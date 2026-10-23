#!/usr/bin/env node
// 送る前の確かめ（ai-digest の記事）。要る物は Node.js だけ。
//   node check.mjs <記事.md>...
// 「直す」が 1 つでもあれば 1 で終わる（送ってもサーバーで断られる・サイトの決まりに外れる）。
// 「見る」は文の癖の注意（yomiyasu が無い時の代わりの目安。止めはしない）。
// 見出しの決まり（checkTitle）は、サイトの側の scripts/title-check.mjs もここを読む（正はここ）。
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { registeredKey, scrub } from './mask.mjs';
import { registeredName, writtenBy } from './author.mjs';

export const TITLE_MAX = 50;
export const BODY_MAX = 1000;
export const HEADINGS = ['何が起きた', 'あなたに関係あるか', 'やるなら何を', 'どのくらい確か'];
export const GENRES = ['AIモデル', '画像生成', '動画生成', '音声', '3D・アバター', 'AIエージェント', '使い方', '仕事', 'ニュースの読み方', '安全・プライバシー', 'その他'];
export const CONFIDENCES = ['公式の発表', '試した結果', '投稿の主張', '推論'];

/** 見出しの問題点（空なら良い）。見出しは「最大の要約」: 読まなくても内容が分かる 1 文。情緒や誘いを入れない */
export function checkTitle(title) {
  const t = String(title ?? '').trim();
  const problems = [];
  if (!t) return ['見出しが空'];
  if (t.length > TITLE_MAX) problems.push(`長い（${t.length} 字。${TITLE_MAX} 字まで）`);
  if (/[?？]/.test(t) || /(?:か|のか|だろうか)[。]?$/.test(t) || /か。/.test(t)) problems.push('疑問形（答えを見出しに書く）');
  if (/本当か|真相|正体|実は|衝撃|驚き|ヤバい|すごい|必見|決定版|完全|最強|革命|覇権/.test(t)) problems.push('煽りや情緒の言葉');
  if (/た話$|してみた$|やってみた$|考えてみた$|まとめ$/.test(t)) problems.push('「〜した話」「〜してみた」の形（内容ではなく行為の見出し）');
  if (/へ。|へ$/.test(t)) problems.push('「〜へ」の形（変化の宣言。何がどうなったかを書く）');
  if (/[…‥]|\.\.\./.test(t)) problems.push('「…」で引っぱる');
  if (/[ぁ-んァ-ン一-龥] [A-Za-z0-9]|[A-Za-z0-9] [ぁ-んァ-ン一-龥]/.test(t)) problems.push('英数字の前後の半角空白（「1 時間」は「1時間」）');
  if (!/[0-9０-９]|[一二三四五六七八九十百千万]/.test(t) && t.length < 20) problems.push('短すぎて内容が予想できない');
  return problems;
}

/** frontmatter の 1 行の値（引用符を外す・行末の注釈を外す）。複数行や入れ子は見ない */
export function scalar(frontmatter, key) {
  const m = frontmatter.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  if (!m) return null;
  const raw = m[1];
  if (raw.startsWith('#')) return ''; // 値が空で、注釈だけの行
  if (raw.startsWith('"')) {
    const q = raw.match(/^"((?:[^"\\]|\\.)*)"/);
    return q ? q[1].replace(/\\(.)/g, '$1') : raw;
  }
  if (raw.startsWith("'")) {
    const q = raw.match(/^'((?:[^']|'')*)'/);
    return q ? q[1].replace(/''/g, "'") : raw;
  }
  return raw.replace(/\s+#.*$/, '').trim();
}

/** sources の中身（同じ行の値と、その下の字下げした行。次の項目の手前まで）。注釈は外す */
export function sourcesText(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const i = lines.findIndex((l) => /^sources:/.test(l));
  if (i < 0) return '';
  const out = [lines[i].slice('sources:'.length)];
  for (const l of lines.slice(i + 1)) {
    if (/^\S/.test(l)) break; // 次の項目
    out.push(l);
  }
  return out.map((l) => l.replace(/(^|\s)#.*$/, '')).join('\n');
}

/** 記事 1 本を確かめる。fix（直す）・look（見る）・本文の字数。
 *  author: 登録した投稿者名（written_by と照らし合わせる）。null は未登録。省くと照らし合わせない */
export function checkArticle(markdown, filename = '', { author } = {}) {
  const fix = [];
  const look = [];
  const m = String(markdown).match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);
  if (!m) return { fix: ['先頭に frontmatter（--- で囲んだ部分）が無い'], look, chars: 0 };
  const [, fm, body] = m;

  for (const p of checkTitle(scalar(fm, 'title'))) fix.push(`見出し: ${p}`);
  const slug = scalar(fm, 'slug') ?? '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fix.push('slug は英小文字・数字・ハイフンだけ（URL になる）');
  const requested = scalar(fm, 'requested_at') ?? '';
  // 調べた日時（JST・秒まで）か、時刻が分からない時の日付だけ。ファイル名の日付はその日付の部分
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\+09:00)?$/.test(requested)) fix.push('requested_at は調べた日時（2026-10-24T09:12:34+09:00 の形。時刻が分からなければ YYYY-MM-DD）');
  const date = requested.slice(0, 10);
  if (filename && slug && date && basename(filename) !== `${date}_${slug}.md`) fix.push(`ファイル名は ${date}_${slug}.md にする（今は ${basename(filename)}）`);
  const summary = scalar(fm, 'summary') ?? '';
  if (!summary) fix.push('summary（1〜2 文）が空');
  else if ([...summary].length > 200) fix.push(`summary が長い（${[...summary].length} 字。200 字まで）`);
  if (!GENRES.includes(scalar(fm, 'genre') ?? '')) fix.push(`genre は次のどれか 1 つ: ${GENRES.join(' / ')}`);
  if (!CONFIDENCES.includes(scalar(fm, 'confidence') ?? '')) fix.push(`confidence は次のどれか: ${CONFIDENCES.join(' / ')}`);
  if (!/(?:^|[\s{,-])url:[ \t]*["']?https?:\/\//m.test(sourcesText(fm))) fix.push('sources に出典の URL が 1 つ以上要る（要約とリンクだけ。転載しない）');
  const wb = scalar(fm, 'written_by') ?? '';
  if (!wb) fix.push('written_by が空。記事の下に表示される投稿者名を「投稿者：」と登録した名前で書く（名前は node post.mjs --check で出る）');
  else if (author && wb !== writtenBy(author)) look.push(`written_by（${wb}）が、登録した投稿者名の「${writtenBy(author)}」と違う。記事の下にこのまま表示される`);
  else if (author === null) look.push('投稿者名が未登録。node post.mjs --set-name で登録すると、written_by と照らし合わせる');
  // 鍵を記事に書かない（公開されると誰でも投稿できてしまう）。表示には鍵の中身を出さない
  if (/aid_[0-9A-Za-z_-]{16,}|Bearer\s+\S{16,}/.test(String(markdown))) fix.push('鍵のような文字列（aid_… や Bearer …）がある。記事に鍵を書かない');
  // サイトは frontmatter も含めて生の HTML を断る（注釈の中の「<slug>」のような書き方も）。コードの中と自動リンクは除く
  const noCode = String(markdown).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const tag = noCode.match(/<(?!https?:\/\/|mailto:|[^>\s]+@[^>\s]+>)[A-Za-z!\/?][^>\n]*>/);
  if (tag) fix.push(`HTML のタグのような書き方がある（${tag[0].slice(0, 30)}）。frontmatter の注釈の中も含めて使えない（サイトに断られる）`);
  if (scalar(fm, 'status') === 'published') look.push('status が published。公開できるのは publisher / admin の鍵だけ（writer は draft で送る）');

  const heads = [...body.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)].map((h) => h[1]);
  if (heads.join('|') !== HEADINGS.join('|')) fix.push(`本文の見出しは ${HEADINGS.map((h) => `## ${h}`).join(' → ')} の 4 つをこの順で（今: ${heads.join(' / ') || 'なし'}）`);
  const chars = body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\s/g, '').length;
  if (chars > BODY_MAX) fix.push(`本文が ${chars} 字（${BODY_MAX} 字まで）`);

  // 文の癖（yomiyasu が無い時の代わりの目安）。見出しの行とリンク先は見ない
  const text = body.replace(/^##.*$/gm, '').replace(/\]\([^)]*\)/g, ']');
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) look.push('絵文字がある');
  if (/[—―]/.test(text)) look.push('ダッシュ（—）がある。文を分けるか読点にする');
  if (/[:：][ \t]*$/m.test(text)) look.push('行の終わりのコロン（：）がある');
  if (/[ぁ-んァ-ン一-龥] [A-Za-z0-9]|[A-Za-z0-9] [ぁ-んァ-ン一-龥]/.test(text)) look.push('英数字の前後の半角空白がある（「1 時間」は「1時間」）');
  const long = text.split(/[。！？\n]/).map((s) => s.trim()).filter((s) => [...s].length > 80);
  if (long.length) look.push(`80 字を超える文が ${long.length} つ。2 文に分けられないか`);
  return { fix, look, chars };
}

if (process.argv[1] && basename(process.argv[1]) === 'check.mjs') {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('使い方: node check.mjs <記事.md>...');
    process.exit(2);
  }
  // 画面に出す物は全部ここを通す（ファイル名・読めない時の例外文・HTML のような書き方の抜き出しに鍵が混ざっていても出さない）
  const key = registeredKey();
  const say = (t) => console.log(scrub(t, key));
  const author = registeredName().name || null;
  let bad = 0;
  for (const f of files) {
    let r;
    try {
      r = checkArticle(readFileSync(f, 'utf-8'), f, { author });
    } catch (e) {
      say(`✗ ${f}: 読めない（${e.message}）`);
      bad++;
      continue;
    }
    say(`${r.fix.length ? '✗' : '○'} ${basename(f)}（本文 ${r.chars} 字）`);
    for (const p of r.fix) say(`  直す: ${p}`);
    for (const p of r.look) say(`  見る: ${p}`);
    if (r.fix.length) bad++;
  }
  process.exit(bad ? 1 : 0);
}
