// 表示から鍵を消す（送る道具 post.mjs と送る前の確かめ check.mjs の両方が、画面に出す物を全部ここに通す）。
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 表示する文から鍵を消す（登録した鍵そのもの・その aid_ の後ろだけ・Bearer の後ろ・aid_ で始まる文字列） */
export function scrub(text, key = '') {
  let t = String(text ?? '');
  const k = String(key ?? '');
  for (const s of [k, k.startsWith('aid_') ? k.slice(4) : ''].filter((x) => x.length >= 8)) t = t.split(s).join('<鍵>');
  return t.replace(/Bearer\s+\S+/g, 'Bearer <鍵>').replace(/aid_[0-9A-Za-z_-]+/g, 'aid_<鍵>');
}

/** この端末に登録した鍵（環境変数 AI_DIGEST_API_KEY か ~/.config/ai-digest/key）。表示から消すためだけに読む */
export function registeredKey({ env = process.env, home = homedir() } = {}) {
  if (env.AI_DIGEST_API_KEY) return env.AI_DIGEST_API_KEY.trim();
  try {
    return readFileSync(join(home, '.config', 'ai-digest', 'key'), 'utf-8').trim();
  } catch {
    return '';
  }
}
