#!/usr/bin/env bash
# ai-digest の投稿スキル（ai-digest-post）を入れる。Mac・Linux・WSL 用（Windows は install.ps1）。
#   bash install.sh [--claude] [--codex] [--with-imozuru] [--with-yomiyasu] [--with-extras] [--no-extras] [--author-name <投稿者名>]
# 1. Node.js 22 以上があるかを見る。無ければ入れ方を案内する（スキルは入れる）
# 2. スキルを、入っている方（Claude Code の ~/.claude と Codex の ~/.codex。両方なら両方）に写す。
#    前の版は ~/.ai-digest-skill/backup/<claude か codex>/ に残す（スキルの置き場の外。置き場の中に残すと古い版も読み込まれる）
# 3. 連携するスキル imozuru と yomiyasu が無ければ、入れるかを聞く（y/N）。入れる時は、確かめた版を GitHub から取って入れる。
#    すでに入っている物には手を付けない。入れなくても記事は書ける。後から入れれば、スキルが記事を書くたびに見つけて使う。
#    聞けない時（端末でない・AI が実行した時）は入れない。--with-imozuru・--with-yomiyasu・--with-extras（両方）で入れる。--no-extras で聞かない
# 4. 投稿者名（記事の下に「投稿者：<名前>」と表示される名前。サイトを読む人に見える）を聞く。登録済みなら Enter でそのまま。
#    確かめと書き込みは post.mjs --set-name（~/.config/ai-digest/name）。--author-name で聞かずに決める（だめな名前なら入れる前に 2 で止める）。
#    聞けない時は決めず、記事を書く時にスキルが聞く
# 終わりの値: 0 済んだ／1 入れる先が無い／2 使い方の誤り／3 スキルは入れたが Node.js が要る／4 スキルは入れたが連携するスキルを入れられなかった
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/skills/ai-digest-post"
codex_home="${CODEX_HOME:-$HOME/.codex}"
node_bin="${AI_DIGEST_NODE_BIN:-node}"            # 試し用に差し替えられる
extras_source="${AI_DIGEST_EXTRAS_SOURCE:-}"      # 試し用: <フォルダ>/<名前>/SKILL.md を GitHub の代わりに使う
assume_tty="${AI_DIGEST_INSTALL_ASSUME_TTY:-}"    # 試し用: 端末でなくても聞く（答えは標準入力から）

# 連携するスキル（入れる版は、確かめた commit に固定する）
IMOZURU_REPO="MaryCache/imozuru";  IMOZURU_REF="ecb82c71b611872a0f49e783eda3bec987c80d91"
YOMIYASU_REPO="nanaism/yomiyasu";  YOMIYASU_REF="fbe02c93877d697cc53d9377b7a45dd8a1dd99b3"

backup_root="$HOME/.ai-digest-skill/backup"   # 前の版の置き場（スキルの置き場の外）

usage() { echo "使い方: bash install.sh [--claude] [--codex] [--with-imozuru] [--with-yomiyasu] [--with-extras] [--no-extras] [--author-name <投稿者名>]" >&2; }

targets=()
want_imozuru=""
want_yomiyasu=""
author_name=""
author_given=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --claude) targets+=("$HOME/.claude/skills") ;;
    --codex) targets+=("$codex_home/skills") ;;
    --with-imozuru) want_imozuru=y ;;
    --with-yomiyasu) want_yomiyasu=y ;;
    --with-extras) want_imozuru=y; want_yomiyasu=y ;;
    --no-extras) [ -n "$want_imozuru" ] || want_imozuru=n; [ -n "$want_yomiyasu" ] || want_yomiyasu=n ;;
    --author-name) [ "$#" -ge 2 ] || { usage; exit 2; }; author_name="$2"; author_given=1; shift ;;
    --author-name=*) author_name="${1#*=}"; author_given=1 ;;
    *) usage; exit 2 ;;
  esac
  shift
done
if [ "${#targets[@]}" -eq 0 ]; then
  [ -d "$HOME/.claude" ] && targets+=("$HOME/.claude/skills")
  [ -d "$codex_home" ] && targets+=("$codex_home/skills")
fi
[ -f "$src/SKILL.md" ] || { echo "スキルが見つからない: $src" >&2; exit 1; }
if [ "${#targets[@]}" -eq 0 ]; then
  echo "Claude Code（~/.claude）も Codex（$codex_home）も見つからない。--claude か --codex を付けて実行する" >&2
  exit 1
fi

# 1. Node.js
node_ok=1
v="$("$node_bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [ -n "$v" ] && [ "$v" -ge 22 ] 2>/dev/null; then
  echo "Node.js: v$("$node_bin" -p 'process.versions.node')（使える）"
else
  node_ok=0
  echo "注意: Node.js 22 以上が見つからない（今: ${v:+v$v 系}${v:-入っていない}）。送る道具と送る前の確かめに要る"
  case "$(uname -s)" in
    Darwin) echo "  入れ方（Mac）: https://nodejs.org/ja/download から入れる。Homebrew があれば brew install node" ;;
    *) echo "  入れ方（Linux・WSL）: https://nodejs.org/ja/download の手順か、nvm（https://github.com/nvm-sh/nvm）で nvm install 22" ;;
  esac
  echo "  スキルは入れておく。Node.js を入れた後は、入れ直さずにそのまま使える"
fi

# 投稿者名の確かめと書き込みは post.mjs に任せる（名前の決まりを 1 か所にする）
name_file="$HOME/.config/ai-digest/name"
set_name() { "$node_bin" "$src/scripts/post.mjs" --set-name "$1"; }
current_name() { if [ -f "$name_file" ]; then head -n 1 "$name_file" 2>/dev/null | tr -d '\r' || true; fi; } # 読めなくても止めない（聞き直すだけ）
if [ "$author_given" = 1 ]; then
  if [ "$node_ok" = 1 ]; then
    set_name "$author_name" || { echo "--author-name の名前を直して、もう一度実行する（スキルはまだ入れていない）" >&2; exit 2; }
  else
    echo "投稿者名: Node.js が無いので登録できない。Node.js を入れた後に --author-name を付けて実行し直すか、記事を書く時にスキルが聞く"
  fi
fi

# 前の版を、スキルの置き場の外へ移す（$1 置き場 $2 名前 $3 残す名前）。同じ名前の前の控えは消す
label_of() { if [ "$1" = "$HOME/.claude/skills" ]; then echo claude; elif [ "$1" = "$codex_home/skills" ]; then echo codex; else basename "$(dirname "$1")"; fi; }
stash() {
  local b="$backup_root/$(label_of "$1")"
  mkdir -p "$b"
  rm -rf "${b:?}/$3"
  mv "$1/$2" "$b/$3"
}

# 2. スキル
for t in "${targets[@]}"; do
  mkdir -p "$t"
  dest="$t/ai-digest-post"
  # 前のインストーラーが置き場の中に残した控え（*.bak）は、読み込まれないよう外へ移す
  for old in ai-digest-post.bak imozuru.bak yomiyasu.bak; do
    if [ -e "$t/$old" ] || [ -L "$t/$old" ]; then stash "$t" "$old" "$old"; echo "移した（置き場の外へ）: $t/$old → $backup_root/$(label_of "$t")/$old"; fi
  done
  rm -rf "$dest.new"
  cp -R "$src" "$dest.new"
  if [ -e "$dest" ] || [ -L "$dest" ]; then stash "$t" ai-digest-post ai-digest-post; fi
  mv "$dest.new" "$dest"
  echo "入れた: $dest（前の版は $backup_root/$(label_of "$t")/ai-digest-post）"
done

# 3. 連携するスキル（取ってきた物は一時フォルダに置き、終わる時に消す）
extras_failed=0
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
installed_everywhere() { local t; for t in "${targets[@]}"; do [ -f "$t/$1/SKILL.md" ] || return 1; done; return 0; }
can_ask() { [ -n "$assume_tty" ] || [ -t 0 ]; }
fetch_extra() { # $1 名前 $2 リポジトリ $3 版 → 取ったスキルのフォルダを標準出力に（失敗は 1）
  local name="$1" repo="$2" ref="$3" tmp
  if [ -n "$extras_source" ]; then
    [ -f "$extras_source/$name/SKILL.md" ] || return 1
    echo "$extras_source/$name"
    return 0
  fi
  command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 || { echo "  curl と tar が要る" >&2; return 1; }
  tmp="$work/$name"
  mkdir -p "$tmp"
  curl -fsSL "https://codeload.github.com/$repo/tar.gz/$ref" | tar -xz -C "$tmp" 2>/dev/null || return 1
  [ -f "$tmp/${repo#*/}-$ref/skills/$name/SKILL.md" ] || return 1
  echo "$tmp/${repo#*/}-$ref/skills/$name"
}
extra() { # $1 名前 $2 リポジトリ $3 版 $4 入れるか（y・n・空＝聞く）$5 説明
  local name="$1" repo="$2" ref="$3" want="$4" what="$5" ans dir t
  if installed_everywhere "$name"; then
    echo "$name: すでに入っている。記事を書く時に使われる"
    return 0
  fi
  if [ -z "$want" ]; then
    if can_ask; then
      printf '%s（%s・https://github.com/%s・MIT）も入れますか？ 無くても記事は書けます [y/N] ' "$name" "$what" "$repo"
      read -r ans || ans=""
      case "$ans" in y|Y|yes|YES|Yes|はい) want=y ;; *) want=n ;; esac
    else
      echo "$name: 聞けないので入れない（端末でない）。入れる時は --with-$name を付けて実行し直す。無くても記事は書ける"
      return 0
    fi
  fi
  if [ "$want" != y ]; then
    echo "$name: 入れない。無くても記事は書ける。後から入れれば、記事を書くたびにスキルが見つけて使う"
    return 0
  fi
  if ! dir="$(fetch_extra "$name" "$repo" "$ref")"; then
    echo "$name: 取れなかった（https://github.com/$repo ・版 ${ref:0:7}）。ネットにつながるかを見て、もう一度実行する" >&2
    extras_failed=1
    return 0
  fi
  for t in "${targets[@]}"; do
    if [ -f "$t/$name/SKILL.md" ]; then
      echo "$name: すでに入っている（そのまま使う）: $t/$name"
      continue
    fi
    if [ -e "$t/$name" ] || [ -L "$t/$name" ]; then # 壊れた物（SKILL.md が無い）は置き場の外に残して入れ直す
      stash "$t" "$name" "$name"
    fi
    cp -R "$dir" "$t/$name"
    echo "入れた: $t/$name（$repo の版 ${ref:0:7}）"
  done
  if [ "$name" = imozuru ] && ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    echo "注意: imozuru の道具は Python 3.10 以上が要る。無いと出典を落とす道具だけ動かず、スキルは出典を自分で開いて確かめる"
  fi
}
extra imozuru "$IMOZURU_REPO" "$IMOZURU_REF" "$want_imozuru" "出典を落として読む道具を持つスキル"
extra yomiyasu "$YOMIYASU_REPO" "$YOMIYASU_REF" "$want_yomiyasu" "AI っぽい日本語を読みやすく整えるスキル"

# 4. 投稿者名（--author-name で決めた時は聞かない）
inst_post="${targets[0]}/ai-digest-post/scripts/post.mjs"
if [ "$author_given" != 1 ]; then
  cur="$(current_name)"
  if [ "$node_ok" != 1 ]; then
    if [ -n "$cur" ]; then echo "投稿者名: $cur（登録済み）"; else echo "投稿者名: Node.js を入れた後に node \"$inst_post\" --set-name \"<名前>\" で登録する。記事を書く時にスキルも聞く"; fi
  elif can_ask; then
    echo "投稿者名を決めます。記事の下に「投稿者：<名前>」と表示され、サイトを読む人に見えます。本名でなくてかまいません（30 字まで）"
    while :; do
      if [ -n "$cur" ]; then printf '投稿者名（今: %s。Enter でそのまま）: ' "$cur"; else printf '投稿者名（Enter で後にする）: '; fi
      read -r ans || ans=""
      if [ -z "$ans" ]; then
        if [ -n "$cur" ]; then echo "投稿者名: $cur のまま"; else echo "投稿者名: 後にした。記事を書く時にスキルが聞く（node \"$inst_post\" --set-name \"<名前>\" でも登録できる）"; fi
        break
      fi
      set_name "$ans" && break # だめな名前なら、理由（post.mjs が出す）を見せて聞き直す
    done
  elif [ -n "$cur" ]; then
    echo "投稿者名: $cur（登録済み。記事の下に「投稿者：$cur」と表示される）"
  else
    echo "投稿者名: 聞けないので決めなかった（端末でない）。--author-name \"<名前>\" を付けて実行し直すか、記事を書く時にスキルが聞く"
  fi
fi

echo "次は鍵とサイトの URL の登録: references/setup.md（入れた先のフォルダの中）"
echo "確かめ: node \"${targets[0]}/ai-digest-post/scripts/post.mjs\" --check"
[ "$node_ok" = 1 ] || exit 3
[ "$extras_failed" = 0 ] || exit 4
exit 0
