#!/usr/bin/env node
// 投稿用の鍵を作る・鍵のハッシュ値を出す・鍵を消す（このPCの中だけで、通信しない。要る物は Node.js だけ）。
//   node key.mjs new <鍵の名前> [--replace]   … 鍵を作って ~/.config/ai-digest/key に置き、運営に送る1行（鍵のハッシュ値）を出す
//   node key.mjs hash                          … 登録した鍵のハッシュ値の1行を、もう一度出す
//   node key.mjs delete [--yes]                … このPCの鍵を消す（--yes が無ければ、端末で確かめる）
// 鍵そのものは画面に出さない。運営に送るのは鍵のハッシュ値（SHA-256）だけ。ハッシュ値から鍵には戻せず、サイトは元からハッシュ値で照らし合わせる。
// 鍵の名前は、運営が誰の鍵かを見分けるため（英小文字・数字・_-・32字まで）。記事には出ない（記事に出るのは投稿者名）。
// 終わりの番号: 0 済んだ／1 書けない・消せない／2 使い方の誤り・鍵が無い・環境変数の鍵がある／3 もう鍵がある（作り直すなら --replace）／
//   4 消すのを確かめられない・「いいえ」
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { configDir, KEY_RE } from './post.mjs';

export const KEY_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const keyFile = (home = homedir()) => join(configDir(home), 'key');
export const keyNameFile = (home = homedir()) => join(configDir(home), 'key-name');
/** サイトと同じ計算（SHA-256 の 16 進） */
export const hashKey = (key) => createHash('sha256').update(key, 'utf8').digest('hex');
export const newKey = () => `aid_${randomBytes(24).toString('hex')}`;
/** 運営に送る1行。鍵の名前が分からない時（運営から受け取った鍵）は、ハッシュ値だけ */
export const sendLine = (name, key) => JSON.stringify(name ? { name, sha256: hashKey(key) } : { sha256: hashKey(key) });

const SEND = '次の1行を運営に送ってください。中身は鍵のハッシュ値で、鍵には戻せません。人に見られてもかまいません。';
const SANDBOX = 'Codex の中なら、サンドボックスがホームへの書き込みを止めていないかを見る（承認して、サンドボックスの外で実行する）';

const readTrim = (file) => {
  try {
    return readFileSync(file, 'utf-8').trim();
  } catch (e) {
    if (e?.code === 'ENOENT') return '';
    throw e;
  }
};

/** 鍵を書く（一時のファイルに書いてから置き換える。権限は本人だけ） */
function writeSecret(file, text) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

export async function main(argv, { env = process.env, home = homedir(), out = console.log, err = console.error, ask } = {}) {
  const [cmd, ...rest] = argv;
  const flags = rest.filter((a) => a.startsWith('--'));
  const args = rest.filter((a) => !a.startsWith('--'));
  const allowed = { new: ['--replace'], hash: [], delete: ['--yes'] }[cmd];
  const usage = () => err('使い方: node key.mjs new <鍵の名前> [--replace] ／ node key.mjs hash ／ node key.mjs delete [--yes]');
  if (!allowed || flags.some((f) => !allowed.includes(f)) || args.length > (cmd === 'new' ? 1 : 0)) {
    usage();
    return 2;
  }
  const file = keyFile(home);
  const nameFile = keyNameFile(home);
  let current;
  let currentName;
  try {
    current = readTrim(file);
    currentName = readTrim(nameFile);
  } catch (e) {
    err(`鍵のファイルを読めない（${e?.code ?? e}）: ${file}`);
    return 1;
  }

  if (cmd === 'new') {
    const name = args[0] ?? '';
    if (!KEY_NAME_RE.test(name)) {
      err(`鍵の名前は、英小文字・数字・_- で32字まで（頭は英小文字か数字）。例: tanaka（今: ${name || 'なし'}）`);
      usage();
      return 2;
    }
    if (env.AI_DIGEST_API_KEY) {
      err('環境変数 AI_DIGEST_API_KEY に鍵があり、そちらが先に使われる。このPCのファイルに鍵を作るなら、環境変数を外してから作る');
      return 2;
    }
    const replace = flags.includes('--replace');
    if (current && !replace) {
      err(`投稿用の鍵はもう登録されています（${file}）。作り直す時は --replace を付ける。作り直すと、運営が新しいハッシュ値を登録するまで投稿できない`);
      return 3;
    }
    const key = newKey();
    try {
      writeSecret(file, key);
      writeSecret(nameFile, `${name}\n`);
    } catch (e) {
      err(`鍵を書けなかった（${e?.code ?? e?.message ?? e}）: ${file}。${SANDBOX}`);
      return 1;
    }
    if (current) {
      out('前の鍵のハッシュ値です。運営に、この行を消してもらってください。');
      out(KEY_RE.test(current) ? sendLine(currentName, current) : '（前の鍵は形が違ったので、サイトでは使えていなかった）');
    }
    out(`投稿用の鍵を作り、このPCに保存しました（${file}。鍵の中身は表示しません）。`);
    out(SEND);
    out(sendLine(name, key));
    out('運営が登録すると投稿できます。登録されたかは node post.mjs --check で確かめられます。');
    return 0;
  }

  if (cmd === 'hash') {
    const key = env.AI_DIGEST_API_KEY ? env.AI_DIGEST_API_KEY.trim() : current;
    if (!key) {
      err(`投稿用の鍵がまだ無い（${file}）。作る: node key.mjs new <鍵の名前>`);
      return 2;
    }
    if (!KEY_RE.test(key)) {
      err(`鍵の形が違う（aid_ で始まる52文字のはず。${env.AI_DIGEST_API_KEY ? '環境変数 AI_DIGEST_API_KEY' : file}）。作り直す: node key.mjs new <鍵の名前> --replace`);
      return 2;
    }
    out(`このPCの鍵のハッシュ値です（${env.AI_DIGEST_API_KEY ? '環境変数 AI_DIGEST_API_KEY' : file}）。${SEND}`);
    out(sendLine(env.AI_DIGEST_API_KEY ? '' : currentName, key));
    return 0;
  }

  // delete
  if (env.AI_DIGEST_API_KEY) err('注意: 環境変数 AI_DIGEST_API_KEY の鍵は、この道具では消せない。シェルの設定から外す');
  if (!current) {
    out(`このPCに鍵のファイルはありません（${file}）。`);
    return env.AI_DIGEST_API_KEY ? 2 : 0;
  }
  out('消す鍵のハッシュ値です。消した後、運営にこの行を消してもらってください。');
  out(KEY_RE.test(current) ? sendLine(currentName, current) : '（形の違う鍵。サイトでは使えていなかった）');
  if (!flags.includes('--yes')) {
    const question = 'このPCの鍵を消しますか？ 消すと、新しい鍵を作って運営に登録してもらうまで投稿できません [y/N] ';
    let answer = '';
    if (ask) answer = await ask(question);
    else if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      answer = await rl.question(question);
      rl.close();
    } else {
      err('確かめられないので消さなかった（端末でない）。消すなら --yes を付ける');
      return 4;
    }
    if (!/^(y|yes|はい)$/i.test(String(answer).trim())) {
      out('消さなかった。');
      return 4;
    }
  }
  try {
    rmSync(file, { force: true });
    rmSync(nameFile, { force: true });
  } catch (e) {
    err(`消せなかった（${e?.code ?? e?.message ?? e}）: ${file}。${SANDBOX}`);
    return 1;
  }
  if (existsSync(file)) {
    err(`消せなかった: ${file}`);
    return 1;
  }
  out('このPCから鍵を消しました。サイトの側では、運営がこの行を消すまで有効です。漏れた疑いがある時は、すぐ運営に連絡してください。');
  return 0;
}

if (process.argv[1] && basename(process.argv[1]) === 'key.mjs') process.exit(await main(process.argv.slice(2)));
