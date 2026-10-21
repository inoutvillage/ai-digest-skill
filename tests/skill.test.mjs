// スキル（skills/ai-digest-post）のテスト。要る物は Node.js 22 以上と bash（入れる道具の試し）だけ。
//   node --test tests/
// 送る前の確かめ・見出しの決まり・送る道具（偽のサーバーで実際に起動）・鍵を表示しないこと・入れる道具・スキルの説明文。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
written_by: "投稿者：いんきょ"
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
  for (const f of ['scripts/post.mjs', 'scripts/check.mjs', 'assets/template.md', 'references/setup.md', 'references/writing.md', 'references/images.md']) {
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
async function fakeSite() {
  const got = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end(JSON.stringify({ ok: false, errors: ['鍵が違う'] }));
      if (req.method === 'GET' && req.url === '/api/articles') return res.end(JSON.stringify({ ok: true, me: { name: 'tanaka', role: 'writer' }, articles: [{}, {}] }));
      if (req.method === 'POST' && req.url === '/api/articles') return res.writeHead(201).end(JSON.stringify({ ok: true, slug: 'sample-article', status: 'draft' }));
      if (req.method === 'POST' && req.url === '/api/articles/publish') return res.writeHead(403).end(JSON.stringify({ ok: false, errors: ['公開できない'] }));
      res.writeHead(404).end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, got, close: () => new Promise((r) => server.close(r)) };
}

function homeWith({ url, key } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'aid-home-'));
  mkdirSync(join(home, '.config/ai-digest'), { recursive: true });
  if (url) writeFileSync(join(home, '.config/ai-digest/url'), url);
  if (key) writeFileSync(join(home, '.config/ai-digest/key'), key);
  return home;
}

const run = (script, args, home) =>
  new Promise((resolve) => {
    const env = { ...process.env, HOME: home };
    delete env.AI_DIGEST_API_URL;
    delete env.AI_DIGEST_API_KEY;
    execFile(process.execPath, [script, ...args], { env, cwd: home }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr }));
  });

test('送る道具: --check は登録した鍵で名前と役を出す。鍵そのものは出さない', async () => {
  const site = await fakeSite();
  const home = homeWith({ url: site.url, key: `${KEY}\n` });
  try {
    for (const script of [join(SKILL, 'scripts/post.mjs')]) {
      const r = await run(script, ['--check'], home);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /鍵は有効です: tanaka（writer・下書きまで/);
      assert.match(r.out, /自分の記事 2 本/);
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
