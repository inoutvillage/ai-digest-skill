#!/usr/bin/env bash
# ai-digest の投稿スキル（ai-digest-post）を入れる。Mac・Linux・WSL 用（Windows は README の手順）。
#   bash install.sh            … 入っている方（Claude Code の ~/.claude と Codex の ~/.codex。両方なら両方）に写す
#   bash install.sh --claude   … Claude Code だけ
#   bash install.sh --codex    … Codex だけ
# 前に入れた版は ai-digest-post.bak に残す（その前の .bak は消える）。
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/skills/ai-digest-post"
codex_home="${CODEX_HOME:-$HOME/.codex}"
targets=()
case "${1:-}" in
  --claude) targets=("$HOME/.claude/skills") ;;
  --codex) targets=("$codex_home/skills") ;;
  "")
    [ -d "$HOME/.claude" ] && targets+=("$HOME/.claude/skills")
    [ -d "$codex_home" ] && targets+=("$codex_home/skills")
    ;;
  *) echo "使い方: bash install.sh [--claude|--codex]" >&2; exit 2 ;;
esac
[ -f "$src/SKILL.md" ] || { echo "スキルが見つからない: $src" >&2; exit 1; }
if [ "${#targets[@]}" -eq 0 ]; then
  echo "Claude Code（~/.claude）も Codex（$codex_home）も見つからない。--claude か --codex を付けて実行する" >&2
  exit 1
fi
for t in "${targets[@]}"; do
  mkdir -p "$t"
  dest="$t/ai-digest-post"
  rm -rf "$dest.new"
  cp -R "$src" "$dest.new"
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    rm -rf "$dest.bak"
    mv "$dest" "$dest.bak"
  fi
  mv "$dest.new" "$dest"
  echo "入れた: $dest"
done
echo "次は鍵とサイトの URL の登録: references/setup.md（入れた先のフォルダの中）"
echo "確かめ: node \"${targets[0]}/ai-digest-post/scripts/post.mjs\" --check"
