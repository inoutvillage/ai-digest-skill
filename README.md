# ai-digest に記事を投稿する人へ

このサイトの記事は、API に送ると保存場所に入り、公開になるとサイトが自動で作り直されます。GitHub は要りません。
記事を書いて送る手順は、Claude Code と Codex の両方で使えるスキル（`skills/ai-digest-post/`）にまとめてあります。

このスキルは調べ直しをしません。すでに調べた内容（その会話で調べたことや、調べ物のメモ）から記事を書き、やり直すのは裏付けの確かめだけです。主張ごとに、使った出典を開き直して確かめます。

## 1. スキルを入れる

スキルは 1 つのフォルダで、Claude Code にも Codex にも同じ物を入れます。まず、このリポジトリを手元に取ります。運営から zip で受け取った人は、展開したフォルダで同じように進めます。

```bash
git clone https://github.com/inoutvillage/ai-digest-skill.git
cd ai-digest-skill
```

入れる道具を実行します。

- Mac・Linux・WSL: `bash install.sh`
- Windows（PowerShell）: `powershell -ExecutionPolicy Bypass -File .\install.ps1`

入れる道具がすること:

1. Node.js 22 以上があるかを見ます。無ければ入れ方を案内します。スキルは入れておくので、Node.js を入れた後はそのまま使えます
2. スキルを、Claude Code と Codex の入っている方（両方なら両方）に写します。前の版は `.bak` に残します。片方だけに入れる時は `--claude` か `--codex`（Windows は `-Claude` か `-Codex`）を付けます
3. 連携するスキル（imozuru と yomiyasu。下の「連携するスキル」）が入っていなければ、入れるかを 1 つずつ聞きます（y/N）。入れなくても記事は書けます。後から入れた時も、スキルが記事を書くたびに見つけて使います。すでに入っている物には手を付けません

### AI に頼んで入れる時

AI が入れる道具を動かすと、質問に答えられません。その時は連携するスキルを入れずに進みます。入れたい時は、先に AI に伝えて `--with-extras`（両方）・`--with-imozuru`・`--with-yomiyasu` を付けてもらいます（Windows は `-WithExtras`・`-WithImozuru`・`-WithYomiyasu`）。聞かずに入れない時は `--no-extras`（`-NoExtras`）です。

入れる道具の終わりの値: 0 は済んだ、3 はスキルを入れたが Node.js が要る、4 はスキルを入れたが連携するスキルを取れなかった。

入れたら Claude Code・Codex を開き直します。「ai-digest の記事を書いて」と頼むと使われます（Codex は `$ai-digest-post` と書いても呼べます）。

更新する時は、このフォルダで `git pull` してから、入れる道具をもう一度実行します（前の版は `.bak` に残して入れ替えます）。

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
| imozuru（原文を落として読む道具を持つスキル。https://github.com/MaryCache/imozuru ・MIT。道具は Python 3.10 以上） | 任意。入れる道具で入れられる | 裏付けの確かめで、出典を自分で開いて確かめる |
| yomiyasu（AI っぽい日本語を読みやすく整えるスキル。https://github.com/nanaism/yomiyasu ・MIT） | 任意。入れる道具で入れられる | スキルが「自分で整える時の決まり」で整える |
| 絵を作る道具 | 任意 | Codex なら内蔵の画像生成で作れる。Claude Code だけなら絵なしで送るか、権利のある写真を使う |

どれを使ったか、どれが無くて代わりの手順にしたかは、スキルが最後の報告に書きます。

## 連携するスキル

このスキルは、入っていれば次の 2 つのスキルを使います。どちらも作者の方々が公開している OSS（MIT）で、このリポジトリには含めていません。入れる道具で「入れる」を選ぶと、確かめた版をそれぞれの公開元から取ってきて入れます。

| スキル | 公開元 | このスキルでの使い方 | 入れる版 |
|---|---|---|---|
| imozuru | https://github.com/MaryCache/imozuru | 裏付けの確かめで、出典を落として読む（PDF や動画の字幕も） | ecb82c7 |
| yomiyasu | https://github.com/nanaism/yomiyasu | 書いた本文を、読みやすい日本語に整える | fbe02c9（v2.1.1） |

## 4. 記事の形と決まり

- 1 本 1,000 字以内の 4 段（何が起きた／あなたに関係あるか／やるなら何を／どのくらい確か）
- 見出しは「最大の要約」（読まなくても内容が分かる 1 文・50 字まで）
- 出典は要約とリンクだけ（転載しない）。載せるのは主張を支えた出典だけで、1 本でもよい
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

## このリポジトリを直す人へ

テストは `node --test`（Node.js 22 以上と bash があれば動きます）。直したら、テストを通してから送ってください。

## 鍵が漏れた・投稿をやめる時

運営に連絡してください。運営がその鍵を止め、必要なら新しい鍵を作ります。手元の鍵は `skills/ai-digest-post/references/setup.md` の「5. 鍵を消す・替える」の手順で消します。
