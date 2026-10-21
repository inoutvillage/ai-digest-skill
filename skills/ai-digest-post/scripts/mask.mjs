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

// 会話の記録から抜き出す時に伏せる、よくある鍵・合言葉の形（記事に入らないよう、AI が読む前に消す）
const SECRET_RES = [
  // 秘密鍵は終わりの印まで。終わりの印が無い（途中で切れた）時は、続く鍵の文字を全部
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[A-Za-z0-9+/=\s]*)/g, '<伏せた>'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, '<伏せた>'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g, '<伏せた>'],
  [/\bgithub[_]pat_[A-Za-z0-9_]{30,}/g, '<伏せた>'], // [_] は、この行そのものが鍵と見なされないため
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '<伏せた>'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '<伏せた>'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '<伏せた>'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '<伏せた>'],
  [/\bvercel_blob_rw_[A-Za-z0-9_]{10,}/g, '<伏せた>'],
  // 名前に KEY・SECRET・TOKEN・PASSWORD などを含む値（TYPESAFE_API_KEY=… や AWS_SECRET_ACCESS_KEY=…、"apiKey": "…" も）
  [/\b([A-Za-z0-9_]*(?:api[_-]?key|secret|password|passwd|passphrase|token|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)[^\s"',;]{8,}/gi, '$1<伏せた>'],
  // 知っているだけで送れてしまう URL（Slack・Discord の受け口、Vercel のデプロイフック）
  [/https:\/\/hooks\.slack\.com\/services\/[^\s"'<>)]+/g, '<伏せた URL>'],
  [/https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/[^\s"'<>)]+/g, '<伏せた URL>'],
  [/https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\/[^\s"'<>)]+/g, '<伏せた URL>'],
];

/** よくある形の鍵・合言葉を伏せる（会話の記録の抜き出しに使う） */
export function maskSecrets(text) {
  let t = String(text ?? '');
  for (const [re, to] of SECRET_RES) t = t.replace(re, to);
  return t;
}
