#!/usr/bin/env node
// ai-digest に記事を送る・鍵を確かめる（投稿する人の手元で使う。要る物は Node.js 22 以上だけ）。
//   node post.mjs --check                                   … 鍵と URL と投稿者名を確かめる（何も送らない）
//   node post.mjs --set-name "<投稿者名>"                   … 記事の下に「投稿者：<名前>」と表示される名前を登録する（~/.config/ai-digest/name）
//   node post.mjs <記事.md> [--image <絵>]... [--publish]   … 送る（--publish は送った後に公開。publisher / admin だけ）
// URL と鍵は、先に見つかった物を使う: 環境変数 AI_DIGEST_API_URL / AI_DIGEST_API_KEY → ~/.config/ai-digest/url・key
// （登録のしかたは ../references/setup.md）。鍵は画面に出さない。--url / --key の引数も使えるが、鍵は履歴に残るので勧めない。
// 終わりの番号: 0 済んだ／1 鍵が違う・つながらない・送れなかった／2 使い方の誤り・登録が無い／5 鍵は有効だが投稿者名が未登録（--check）
// サイトの側の scripts/post.mjs はこのファイルを読む（正はここ）。
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { scrub } from './mask.mjs';
import { AUTHOR_PREFIX, NAME_MAX, nameFile, registeredName, saveName, validateName } from './author.mjs';

export { scrub };

const SETUP = 'このスキルのフォルダの references/setup.md';
const KINDS = ['articles', 'digests'];
const UNREGISTERED = 'このPCで作ったばかりの鍵なら、運営がハッシュ値を登録するまで使えない（node key.mjs hash で出る1行が運営に届いているかを確かめてもらう）。運営から受け取った鍵なら、写し間違いが無いかを見て、だめなら運営に連絡する';
/** 鍵の形（運営が発行する鍵は aid_ と 16 進 48 字）。違えば通信の前に止める（改行などが混ざった鍵は、通信の例外文に全文が載るため） */
export const KEY_RE = /^aid_[0-9a-f]{48}$/;

// 画面に出す物は全部ここを通す（URL や引数の入れ間違いで鍵が出ないように）。鍵は設定を読んだ所で覚える
let knownKey = '';
const out = (...a) => console.log(...a.map((x) => scrub(x, knownKey)));
/** 名前を差し込む行を出す。parts の NAME の所に名前をそのまま入れ、ほかの部分はそれぞれ先に伏せる。
 *  名前は決まりで確かめた物（鍵ではない）なので伏せない（said_ali が「aid_<鍵>」に壊れないように）。
 *  行全体で名前の文字を置き換えてから伏せると、短い名前（a など）が鍵の中の同じ文字まで変えて、鍵を伏せられなくなる */
const NAME = Symbol('name');
const outParts = (parts, name) => console.log(parts.map((p) => (p === NAME ? name : scrub(String(p), knownKey))).join(''));
const ROLES = ['writer', 'publisher', 'admin'];
const KEY_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const err = (...a) => console.error(...a.map((x) => scrub(x, knownKey)));

/** fetch の包み。通信の失敗は、元の例外文（鍵を含みうる）を出さずに、理由の符号だけの例外にする */
async function request(url, init) {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new Error(`通信できない（${e?.cause?.code ?? e?.code ?? e?.name ?? 'エラー'}）`);
  }
}

export const configDir = (home = homedir()) => join(home, '.config', 'ai-digest');

const readTrim = (file) => {
  try {
    return readFileSync(file, 'utf-8').trim();
  } catch {
    return '';
  }
};

/** URL と鍵を探す。どこで見つけたか（from）も返す。鍵の値は表示に使わない */
export function resolveConfig({ args = {}, env = process.env, home = homedir() } = {}) {
  const dir = configDir(home);
  const fileUrl = readTrim(join(dir, 'url'));
  const fileKey = readTrim(join(dir, 'key'));
  const url = (args.url || env.AI_DIGEST_API_URL || fileUrl || '').trim().replace(/\/+$/, '');
  const key = (args.key || env.AI_DIGEST_API_KEY || fileKey || '').trim();
  const urlFrom = args.url ? '--url' : env.AI_DIGEST_API_URL ? '環境変数 AI_DIGEST_API_URL' : fileUrl ? join(dir, 'url') : '';
  const keyFrom = args.key ? '--key' : env.AI_DIGEST_API_KEY ? '環境変数 AI_DIGEST_API_KEY' : fileKey ? join(dir, 'key') : '';
  return { url, key, urlFrom, keyFrom };
}

export function parseArgs(argv) {
  const opt = { file: '', images: [], publish: false, check: false, setName: undefined, kind: 'articles', url: '', key: '', errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--image') opt.images.push(argv[++i] ?? '');
    else if (a === '--publish') opt.publish = true;
    else if (a === '--check') opt.check = true;
    else if (a === '--set-name') {
      opt.setName = argv[++i];
      if (opt.setName === undefined) opt.errors.push('--set-name の後に投稿者名を書く');
    }
    else if (a === '--kind') opt.kind = argv[++i] ?? '';
    else if (a === '--url') opt.url = argv[++i] ?? '';
    else if (a === '--key') opt.key = argv[++i] ?? '';
    else if (!opt.file && !a.startsWith('--')) opt.file = a;
    else opt.errors.push(`知らない引数: ${a}`);
  }
  if (!KINDS.includes(opt.kind)) opt.errors.push(`--kind は ${KINDS.join(' か ')}`);
  if (opt.setName !== undefined && (opt.file || opt.check || opt.publish || opt.images.length)) opt.errors.push('--set-name はほかの指定と一緒に使わない');
  return opt;
}

const USAGE = '使い方: node post.mjs --check ／ node post.mjs --set-name "<投稿者名>" ／ node post.mjs <記事.md> [--image <絵>]... [--publish]';
const ROLE_CAN = { writer: '下書きまで送れる。公開は運営が確かめてから', publisher: '自分の記事は確かめなしで公開できる', admin: '誰の記事でも公開・書き換えできる' };

async function check(cfg, headers) {
  let r;
  try {
    r = await request(`${cfg.url}/api/articles`, { headers });
  } catch (e) {
    err(`サイトにつながらない: ${cfg.url}（${e.message}）。URL を確かめる（${cfg.urlFrom}）`);
    return 1;
  }
  const j = await r.json().catch(() => null);
  if (r.status === 401) {
    err(`鍵が違うか、失効している（鍵の場所: ${cfg.keyFrom}）。${UNREGISTERED}`);
    return 1;
  }
  if (!r.ok || !j?.ok) {
    err(`確かめられなかった: HTTP ${r.status}（URL が違う・サイトが止まっている など）`);
    return 1;
  }
  const role = ROLES.includes(j.me?.role) ? j.me.role : '?'; // 知っている役だけを出す
  const keyName = KEY_NAME_RE.test(j.me?.name ?? '') ? j.me.name : '?'; // サイトが決まりで確かめた鍵の名前（32 字まで。鍵ではない）
  outParts(['鍵は有効です: ', NAME, `（${role}・${ROLE_CAN[role] ?? ''}）。自分の記事 ${Array.isArray(j.articles) ? j.articles.length : 0} 本`], keyName);
  out(`URL: ${cfg.url}（${cfg.urlFrom}）・鍵の場所: ${cfg.keyFrom}`);
  return 0;
}

/** 投稿者名の行（--check で出す） */
function nameParts(a) {
  if (a.error) return [`投稿者名の登録が正しくない（${a.error}・${a.from}）。node post.mjs --set-name "<名前>" で登録し直す`];
  if (a.name) return ['投稿者名: ', NAME, `（記事の下に「${AUTHOR_PREFIX}`, NAME, `」と表示される・${a.from}）`];
  return ['投稿者名: 未登録。記事の下に「投稿者：<名前>」と表示される名前を決めて、node post.mjs --set-name "<名前>" で登録する'];
}

/** 投稿者名を確かめて登録する（通信しない。鍵が無くても使える） */
function setName(raw) {
  const v = validateName(raw);
  if (v.error) {
    err(`投稿者名にできない: ${v.error}。記事の下に「投稿者：<名前>」と表示される名前を、${NAME_MAX} 字までで決める`);
    return 2;
  }
  let file;
  try {
    file = saveName(v.name);
  } catch (e) {
    err(`投稿者名を書けなかった（${e?.code ?? e?.message ?? e}）: ${nameFile()}`);
    return 1;
  }
  outParts(['投稿者名を登録した: ', NAME, `（記事の下に「${AUTHOR_PREFIX}`, NAME, `」と表示される・${file}）`], v.name);
  return 0;
}

export async function main(argv) {
  try {
    return await run(argv);
  } catch (e) {
    // 思いがけない失敗でも、鍵を含みうる文はそのまま出さない（err が消す）
    err(`失敗: ${e?.message ?? e}`);
    return 1;
  }
}

async function run(argv) {
  const opt = parseArgs(argv);
  const cfg = resolveConfig({ args: opt });
  knownKey = cfg.key; // ここから先の表示は、この鍵を消してから出す（引数の誤りの表示も）
  if (opt.errors.length) {
    for (const e of opt.errors) err(e);
    err(USAGE);
    return 2;
  }
  if (opt.setName !== undefined) return setName(opt.setName);
  const author = registeredName();
  if (opt.check) outParts(nameParts(author), author.name); // 投稿者名は validateName で確かめ済み（鍵のような文字列は断っている）
  if (opt.key) err(`注意: --key で渡した鍵はシェルの履歴に残る。次からは端末に登録した鍵を使う（${SETUP}）`);
  if (!cfg.url || !cfg.key) {
    const missing = [!cfg.url && 'サイトの URL', !cfg.key && '投稿の鍵'].filter(Boolean).join(' と ');
    err(`${missing}が見つからない（環境変数 AI_DIGEST_API_URL・AI_DIGEST_API_KEY も ${configDir()} の url・key も無い）。`);
    if (!cfg.key) err(`投稿用の鍵は、このPCで作れる: node key.mjs new <鍵の名前>（出た1行＝鍵のハッシュ値を運営に送る）。運営から鍵を受け取った人は ${SETUP} の手順で登録する（AI との会話には貼らない）`);
    if (!cfg.url) err(`サイトの URL は運営から受け取り、${SETUP} の手順で登録する`);
    return 2;
  }
  if (!/^https:\/\//.test(cfg.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cfg.url)) {
    err(`URL は https:// で始める（今: ${cfg.url}・${cfg.urlFrom}）`);
    return 2;
  }
  if (!KEY_RE.test(cfg.key)) {
    err(`鍵の形が違う（aid_ で始まる 52 文字の英数字のはず）。空白や改行が混ざっていないかを見て、登録し直す（${SETUP}）。鍵の場所: ${cfg.keyFrom}。鍵の中身は表示しない`);
    return 2;
  }
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` };
  if (opt.check) {
    const code = await check(cfg, headers);
    return code === 0 && !author.name ? 5 : code; // 鍵は有効でも、投稿者名が無ければ記事を書き終えられない
  }
  if (!opt.file) {
    err(USAGE);
    return 2;
  }

  const markdown = readFileSync(opt.file, 'utf-8');
  const body = { markdown, kind: opt.kind };
  if (opt.images.length) body.images = opt.images.map((f) => ({ name: basename(f), base64: readFileSync(f).toString('base64') }));
  let r;
  try {
    r = await request(`${cfg.url}/api/articles`, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    err(`送れなかった: ${cfg.url}（${e.message}）。node post.mjs --check で確かめる`);
    return 1;
  }
  const j = await r.json().catch(() => ({}));
  out(`投稿: HTTP ${r.status}`, JSON.stringify(j));
  if (r.status === 401) err(`鍵が違うか、失効している（${cfg.keyFrom}）。${UNREGISTERED}`);
  if (!r.ok) return 1;
  if (opt.publish) {
    let r2;
    try {
      r2 = await request(`${cfg.url}/api/articles/publish`, { method: 'POST', headers, body: JSON.stringify({ slug: j.slug, kind: opt.kind }) }); // 投稿の返事にある解析済みの slug
    } catch (e) {
      err(`公開にできなかった（下書きは送れている）: ${e.message}`);
      return 1;
    }
    const j2 = await r2.json().catch(() => ({}));
    out(`公開: HTTP ${r2.status}`, JSON.stringify(j2));
    if (r2.status === 403) err('公開できるのは publisher（自分の記事）と admin の鍵だけ。writer の鍵なら下書きのまま運営の確かめを待つ');
    if (!r2.ok) return 1;
  }
  return 0;
}

// node post.mjs …（サイトの側の scripts/post.mjs から読まれた時も、名前が post.mjs なので動く）
if (process.argv[1] && basename(process.argv[1]) === 'post.mjs') process.exit(await main(process.argv.slice(2)));
