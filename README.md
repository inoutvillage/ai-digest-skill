# ai-digest に記事を投稿する人へ

このサイトの記事は、API に送ると保存場所に入り、公開になるとサイトが自動で作り直されます。GitHub は要りません。
記事を書いて送る手順は、Claude Code と Codex の両方で使えるスキル（`skills/ai-digest-post/`）にまとめてあります。

このスキルは調べ直しをしません。すでに調べた内容から記事を書き、やり直すのは裏付けの確かめだけです。主張ごとに、使った出典を開き直して確かめます。

元にするのは、その会話で調べたこと・渡された調べ物のメモと、この PC の Claude Code と Codex の会話の履歴です。履歴は、記事の話題の言葉でスキルが毎回自動で探し、関係する問いと答えだけを抜き出して使います。どの会話を使うかを利用者が選ぶ必要はありません（読む物と止め方は下の「会話の履歴を探すこと」）。

頼み方と、スキルが聞くこと:

- 「〇〇を記事にして」のように話題がはっきりしている時は、聞かずに記事を書きます
- 「今の会話を記事にして」のように曖昧な時は、「〇〇の記事化で間違いないですか？」と確かめてから書きます。違えば、正しい話題を伝えてください
- 書いた記事は、送る前に必ず全部を見せます。直したい所を伝えると、直してもう一度見せます。OK と伝えるまで送りません

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
2. スキルを、Claude Code と Codex の入っている方（両方なら両方）に写します。前の版は `~/.ai-digest-skill/backup/` に残します（スキルの置き場の外なので、古い版が読み込まれることはありません）。片方だけに入れる時は `--claude` か `--codex`（Windows は `-Claude` か `-Codex`）を付けます
3. 連携するスキル（imozuru と yomiyasu。下の「連携するスキル」）が入っていなければ、入れるかを 1 つずつ聞きます（y/N）。入れなくても記事は書けます。後から入れた時も、スキルが記事を書くたびに見つけて使います。すでに入っている物には手を付けません
4. 投稿者名を聞きます。**投稿者名は、記事の下に「投稿者：<名前>」と表示される名前で、サイトを読む人に見えます。** 本名でなくてかまいません。30 字までです。決めなかった時は、記事を書く時にスキルが聞きます。登録済みなら今の名前を見せ、Enter でそのまま使います
5. 投稿用の鍵を作るかを聞きます（Y/n）。作ると、運営に送る 1 行（鍵のハッシュ値）を表示します。鍵そのものは表示せず、この PC の外に出しません。もう鍵がある時は、作り直すかを聞きます（y/N）

### AI に頼んで入れる時

AI が入れる道具を動かすと、質問に答えられません。その時は連携するスキルを入れずに進みます。入れたい時は、先に AI に伝えて `--with-extras`（両方）・`--with-imozuru`・`--with-yomiyasu` を付けてもらいます（Windows は `-WithExtras`・`-WithImozuru`・`-WithYomiyasu`）。聞かずに入れない時は `--no-extras`（`-NoExtras`）です。投稿者名も聞けないので、記事の下に表示したい名前を AI に伝えて `--author-name "<名前>"`（Windows は `-AuthorName "<名前>"`）を付けてもらいます。鍵も作れないので、鍵の名前を AI に伝えて `--new-key <鍵の名前>`（Windows は `-NewKey <鍵の名前>`）を付けてもらいます。もう鍵があって作り直す時は `--replace-key`（`-ReplaceKey`）も付けます。

入れる道具の終わりの値: 0 は済んだ、3 はスキルを入れたが Node.js が要る、4 はスキルを入れたが連携するスキルを取れなかった。

入れたら Claude Code・Codex を開き直します。「ai-digest の記事を書いて」と頼むと使われます（Codex は `$ai-digest-post` と書いても呼べます）。

更新する時は、このフォルダで `git pull` してから、入れる道具をもう一度実行します（前の版は `~/.ai-digest-skill/backup/` に残して入れ替えます）。

## 2. 投稿の準備（鍵・サイトの URL・投稿者名）

投稿用の鍵は、運営から受け取らずに自分の PC で作ります。入れる道具が作るかを聞き、作ると次のように表示します。

```text
投稿用の鍵を作り、このPCに保存しました（~/.config/ai-digest/key。鍵の中身は表示しません）。
次の1行を運営に送ってください。中身は鍵のハッシュ値で、鍵には戻せません。人に見られてもかまいません。
{"name":"tanaka","sha256":"…"}
```

この 1 行を運営に送ります。ハッシュ値は鍵から計算した値で、鍵には戻せないので、メールやチャットで送ってかまいません。運営が登録すると投稿できます。鍵の名前は、運営が誰の鍵かを見分けるための名前で、記事には表示されません。

後から作る・作り直す・消す時は、AI に「投稿の鍵を作って」「ハッシュ値を出して」「鍵を消して」と頼むか、`key.mjs` を直接使います（下の「5. 道具を直接使う時」）。サイトの URL は運営から受け取り、`skills/ai-digest-post/references/setup.md` の「2. サイトの URL を登録する」で登録します。

**鍵を AI との会話に貼らないでください。** スキルの道具は鍵を表示しません。運営から鍵を受け取った人の登録の手順も、setup.md にあります。

投稿者名（記事の下に表示される名前）は、入れる道具が聞いて `~/.config/ai-digest/name` に置きます。鍵の名前とは別で、鍵の名前は記事に表示されません。後から変える時は `node skills/ai-digest-post/scripts/post.mjs --set-name "<名前>"` です。

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

## 会話の履歴を探すこと

スキルは記事を書くたびに、この PC の会話の記録から、話題の言葉が出る会話を探します。

| 項目 | 中身 |
|---|---|
| 読む物 | Claude Code の `~/.claude/projects/`（`CLAUDE_CONFIG_DIR` があればそこ）と、Codex の `~/.codex/sessions/`・`~/.codex/archived_sessions/`（`CODEX_HOME` があればそこ）の会話の記録。365 日以内の物 |
| 読まない物 | 道具の出力（開いたページの中身やコマンドの結果）、AI の考えの途中。いま話している会話（要約された会話なら、要約の前の部分だけ読み直す） |
| 書く物 | 会話ごとの抜き出しのメモを `~/.ai-digest-skill/history/<日時>/` に書きます（新しい 10 回分だけ残します）。ホームに書けない時（Codex のサンドボックスなど）は一時の置き場に書きます |
| 外に送る物 | 探す道具は何も送りません。ただし、メモは AI が読むので、メモの中身はいま使っている AI の提供元に届きます。**Codex で使うと Claude Code の会話の一部が OpenAI に、Claude Code で使うと Codex の会話の一部が Anthropic に届きます** |
| 伏せる物 | よくある形の鍵・合言葉（`sk-…`・`ghp_…`・`token=…` など）と、登録した投稿の鍵。全部の形を見分けられるわけではありません |

探してほしくない会話がある時は、`~/.config/ai-digest/history-ignore` に、その会話の作業の場所（フォルダの名前）か記録のファイルの名前の一部を 1 行に 1 つ書きます。`*` だけの行を書くと、履歴を探さなくなります（この会話と渡した記録だけで書きます）。このファイルがあるのに読めない時（権限が無いなど）は、決めた除外を無視して探すことはせず、履歴を探さずに止まります。

```text
# 探さない場所（# から後は注釈）
/home/me/private-project
client-a
```

## 4. 記事の形と決まり

- 1 本 1,000 字以内の 4 段（何が起きた／あなたに関係あるか／やるなら何を／どのくらい確か）
- 見出しは「最大の要約」（読まなくても内容が分かる 1 文・50 字まで）
- 出典は要約とリンクだけ（転載しない）。載せるのは主張を支えた出典だけで、1 本でもよい
- 送った物はサーバーの側でも必ず確かめられます（項目の型と、内部の情報の混入）。だめなら理由が返ります

詳しくは `skills/ai-digest-post/references/writing.md`。

## 5. 道具を直接使う時

```bash
node skills/ai-digest-post/scripts/post.mjs --check                          # 鍵と URL と投稿者名の確かめ
node skills/ai-digest-post/scripts/post.mjs --set-name "たなか"               # 投稿者名（記事の下に表示される名前）を登録・変更する
node skills/ai-digest-post/scripts/key.mjs new tanaka                        # 投稿用の鍵を作り、運営に送る 1 行（鍵のハッシュ値）を出す
node skills/ai-digest-post/scripts/key.mjs new tanaka --replace              # 鍵を作り直す（前の鍵の 1 行も出る）
node skills/ai-digest-post/scripts/key.mjs hash                              # 運営に送る 1 行をもう一度出す
node skills/ai-digest-post/scripts/key.mjs delete                            # この PC の鍵を消す（消してよいかを聞く）
node skills/ai-digest-post/scripts/find-history.mjs --query "EmbeddingGemma 文字起こし"   # 前に調べた会話を探す（メモの場所を出す）
node skills/ai-digest-post/scripts/check.mjs 2026-10-20_my-article.md        # 送る前の確かめ
node skills/ai-digest-post/scripts/post.mjs 2026-10-20_my-article.md --image 2026-10-20_my-article.jpg   # 下書きで送る
node skills/ai-digest-post/scripts/post.mjs 2026-10-20_my-article.md --publish                             # 送ってすぐ公開（publisher・admin）
node skills/ai-digest-post/scripts/post.mjs --publish-only my-article                                       # もう送ってある記事を、保存場所の版のまま公開する（送り直さない。運営が下書きを承認する時も）
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

運営に連絡してください。運営がその鍵の行を消して止めます。手元の鍵は `node skills/ai-digest-post/scripts/key.mjs delete` で消し、続ける時は作り直します（`skills/ai-digest-post/references/setup.md` の「5. 鍵を消す・作り直す」）。
