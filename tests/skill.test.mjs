// スキル（skills/ai-digest-post）のテスト。要る物は Node.js 22 以上と bash（入れる道具の試し）だけ。
//   node --test（このリポジトリの一番上で）
// 送る前の確かめ・見出しの決まり・送る道具（偽のサーバーで実際に起動）・鍵を表示しないこと・入れる道具・スキルの説明文・履歴を探す道具（作った会話の記録で）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync as renameSyncReal, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkArticle, checkTitle, scalar, sourcesText } from '../skills/ai-digest-post/scripts/check.mjs';
import { resolveConfig, scrub, KEY_RE } from '../skills/ai-digest-post/scripts/post.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const SKILL = join(REPO, 'skills/ai-digest-post');
const KEY = `aid_${'a'.repeat(48)}`;

const GOOD = `---
title: "1時間の英語の音声を約13秒で文字にする無料のMacアプリ。速さは既存並み"
slug: "sample-article"
summary: "要点の 1 文。"
requested_at: 2026-10-20
published_at:
status: draft
tags: [音声]
genre: 音声 # 大分類
related: []
sources:
  - url: "https://example.com/a"
    kind: article
    note: "n"
confidence: 推論
written_by: "投稿者：たなか"
origin_ref: ""
---

## 何が起きた
本文です。

## あなたに関係あるか
- 音声を扱う人: 関係あります

## やるなら何を
今は何もしなくてよいです。

## どのくらい確か
- 分かっていないことがあります。
`;

test('送る前の確かめ: 決まりどおりの記事は「直す」も「見る」も無い', () => {
  const r = checkArticle(GOOD, '/x/2026-10-20_sample-article.md');
  assert.deepEqual(r.fix, []);
  assert.deepEqual(r.look, []);
  assert.ok(r.chars > 0 && r.chars < 100);
});

test('送る前の確かめ: 見出し・ファイル名・ジャンル・確かさ・出典・4 段・字数は「直す」', () => {
  const bad = GOOD.replace('title: "1時間の英語の音声を約13秒で文字にする無料のMacアプリ。速さは既存並み"', 'title: "AIの覇権は本当か？"')
    .replace('genre: 音声 # 大分類', 'genre: 音楽')
    .replace('confidence: 推論', 'confidence: たぶん')
    .replace('  - url: "https://example.com/a"', '  - url: ""')
    .replace('## やるなら何を', '## すること')
    .replace('本文です。', 'あ'.repeat(1001));
  const r = checkArticle(bad, '2026-10-21_other.md');
  const all = r.fix.join('\n');
  for (const re of [/見出し: 疑問形/, /煽り/, /ファイル名は 2026-10-20_sample-article\.md/, /genre は/, /confidence は/, /sources に出典の URL/, /4 つをこの順で/, /本文が 10\d\d 字/]) assert.match(all, re);
  assert.deepEqual(checkArticle('frontmatter なし').fix, ['先頭に frontmatter（--- で囲んだ部分）が無い']);
});

test('送る前の確かめ: 文の癖は「見る」（止めない）', () => {
  const r = checkArticle(GOOD.replace('本文です。', '速さ— 1 時間で終わる🎉\n結論：\n' + 'い'.repeat(81) + '。').replace('status: draft', 'status: published'), '2026-10-20_sample-article.md');
  assert.deepEqual(r.fix, []);
  const all = r.look.join('\n');
  for (const re of [/絵文字/, /ダッシュ/, /コロン/, /半角空白/, /80 字を超える文が 1 つ/, /published/]) assert.match(all, re);
});

test('frontmatter の 1 行の値: 引用符・注釈・エスケープ', () => {
  assert.equal(scalar('title: "a # b \\"c\\""\nx: 1', 'title'), 'a # b "c"');
  assert.equal(scalar("title: 'it''s'", 'title'), "it's");
  assert.equal(scalar('genre: 音声   # 大分類', 'genre'), '音声');
  assert.equal(scalar('a: 1', 'title'), null);
});

test('スキルの説明文: 名前はフォルダと同じ。説明は Codex の上限（500 字）に収まる', () => {
  const s = readFileSync(join(SKILL, 'SKILL.md'), 'utf-8');
  assert.equal(scalar(s.split(/^---$/m)[1], 'name'), 'ai-digest-post');
  const d = scalar(s.split(/^---$/m)[1], 'description');
  assert.ok(d.length > 50 && d.length <= 500, `説明 ${d.length} 字`);
  for (const f of ['scripts/post.mjs', 'scripts/check.mjs', 'scripts/find-history.mjs', 'scripts/key.mjs', 'assets/template.md', 'references/setup.md', 'references/writing.md', 'references/images.md']) {
    assert.ok(s.includes(`\`${f}\``), `${f} が SKILL.md に書かれていない`);
    assert.ok(existsSync(join(SKILL, f)), `${f} が無い`);
  }
});

test('鍵と URL の探し方: 引数 → 環境変数 → ~/.config/ai-digest の順', () => {
  const home = mkdtempSync(join(tmpdir(), 'aid-home-'));
  try {
    assert.deepEqual(resolveConfig({ env: {}, home }), { url: '', key: '', urlFrom: '', keyFrom: '' });
    mkdirSync(join(home, '.config/ai-digest'), { recursive: true });
    writeFileSync(join(home, '.config/ai-digest/url'), 'https://site.example/\n');
    writeFileSync(join(home, '.config/ai-digest/key'), `${KEY}\n`);
    const f = resolveConfig({ env: {}, home });
    assert.equal(f.url, 'https://site.example');
    assert.equal(f.key, KEY);
    assert.match(f.keyFrom, /\.config\/ai-digest\/key$/);
    const e = resolveConfig({ env: { AI_DIGEST_API_KEY: 'aid_env', AI_DIGEST_API_URL: 'https://env.example' }, home });
    assert.equal(e.key, 'aid_env');
    assert.equal(e.keyFrom, '環境変数 AI_DIGEST_API_KEY');
    assert.equal(resolveConfig({ args: { key: 'aid_arg' }, env: { AI_DIGEST_API_KEY: 'aid_env' }, home }).keyFrom, '--key');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// 偽のサイト（鍵を照合し、届いた物を覚える）
async function fakeSite({ name = 'tanaka' } = {}) {
  const got = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end(JSON.stringify({ ok: false, errors: ['鍵が違う'] }));
      if (req.method === 'GET' && req.url === '/api/articles') return res.end(JSON.stringify({ ok: true, me: { name, role: 'writer' }, articles: [{}, {}] }));
      if (req.method === 'POST' && req.url === '/api/articles') return res.writeHead(201).end(JSON.stringify({ ok: true, slug: 'sample-article', status: 'draft' }));
      if (req.method === 'POST' && req.url === '/api/articles/publish') return res.writeHead(403).end(JSON.stringify({ ok: false, errors: ['公開できない'] }));
      res.writeHead(404).end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, got, close: () => new Promise((r) => server.close(r)) };
}

function homeWith({ url, key, name } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'aid-home-'));
  mkdirSync(join(home, '.config/ai-digest'), { recursive: true });
  if (url) writeFileSync(join(home, '.config/ai-digest/url'), url);
  if (key) writeFileSync(join(home, '.config/ai-digest/key'), key);
  if (name) writeFileSync(join(home, '.config/ai-digest/name'), `${name}\n`);
  return home;
}

const run = (script, args, home) =>
  new Promise((resolve) => {
    const env = { ...process.env, HOME: home };
    delete env.AI_DIGEST_API_URL;
    delete env.AI_DIGEST_API_KEY;
    delete env.AI_DIGEST_AUTHOR_NAME;
    execFile(process.execPath, [script, ...args], { env, cwd: home }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr }));
  });

test('送る道具: --check は登録した鍵で名前と役を出す。鍵そのものは出さない', async () => {
  const site = await fakeSite();
  const home = homeWith({ url: site.url, key: `${KEY}\n`, name: 'たなか' });
  try {
    for (const script of [join(SKILL, 'scripts/post.mjs')]) {
      const r = await run(script, ['--check'], home);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /鍵は有効です: tanaka（writer・下書きまで/);
      assert.match(r.out, /自分の記事 2 本/);
      assert.match(r.out, /投稿者名: たなか（記事の下に「投稿者：たなか」と表示される/);
      assert.doesNotMatch(r.out, new RegExp(KEY));
    }
    assert.equal(site.got.at(-1).auth, `Bearer ${KEY}`);
  } finally {
    await site.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('送る道具: 鍵が無い時は登録の手順を案内して 2。鍵が違う時は 1', async () => {
  const site = await fakeSite();
  const none = homeWith({ url: site.url });
  const wrong = homeWith({ url: site.url, key: `aid_${'b'.repeat(48)}` });
  try {
    const r1 = await run(join(SKILL, 'scripts/post.mjs'), ['--check'], none);
    assert.equal(r1.code, 2);
    assert.match(r1.out, /投稿の鍵が見つからない/);
    assert.match(r1.out, /references\/setup\.md/);
    assert.match(r1.out, /AI との会話には貼らない/);
    const r2 = await run(join(SKILL, 'scripts/post.mjs'), ['--check'], wrong);
    assert.equal(r2.code, 1);
    assert.match(r2.out, /鍵が違うか、失効している/);
    assert.doesNotMatch(r2.out, /aid_b{48}/);
  } finally {
    await site.close();
    rmSync(none, { recursive: true, force: true });
    rmSync(wrong, { recursive: true, force: true });
  }
});

test('送る道具: 記事と絵を送る。writer の鍵で --publish は 403 で、理由を案内する', async () => {
  const site = await fakeSite();
  const home = homeWith({ url: site.url, key: KEY });
  try {
    writeFileSync(join(home, '2026-10-20_sample-article.md'), GOOD);
    writeFileSync(join(home, '2026-10-20_sample-article.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    const r = await run(join(SKILL, 'scripts/post.mjs'), ['2026-10-20_sample-article.md', '--image', '2026-10-20_sample-article.jpg', '--publish'], home);
    assert.equal(r.code, 1);
    assert.match(r.out, /投稿: HTTP 201/);
    assert.match(r.out, /公開できるのは publisher（自分の記事）と admin の鍵だけ/);
    const sent = JSON.parse(site.got.find((g) => g.method === 'POST' && g.url === '/api/articles').body);
    assert.equal(sent.markdown, GOOD);
    assert.deepEqual(sent.images.map((i) => i.name), ['2026-10-20_sample-article.jpg']);
    assert.equal(JSON.parse(site.got.find((g) => g.url === '/api/articles/publish').body).slug, 'sample-article');
  } finally {
    await site.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('送る道具: https でない URL は断る（手元の 127.0.0.1 だけ例外）。知らない引数は 2', async () => {
  const home = homeWith({ url: 'http://site.example', key: KEY });
  try {
    const r = await run(join(SKILL, 'scripts/post.mjs'), ['--check'], home);
    assert.equal(r.code, 2);
    assert.match(r.out, /https:\/\/ で始める/);
    assert.equal((await run(join(SKILL, 'scripts/post.mjs'), ['--nope'], home)).code, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// 入れる道具（install.sh）を一時的なホームで動かす。連携するスキルは GitHub の代わりに手元の見本から取る（ネットにつながない）
function installer({ home, args = [], env = {}, input = '' }) {
  return new Promise((resolve) => {
    const e = { ...process.env, HOME: home, ...env };
    delete e.CODEX_HOME;
    const child = execFile('bash', [join(REPO, 'install.sh'), ...args], { env: e }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr }));
    child.stdin.end(input);
  });
}

/** スキルの置き場に、同じスキルの控え（*.bak など）が無いこと。有効な ai-digest-post は 1 つだけ */
function assertOneSkillEach(home) {
  for (const d of ['.claude/skills', '.codex/skills']) {
    const dir = join(home, d);
    if (!existsSync(dir)) continue;
    const names = readdirSync(dir);
    assert.deepEqual(names.filter((n) => n.endsWith('.bak') || n.endsWith('.new')), [], `${d} に控えが残っている`);
    assert.equal(names.filter((n) => existsSync(join(dir, n, 'SKILL.md')) && readFileSync(join(dir, n, 'SKILL.md'), 'utf-8').includes('name: ai-digest-post')).length, existsSync(join(dir, 'ai-digest-post')) ? 1 : 0, d);
  }
}

function installSetup({ claude = true, codex = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'aid-install-'));
  if (claude) mkdirSync(join(home, '.claude'));
  if (codex) mkdirSync(join(home, '.codex'));
  const extras = join(home, 'extras-source'); // 連携するスキルの見本
  for (const name of ['imozuru', 'yomiyasu']) {
    mkdirSync(join(extras, name, 'scripts'), { recursive: true });
    writeFileSync(join(extras, name, 'SKILL.md'), `---\nname: ${name}\n---\n見本\n`);
  }
  return { home, extras, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test('入れる道具: Claude Code と Codex の入っている方に写す。入れ直すと前の版はスキルの置き場の外に残る。使い方の誤りは 2', async () => {
  const t = installSetup({ claude: false, codex: false });
  try {
    assert.equal((await installer({ home: t.home })).code, 1); // どちらも無い
    mkdirSync(join(t.home, '.claude'));
    mkdirSync(join(t.home, '.codex'));
    const r = await installer({ home: t.home, args: ['--no-extras'] });
    assert.equal(r.code, 0, r.out);
    for (const d of ['.claude/skills', '.codex/skills']) assert.ok(existsSync(join(t.home, d, 'ai-digest-post/SKILL.md')), d);
    assert.equal((await installer({ home: t.home, args: ['--codex', '--no-extras'] })).code, 0);
    assert.ok(existsSync(join(t.home, '.ai-digest-skill/backup/codex/ai-digest-post/SKILL.md')));
    assert.ok(!existsSync(join(t.home, '.ai-digest-skill/backup/claude')));
    assertOneSkillEach(t.home);
    assert.equal((await installer({ home: t.home, args: ['--both'] })).code, 2);
  } finally {
    t.cleanup();
  }
});

test('入れる道具: Node.js 22 以上が無ければ入れ方を案内し、スキルは入れて 3 で終わる', async () => {
  const t = installSetup();
  try {
    const r = await installer({ home: t.home, args: ['--no-extras'], env: { AI_DIGEST_NODE_BIN: join(t.home, 'no-such-node') } });
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /Node\.js 22 以上が見つからない（今: 入っていない）/);
    assert.match(r.out, /入れ方（(Linux・WSL|Mac)）: https:\/\/nodejs\.org/);
    assert.match(r.out, /入れ直さずにそのまま使える/);
    assert.ok(existsSync(join(t.home, '.claude/skills/ai-digest-post/SKILL.md')));
  } finally {
    t.cleanup();
  }
});

test('入れる道具: 聞けない時（AI が実行した時）は連携するスキルを入れず、付ける指定を案内する', async () => {
  const t = installSetup();
  try {
    const r = await installer({ home: t.home, env: { AI_DIGEST_EXTRAS_SOURCE: t.extras } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /imozuru: 聞けないので入れない（端末でない）。入れる時は --with-imozuru/);
    assert.match(r.out, /yomiyasu: 聞けないので入れない（端末でない）。入れる時は --with-yomiyasu/);
    assert.ok(!existsSync(join(t.home, '.claude/skills/imozuru')));
  } finally {
    t.cleanup();
  }
});

test('入れる道具: --with-extras で両方を両方の道具に入れる。2 回目は「すでに入っている」で触らない', async () => {
  const t = installSetup();
  try {
    const r = await installer({ home: t.home, args: ['--with-extras'], env: { AI_DIGEST_EXTRAS_SOURCE: t.extras } });
    assert.equal(r.code, 0, r.out);
    for (const d of ['.claude/skills', '.codex/skills']) for (const n of ['imozuru', 'yomiyasu']) assert.ok(existsSync(join(t.home, d, n, 'SKILL.md')), `${d}/${n}`);
    const r2 = await installer({ home: t.home, args: ['--with-extras'], env: { AI_DIGEST_EXTRAS_SOURCE: t.extras } });
    assert.match(r2.out, /imozuru: すでに入っている。記事を書く時に使われる/);
    assertOneSkillEach(t.home);
  } finally {
    t.cleanup();
  }
});

test('入れる道具: 聞いた時の答え（y・n）どおりに入れる。答えが空なら入れない', async () => {
  const t = installSetup();
  try {
    const r = await installer({ home: t.home, env: { AI_DIGEST_EXTRAS_SOURCE: t.extras, AI_DIGEST_INSTALL_ASSUME_TTY: '1' }, input: 'y\n\n' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /imozuru（.*）も入れますか？ 無くても記事は書けます \[y\/N\]/);
    assert.ok(existsSync(join(t.home, '.claude/skills/imozuru/SKILL.md')));
    assert.match(r.out, /yomiyasu: 入れない。無くても記事は書ける。後から入れれば、記事を書くたびにスキルが見つけて使う/);
    assert.ok(!existsSync(join(t.home, '.claude/skills/yomiyasu')));
  } finally {
    t.cleanup();
  }
});

test('入れる道具: 利用者がすでに入れている連携するスキルは書き換えない。壊れた物（SKILL.md が無い）は .bak に残して入れ直す', async () => {
  const t = installSetup();
  try {
    mkdirSync(join(t.home, '.claude/skills/imozuru'), { recursive: true });
    writeFileSync(join(t.home, '.claude/skills/imozuru/SKILL.md'), '自分で入れた版\n');
    mkdirSync(join(t.home, '.codex/skills/imozuru'), { recursive: true }); // 壊れた物
    const r = await installer({ home: t.home, args: ['--with-imozuru', '--no-extras'], env: { AI_DIGEST_EXTRAS_SOURCE: t.extras } });
    assert.equal(r.code, 0, r.out);
    assert.equal(readFileSync(join(t.home, '.claude/skills/imozuru/SKILL.md'), 'utf-8'), '自分で入れた版\n');
    assert.match(readFileSync(join(t.home, '.codex/skills/imozuru/SKILL.md'), 'utf-8'), /見本/);
    assert.ok(existsSync(join(t.home, '.ai-digest-skill/backup/codex/imozuru'))); // 壊れた物は置き場の外へ
    assertOneSkillEach(t.home);
    assert.match(r.out, /yomiyasu: 入れない/); // --no-extras は、指定の無い方だけを「入れない」にする
  } finally {
    t.cleanup();
  }
});

test('入れる道具: 連携するスキルを取れなかった時は 4 で終わる（スキルは入っている）', async () => {
  const t = installSetup();
  try {
    rmSync(join(t.extras, 'yomiyasu'), { recursive: true });
    const r = await installer({ home: t.home, args: ['--with-extras'], env: { AI_DIGEST_EXTRAS_SOURCE: t.extras } });
    assert.equal(r.code, 4, r.out);
    assert.match(r.out, /yomiyasu: 取れなかった（https:\/\/github\.com\/nanaism\/yomiyasu ・版 [0-9a-f]{7}）/);
    assert.ok(existsSync(join(t.home, '.claude/skills/ai-digest-post/SKILL.md')));
    assert.ok(existsSync(join(t.home, '.claude/skills/imozuru/SKILL.md')));
  } finally {
    t.cleanup();
  }
});

test('同梱の雛形を埋めた記事は、送る前の確かめを通る（注釈の付いた行のまま）', () => {
  let t = readFileSync(join(SKILL, 'assets/template.md'), 'utf-8');
  const fill = [
    [/^title: ".*?"/m, 'title: "1時間の英語の音声を約13秒で文字にする無料のMacアプリ。速さは既存並み"'],
    [/^slug: ""/m, 'slug: "sample-article"'],
    [/^summary: ""/m, 'summary: "要点の 1 文。"'],
    [/^requested_at: YYYY-MM-DD/m, 'requested_at: 2026-10-20'],
    [/^genre:( +)#/m, 'genre: 音声$1#'],
    [/^  - url: ""/m, '  - url: "https://example.com/a"'],
    [/^    kind: ""/m, '    kind: article'],
    [/^    note: ""/m, '    note: "何が書いてあるか"'],
    [/^confidence: ""/m, 'confidence: 推論'],
    [/^written_by: ""/m, 'written_by: "投稿者：たなか"'],
  ];
  for (const [re, to] of fill) {
    assert.match(t, re);
    t = t.replace(re, to);
  }
  assert.match(t, /^sources: +# /m); // sources の行の注釈は残したまま
  assert.deepEqual(checkArticle(t, '2026-10-20_sample-article.md').fix, []);
});

test('値が空で注釈だけの行は空。sources は注釈・項目の順・同じ行の書き方によらず URL を見つける', () => {
  assert.equal(scalar('genre:                       # 大分類', 'genre'), '');
  assert.equal(scalar('genre: 音声  # 大分類', 'genre'), '音声');
  const has = (fm) => /(?:^|[\s{,-])url:[ \t]*["']?https?:\/\//m.test(sourcesText(fm));
  assert.equal(has('sources:   # 出典\n  - url: "https://a.example"\n    kind: x\nconfidence: 推論'), true);
  assert.equal(has('sources:\n  - kind: article\n    url: https://a.example\n'), true);
  assert.equal(has('sources: [{ url: "https://a.example", kind: x }]\n'), true);
  assert.equal(has('sources:   # 出典\n  - url: ""\n    note: "https://a.example を見た"\nconfidence: 推論'), false); // note の中の URL は出典の URL ではない
  assert.equal(has('title: x\nconfidence: 推論'), false);
});

test('表示する文から鍵を消す', () => {
  const k = `aid_${'c'.repeat(48)}`;
  assert.equal(KEY_RE.test(k), true);
  const msg = scrub(`Headers.append: "Bearer ${k}\nzz" is an invalid header value. key=${k} other=aid_${'d'.repeat(10)}`, k);
  assert.doesNotMatch(msg, /c{20}|d{10}/);
  assert.match(msg, /Bearer <鍵>/);
});

test('送る道具: 形の違う鍵（途中の改行・空白・長さ違い）は通信の前に 2 で止め、鍵の断片を出さない', async () => {
  const site = await fakeSite();
  const bads = [`aid_${'e'.repeat(24)}\n${'e'.repeat(24)}`, `aid_${'e'.repeat(24)} ${'e'.repeat(24)}`, `aid_${'e'.repeat(40)}`];
  try {
    for (const bad of bads) {
      for (const args of [['--check'], ['nofile.md']]) {
        const home = homeWith({ url: site.url, key: bad });
        try {
          const r = await run(join(SKILL, 'scripts/post.mjs'), args, home);
          assert.equal(r.code, 2, r.out);
          assert.match(r.out, /鍵の形が違う/);
          assert.doesNotMatch(r.out, /e{20}/);
        } finally {
          rmSync(home, { recursive: true, force: true });
        }
      }
    }
    assert.equal(site.got.length, 0); // どれもサイトに何も送っていない
  } finally {
    await site.close();
  }
});

test('送る道具: つながらない時は理由の符号だけを出して 1。鍵は出さない', async () => {
  // 閉じたばかりの口（fetch の決まりで止められる口ではなく、本当に誰も聞いていない口）
  const s0 = createServer();
  await new Promise((r) => s0.listen(0, '127.0.0.1', r));
  const port = s0.address().port;
  await new Promise((r) => s0.close(r));
  const home = homeWith({ url: `http://127.0.0.1:${port}`, key: KEY });
  try {
    writeFileSync(join(home, '2026-10-20_sample-article.md'), GOOD);
    for (const args of [['--check'], ['2026-10-20_sample-article.md']]) {
      const r = await run(join(SKILL, 'scripts/post.mjs'), args, home);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /通信できない（ECONNREFUSED）/);
      assert.doesNotMatch(r.out, /a{20}/);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('HTML のタグのような書き方は「直す」（frontmatter の注釈の中も）。自動リンク・コード・メールの宛先は通す', () => {
  assert.doesNotMatch(readFileSync(join(SKILL, 'assets/template.md'), 'utf-8'), /<(?!https?:\/\/)[A-Za-z!\/?][^>\n]*>/);
  const withTag = GOOD.replace('slug: "sample-article"', 'slug: "sample-article"   # ファイル名の <slug> と同じ');
  assert.match(checkArticle(withTag, '2026-10-20_sample-article.md').fix.join('\n'), /HTML のタグのような書き方がある（<slug>）/);
  const ok = GOOD.replace('本文です。', '本文です。<https://example.com/a> と `<div>` と <info@example.com> は HTML ではない。');
  assert.deepEqual(checkArticle(ok, '2026-10-20_sample-article.md').fix, []);
});

test('送る道具: URL の欄に鍵を貼り間違えても、知らない引数に鍵があっても、鍵（全文も aid_ の後ろだけも）を出さない', async () => {
  const hex = KEY.slice(4);
  const cases = [
    { url: KEY, key: KEY, args: ['--check'], code: 2, says: /URL は https:\/\/ で始める/ },
    { url: KEY, key: '', args: ['--check'], code: 2, says: /投稿の鍵が見つからない/ },
    { url: hex, key: KEY, args: ['--check'], code: 2, says: /URL は https:\/\/ で始める/ },
    { url: 'https://site.example', key: KEY, args: ['a.md', KEY], code: 2, says: /知らない引数: <鍵>/ }, // 登録した鍵そのものは先に <鍵> になる
    { url: 'https://site.example', key: KEY, args: ['a.md', `aid_${'b'.repeat(48)}`], code: 2, says: /知らない引数: aid_<鍵>/ }, // 登録と違う鍵も aid_ の形で消える
    { url: 'https://site.example', key: KEY, args: ['a.md', hex], code: 2, says: /知らない引数: <鍵>/ },
    { url: 'https://site.example', key: KEY, args: ['--check', '--kye', KEY], code: 2, says: /知らない引数: --kye/ },
    { url: 'https://site.example', key: KEY, args: [`${KEY}.md`], code: 1, says: /失敗: .*ENOENT/ },
  ];
  for (const c of cases) {
    const home = homeWith({ url: c.url, key: c.key });
    try {
      const r = await run(join(SKILL, 'scripts/post.mjs'), c.args, home);
      assert.equal(r.code, c.code, `${JSON.stringify(c.args)}: ${r.out}`);
      assert.match(r.out, c.says, r.out);
      assert.doesNotMatch(r.out, /a{16}|b{16}/, `鍵が出た: ${JSON.stringify(c.args)}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test('送る前の確かめ: 記事に鍵のような文字列があれば「直す」。表示には鍵を出さない', async () => {
  const withKey = GOOD.replace('本文です。', `本文です。鍵は ${KEY} です。`);
  assert.match(checkArticle(withKey, '2026-10-20_sample-article.md').fix.join('\n'), /鍵のような文字列/);
  const dir = mkdtempSync(join(tmpdir(), 'aid-check-'));
  try {
    const f = join(dir, '2026-10-20_sample-article.md');
    writeFileSync(f, withKey.replace('本文です。', `本文です。<${KEY}>`));
    const r = await new Promise((resolve) => execFile(process.execPath, [join(SKILL, 'scripts/check.mjs'), f], (e, so, se) => resolve({ code: e ? e.code : 0, out: so + se })));
    assert.equal(r.code, 1);
    assert.match(r.out, /鍵のような文字列/);
    assert.doesNotMatch(r.out, /a{16}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('送る前の確かめ: 読めないファイル（鍵の名前・aid_ の後ろだけの名前）でも、表示に鍵を出さない', async () => {
  const home = homeWith({ key: KEY }); // 登録した鍵（aid_ の後ろだけの名前を消すのに使う）
  try {
    for (const name of [`${KEY}.md`, `${KEY.slice(4)}.md`, `Bearer ${KEY}.md`]) {
      const r = await new Promise((resolve) => {
        const env = { ...process.env, HOME: home };
        delete env.AI_DIGEST_API_KEY;
        execFile(process.execPath, [join(SKILL, 'scripts/check.mjs'), join(home, name)], { env }, (e, so, se) => resolve({ code: e ? e.code : 0, out: so + se }));
      });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /読めない（ENOENT/);
      assert.doesNotMatch(r.out, /a{16}/, `鍵が出た: ${name}`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// 見出しの決まり（最大の要約）
test('最大の要約の見出しは通る', () => {
  assert.deepEqual(checkTitle('DeepSeekの新モデルは安さが本物。公式も「小さな更新」と書き、順位は上位の一角にとどまる'), []);
  assert.deepEqual(checkTitle('1時間の英語の音声を約13秒で文字にする無料のMacアプリ。速さは既存並みで精度はやや低い'), []);
});

test('疑問形・煽り・した話・〜へ・空白・長さは指摘', () => {
  assert.match(checkTitle('「AI の覇権が変わる」は本当か。DeepSeek の新モデルを公式の数字で確かめた').join('/'), /疑問形|煽り/);
  assert.match(checkTitle('AI録音機は買収で突然売られなくなる。勧める前に「今も買えるか」を確かめた話').join('/'), /した話/);
  assert.match(checkTitle('「答えるAI」から「24時間働くAI」へ。ChatGPTのdotsで何が変わるか').join('/'), /へ|疑問形/);
  assert.match(checkTitle('1 時間の音声が約 13 秒で文字になる').join('/'), /空白/);
  assert.match(checkTitle('あ'.repeat(51)).join('/'), /長い/);
  assert.match(checkTitle('').join('/'), /空/);
});

test('入れる道具: 前のインストーラーが置き場の中に残した *.bak は、置き場の外へ移す（読み込まれない）', async () => {
  const t = installSetup();
  try {
    for (const d of ['.claude/skills', '.codex/skills']) {
      mkdirSync(join(t.home, d, 'ai-digest-post.bak'), { recursive: true });
      writeFileSync(join(t.home, d, 'ai-digest-post.bak', 'SKILL.md'), '---\nname: ai-digest-post\n---\n古い版\n');
    }
    const r = await installer({ home: t.home, args: ['--no-extras'] });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /移した（置き場の外へ）: .*\.claude\/skills\/ai-digest-post\.bak/);
    assert.match(readFileSync(join(t.home, '.ai-digest-skill/backup/claude/ai-digest-post.bak/SKILL.md'), 'utf-8'), /古い版/);
    assertOneSkillEach(t.home);
  } finally {
    t.cleanup();
  }
});

// ---- 履歴を探す道具（find-history.mjs）。本物の会話の記録は読まない（作った記録だけ） ----
import { byteRes, excerpt, findHistory, hasWord, IgnoreUnreadable, publicUrl } from '../skills/ai-digest-post/scripts/find-history.mjs';
import { maskSecrets } from '../skills/ai-digest-post/scripts/mask.mjs';

const HIST = join(SKILL, 'scripts/find-history.mjs');
const NOW = Date.parse('2026-10-20T00:00:00Z');
const ago = (d) => new Date(NOW - d * 86_400_000).toISOString();
const J = (o) => JSON.stringify(o);
const CUR = 'cccc3333-0000-0000-0000-000000000003';
const SECRET = `sk-ant-api03-${'k'.repeat(30)}`;

/** 作った会話の記録: 調べた会話（Claude Code・Codex）・ありふれた言葉だけの会話・この会話・壊れた記録 */
function histSetup() {
  const home = mkdtempSync(join(tmpdir(), 'aid-hist-'));
  const claude = join(home, 'claude');
  const codex = join(home, 'codex');
  const proj = join(claude, 'projects', '-work-research');
  mkdirSync(join(proj, CUR, 'subagents'), { recursive: true });
  mkdirSync(join(claude, 'projects', '-work-broken'), { recursive: true });
  mkdirSync(join(codex, 'sessions', '2026', '10', '01'), { recursive: true });
  const user = (text, d, extra = {}) => J({ parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: text }, cwd: '/work/research', timestamp: ago(d), ...extra });
  const ai = (content, d) => J({ parentUuid: 'p', isSidechain: false, message: { model: 'm', id: 'msg', type: 'message', role: 'assistant', content }, type: 'assistant', timestamp: ago(d) });
  const filler = Array.from({ length: 6 }, (_, i) => [user(`関係の無い話 ${i}`, 10), ai([{ type: 'text', text: `返事 ${i}` }], 10)]).flat();
  writeFileSync(
    join(proj, 'aaaa1111-0000-0000-0000-000000000001.jsonl'),
    [
      J({ type: 'ai-title', aiTitle: 'zebrafont の調べもの', sessionId: 'a1' }),
      user('zebrafont という新しい書体の道具を調べて', 10),
      ai([{ type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://zebrafont.example.com/news', prompt: 'p' } }, { type: 'tool_use', id: 't2', name: 'WebSearch', input: { query: 'zebrafont release' } }], 10),
      J({ parentUuid: 'y', isSidechain: false, type: 'user', message: { role: 'user', content: [{ tool_use_id: 't1', type: 'tool_result', content: 'zebrafont 道具の出力の中だけの文 TOOLONLY' }] }, timestamp: ago(10) }),
      ai([{ type: 'thinking', thinking: 'zebrafont THINKING' }, { type: 'text', text: `調べた結果: zebrafont は 3 種類の太さがある。出典 https://zebrafont.example.com/news 。手元の http://localhost:3000/x と http://$h:3900/y は外す。鍵 ${SECRET}` }], 10),
      J({ type: 'user', isMeta: true, message: { role: 'user', content: 'zebrafont META' }, timestamp: ago(10) }),
      user('<command-name>/model</command-name> zebrafont COMMAND', 10),
      ...filler,
      user('別の話。書体の本を買った FARAWAY', 9),
      ai([{ type: 'text', text: 'よかったですね' }], 9),
    ].join('\n') + '\n',
  );
  // ありふれた言葉（書体）だけが出る会話。「書体」を軽い言葉にする
  for (let i = 0; i < 10; i++) {
    writeFileSync(join(proj, `bbbb${i}000-0000-0000-0000-00000000000${i}.jsonl`), [user(`書体の話 ${i}`, 5), ai([{ type: 'text', text: `書体は大事 ${i} https://fonts.example.org/${i}` }], 5)].join('\n') + '\n');
  }
  // この会話（要約された）と、その下請けの AI
  writeFileSync(join(proj, `${CUR}.jsonl`), [user('zebrafont を記事にして', 1), user('This session is being continued. zebrafont SELFSUMMARY', 1, { isCompactSummary: true })].join('\n') + '\n');
  writeFileSync(join(proj, CUR, 'subagents', 'agent-1.jsonl'), [user('zebrafont を探して', 1), ai([{ type: 'text', text: 'zebrafont SUBAGENT' }], 1)].join('\n') + '\n');
  // 壊れた記録（言葉は出るが、JSON の行が無い）と、発言の無い会話（付けたしの記録だけ）
  writeFileSync(join(claude, 'projects', '-work-broken', 'broken.jsonl'), 'zebrafont not json\n{"type":"user","message":{"role":"user","content":"zebrafont 途中で切れた行\n');
  writeFileSync(join(proj, 'eeee5555-0000-0000-0000-000000000005.jsonl'), [J({ type: 'custom-title', customTitle: 'zebrafont', sessionId: 'e5' }), user('<command-name>/exit</command-name> zebrafont', 2)].join('\n') + '\n');
  // Codex の調べた会話
  const cx = (type, payload, d) => J({ timestamp: ago(d), type, payload });
  writeFileSync(
    join(codex, 'sessions', '2026', '10', '01', 'rollout-2026-10-01T00-00-00-dddd4444-0000-0000-0000-000000000004.jsonl'),
    [
      cx('session_meta', { id: 'dddd4444', timestamp: ago(19), cwd: '/work/codex' }, 19),
      cx('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>zebrafont ENVCTX</environment_context>' }] }, 19),
      cx('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'zebrafont の値段を調べて' }] }, 19),
      cx('response_item', { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'zebrafont price', queries: ['zebrafont price'] } }, 19),
      cx('response_item', { type: 'function_call', name: 'exec_command', arguments: J({ cmd: 'curl -s https://shop.zebrafont.example.com/price' }) }, 19),
      cx('response_item', { type: 'function_call_output', call_id: 'c', output: 'zebrafont OUTPUTONLY' }, 19),
      cx('response_item', { type: 'reasoning', summary: [], encrypted_content: 'zebrafont REASONING' }, 19),
      cx('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'zebrafont は月 500 円。' }] }, 19),
    ].join('\n') + '\n',
  );
  const env = { AI_DIGEST_CLAUDE_DIR: claude, AI_DIGEST_CODEX_DIR: codex, CLAUDE_CODE_SESSION_ID: CUR };
  return { home, env, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test('履歴を探す: 調べた会話を上に並べ、関係する問いと答え・開いた URL・検索した言葉だけをメモにする（Claude Code と Codex）', async () => {
  const t = histSetup();
  const lines = [];
  try {
    const out = join(t.home, 'memos');
    const r = await findHistory({ query: 'zebrafont 書体', env: t.env, home: t.home, now: NOW, out, log: (l) => lines.push(l) });
    assert.equal(r.written.length, 5);
    assert.match(r.written[0], /1-claude-000000000001\.md$/); // 調べた会話（強い言葉・URL・新しい）
    assert.match(r.written[1], /2-codex-000000000004\.md$/); // Codex の調べた会話
    const a = readFileSync(r.written[0], 'utf-8');
    for (const s of ['3 種類の太さ', 'https://zebrafont.example.com/news', 'zebrafont release', 'zebrafont という新しい書体']) assert.ok(a.includes(s), s);
    for (const s of ['TOOLONLY', 'THINKING', 'META', 'COMMAND', 'k'.repeat(30), 'FARAWAY']) assert.ok(!a.includes(s), `メモに ${s} が入った`);
    // URL の一覧には、外から開ける物だけ（発言の文はそのまま写すので、文の中には残る）
    const urlList = a.split('## 関係する所で開いた URL')[1].split('\n## ')[0];
    assert.deepEqual(urlList.trim().split('\n').filter((l) => l.startsWith('- ')), ['- https://zebrafont.example.com/news']);
    assert.match(a, /<伏せた>/);
    const d = readFileSync(r.written[1], 'utf-8');
    for (const s of ['月 500 円', 'https://shop.zebrafont.example.com/price', 'zebrafont price', '/work/codex']) assert.ok(d.includes(s), s);
    for (const s of ['OUTPUTONLY', 'REASONING', 'ENVCTX']) assert.ok(!d.includes(s), `メモに ${s} が入った`);
    // この会話は外す。要約されているので、要約の前も読めるメモを別に書く
    assert.ok(r.written.every((p) => !p.includes('000000000003')));
    assert.equal(r.selfMemos.length, 1);
    assert.match(r.selfMemos[0], /0-this-claude-000000000003\.md$/);
    assert.match(readFileSync(r.selfMemos[0], 'utf-8'), /SELFSUMMARY/);
    assert.ok(lines.some((l) => l.startsWith('この会話（Claude Code）: 要約されているので')));
    assert.ok(lines.some((l) => l.includes('この会話の下請けの AI の記録 1 件も外した')));
    // 壊れた記録は数えて出す（黙って飛ばさない）。発言の無い会話は誤りにしない
    assert.equal(r.unreadable, 1);
    assert.ok(lines.some((l) => /読めなかった物: 1 件/.test(l)));
    assert.ok(lines.join('\n').includes('broken.jsonl（壊れている）'));
    assert.ok(lines.some((l) => /発言の無い会話: 1 件/.test(l)));
  } finally {
    t.cleanup();
  }
});

test('履歴を探す: 探さない場所（history-ignore）と、* の行で探さない設定', async () => {
  const t = histSetup();
  try {
    mkdirSync(join(t.home, '.config/ai-digest'), { recursive: true });
    writeFileSync(join(t.home, '.config/ai-digest/history-ignore'), '# 注釈\n/work/codex   # Codex の作業は探さない\n-work-broken\n');
    const r = await findHistory({ query: 'zebrafont', env: t.env, home: t.home, now: NOW, out: join(t.home, 'm1'), log: () => {} });
    assert.ok(r.written.every((p) => !p.includes('codex')));
    assert.equal(r.ignored, 2);
    assert.equal(r.unreadable, 0);
    writeFileSync(join(t.home, '.config/ai-digest/history-ignore'), '*\n');
    const lines = [];
    const off = await findHistory({ query: 'zebrafont', env: t.env, home: t.home, now: NOW, out: join(t.home, 'm2'), log: (l) => lines.push(l) });
    assert.equal(off.off, true);
    assert.equal(off.written.length, 0);
    assert.match(lines.join('\n'), /探さない設定/);
    assert.equal(existsSync(join(t.home, 'm2')), false);
  } finally {
    t.cleanup();
  }
});

const runHist = (args, { home, env }) =>
  new Promise((resolve) => {
    const e = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...env };
    execFile(process.execPath, [HIST, ...args], { env: e, cwd: home }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr }));
  });

test('履歴を探す道具: 読めない会話があれば 3 で終わる。古い探し物は 10 回分だけ残し、ほかの物は消さない。使い方の誤りは 2', async () => {
  const t = histSetup();
  try {
    const base = join(t.home, '.ai-digest-skill/history');
    for (let i = 0; i < 12; i++) mkdirSync(join(base, `2026-01-${String(i + 1).padStart(2, '0')}T00-00-00-000Z`), { recursive: true });
    mkdirSync(join(base, 'keep-me'));
    const r = await runHist(['--query', 'zebrafont 書体', '--limit', '2'], t);
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /当たった会話: \d+ 件/);
    assert.match(r.out, /読めなかった物: 1 件/);
    assert.doesNotMatch(r.out, /k{30}/);
    const left = readdirSync(base);
    assert.ok(left.includes('keep-me'));
    assert.equal(left.filter((n) => /^\d{4}-/.test(n)).length, 10);
    assert.ok(!left.includes('2026-01-01T00-00-00-000Z'));
    assert.equal((await runHist([], t)).code, 2);
    assert.equal((await runHist(['--query', 'zebrafont', '--bogus'], t)).code, 2);
    assert.equal((await runHist(['--query', 'x'], t)).code, 2); // 2 文字未満
  } finally {
    t.cleanup();
  }
});

test('履歴を探す: 短い英数字の言葉は単語の所だけ当てる（画像のデータの中の偶然を拾わない）。長い言葉は語の中でも当てる', () => {
  const [eg2] = byteRes(['eg2']);
  for (const s of ['使う eg2 は速い', '\\neg2 の話', 'EG2-Transcribe', '(eg2)', 'eg2']) assert.equal(hasWord(s, eg2), true, s);
  for (const s of ['iVBORw0KGgoAAAANSUhEUgAAeg2BBx', 'AAA+eg2/BBB', 'leg2', 'eg2demo']) assert.equal(hasWord(s, eg2), false, s);
  const [long] = byteRes(['embeddinggemma']);
  assert.equal(hasWord('NewEmbeddingGemma2', long), true);
  const [ja] = byteRes(['文字起こし']);
  assert.equal(hasWord(Buffer.from('音声の文字起こしの道具').toString('latin1'), ja), true);
});

test('履歴を探す: URL は外から開ける物だけ。鍵のような値は伏せる。長い発言は当たりの前後だけ', () => {
  assert.equal(publicUrl('https://example.com/a).'), 'https://example.com/a');
  assert.equal(publicUrl('https://en.wikipedia.org/wiki/Foo_(bar)'), 'https://en.wikipedia.org/wiki/Foo_(bar)');
  for (const u of ['http://localhost:3000/', 'http://127.0.0.1/x', 'http://192.168.1.2/', 'http://$h:3900/', 'https://user:pass@example.com/', 'ftp://example.com/', 'http://printer.local/'])
    assert.equal(publicUrl(u), '', u);
  assert.equal(publicUrl('https://example.com/f?token=abc&x=1'), 'https://example.com/f?token=%3C%E4%BC%8F%E3%81%9B%E3%81%9F%3E&x=1');
  const masked = maskSecrets(`a ${SECRET} b ghp_${'g'.repeat(36)} token=${'z'.repeat(20)} task-runner-is-a-word`);
  assert.doesNotMatch(masked, /k{30}|g{36}|z{20}/);
  assert.match(masked, /task-runner-is-a-word/);
  const long = `${'あ'.repeat(3000)} zebrafont が大事 ${'い'.repeat(3000)}`;
  const ex = excerpt(long, ['zebrafont']);
  assert.ok(ex.length <= 1600 && ex.includes('zebrafont が大事'));
});

test('履歴を探す道具: ホームに書けない時（Codex のサンドボックスなど）は、一時の置き場にメモを書く', async () => {
  const t = histSetup();
  try {
    const locked = join(t.home, '.ai-digest-skill');
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    const tmp = join(t.home, 'tmp');
    mkdirSync(tmp);
    const r = await runHist(['--query', 'zebrafont', '--limit', '1'], { home: t.home, env: { ...t.env, TMPDIR: tmp } });
    assert.equal(r.code, 3, r.out); // 形の違う記録が 1 つあるので 3
    assert.match(r.out, /一時の置き場に書いた/);
    const runs = readdirSync(join(tmp, 'ai-digest-history'));
    assert.equal(runs.length, 1);
    assert.equal(readdirSync(join(tmp, 'ai-digest-history', runs[0])).filter((n) => n.endsWith('.md')).length, 2); // 1 件と、この会話
  } finally {
    chmodSync(join(t.home, '.ai-digest-skill'), 0o700);
    t.cleanup();
  }
});

test('履歴を探す: Codex の中で動かした時は Codex の会話を外す。両方の ID が環境にあれば両方外して、そう書く', async () => {
  const t = histSetup();
  try {
    const codexOnly = { ...t.env, CLAUDE_CODE_SESSION_ID: '', CODEX_THREAD_ID: 'dddd4444-0000-0000-0000-000000000004' };
    const lines = [];
    const r = await findHistory({ query: 'zebrafont', env: codexOnly, home: t.home, now: NOW, out: join(t.home, 'm1'), log: (l) => lines.push(l) });
    assert.ok(r.written.every((p) => !p.includes('codex')));
    assert.ok(r.written.some((p) => p.includes('000000000003'))); // Claude Code の会話は、この会話ではない
    assert.ok(lines.includes('この会話（Codex）: 言葉は当たったが、いま読めているので外した'));
    const both = { ...t.env, CODEX_THREAD_ID: 'dddd4444-0000-0000-0000-000000000004' };
    const lines2 = [];
    const r2 = await findHistory({ query: 'zebrafont', env: both, home: t.home, now: NOW, out: join(t.home, 'm2'), log: (l) => lines2.push(l) });
    assert.ok(r2.written.every((p) => !p.includes('codex') && !p.includes('000000000003')));
    assert.match(lines2.join('\n'), /両方の会話の ID が環境にあった/);
  } finally {
    t.cleanup();
  }
});

test('履歴を探す: 道具の記録の形が変わって、どの会話からも発言が取れない時は、見つからないで済ませず 3 にする', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aid-hist-'));
  try {
    const proj = join(home, 'claude', 'projects', '-w');
    mkdirSync(proj, { recursive: true });
    for (let i = 0; i < 3; i++) writeFileSync(join(proj, `f${i}.jsonl`), J({ type: 'human', text: `zebrafont ${i}` }) + '\n'); // 知らない形
    const lines = [];
    const r = await findHistory({ query: 'zebrafont', env: { AI_DIGEST_CLAUDE_DIR: join(home, 'claude'), AI_DIGEST_CODEX_DIR: join(home, 'codex') }, home, now: NOW, out: join(home, 'm'), log: (l) => lines.push(l) });
    assert.equal(r.written.length, 0);
    assert.equal(r.unreadable, 1);
    assert.match(lines.join('\n'), /Claude Code の会話 3 件から、発言が 1 つも取れなかった/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/** 1 つの会話（Claude Code）だけの手元。行は fromClaude が読む形 */
function oneSession(lines) {
  const home = mkdtempSync(join(tmpdir(), 'aid-hist-'));
  const proj = join(home, 'claude', 'projects', '-w');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'ffff6666-0000-0000-0000-000000000006.jsonl'), lines.map((l) => J(l)).join('\n') + '\n');
  return { home, env: { AI_DIGEST_CLAUDE_DIR: join(home, 'claude'), AI_DIGEST_CODEX_DIR: join(home, 'codex') }, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}
const cuser = (text, d = 3) => ({ parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: text }, cwd: '/w', timestamp: ago(d) });
const cai = (content, d = 3) => ({ parentUuid: 'p', isSidechain: false, message: { model: 'm', id: 'msg', type: 'message', role: 'assistant', content }, type: 'assistant', timestamp: ago(d) });

test('伏せる: 名前の途中に KEY・SECRET・TOKEN・PASSWORD がある環境変数の値・終わりの印の無い秘密鍵・送れてしまう URL', () => {
  const v = 'Q'.repeat(24);
  const t = maskSecrets([`export TYPESAFE_API_KEY=${v}`, `AWS_SECRET_ACCESS_KEY=${v}`, `DB_PASSWORD: "${v}"`, `"apiKey": "${v}"`, `GITHUB_TOKEN=${v}`].join('\n'));
  assert.doesNotMatch(t, /Q{24}/);
  assert.match(t, /export TYPESAFE_API_KEY=<伏せた>/);
  const cut = `前の文 -----BEGIN PRIVATE KEY-----\n${'PEMBODY0'.repeat(8)}\n${'PEMBODY1'.repeat(8)}`;
  assert.doesNotMatch(maskSecrets(cut), /PEMBODY/);
  assert.match(maskSecrets(cut), /^前の文 <伏せた>/);
  for (const url of ['https://hooks.slack.com/services/T0/B0/HOOKSECRET', 'https://discord.com/api/webhooks/1/HOOKSECRET', 'https://api.vercel.com/v1/integrations/deploy/prj_1/HOOKSECRET'])
    assert.doesNotMatch(maskSecrets(`url ${url} end`), /HOOKSECRET/, url);
});

test('履歴を探す: 長い発言の中の秘密鍵は、抜き出しで終わりの印が切れても伏せたまま。送れてしまう URL は一覧に出さない', async () => {
  const body = Array.from({ length: 30 }, (_, i) => `PEMBODY${String(i).padStart(2, '0')}`.repeat(8)).join('\n');
  const long = `${'前置き。'.repeat(800)} zebrafont の鍵を貼る\n-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n${'後書き。'.repeat(800)}`;
  const t = oneSession([cuser('zebrafont の設定を見て'), cai([{ type: 'text', text: long }, { type: 'tool_use', id: 'w', name: 'WebFetch', input: { url: 'https://hooks.slack.com/services/T0/B0/HOOKSECRET', prompt: 'p' } }])]);
  try {
    const r = await findHistory({ query: 'zebrafont', env: t.env, home: t.home, now: NOW, out: join(t.home, 'm'), log: () => {} });
    const memo = readFileSync(r.written[0], 'utf-8');
    assert.doesNotMatch(memo, /PEMBODY/);
    assert.doesNotMatch(memo, /HOOKSECRET|hooks\.slack/);
    assert.match(memo, /zebrafont の鍵を貼る/);
  } finally {
    t.cleanup();
  }
});

test('履歴を探す: 「調べます」の後の調べた結果（話題の言葉を含まない最後の答え）もメモに入れる', async () => {
  const t = oneSession([
    cuser('zebrafont の値段を調べて'),
    cai([{ type: 'text', text: '調べます。' }]),
    cai([{ type: 'tool_use', id: 'w', name: 'WebFetch', input: { url: 'https://shop.example.com/price', prompt: 'p' } }]),
    { parentUuid: 'y', isSidechain: false, type: 'user', message: { role: 'user', content: [{ tool_use_id: 'w', type: 'tool_result', content: '道具の出力' }] }, timestamp: ago(3) },
    cai([{ type: 'text', text: '確認結果: 月額 500 円でした。FINALANSWER' }]),
    cuser('ありがとう。別の話をしよう'),
    cai([{ type: 'text', text: '別の話の答え OTHERTOPIC' }]),
  ]);
  try {
    const r = await findHistory({ query: 'zebrafont', env: t.env, home: t.home, now: NOW, out: join(t.home, 'm'), log: () => {} });
    const memo = readFileSync(r.written[0], 'utf-8');
    assert.match(memo, /調べます/);
    assert.match(memo, /確認結果: 月額 500 円でした。FINALANSWER/);
    assert.match(memo, /https:\/\/shop\.example\.com\/price/);
    assert.doesNotMatch(memo, /OTHERTOPIC/);
  } finally {
    t.cleanup();
  }
});

test('履歴を探す: 探さない場所の設定があるのに読めない時は、全部を探さずに止める（道具は 4 で終わる）', { skip: process.getuid?.() === 0 ? 'root では読めてしまう' : false }, async () => {
  const t = histSetup();
  const f = join(t.home, '.config/ai-digest/history-ignore');
  try {
    mkdirSync(join(t.home, '.config/ai-digest'), { recursive: true });
    writeFileSync(f, '*\n');
    chmodSync(f, 0o000);
    await assert.rejects(findHistory({ query: 'zebrafont', env: t.env, home: t.home, now: NOW, out: join(t.home, 'm'), log: () => {} }), IgnoreUnreadable);
    assert.equal(existsSync(join(t.home, 'm')), false);
    const r = await runHist(['--query', 'zebrafont'], t);
    assert.equal(r.code, 4, r.out);
    assert.match(r.out, /探さない場所の設定.*読めない/);
    assert.equal(existsSync(join(t.home, '.ai-digest-skill/history')), false);
  } finally {
    chmodSync(f, 0o600);
    t.cleanup();
  }
});

// ---- 投稿者名（記事の下に「投稿者：<名前>」と表示される名前） ----
import { validateName } from '../skills/ai-digest-post/scripts/author.mjs';

test('投稿者名の決まり: 頭の「投稿者：」と前後の空白は外す。空・長い・" \\ < >・改行・鍵のような文字列は断る', () => {
  assert.deepEqual(validateName('  投稿者：たなか '), { name: 'たなか' });
  assert.deepEqual(validateName('Tanaka Taro'), { name: 'Tanaka Taro' });
  for (const bad of ['', '   ', '投稿者：', 'あ'.repeat(31), '"たなか"', 'a\\b', '<b>x</b>', 'た\nなか', `aid_${'0'.repeat(48)}`]) assert.ok(validateName(bad).error, JSON.stringify(bad));
  assert.equal(validateName('あ'.repeat(30)).name, 'あ'.repeat(30));
});

test('送る道具: --set-name で投稿者名を登録する（鍵が無くても使える）。だめな名前は 2 で、登録を変えない', async () => {
  const home = homeWith({});
  const post = join(SKILL, 'scripts/post.mjs');
  const file = join(home, '.config/ai-digest/name');
  try {
    const r = await run(post, ['--set-name', '投稿者：たなか'], home);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /記事の下に「投稿者：たなか」と表示される/);
    assert.equal(readFileSync(file, 'utf-8'), 'たなか\n');
    const bad = await run(post, ['--set-name', '<b>'], home);
    assert.equal(bad.code, 2);
    assert.match(bad.out, /投稿者名にできない/);
    assert.equal(readFileSync(file, 'utf-8'), 'たなか\n');
    assert.equal((await run(post, ['--set-name'], home)).code, 2);
    assert.equal((await run(post, ['--set-name', 'はなこ', '--check'], home)).code, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('送る道具: 鍵は有効でも投稿者名が未登録なら --check は 5 で、登録のしかたを出す。鍵が無い時も投稿者名の行は出す', async () => {
  const site = await fakeSite();
  const noName = homeWith({ url: site.url, key: KEY });
  const nothing = homeWith({});
  try {
    const r = await run(join(SKILL, 'scripts/post.mjs'), ['--check'], noName);
    assert.equal(r.code, 5, r.out);
    assert.match(r.out, /鍵は有効です/);
    assert.match(r.out, /投稿者名: 未登録。記事の下に「投稿者：<名前>」と表示される名前を決めて、node post\.mjs --set-name/);
    const r2 = await run(join(SKILL, 'scripts/post.mjs'), ['--check'], nothing);
    assert.equal(r2.code, 2);
    assert.match(r2.out, /投稿者名: 未登録/);
  } finally {
    await site.close();
    rmSync(noName, { recursive: true, force: true });
    rmSync(nothing, { recursive: true, force: true });
  }
});

test('送る前の確かめ: written_by が空なら「直す」。登録した投稿者名と違えば「見る」。未登録なら「見る」で登録を勧める', () => {
  const empty = GOOD.replace('written_by: "投稿者：たなか"', 'written_by: ""');
  assert.ok(checkArticle(empty, '2026-10-20_sample-article.md').fix.some((f) => /written_by が空。記事の下に表示される投稿者名/.test(f)));
  assert.deepEqual(checkArticle(GOOD, '2026-10-20_sample-article.md', { author: 'たなか' }).look, []);
  assert.ok(checkArticle(GOOD, '2026-10-20_sample-article.md', { author: 'はなこ' }).look.some((l) => /登録した投稿者名の「投稿者：はなこ」と違う/.test(l)));
  assert.ok(checkArticle(GOOD, '2026-10-20_sample-article.md', { author: null }).look.some((l) => /投稿者名が未登録/.test(l)));
});

test('入れる道具: 投稿者名を聞いて登録する。だめな名前は聞き直す。登録済みなら Enter でそのまま', async () => {
  const t = installSetup();
  try {
    const env = { AI_DIGEST_EXTRAS_SOURCE: t.extras, AI_DIGEST_INSTALL_ASSUME_TTY: '1' };
    const r = await installer({ home: t.home, args: ['--no-extras'], env, input: '<b>\nたなか\n' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /記事の下に「投稿者：<名前>」と表示され、サイトを読む人に見えます/);
    assert.match(r.out, /投稿者名にできない/);
    assert.equal(readFileSync(join(t.home, '.config/ai-digest/name'), 'utf-8'), 'たなか\n');
    const again = await installer({ home: t.home, args: ['--no-extras'], env, input: '\n' });
    assert.match(again.out, /投稿者名（今: たなか。Enter でそのまま）/);
    assert.match(again.out, /投稿者名: たなか のまま/);
    assert.equal(readFileSync(join(t.home, '.config/ai-digest/name'), 'utf-8'), 'たなか\n');
  } finally {
    t.cleanup();
  }
});

test('入れる道具: --author-name で聞かずに決める。だめな名前は入れる前に 2 で止める。聞けない時は決めずに案内する', async () => {
  const t = installSetup();
  try {
    const bad = await installer({ home: t.home, args: ['--no-extras', '--author-name', '"x"'] });
    assert.equal(bad.code, 2, bad.out);
    assert.equal(existsSync(join(t.home, '.claude/skills/ai-digest-post')), false); // 入れる前に止めた
    const quiet = await installer({ home: t.home, args: ['--no-extras'] });
    assert.equal(quiet.code, 0, quiet.out);
    assert.match(quiet.out, /投稿者名: 聞けないので決めなかった（端末でない）。--author-name/);
    assert.equal(existsSync(join(t.home, '.config/ai-digest/name')), false);
    const ok = await installer({ home: t.home, args: ['--no-extras', '--author-name', 'はなこ'] });
    assert.equal(ok.code, 0, ok.out);
    assert.equal(readFileSync(join(t.home, '.config/ai-digest/name'), 'utf-8'), 'はなこ\n');
    assert.doesNotMatch(ok.out, /投稿者名（/); // 聞かない
  } finally {
    t.cleanup();
  }
});

// ---- 投稿用の鍵（この PC で作り、運営には鍵のハッシュ値の 1 行だけを送る） ----
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { commitKey, main as keyMain } from '../skills/ai-digest-post/scripts/key.mjs';

const sha = (k) => createHash('sha256').update(k, 'utf8').digest('hex');
/** key.mjs を、作った手元で動かす（出力を集める）。ask は「消しますか？」への答え */
async function keyRun(argv, home, { env = {}, ask } = {}) {
  const lines = [];
  const code = await keyMain(argv, { env, home, out: (l) => lines.push(l), err: (l) => lines.push(l), ask });
  return { code, out: lines.join('\n') };
}
const keyOf = (home) => readFileSync(join(home, '.config/ai-digest/key'), 'utf-8');

test('鍵の道具: 鍵を作って本人だけが読める所に置き、運営に送る 1 行（鍵のハッシュ値）を出す。鍵そのものは出さない', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aid-key-'));
  try {
    const r = await keyRun(['new', 'tanaka'], home);
    assert.equal(r.code, 0, r.out);
    const key = keyOf(home);
    assert.match(key, KEY_RE);
    assert.equal(statSync(join(home, '.config/ai-digest/key')).mode & 0o777, 0o600);
    assert.ok(r.out.includes(JSON.stringify({ name: 'tanaka', sha256: sha(key) })));
    assert.match(r.out, /次の1行を運営に送ってください。中身は鍵のハッシュ値で、鍵には戻せません。人に見られてもかまいません。/);
    assert.ok(!r.out.includes(key) && !r.out.includes(key.slice(4)));
    const h = await keyRun(['hash'], home);
    assert.equal(h.code, 0);
    assert.ok(h.out.includes(JSON.stringify({ name: 'tanaka', sha256: sha(key) })));
    assert.ok(!h.out.includes(key.slice(4)));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('鍵の道具: もう鍵があれば 3 で止め、鍵を変えない。--replace で作り直すと、前の鍵の 1 行も出す', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aid-key-'));
  try {
    await keyRun(['new', 'tanaka'], home);
    const first = keyOf(home);
    const again = await keyRun(['new', 'tanaka'], home);
    assert.equal(again.code, 3);
    assert.match(again.out, /もう登録されています.*--replace/);
    assert.equal(keyOf(home), first);
    const re = await keyRun(['new', 'tanaka', '--replace'], home);
    assert.equal(re.code, 0, re.out);
    const second = keyOf(home);
    assert.notEqual(second, first);
    assert.ok(re.out.indexOf(sha(first)) < re.out.indexOf(sha(second)));
    assert.match(re.out, /前の鍵のハッシュ値です。運営に、この行を消してもらってください/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('鍵の道具: 消す前に確かめる。「いいえ」と、確かめられない時は 4 で消さない。--yes か「はい」で消す', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aid-key-'));
  try {
    await keyRun(['new', 'tanaka'], home);
    const key = keyOf(home);
    const no = await keyRun(['delete'], home, { ask: async () => 'n' });
    assert.equal(no.code, 4);
    assert.equal(keyOf(home), key);
    const quiet = await keyRun(['delete'], home); // 端末でない（ask も無い）
    assert.equal(quiet.code, 4);
    assert.match(quiet.out, /確かめられないので消さなかった.*--yes/);
    const yes = await keyRun(['delete'], home, { ask: async () => 'y' });
    assert.equal(yes.code, 0, yes.out);
    assert.equal(existsSync(join(home, '.config/ai-digest/key')), false);
    assert.equal(existsSync(join(home, '.config/ai-digest/key-name')), false);
    assert.ok(yes.out.includes(sha(key)));
    assert.match(yes.out, /運営がこの行を消すまで有効です/);
    assert.equal((await keyRun(['delete', '--yes'], home)).code, 0); // もう無い
    await keyRun(['new', 'tanaka'], home);
    assert.equal((await keyRun(['delete', '--yes'], home)).code, 0);
    assert.equal(existsSync(join(home, '.config/ai-digest/key')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('鍵の道具: だめな鍵の名前・知らない指定・環境変数の鍵がある時は 2。鍵が無いのに hash は 2', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aid-key-'));
  try {
    for (const argv of [['new', 'Tanaka'], ['new', '-x'], ['new'], ['new', 'a'.repeat(33)], ['new', 'tanaka', '--yes'], ['bogus'], [], ['hash', 'x']]) assert.equal((await keyRun(argv, home)).code, 2, JSON.stringify(argv));
    assert.equal(existsSync(join(home, '.config/ai-digest/key')), false);
    assert.equal((await keyRun(['hash'], home)).code, 2);
    const env = await keyRun(['new', 'tanaka'], home, { env: { AI_DIGEST_API_KEY: KEY } });
    assert.equal(env.code, 2);
    assert.match(env.out, /環境変数 AI_DIGEST_API_KEY/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('送る道具: 鍵が無い時は、この PC で鍵を作る道具を案内する。作ったばかりで通らない時は、運営の登録待ちだと分かる', async () => {
  const site = await fakeSite();
  const none = homeWith({ url: site.url });
  const unregistered = homeWith({ url: site.url, key: `aid_${'e'.repeat(48)}`, name: 'たなか' });
  try {
    const r = await run(join(SKILL, 'scripts/post.mjs'), ['--check'], none);
    assert.match(r.out, /投稿用の鍵は、このPCで作れる: node key\.mjs new <鍵の名前>/);
    const r2 = await run(join(SKILL, 'scripts/post.mjs'), ['--check'], unregistered);
    assert.equal(r2.code, 1);
    assert.match(r2.out, /作ったばかりの鍵なら、運営がハッシュ値を登録するまで使えない/);
  } finally {
    await site.close();
    rmSync(none, { recursive: true, force: true });
    rmSync(unregistered, { recursive: true, force: true });
  }
});

test('入れる道具: --new-key で鍵を作り、運営に送る 1 行と次にすることを出す。だめな名前・作り直しの指定が無い時は、入れる前に 2 で止める', async () => {
  const t = installSetup();
  try {
    const bad = await installer({ home: t.home, args: ['--no-extras', '--author-name', 'たなか', '--new-key', 'Bad!'] });
    assert.equal(bad.code, 2, bad.out);
    assert.equal(existsSync(join(t.home, '.claude/skills/ai-digest-post')), false);
    const ok = await installer({ home: t.home, args: ['--no-extras', '--author-name', 'たなか', '--new-key', 'tanaka'] });
    assert.equal(ok.code, 0, ok.out);
    const key = keyOf(t.home);
    assert.ok(ok.out.includes(JSON.stringify({ name: 'tanaka', sha256: sha(key) })));
    assert.match(ok.out, /上に出した1行（鍵のハッシュ値）を運営に送る/);
    assert.ok(!ok.out.includes(key.slice(4)));
    const noReplace = await installer({ home: t.home, args: ['--no-extras', '--author-name', 'たなか', '--new-key', 'tanaka'] });
    assert.equal(noReplace.code, 2, noReplace.out);
    assert.equal(keyOf(t.home), key);
    const replaced = await installer({ home: t.home, args: ['--no-extras', '--author-name', 'たなか', '--new-key', 'tanaka', '--replace-key'] });
    assert.equal(replaced.code, 0, replaced.out);
    assert.notEqual(keyOf(t.home), key);
    assert.ok(replaced.out.includes(sha(key))); // 前の鍵の 1 行
    const quiet = await installer({ home: t.home, args: ['--no-extras', '--author-name', 'たなか'] });
    assert.match(quiet.out, /投稿用の鍵: 登録済み（作り直す時は --new-key <鍵の名前> --replace-key）/);
  } finally {
    t.cleanup();
  }
});

test('入れる道具: 鍵を作るかを聞く（Enter で作る・n で作らない）。もう鍵があれば作り直すかを聞く（Enter でそのまま）。聞けない時は作らない', async () => {
  const t = installSetup();
  try {
    const env = { AI_DIGEST_EXTRAS_SOURCE: t.extras, AI_DIGEST_INSTALL_ASSUME_TTY: '1' };
    const args = ['--no-extras', '--author-name', 'たなか'];
    const quiet = await installer({ home: t.home, args });
    assert.match(quiet.out, /投稿用の鍵: 聞けないので作らなかった（端末でない）。--new-key/);
    assert.equal(existsSync(join(t.home, '.config/ai-digest/key')), false);
    const skip = await installer({ home: t.home, args, env, input: 'n\n' });
    assert.match(skip.out, /投稿用の鍵: 作らなかった/);
    assert.equal(existsSync(join(t.home, '.config/ai-digest/key')), false);
    const made = await installer({ home: t.home, args, env, input: '\nBad!\ntanaka\n' });
    assert.equal(made.code, 0, made.out);
    assert.match(made.out, /鍵の名前は、運営が誰の鍵かを見分けるための名前です/);
    assert.match(made.out, /鍵の名前は、英小文字・数字・_- で32字まで/); // だめな名前の理由を見せて聞き直した
    const key = keyOf(t.home);
    assert.ok(made.out.includes(JSON.stringify({ name: 'tanaka', sha256: sha(key) })));
    const keep = await installer({ home: t.home, args, env, input: '\n' });
    assert.match(keep.out, /投稿用の鍵: そのまま使う/);
    assert.equal(keyOf(t.home), key);
    const remake = await installer({ home: t.home, args, env, input: 'y\n\n' }); // 名前は今のまま（Enter）
    assert.equal(remake.code, 0, remake.out);
    assert.match(remake.out, /鍵の名前（今: tanaka。Enter でそのまま）/);
    assert.notEqual(keyOf(t.home), key);
    assert.ok(remake.out.includes(sha(key)));
  } finally {
    t.cleanup();
  }
});

test('入れる道具: 次にすることは、登録済みの物を出さない（鍵とサイトの URL が登録済みなら「なし」）', async () => {
  const t = installSetup();
  try {
    const args = ['--no-extras', '--author-name', 'たなか'];
    const empty = await installer({ home: t.home, args });
    assert.match(empty.out, /投稿用の鍵を作る（node .*key\.mjs" new <鍵の名前>）か、運営から受け取った鍵/);
    assert.match(empty.out, /サイトの URL を登録する/);
    mkdirSync(join(t.home, '.config/ai-digest'), { recursive: true });
    writeFileSync(join(t.home, '.config/ai-digest/url'), 'https://site.example');
    const made = await installer({ home: t.home, args: [...args, '--new-key', 'tanaka'] });
    assert.match(made.out, /上に出した1行（鍵のハッシュ値）を運営に送る/);
    assert.doesNotMatch(made.out, /サイトの URL を登録する/);
    const done = await installer({ home: t.home, args });
    assert.match(done.out, /なし（投稿用の鍵とサイトの URL は登録済み）/);
  } finally {
    t.cleanup();
  }
});

test('鍵の道具: 名前の欄に鍵を入れ間違えても、鍵を表示しない（aid_ の付いた鍵も、後ろだけも）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aid-key-'));
  try {
    for (const wrong of [KEY, KEY.slice(4), `aid_${'0'.repeat(48)}`]) {
      const r = await keyRun(['new', wrong], home);
      assert.equal(r.code, 2);
      assert.ok(!r.out.includes(wrong.replace(/^aid_/, '')), `出た: ${r.out}`);
      assert.match(r.out, /入れた物は表示しない/);
    }
    await keyRun(['new', 'tanaka'], home);
    const key = keyOf(home);
    const r = await keyRun(['new', key, '--replace'], home); // 登録した鍵そのものを名前に入れた
    assert.equal(r.code, 2);
    assert.ok(!r.out.includes(key.slice(4)));
    assert.equal(keyOf(home), key);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('鍵の道具: 作り直しの途中で書けなかった時は、元の鍵を残し、名前も元に戻す。一時のファイルを残さない', () => {
  const home = mkdtempSync(join(tmpdir(), 'aid-key-'));
  const dir = join(home, '.config/ai-digest');
  const file = join(dir, 'key');
  const nameFile = join(dir, 'key-name');
  const real = { mkdirSync, writeFileSync, renameSync: (a, b) => renameSyncReal(a, b), rmSync };
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, KEY);
    writeFileSync(nameFile, 'tanaka\n');
    const failOn = (target) => ({ ...real, renameSync: (a, b) => { if (b === target) throw Object.assign(new Error('書けない'), { code: 'EIO' }); renameSyncReal(a, b); } });
    assert.throws(() => commitKey(file, nameFile, `aid_${'b'.repeat(48)}`, 'hanako', 'tanaka', failOn(file)), /書けない/); // 鍵の置き換えで失敗
    assert.equal(readFileSync(file, 'utf-8'), KEY);
    assert.equal(readFileSync(nameFile, 'utf-8'), 'tanaka\n');
    assert.throws(() => commitKey(file, nameFile, `aid_${'b'.repeat(48)}`, 'hanako', 'tanaka', failOn(nameFile)), /書けない/); // 名前の置き換えで失敗
    assert.equal(readFileSync(file, 'utf-8'), KEY);
    assert.equal(readFileSync(nameFile, 'utf-8'), 'tanaka\n');
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('鍵の道具: 置き場に書けない時は 1 で止め、元の鍵のまま（root では書けてしまうので見ない）', { skip: process.getuid?.() === 0 ? 'root' : false }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'aid-key-'));
  const dir = join(home, '.config/ai-digest');
  try {
    await keyRun(['new', 'tanaka'], home);
    const key = keyOf(home);
    chmodSync(dir, 0o500);
    const r = await keyRun(['new', 'hanako', '--replace'], home);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /鍵は元のまま（作り直していない）/);
    chmodSync(dir, 0o700);
    assert.equal(keyOf(home), key);
    assert.equal(readFileSync(join(dir, 'key-name'), 'utf-8'), 'tanaka\n');
  } finally {
    chmodSync(dir, 0o700);
    rmSync(home, { recursive: true, force: true });
  }
});

test('鍵の道具: aid_ を含む正しい鍵の名前（aid_tanaka・said_ali）も、運営に送る 1 行にそのまま出す（鍵は伏せる）', async () => {
  for (const name of ['aid_tanaka', 'said_ali']) {
    const home = mkdtempSync(join(tmpdir(), 'aid-key-'));
    try {
      const r = await keyRun(['new', name], home);
      assert.equal(r.code, 0, r.out);
      const key = keyOf(home);
      const line = JSON.stringify({ name, sha256: sha(key) });
      assert.ok(r.out.includes(line), r.out);
      assert.equal(readFileSync(join(home, '.config/ai-digest/key-name'), 'utf-8'), `${name}\n`);
      const h = await keyRun(['hash'], home);
      assert.ok(h.out.includes(line), h.out);
      for (const o of [r.out, h.out]) assert.ok(!o.includes(key.slice(4)));
      const re = await keyRun(['new', name, '--replace'], home);
      assert.ok(re.out.includes(line)); // 前の鍵の 1 行も名前のまま
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});

test('送る道具: --check は aid_ を含む鍵の名前と投稿者名（said_ali）を壊さずに出す。鍵は出さない', async () => {
  const site = await fakeSite({ name: 'said_ali' });
  const home = homeWith({ url: site.url, key: KEY, name: 'said_ali' });
  try {
    const r = await run(join(SKILL, 'scripts/post.mjs'), ['--check'], home);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /鍵は有効です: said_ali（writer/);
    assert.match(r.out, /投稿者名: said_ali（記事の下に「投稿者：said_ali」と表示される/);
    assert.doesNotMatch(r.out, new RegExp(KEY.slice(4)));
  } finally {
    await site.close();
    rmSync(home, { recursive: true, force: true });
  }
});
