// 投稿者名: 記事の下に「投稿者：<名前>」と表示される名前（サイトを読む人に見える）。
// 入れる道具（install.sh・install.ps1）が聞き、post.mjs --set-name が確かめて ~/.config/ai-digest/name に書く（鍵や URL と同じ置き場）。
// 環境変数 AI_DIGEST_AUTHOR_NAME があれば、そちらを先に使う。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const AUTHOR_PREFIX = '投稿者：';
export const NAME_MAX = 30;
export const nameFile = (home = homedir()) => join(home, '.config', 'ai-digest', 'name');
/** 記事の written_by に書く形 */
export const writtenBy = (name) => `${AUTHOR_PREFIX}${name}`;

/** 名前を確かめる。前後の空白と、頭の「投稿者：」は外す。だめなら error に理由 */
export function validateName(raw) {
  const name = String(raw ?? '')
    .normalize('NFC')
    .trim()
    .replace(/^投稿者\s*[:：]\s*/, '')
    .trim();
  if (!name) return { error: '名前が空' };
  if ([...name].length > NAME_MAX) return { error: `長い（${[...name].length} 字。${NAME_MAX} 字まで）` };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { error: '改行や制御文字は使えない' };
  if (/["\\<>]/.test(name)) return { error: '" \\ < > は使えない（記事の frontmatter とサイトの表示が崩れる）' };
  if (/aid_[0-9A-Za-z_-]{8,}|Bearer\s/i.test(name)) return { error: '鍵のような文字列は名前にしない' };
  return { name };
}

/** 登録した投稿者名。無ければ name は空。登録が正しくない・読めない時は error */
export function registeredName({ env = process.env, home = homedir() } = {}) {
  let raw = env.AI_DIGEST_AUTHOR_NAME ?? '';
  let from = raw ? '環境変数 AI_DIGEST_AUTHOR_NAME' : '';
  if (!raw) {
    from = nameFile(home);
    try {
      raw = readFileSync(from, 'utf-8');
    } catch (e) {
      if (e?.code === 'ENOENT') return { name: '', from: '' };
      return { name: '', from, error: `読めない（${e?.code ?? e}）` };
    }
  }
  const v = validateName(raw);
  return v.error ? { name: '', from, error: v.error } : { name: v.name, from };
}

/** 確かめ済みの名前を書く。書いた場所を返す */
export function saveName(name, home = homedir()) {
  mkdirSync(join(home, '.config', 'ai-digest'), { recursive: true, mode: 0o700 });
  writeFileSync(nameFile(home), `${name}\n`, { mode: 0o600 });
  return nameFile(home);
}
