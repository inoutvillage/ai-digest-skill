# 投稿の準備（鍵・サイトの URL・投稿者名）

投稿には 3 つ要る。

- 投稿用の鍵: この PC で作る（1）。運営には、鍵のハッシュ値の 1 行だけを送る。鍵そのものは誰にも渡さない
- サイトの URL: 運営から受け取る（2）。秘密ではない
- 投稿者名: 記事の下に表示される名前（6）

入れる道具（`install.sh`・`install.ps1`）が、投稿者名と鍵を聞く。ここに書くのは、後から作る・変える時の手順と、運営から鍵を受け取った人の手順。

## 1. 投稿用の鍵を作る

```bash
node <このスキルのフォルダ>/scripts/key.mjs new <鍵の名前>
```

- 鍵の名前: 英小文字・数字・`_-` で 32 字まで（例 `tanaka`）。運営が誰の鍵かを見分けるのに使う。記事には出ない（記事に出るのは投稿者名）
- 鍵は `~/.config/ai-digest/key` に置かれる（本人だけが読める権限）。画面には出ない
- 画面に出た 1 行（`{"name":…,"sha256":…}`）を運営に送る。中身は鍵のハッシュ値で、鍵には戻せない。メールやチャットで送ってかまわない
- 役（writer か publisher）は運営が決める。希望があれば 1 行と一緒に伝える
- 運営が登録すると投稿できる。それまで `post.mjs --check` は「鍵が違うか、失効している」と出る
- 1 行をもう一度出す: `node <このスキルのフォルダ>/scripts/key.mjs hash`
- 運営から「ハッシュ値の先頭を教えて」と頼まれたら、1 行の `sha256` の先頭の数文字を、電話や対面で伝える（送った 1 行が途中ですり替えられていないかの確かめ）
- Codex の中で動かして「書けなかった」と出たら、サンドボックスがホームへの書き込みを止めている。承認して、サンドボックスの外で実行する

## 2. サイトの URL を登録する

運営から受け取った URL を、自分のターミナルで登録する。

Mac・Linux・WSL（bash・zsh）:

```bash
mkdir -p ~/.config/ai-digest && chmod 700 ~/.config/ai-digest
printf 'サイトの URL: '; read -r u; printf '%s' "$u" > ~/.config/ai-digest/url; unset u
```

Windows（PowerShell。WSL の bash ではない）:

```powershell
New-Item -ItemType Directory -Force "$HOME\.config\ai-digest" | Out-Null
Read-Host "サイトの URL" | Set-Content -NoNewline "$HOME\.config\ai-digest\url"
```

## 3. 確かめる

```bash
node <このスキルのフォルダ>/scripts/post.mjs --check
```

| 出た言葉 | すること |
|---|---|
| 鍵は有効です: 名前（役） | 登録は済んだ。ここの名前は鍵の名前で、記事には表示されない |
| 投稿者名: 未登録（終わりの番号 5） | 6 で投稿者名を登録する |
| サイトの URL と投稿の鍵が見つからない | 鍵は 1 で作る（運営から受け取った鍵は末尾の手順で登録する）。URL は 2 |
| 鍵が違うか、失効している | 作ったばかりの鍵なら、運営の登録を待つ（1 行が届いているかを確かめてもらう）。受け取った鍵なら写し間違い（空白・改行）を見る。だめなら運営に連絡する |
| サイトにつながらない | URL を確かめる。Codex の中なら、サンドボックスがネットを止めていないかを見る（承認して外で実行する） |
| URL は https:// で始める | URL を登録し直す |

## 4. 鍵が漏れた・端末をなくした時

すぐ運営に連絡する。運営がその鍵の行を消す。そのうえで、1 の手順で鍵を作り直す（`--replace` を付ける）。AI との会話に鍵を貼ってしまった時も同じ。

## 5. 鍵を消す・作り直す

- 消す: `node <このスキルのフォルダ>/scripts/key.mjs delete`。消してよいかを聞いてから消す（AI に頼む時は、AI が確かめてから `--yes` を付けて消す）。消すと、新しい鍵を作って運営に登録してもらうまで投稿できない
- 消した後も、運営が行を消すまで、サイトの側では有効なまま。消す時に出る 1 行を運営に送り、その行を消してもらう
- 作り直す: `node <このスキルのフォルダ>/scripts/key.mjs new <鍵の名前> --replace`。前の鍵の 1 行と新しい鍵の 1 行が出るので、運営に「前の行を消して、新しい行を足して」と頼む

## 6. 投稿者名（記事の下に表示される名前）

記事の下に「投稿者：<名前>」と表示される名前。サイトを読む人に見える。本名でなくてよい。鍵の名前（1 で運営に伝える英小文字の名前）とは別で、鍵の名前は記事に表示されない。

- 入れる道具（`install.sh`・`install.ps1`）が聞く。AI に入れてもらう時は、名前を AI に伝えて `--author-name "<名前>"`（Windows は `-AuthorName`）を付けてもらう
- 決めなかった時は、記事を書く時にスキルが聞く
- 変える時:

```bash
node <このスキルのフォルダ>/scripts/post.mjs --set-name "<名前>"
```

- 置き場は `~/.config/ai-digest/name`（鍵や URL と同じフォルダ）。環境変数 `AI_DIGEST_AUTHOR_NAME` があれば、そちらを先に使う
- 決まり: 30 字まで。`" \ < >` と改行は使えない。頭に「投稿者：」は付けなくてよい（付けても外して登録する）
- 前に送った記事の名前は変わらない。変えたい記事は、名前を直して同じ slug で送り直す

## 運営から鍵を受け取った時

前のやり方で、運営が鍵を作って渡した人の手順。**AI（Claude Code・Codex）との会話に鍵を貼らない。** 会話は記録に残り、AI の提供元にも送られる。次の手順は、利用者が自分のターミナルで実行する。鍵は画面にも、シェルの履歴にも残らない。メールやチャットなど残る場所で鍵を受け取ったら、登録した後でそのメッセージを消す。

Mac・Linux・WSL（bash・zsh）:

```bash
mkdir -p ~/.config/ai-digest && chmod 700 ~/.config/ai-digest
printf '鍵（貼っても表示されない）: '; read -rs k; echo; (umask 077; printf '%s' "$k" > ~/.config/ai-digest/key); unset k
```

Windows（PowerShell）:

```powershell
New-Item -ItemType Directory -Force "$HOME\.config\ai-digest" | Out-Null
$k = Read-Host "鍵（貼っても表示されない）" -AsSecureString
[Net.NetworkCredential]::new("", $k).Password | Set-Content -NoNewline "$HOME\.config\ai-digest\key"
Remove-Variable k
```

この鍵には鍵の名前のファイルが無いので、`key.mjs hash` の 1 行はハッシュ値だけになる（鍵の名前は運営が付けた名前）。

### 環境変数で渡したい時

`AI_DIGEST_API_URL` と `AI_DIGEST_API_KEY` があれば、そちらを先に使う。シェルの設定ファイルに鍵を直に書くと、設定ファイルを人に見せた時に漏れるので、上のファイルの方を勧める。環境変数の鍵は `key.mjs` では作り直せない・消せない。
