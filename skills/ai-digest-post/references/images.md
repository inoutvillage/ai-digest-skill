# 絵の決まりと作り方

## 決まり

- アイキャッチは 1 枚（任意）。挿絵は「文だけでは伝わりにくい仕組み・比べ」がある時だけ、1 枚まで
- 横 3:2、jpg・png・webp、1 枚 3MB 以下、横幅は 1200px くらい
- 入れない物: 文字・数字・ロゴ・実在の製品の形・人の顔
- 名前: アイキャッチは `YYYY-MM-DD_<slug>.jpg`、挿絵は `YYYY-MM-DD_<slug>-1.jpg`
- 記事の側: `image: /images/YYYY-MM-DD_<slug>.jpg`、本文の挿絵は `![一言の説明](/images/YYYY-MM-DD_<slug>-1.jpg)`
- 送る時に `--image` で、記事が指す絵を全部一緒に送る（他人の絵は指せない）

## サイトの絵柄（頼む時に必ず添える）

```
Calm, flat-color, minimal editorial illustration for a short news article.
Palette: dusty blue (#6b8a96), sand (#e6ddcb), off-white (#f7f6f2), a little dark slate for outlines.
Landscape 3:2. Lots of empty space. Soft and friendly, not dramatic, not glossy, no 3D render look.
Absolutely no letters, no words, no numbers, no logos, no brand marks, no real product designs, no human faces.
```

これに場面を 1〜2 文足す。場面は「記事の中身を 1 場面の物の絵にしたもの」。例: 机の上のノート PC。画面の中の音の波が、文字の列になって右へ流れ出す。横に湯気の立つカップ。

## Codex で作る

1. 内蔵の画像生成（`$imagegen`）に、上の絵柄と場面を渡す。横長の 3:2 で
2. 出来た絵は `$CODEX_HOME/generated_images/`（既定は `~/.codex/generated_images/`）に入る。選んだ 1 枚を記事のファイルの横へ写し、決まりの名前にする
3. 3MB を超えたら縮める。使える物のどれかで:
   - Mac: `sips -Z 1200 -s format jpeg <元>.png --out <名前>.jpg`
   - Python と Pillow: `python3 -c "from PIL import Image; im = Image.open('<元>.png').convert('RGB'); im.thumbnail((1200, 1200)); im.save('<名前>.jpg', quality=85)"`
   - ImageMagick: `magick <元>.png -resize 1200x -quality 85 <名前>.jpg`
4. 絵を開いて見る。文字やロゴが紛れていたら作り直す。2 回だめなら絵なしで送る

## Claude Code で

絵を作る道具は無い。次のどれか。

- 絵なしで送る（サイトはジャンルの色の板を出す）
- 利用者が権利を持つ写真を使う（自分で撮った物など。人の顔や他社のロゴが写っていない物）
- Codex も入っているなら、Codex に頼んで作り、上の 2〜4 で仕上げる
