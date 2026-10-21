#!/usr/bin/env node
// この PC の Claude Code と Codex の会話の記録から、記事の元になる「前に調べた内容」を探して抜き出す（要る物は Node.js だけ）。
//   node find-history.mjs --query "言葉 言葉 …" [--days 365] [--limit 5] [--out <フォルダ>]
// 探す先:
//   Claude Code … ${CLAUDE_CONFIG_DIR:-~/.claude}/projects/**/*.jsonl
//   Codex       … ${CODEX_HOME:-~/.codex}/{sessions,archived_sessions}/**/*.jsonl
// 並べ方: 当たった言葉の珍しさ（多くの会話に出る言葉ほど軽い）と回数・開いた URL の数・新しさ。
//   ありふれた言葉だけの発言は、珍しい言葉の当たった発言の近くにある時だけ数える（話題の違う所を拾わない）。
// 上位の会話ごとに、関係する問いと答えだけを抜き出したメモ（Markdown）を書く。鍵や合言葉のような文字列は伏せる。
// いま動いている会話（この会話）は外す。ただし要約された会話なら、要約の前の部分を読み直せるようにメモにする。
//   Claude Code と Codex の片方の中でもう片方を動かすと、両方の会話の ID が環境にある。どちらが内側かは見分けられないので、両方を外して名前を出す。
// 探さない場所: ~/.config/ai-digest/history-ignore（1 行に 1 つ。会話の記録のファイルか作業の場所に含まれる文字。
//   # から後は注釈。* だけの行があれば履歴を探さない）
// 読めなかった会話（壊れている・開けない）は数えて出し、終わりの番号を 3 にする（黙って飛ばさない）。
//   道具ごとに、読んだ会話のどれからも発言が取れなければ「記録の形が変わったかもしれない」と出して 3 にする。
//   発言の無い会話（付けたしの記録だけ・終わりの命令だけ）は、数えて出すが誤りにはしない。
// 終わりの番号: 0 探し終えた（見つからなかった時も）・2 使い方の誤り・3 探したが読めなかった会話がある・
//   4 探さない場所の設定（history-ignore）があるのに読めないので、探さずに止めた（設定を無視して全部を探さない）
// 外には何も送らない。読むのは利用者の PC のファイルだけ。
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { maskSecrets, registeredKey, scrub } from './mask.mjs';

const MSG_MAX = 1500; // 1 つの発言から抜き出す上限（字）
const MEMO_MAX = 14000; // 1 つのメモの上限（字）
const URL_MAX = 30; // 1 つのメモに並べる URL の上限
const KEEP_RUNS = 10; // 残しておく探し物の回数（古い物から消す）
const CHUNK = 8 << 20; // 1 回に読む量（バイト）
const HEAD = 2000; // 行の種類を見る、行の頭の長さ（バイト）
const SHORT = 5; // これ以下の長さの英数字の言葉は、単語として出た所だけ当てる（画像のデータや ID の中の偶然の一致を避ける）
const NEAR = 4; // ありふれた言葉の発言を数える、珍しい言葉の発言からの距離（発言の数）

export function roots(env = process.env, home = homedir()) {
  const claude = env.AI_DIGEST_CLAUDE_DIR || env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const codex = env.AI_DIGEST_CODEX_DIR || env.CODEX_HOME || join(home, '.codex');
  return [
    { tool: 'Claude Code', dirs: [join(claude, 'projects')] },
    { tool: 'Codex', dirs: [join(codex, 'sessions'), join(codex, 'archived_sessions')] },
  ];
}

export class IgnoreUnreadable extends Error {}

/** 探さない場所の設定。無い時だけ「全部探す」。あるのに読めない時は止める（利用者が決めた除外を黙って無視しない） */
export function readIgnore(home = homedir()) {
  let text;
  try {
    text = readFileSync(join(home, '.config', 'ai-digest', 'history-ignore'), 'utf-8');
  } catch (e) {
    if (e?.code === 'ENOENT') return { all: false, pats: [] };
    throw new IgnoreUnreadable(`探さない場所の設定（~/.config/ai-digest/history-ignore）を読めない（${e?.code ?? e}）。履歴は探さずに止めた。読めるように直すか、要らなければ消す`);
  }
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean);
  return { all: rows.includes('*'), pats: rows.filter((r) => r !== '*') };
}

/** いま動いている会話の ID（Claude Code と Codex が、実行するコマンドの環境に入れる） */
export function currentIds(env = process.env) {
  return { claude: env.CLAUDE_CODE_SESSION_ID || '', codex: env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || '' };
}

const isSub = (path) => path.includes(`${sep}subagents${sep}`);

export function isCurrent(path, tool, ids) {
  if (tool === 'Codex') return Boolean(ids.codex) && basename(path, '.jsonl').endsWith(ids.codex);
  // Claude Code の下請けの AI の記録は <会話の ID>/subagents/ の下にある
  return Boolean(ids.claude) && (basename(path, '.jsonl') === ids.claude || path.includes(`${sep}${ids.claude}${sep}`));
}

export const wordsOf = (query) =>
  [...new Set(String(query ?? '').normalize('NFKC').toLowerCase().split(/\s+/).filter((w) => [...w].length >= 2))];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isShort = (w) => /^[a-z0-9]+$/.test(w) && w.length <= SHORT;

/** 言葉ごとの、ファイルの生のバイトで探す物（UTF-8 のバイトを 1 字ずつに見立てる。英字は大小を区別しない）。
 *  短い言葉は前後が英数字・+・/ でない所だけ（画像の base64 の中の偶然を拾わない）。JSON の中の改行（\n）の直後は始まりとみなす。
 *  前の字は正規表現の後ろ読みにせず、当たった所で確かめる（後ろ読みから始まる正規表現は、速い探し方が効かず 10 倍遅い） */
export const byteRes = (words) =>
  words.map((w) => {
    const body = esc(Buffer.from(w, 'utf8').toString('latin1'));
    return isShort(w) ? { re: new RegExp(`${body}(?![A-Za-z0-9+/=])`, 'gi'), short: true } : { re: new RegExp(body, 'i'), short: false };
  });

const WORDCH = /[A-Za-z0-9+/\\]/;
/** 生のバイトの文字列 s に言葉が出るか */
export function hasWord(s, { re, short }) {
  if (!short) return re.test(s);
  re.lastIndex = 0;
  for (let m; (m = re.exec(s)); ) {
    const i = m.index;
    if (i === 0 || !WORDCH.test(s[i - 1]) || (i >= 2 && s[i - 2] === '\\' && 'nrt'.includes(s[i - 1]))) return true;
  }
  return false;
}

/** 文の中で言葉を探す正規表現（短い言葉は単語として出た所だけ） */
export const textRes = (words) => words.map((w) => new RegExp(isShort(w) ? `(?<![A-Za-z0-9])${esc(w)}(?![A-Za-z0-9])` : esc(w), 'gi'));

function listJsonl(dir, since, out = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) listJsonl(p, since, out);
    else if (n.endsWith('.jsonl') && st.mtimeMs >= since) out.push({ path: p, mtime: st.mtimeMs });
  }
  return out;
}

/** ファイルにどの言葉が出るか（道具の出力の中も含む。速く当たりを付けるだけ）。開けなければ null */
export function scanFile(path, res, maxLen) {
  const found = new Set();
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.allocUnsafe(CHUNK + maxLen + 2);
    let carry = 0;
    let pos = 0;
    for (;;) {
      const n = readSync(fd, buf, carry, CHUNK, pos);
      if (n <= 0) break;
      const s = buf.toString('latin1', 0, carry + n);
      for (let i = 0; i < res.length; i++) if (!found.has(i) && hasWord(s, res[i])) found.add(i);
      if (found.size === res.length) break;
      pos += n;
      const keep = Math.min(maxLen + 2, carry + n); // 読む区切りをまたぐ言葉（と前後の 1 字）のために、末尾を次へ持ち越す
      buf.copy(buf, 0, carry + n - keep, carry + n);
      carry = keep;
    }
    return found;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** ファイルを行に分け、行の頭（HEAD バイトまで・latin1）を pick に渡す。pick が true の行だけ UTF-8 の文字にして take に渡す。
 *  行の数と、JSON でない行（{ で始まらない行）の数を返す */
export function eachLine(path, pick, take) {
  const fd = openSync(path, 'r');
  const st = { lines: 0, junk: 0 };
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let pos = 0;
    let carry = [];
    const one = (line) => {
      if (!line.length || (line.length === 1 && line[0] === 13)) return;
      st.lines++;
      if (line[0] !== 0x7b) {
        st.junk++;
        return;
      }
      if (pick(line.toString('latin1', 0, Math.min(line.length, HEAD)))) take(line.toString('utf8'));
    };
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      pos += n;
      let s = 0;
      for (;;) {
        const nl = buf.indexOf(10, s);
        if (nl === -1 || nl >= n) {
          if (s < n) carry.push(Buffer.from(buf.subarray(s, n)));
          break;
        }
        const piece = buf.subarray(s, nl);
        one(carry.length ? Buffer.concat([...carry, piece]) : piece);
        carry = [];
        s = nl + 1;
      }
    }
    if (carry.length) one(Buffer.concat(carry));
  } finally {
    closeSync(fd);
  }
  return st;
}

const URL_RE = /https?:\/\/[^\s"'<>`\\{}|^\u0080-\uffff]+/g;
const SECRET_PARAM = /^(.*token.*|.*key.*|sig|signature|secret|password|auth.*|code)$/i;

function trimUrl(u) {
  for (;;) {
    const last = u.at(-1);
    if (/[.,;:!?*\]]/.test(last ?? '')) u = u.slice(0, -1);
    else if (last === ')' && (u.match(/\)/g) ?? []).length > (u.match(/\(/g) ?? []).length) u = u.slice(0, -1);
    else return u;
  }
}

/** 外から開ける URL だけ（手元・社内の番地、名前の形でない番地、鍵の入った URL は外す）。問いの値のうち鍵らしい物は伏せる */
export function publicUrl(raw) {
  let x;
  try {
    x = new URL(trimUrl(String(raw)));
  } catch {
    return '';
  }
  if (!/^https?:$/.test(x.protocol) || x.username || x.password) return '';
  const h = x.hostname.toLowerCase();
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
  if (!ip && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(h)) return '';
  if (/\.(localhost|local|internal|lan|home|corp)$/.test(h)) return '';
  if (ip && /^(127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return '';
  for (const k of [...x.searchParams.keys()]) if (SECRET_PARAM.test(k)) x.searchParams.set(k, '<伏せた>');
  return x.toString();
}
const urlsIn = (t) => (String(t).match(URL_RE) ?? []).map(publicUrl).filter(Boolean);

// 道具が差し込む決まり文句（利用者の言葉ではない）
const NOISE =
  /^(<command-(name|message|args)>|<local-command-(stdout|stderr|caveat)>|Caveat: The messages below|<system-reminder>|<environment_context>|<user_instructions>|<permissions instructions>|<recommended_plugins|<turn_aborted>|# AGENTS\.md|\[Request interrupted)/;
// ほかの AI からの知らせ（下請けの AI の結果・同じ組の AI の言葉）
const AGENT = /^(<(task-notification|teammate-message)|Another Claude session sent a message)/;
const cleanText = (t) => String(t ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();

/** Claude Code の 1 行 → 要る物だけ（発言・URL・検索した言葉・題・作業の場所）。要らない行は null */
export function fromClaude(d) {
  if (d.type === 'ai-title' && d.aiTitle) return { title: String(d.aiTitle) };
  if (d.type === 'summary' && typeof d.summary === 'string') return { title: d.summary };
  if (d.type !== 'user' && d.type !== 'assistant') return null;
  const out = { msgs: [], urls: [], queries: [], cwd: d.cwd, ts: d.timestamp, compacted: Boolean(d.isCompactSummary) };
  const c = d.message?.content;
  if (d.type === 'user') {
    if (d.isMeta) return out;
    const texts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text) : [];
    for (const raw of texts) {
      const t = cleanText(raw);
      if (!t || NOISE.test(t)) continue;
      out.msgs.push({ role: d.isCompactSummary ? 'summary' : AGENT.test(t) ? 'agent' : 'user', text: t });
      out.urls.push(...urlsIn(t));
    }
    return out;
  }
  for (const b of Array.isArray(c) ? c : []) {
    if (b?.type === 'text' && b.text?.trim()) {
      out.msgs.push({ role: 'assistant', text: b.text.trim() });
      out.urls.push(...urlsIn(b.text));
    } else if (b?.type === 'tool_use') {
      const i = b.input ?? {};
      if (b.name === 'WebFetch' && i.url) out.urls.push(...urlsIn(i.url));
      else if (b.name === 'WebSearch' && i.query) out.queries.push(String(i.query));
      else if (typeof i.command === 'string') out.urls.push(...urlsIn(i.command));
    }
  }
  return out;
}

/** Codex の 1 行 → 要る物だけ。要らない行は null */
export function fromCodex(d) {
  const p = d.payload ?? {};
  if (d.type === 'session_meta') return { cwd: p.cwd, ts: p.timestamp ?? d.timestamp };
  if (d.type === 'compacted') return { compacted: true };
  if (d.type !== 'response_item') return null;
  const out = { msgs: [], urls: [], queries: [], ts: d.timestamp };
  if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
    for (const c of p.content ?? []) {
      const t = cleanText(c?.text);
      if (!t || NOISE.test(t)) continue;
      out.msgs.push({ role: p.role === 'user' && AGENT.test(t) ? 'agent' : p.role, text: t });
      out.urls.push(...urlsIn(t));
    }
    return out;
  }
  if (p.type === 'web_search_call') {
    const a = p.action ?? {};
    for (const q of [a.query, ...(Array.isArray(a.queries) ? a.queries : [])]) if (q) out.queries.push(String(q));
    if (a.url) out.urls.push(...urlsIn(a.url));
    return out;
  }
  if (p.type === 'function_call' || p.type === 'custom_tool_call') {
    out.urls.push(...urlsIn(p.arguments ?? p.input ?? ''));
    return out;
  }
  return null;
}

// 行の頭だけで、読む行を決める（道具の出力・画像のデータ・考えの途中は大きく、記事の元にならない）
const CODEX_WANT = new Set(['message', 'web_search_call', 'function_call', 'custom_tool_call']);
const SHAPE = {
  'Claude Code': {
    pick: (h) =>
      !/^\{"type":"(?!user"|assistant"|ai-title"|summary")/.test(h) &&
      ((h.includes('"type":"user"') && !h.includes('"type":"tool_result"')) || h.includes('"role":"assistant"') || /"type":"(ai-title|summary)"/.test(h)),
    parse: fromClaude,
  },
  Codex: {
    pick: (h) => {
      const top = h.match(/"type":"([a-z_]+)"/)?.[1]; // 頭の中で最初の type が、行の種類
      if (top === 'session_meta' || top === 'compacted') return true;
      if (top !== 'response_item') return false;
      const p = h.match(/"payload":\{"type":"([a-z_]+)"/)?.[1];
      return p === undefined || CODEX_WANT.has(p); // 形が分からない時は読む
    },
    parse: fromCodex,
  },
};

/** 会話 1 つを読む。発言・URL と検索した言葉（どのやりとりで出たか）・題・作業の場所・始めの時刻。
 *  やりとり（turn）は、利用者の 1 つの問いと、次の問いまでの答え・道具の使用。
 *  clean で、発言・URL・検索した言葉・題を読んだ時に伏せる（抜き出しや省略で鍵の終わりの印が切れる前に） */
export function readSession(path, tool, clean = (t) => t) {
  const { pick, parse } = SHAPE[tool];
  const s = { tool, path, cwd: '', started: '', title: '', compacted: false, msgs: [], urls: new Map(), queries: new Map(), lines: 0, junk: 0, tried: 0, bad: 0, turn: 0 };
  const st = eachLine(path, pick, (l) => {
    s.tried++;
    let d;
    try {
      d = JSON.parse(l);
    } catch {
      s.bad++;
      return;
    }
    const r = parse(d);
    if (!r) return;
    if (r.cwd && !s.cwd) s.cwd = String(r.cwd);
    if (r.ts && !s.started) s.started = String(r.ts);
    if (r.title && !s.title) s.title = clean(r.title.trim());
    if (r.compacted) s.compacted = true;
    for (const m of r.msgs ?? []) {
      if (m.role === 'user') s.turn++;
      s.msgs.push({ ...m, text: clean(m.text), ts: r.ts, turn: s.turn });
    }
    for (const raw of r.urls ?? []) {
      const u = clean(raw);
      if (u.startsWith('<伏せた')) continue; // 伏せた URL（送れてしまう受け口など）は一覧に出さない
      if (!s.urls.has(u)) s.urls.set(u, s.turn);
    }
    for (const raw of r.queries ?? []) {
      const q = clean(raw);
      if (!s.queries.has(q)) s.queries.set(q, s.turn);
    }
  });
  s.lines = st.lines;
  s.junk = st.junk;
  return s;
}

const norm = (t) => t.normalize('NFKC');
const count = (re, t) => {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(t)) n++;
  return n;
};

/** 関係する発言を決めて、会話に点を付ける。
 *  強い言葉（いちばん珍しい言葉の重みの 3/4 以上）の当たった発言と、その近く（NEAR 発言以内）の弱い言葉の発言が「関係する発言」。
 *  強い言葉の当たりが無い会話は、当たった発言の全部 */
export function score(s, words, weight, now = Date.now()) {
  const res = textRes(words);
  const top = Math.max(...words.map((w) => weight[w] ?? 1));
  const strong = words.map((w) => (weight[w] ?? 1) >= top * 0.75);
  const per = s.msgs.map((m) => {
    m.nt ??= norm(m.text);
    return res.map((re) => count(re, m.nt));
  });
  const strongAt = per.flatMap((h, i) => (h.some((n, k) => n && strong[k]) ? [i] : []));
  const rel = [];
  per.forEach((h, i) => {
    if (!h.some(Boolean)) return;
    if (!strongAt.length || strongAt.some((j) => Math.abs(j - i) <= NEAR)) rel.push(i);
  });
  const hits = Object.fromEntries(words.map((w) => [w, 0]));
  for (const i of rel) per[i].forEach((n, k) => (hits[words[k]] += n));
  const kinds = words.filter((w) => hits[w] > 0).length;
  const total = Object.values(hits).reduce((a, b) => a + b, 0);
  const last = rel.length ? Date.parse(s.msgs[rel.at(-1)].ts) : Date.parse(s.started);
  const ageDays = Number.isNaN(last) ? 365 : (now - last) / 86_400_000;
  const turns = new Set(rel.map((i) => s.msgs[i].turn));
  const near = (turn) => turns.has(turn);
  const urls = [...s.urls].filter(([u, turn]) => near(turn) || res.some((re) => count(re, u) > 0));
  // 強い言葉の当たった会話は、弱い言葉だけの会話より必ず上に並べる
  let value = (strongAt.length ? 100 : 0) + Math.min(urls.length, 20) / 4 + Math.max(0, 3 - ageDays / 60);
  for (const w of words) if (hits[w]) value += (weight[w] ?? 1) * (2 + Math.log2(1 + hits[w]));
  // 関係する発言の重み（記事の元として強い順にメモへ入れるため）
  const msgWeight = new Map(rel.map((i) => [i, per[i].reduce((a, n, k) => a + (n ? weight[words[k]] ?? 1 : 0), 0)]));
  return { kinds, total, hits, value, rel, msgWeight, urls, near, strong: strongAt.length > 0 };
}

/** 長い発言は、言葉の当たった前後だけ抜き出す */
export function excerpt(text, words, max = MSG_MAX) {
  if (text.length <= max) return text;
  const spans = [];
  for (const re of textRes(words)) {
    re.lastIndex = 0;
    for (let m, n = 0; (m = re.exec(text)) && n < 20; n++) spans.push([Math.max(0, m.index - 250), Math.min(text.length, m.index + m[0].length + 450)]);
  }
  if (!spans.length) return `${text.slice(0, max)}…（以下略）`;
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const sp of spans) {
    const last = merged.at(-1);
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([...sp]);
  }
  let out = '';
  for (const [a, b] of merged) {
    const piece = `${a > 0 ? '…' : ''}${text.slice(a, b)}${b < text.length ? '…' : ''}`;
    if (out.length + piece.length > max) {
      out = out ? `${out}\n（ほかの当たりは略）` : `${piece.slice(0, max)}…`;
      break;
    }
    out += (out ? '\n' : '') + piece;
  }
  return out;
}

/** 記録の時刻を、この PC の時刻で「2026-10-18 12:34（UTC+9）」の形に */
export function localTime(ts, dateOnly = false) {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return '?';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (dateOnly) return day;
  const off = -d.getTimezoneOffset() / 60;
  return `${day} ${p(d.getHours())}:${p(d.getMinutes())}（UTC${off >= 0 ? '+' : ''}${off}）`;
}

const oneLine = (t, n) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
const LABEL = { user: '利用者', assistant: 'AI', summary: '会話の要約', agent: 'ほかの AI からの知らせ' };

/** 関係する発言の、問い。発言が利用者の言葉ならそれ、そうでなければ前の利用者の言葉。
 *  利用者の言葉が無い会話（ほかの AI に頼まれて動いた AI の会話）は、前のほかの AI からの頼み */
function askOf(s, i) {
  for (let j = i; j >= 0; j--) if (s.msgs[j].role === 'user') return s.msgs[j];
  for (let j = i; j >= 0; j--) if (s.msgs[j].role === 'agent') return s.msgs[j];
  return null;
}
/** 1 行で見せる時は、道具が付けた印（<teammate-message …> など）を外す */
const plain = (t) => String(t ?? '').replace(/<\/?[a-z][a-z_-]*(\s[^>]{0,300})?>/gi, ' ');

/** 関係する問いと答えだけのメモ。重い発言から順に、問い（そのやりとりの利用者の言葉）と答え（次の AI の言葉と、
 *  そのやりとりの最後の AI の言葉。「調べます」の後の調べた結果は、話題の言葉を含まないことが多い）を添えて入れ、時刻の順に並べる */
export function memo(s, words, sc, { note = '' } = {}) {
  const lastAi = new Map(); // やりとりごとの、最後の AI の言葉
  s.msgs.forEach((m, i) => m.role === 'assistant' && lastAi.set(m.turn, i));
  const order = [...sc.rel].sort((a, b) => sc.msgWeight.get(b) - sc.msgWeight.get(a) || a - b);
  const pick = new Set();
  let size = 0;
  const add = (i) => {
    if (i < 0 || pick.has(i)) return true;
    const len = Math.min(s.msgs[i].text.length, MSG_MAX) + 60;
    if (size + len > MEMO_MAX) return false;
    pick.add(i);
    size += len;
    return true;
  };
  let full = false;
  for (const i of order) {
    if (!add(i)) {
      full = true;
      break;
    }
    const m = s.msgs[i];
    if (m.role === 'user') {
      if (s.msgs[i + 1]?.role === 'assistant') add(i + 1);
    } else if (m.role !== 'summary') {
      const q = askOf(s, i);
      if (q) add(s.msgs.indexOf(q));
    }
    if (m.role !== 'summary' && lastAi.has(m.turn)) add(lastAi.get(m.turn));
  }
  const first = sc.rel.length ? askOf(s, sc.rel[0]) : null;
  const urls = sc.urls.slice(0, URL_MAX);
  const queries = [...s.queries].filter(([q, turn]) => sc.near(turn) || words.some((w) => norm(q).toLowerCase().includes(w)));
  const head = [
    `# ${s.tool} の会話${isSub(s.path) ? '（下請けの AI）' : ''}: ${oneLine(plain(first?.text) || s.title, 80) || '（題なし）'}`,
    ...(note ? [`> ${note}`] : []),
    `- 関係する所の始め: ${localTime(sc.rel.length ? s.msgs[sc.rel[0]].ts : s.started)}`,
    `- 会話の題（道具が付けた）: ${oneLine(s.title, 80) || '（無し）'}`,
    `- 作業の場所: ${s.cwd || '?'}`,
    `- 記録のファイル: ${s.path}`,
    `- 当たった言葉: ${Object.entries(sc.hits).filter(([, n]) => n).map(([w, n]) => `${w}（${n}）`).join('・')}`,
    '',
    `## 関係する所で開いた URL${sc.urls.length > URL_MAX ? `（${sc.urls.length} 件のうち ${URL_MAX} 件）` : ''}`,
    ...(urls.length ? urls.map(([u]) => `- ${u}`) : ['- （無し）']),
    ...(queries.length ? ['', '## 関係する所で検索した言葉', ...queries.slice(0, 20).map(([q]) => `- ${oneLine(q, 120)}`)] : []),
    '',
    '## 関係する問いと答え（抜き出し・時刻の順）',
  ];
  const body = [...pick]
    .sort((a, b) => a - b)
    .map((i) => `\n### ${LABEL[s.msgs[i].role] ?? s.msgs[i].role}（${localTime(s.msgs[i].ts)}）\n${excerpt(s.msgs[i].text, words)}\n`)
    .join('');
  return `${head.join('\n')}\n${body}${full ? '\n…（長いので、関係の強い所だけ入れた。続きは記録のファイルにある）\n' : ''}`;
}

const STAMP = /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

export async function findHistory({ query, days = 365, limit = 5, out, env = process.env, home = homedir(), now = Date.now(), log = console.log }) {
  const words = wordsOf(query);
  if (!words.length) throw new Error('--query に探す言葉（2 文字以上）を 1 つ以上');
  if (!(days > 0) || !(limit > 0)) throw new Error('--days と --limit は 1 以上の数');
  const key = registeredKey({ env, home });
  const clean = (t) => scrub(maskSecrets(t), key);
  const say = (t) => log(clean(t));
  const ig = readIgnore(home);
  if (ig.all) {
    say('履歴は探さない設定（~/.config/ai-digest/history-ignore に * の行がある）。探さなかった');
    return { off: true, words, written: [], selfMemos: [], unreadable: 0 };
  }
  const since = now - days * 86_400_000;
  const ids = currentIds(env);
  const places = roots(env, home);
  const files = [];
  for (const r of places) for (const d of r.dirs) for (const f of listJsonl(d, since)) files.push({ ...f, tool: r.tool });

  // 1. どのファイルにどの言葉が出るか（言葉の珍しさを測り、当たりを付ける）
  const res = byteRes(words);
  const maxLen = Math.max(...words.map((w) => Buffer.byteLength(w)));
  const df = Object.fromEntries(words.map((w) => [w, 0]));
  const unreadable = [];
  let ignored = 0;
  const hitFiles = [];
  for (const f of files) {
    if (ig.pats.some((x) => f.path.includes(x))) {
      ignored++;
      continue;
    }
    const found = scanFile(f.path, res, maxLen);
    if (found === null) {
      unreadable.push(`${f.path}（開けない）`);
      continue;
    }
    for (const i of found) df[words[i]]++;
    if (found.size) hitFiles.push(f);
  }
  const weight = Object.fromEntries(words.map((w) => [w, 1 + Math.log((files.length + 1) / (df[w] + 1))]));

  // 2. 当たったファイルを会話として読み、発言の中の当たりで並べる（道具の出力の中だけに出た言葉は数えない）
  const cands = [];
  const selves = [];
  let selfParts = 0;
  let empty = 0; // 発言の無い会話
  let damaged = 0; // 一部の行が壊れている会話（読める所は使う）
  const readBy = { 'Claude Code': 0, Codex: 0 };
  const talkBy = { 'Claude Code': 0, Codex: 0 };
  for (const f of hitFiles) {
    let s;
    try {
      s = readSession(f.path, f.tool, clean);
    } catch {
      unreadable.push(`${f.path}（開けない）`);
      continue;
    }
    if (s.lines > 0 && s.junk + s.bad === s.lines) {
      unreadable.push(`${f.path}（壊れている）`);
      continue;
    }
    if (s.junk + s.bad > 0) damaged++;
    readBy[f.tool]++;
    if (s.msgs.length === 0 && s.urls.size === 0 && s.queries.size === 0) {
      empty++;
      continue;
    }
    talkBy[f.tool]++;
    if (s.cwd && ig.pats.some((x) => s.cwd.includes(x))) {
      ignored++;
      continue;
    }
    const sc = score(s, words, weight, now);
    if (!sc.kinds) continue;
    if (isCurrent(f.path, f.tool, ids)) {
      if (isSub(f.path)) selfParts++;
      else selves.push({ s, sc });
      continue;
    }
    cands.push({ s, sc });
  }
  // 読んだ会話のどれからも発言が取れない道具は、記録の形が変わったかもしれない（黙って「見つからない」にしない）
  for (const t of Object.keys(readBy)) {
    if (readBy[t] >= 3 && talkBy[t] === 0) unreadable.push(`${t} の会話 ${readBy[t]} 件から、発言が 1 つも取れなかった（記録の形が変わったかもしれない）`);
  }
  cands.sort((a, b) => b.sc.value - a.sc.value);
  const top = cands.slice(0, limit);

  // 3. メモを書く（鍵・合言葉のような文字列は伏せる）。ホームに書けない時（Codex のサンドボックスなど）は一時の置き場へ
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  let base = join(home, '.ai-digest-skill', 'history');
  let dir = out ?? join(base, stamp);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (e) {
    // 書けない理由の番号は場所によって違う（Codex のサンドボックスでは ENOENT だった）。--out を指定していない時は、理由を問わず一時の置き場へ
    if (out) throw e;
    base = join(tmpdir(), 'ai-digest-history');
    dir = join(base, stamp);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    say(`ホームの ~/.ai-digest-skill に書けないので、メモは一時の置き場に書いた: ${base}`);
  }
  const write = (name, text) => {
    const p = join(dir, name);
    writeFileSync(p, scrub(maskSecrets(text), key), { mode: 0o600 });
    return p;
  };
  const tag = (s) => `${s.tool === 'Codex' ? 'codex' : 'claude'}-${basename(s.path, '.jsonl').slice(-12)}`;
  const written = top.map(({ s, sc }, i) => ({ path: write(`${i + 1}-${tag(s)}.md`, memo(s, words, sc)), s, sc }));
  const selfMemos = selves.map(({ s, sc }) =>
    s.compacted ? write(`0-this-${tag(s)}.md`, memo(s, words, sc, { note: 'この会話。要約される前の部分も入っている（要約で消えた細部を読み直すため）' })) : '',
  );
  if (!out) {
    try {
      const runs = readdirSync(base).filter((r) => STAMP.test(r)).sort();
      for (const r of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) rmSync(join(base, r), { recursive: true, force: true });
    } catch {
      // 消せなくても探し物には響かない
    }
  }

  // 4. 結果を出す（画面に出す物も鍵を伏せる）
  say(`探した言葉: ${words.join(' ')}（${days} 日以内の会話 ${files.length} 件を探した）`);
  if (!files.length) say(`会話の記録が見つからない。探した場所: ${places.flatMap((r) => r.dirs).join('・')}`);
  say(`当たった会話: ${cands.length} 件（この会話は数えない）。上位 ${written.length} 件をメモにした`);
  for (const [i, w] of written.entries()) {
    const { s, sc } = w;
    const ask = sc.rel.length ? askOf(s, sc.rel[0]) : null;
    say(`${i + 1}. ${s.tool}${isSub(s.path) ? '（下請けの AI）' : ''}｜${localTime(sc.rel.length ? s.msgs[sc.rel[0]].ts : s.started, true)}｜場所 ${s.cwd || '?'}｜依頼「${oneLine(plain(ask?.text) || s.title, 40) || '？'}」｜言葉 ${sc.kinds}/${words.length} 種・${sc.total} 回｜URL ${sc.urls.length}`);
    say(`   メモ: ${w.path}`);
  }
  if (!written.length) say('前に調べた会話は見つからなかった');
  selves.forEach(({ s }, i) =>
    say(`この会話（${s.tool}）: ${selfMemos[i] ? `要約されているので、要約の前の部分もメモにした → ${selfMemos[i]}` : '言葉は当たったが、いま読めているので外した'}`),
  );
  if (selves.length > 1) say('（Claude Code と Codex の両方の会話の ID が環境にあった。片方の中でもう片方を動かしている。どちらも外した）');
  if (selfParts) say(`この会話の下請けの AI の記録 ${selfParts} 件も外した`);
  if (ignored) say(`探さない場所（history-ignore）に当たった会話: ${ignored} 件`);
  if (empty) say(`発言の無い会話: ${empty} 件（付けたしの記録や終わりの命令だけ。飛ばした）`);
  if (damaged) say(`一部の行が壊れている会話: ${damaged} 件（読める所は使った）`);
  if (unreadable.length) {
    say(`読めなかった物: ${unreadable.length} 件（壊れている・開けない・記録の形が変わった。探し漏れの恐れ）`);
    for (const u of unreadable.slice(0, 5)) say(`   ${u}`);
  }
  return { words, files: files.length, candidates: cands.length, written: written.map((w) => w.path), selfMemos: selfMemos.filter(Boolean), unreadable: unreadable.length, ignored, dir };
}

if (process.argv[1] && basename(process.argv[1]) === 'find-history.mjs') {
  const a = process.argv.slice(2);
  const known = new Set(['--query', '--days', '--limit', '--out']);
  const bad = a.filter((x, i) => x.startsWith('--') && !known.has(x) && !(i > 0 && known.has(a[i - 1])));
  const val = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  try {
    if (bad.length) throw new Error(`知らない引数: ${bad.join(' ')}`);
    const r = await findHistory({ query: val('--query'), days: Number(val('--days') ?? 365), limit: Number(val('--limit') ?? 5), out: val('--out') });
    process.exit(r.unreadable ? 3 : 0);
  } catch (e) {
    if (e instanceof IgnoreUnreadable) {
      console.error(`止めた: ${e.message}`);
      process.exit(4);
    }
    console.error(`止めた: ${scrub(maskSecrets(String(e?.message ?? e)))}`);
    console.error('使い方: node find-history.mjs --query "言葉 言葉 …" [--days 365] [--limit 5] [--out <フォルダ>]');
    process.exit(2);
  }
}
