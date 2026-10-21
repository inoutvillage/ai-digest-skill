# 鍵とサイトの URL の登録（初めての時に 1 回）

投稿には 2 つ要る。サイトの URL と、投稿の鍵（`aid_` で始まる 52 文字）。どちらも運営から受け取る。

## 1. 運営に頼む

伝える物:

- 名前（英小文字と数字。例 `tanaka`）
- 役。writer は下書きまで送れる（公開は運営が確かめてから）。publisher は自分の記事を確かめなしで公開できる

受け取る物はサイトの URL と鍵。鍵は運営の側でも二度と表示されない。メールやチャットなど残る場所で受け取ったら、登録した後でそのメッセージを消す。

## 2. 端末に登録する

**AI（Claude Code・Codex）との会話に鍵を貼らない。** 会話は記録に残り、AI の提供元にも送られる。次の手順は、利用者が自分のターミナルで実行する。鍵は画面にも、シェルの履歴にも残らない。

### Mac・Linux・WSL（bash・zsh）

1 行ずつ実行する。

```bash
mkdir -p ~/.config/ai-digest && chmod 700 ~/.config/ai-digest
printf 'サイトの URL: '; read -r u; printf '%s' "$u" > ~/.config/ai-digest/url; unset u
printf '鍵（貼っても表示されない）: '; read -rs k; echo; (umask 077; printf '%s' "$k" > ~/.config/ai-digest/key); unset k
```

### Windows（PowerShell。WSL の bash ではない）

```powershell
New-Item -ItemType Directory -Force "$HOME\.config\ai-digest" | Out-Null
Read-Host "サイトの URL" | Set-Content -NoNewline "$HOME\.config\ai-digest\url"
$k = Read-Host "鍵（貼っても表示されない）" -AsSecureString
[Net.NetworkCredential]::new("", $k).Password | Set-Content -NoNewline "$HOME\.config\ai-digest\key"
Remove-Variable k
```

### 環境変数で渡したい時

`AI_DIGEST_API_URL` と `AI_DIGEST_API_KEY` があれば、そちらを先に使う。シェルの設定ファイルに鍵を直に書くと、設定ファイルを人に見せた時に漏れるので、上のファイルの方を勧める。

## 3. 確かめる

```bash
node <このスキルのフォルダ>/scripts/post.mjs --check
```

| 出た言葉 | すること |
|---|---|
| 鍵は有効です: 名前（役） | 登録は済んだ |
| サイトの URL と投稿の鍵が見つからない | 2 をやり直す |
| 鍵が違うか、失効している | 写し間違い（空白・改行）が無いかを見る。だめなら運営に連絡する |
| サイトにつながらない | URL を確かめる。Codex の中なら、サンドボックスがネットを止めていないかを見る（承認して外で実行する） |
| URL は https:// で始める | URL を登録し直す |

## 4. 鍵が漏れた・端末をなくした時

すぐ運営に連絡する。運営がその鍵を止めて、新しい鍵を作る。AI との会話に鍵を貼ってしまった時も同じ。

## 5. 鍵を消す・替える

- Mac・Linux・WSL: `rm ~/.config/ai-digest/key`（替える時は 2 の鍵の行をもう一度）
- Windows: `Remove-Item "$HOME\.config\ai-digest\key"`
