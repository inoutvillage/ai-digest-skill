# ai-digest に記事を投稿する人へ

このサイトの記事は、API に送ると保存場所に入り、公開になるとサイトが自動で作り直されます。GitHub は要りません。
記事を書いて送る手順は、Claude Code と Codex の両方で使えるスキル（`skills/ai-digest-post/`）にまとめてあります。

## 1. スキルを入れる

スキルは 1 つのフォルダで、Claude Code にも Codex にも同じ物を入れます。まず、このリポジトリを手元に取ります。運営から zip で受け取った人は、展開したフォルダで同じように進めます。

```bash
git clone https://github.com/inoutvillage/ai-digest-skill.git
cd ai-digest-skill
```

- Mac・Linux・WSL: このフォルダで `bash install.sh` を実行する。Claude Code と Codex の入っている方（両方なら両方）に写します。片方だけなら `--claude` か `--codex` を付けます
- Windows（PowerShell）: このフォルダで、使う方の 2 行を実行します。1 行目で入れる先の `skills` フォルダを作り（無い時に `Copy-Item` が違う場所へ写すのを防ぐ）、2 行目で写します

  ```powershell
  # Claude Code
  New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
  Copy-Item -Recurse -Force .\skills\ai-digest-post "$HOME\.claude\skills\"
  # Codex
  New-Item -ItemType Directory -Force "$HOME\.codex\skills" | Out-Null
  Copy-Item -Recurse -Force .\skills\ai-digest-post "$HOME\.codex\skills\"
  ```

  入れ直す時は、先に前の版を消してから同じ 2 行を実行します（消さずに写すと、新しい版で無くなったファイルが残ります）: `Remove-Item -Recurse -Force "$HOME\.claude\skills\ai-digest-post"`（Codex は `.codex`）

入れたら Claude Code・Codex を開き直します。「ai-digest の記事を書いて」と頼むと使われます（Codex は `$ai-digest-post` と書いても呼べます）。

更新する時は、このフォルダで `git pull` してから、入れた時と同じ手順をもう一度実行します（`install.sh` は前の版を `.bak` に残して入れ替えます）。

## 2. 鍵とサイトの URL を登録する（初めての時に 1 回）

運営から受け取った鍵とサイトの URL を、自分の端末に登録します。手順は `skills/ai-digest-post/references/setup.md` にあります。スキルも、鍵が無いと気づいた時にこの手順を案内します。

**鍵を AI との会話に貼らないでください。** 登録は自分のターミナルで行います。

| 役 | できること |
|---|---|
| writer | 下書きまで送れる。公開は運営が確かめてから |
| publisher | 自分の記事を確かめなしで公開できる |
| admin | 誰の記事でも公開・書き換えできる。鍵の管理 |

## 3. 要る物と、あれば使う物

| 物 | 要るか | 無い時 |
|---|---|---|
| Node.js 22 以上 | 要る（送る道具と確かめに使う） | 入れる |
| imozuru（原文を芋づる式に集めるスキル。https://github.com/MaryCache/imozuru ・MIT） | 任意 | スキルが原文を手で確かめる手順に切り替える |
| yomiyasu（AI っぽい日本語を読みやすく整えるスキル） | 任意 | スキルが「自分で整える時の決まり」で整える |
| 絵を作る道具 | 任意 | Codex なら内蔵の画像生成で作れる。Claude Code だけなら絵なしで送るか、権利のある写真を使う |

どれを使ったか、どれが無くて代わりの手順にしたかは、スキルが最後の報告に書きます。

## 4. 記事の形と決まり

- 1 本 1,000 字以内の 4 段（何が起きた／あなたに関係あるか／やるなら何を／どのくらい確か）
- 見出しは「最大の要約」（読まなくても内容が分かる 1 文・50 字まで）
- 出典は要約とリンクだけ（転載しない）
- 送った物はサーバーの側でも必ず確かめられます（項目の型と、内部の情報の混入）。だめなら理由が返ります

詳しくは `skills/ai-digest-post/references/writing.md`。

## 5. 道具を直接使う時

```bash
node skills/ai-digest-post/scripts/post.mjs --check                          # 鍵と URL の確かめ
node skills/ai-digest-post/scripts/check.mjs 2026-10-20_my-article.md        # 送る前の確かめ
node skills/ai-digest-post/scripts/post.mjs 2026-10-20_my-article.md --image 2026-10-20_my-article.jpg   # 下書きで送る
node skills/ai-digest-post/scripts/post.mjs 2026-10-20_my-article.md --publish                             # 送ってすぐ公開（publisher・admin）
```

- 同じ `slug` で送り直すと書き換えになります（前の版は控えが残ります）
- 他人の記事や絵は書き換えられません（admin を除く）

### API（直接呼ぶ場合）

- `GET /api/articles` … 自分の記事の一覧と、自分の名前と役（admin は全部）。`Authorization: Bearer <鍵>`
- `POST /api/articles` … `{ "markdown": "...", "images": [{ "name": "x.jpg", "base64": "..." }] }`（10 枚まで）。writer は `status: draft` だけ
- `POST /api/articles/publish` … `{ "slug": "..." }`。admin か、本人が publisher の時だけ
- `GET /api/health` … 生きているか

## 鍵が漏れた・投稿をやめる時

運営に連絡してください。運営がその鍵を止め、必要なら新しい鍵を作ります。手元の鍵は `skills/ai-digest-post/references/setup.md` の「5. 鍵を消す・替える」の手順で消します。
