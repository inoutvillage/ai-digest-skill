# ai-digest の投稿スキル（ai-digest-post）を入れる。Windows の PowerShell 用（Mac・Linux・WSL は install.sh）。
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 [-Claude] [-Codex] [-WithImozuru] [-WithYomiyasu] [-WithExtras] [-NoExtras] [-AuthorName <投稿者名>]
#                                                [-NewKey <鍵の名前>] [-ReplaceKey]
# 流れと終わりの値は install.sh と同じ:
#   Node.js 22 以上を見る（無ければ入れ方を案内）→ スキルを写す（前の版は ~/.ai-digest-skill/backup/ に。スキルの置き場の外）→ imozuru と yomiyasu が無ければ入れるかを聞く（y/N）
#   → 投稿者名（記事の下に「投稿者：<名前>」と表示される名前）を聞く（-AuthorName で聞かずに決める。だめな名前なら入れる前に 2 で止める）
#   → 投稿用の鍵を作るかを聞く（鍵はこのPCに置き、運営には鍵のハッシュ値の1行だけを送る。もう鍵があれば作り直すかを聞く。
#     -NewKey で聞かずに作る。もう鍵がある時は -ReplaceKey も要る。だめなら入れる前に 2 で止める）
#   0 済んだ／1 入れる先が無い／3 スキルは入れたが Node.js が要る／4 スキルは入れたが連携するスキルを入れられなかった
param(
  [switch]$Claude, [switch]$Codex,
  [switch]$WithImozuru, [switch]$WithYomiyasu, [switch]$WithExtras, [switch]$NoExtras,
  [string]$AuthorName,
  [string]$NewKey, [switch]$ReplaceKey,
  [string]$HomeDir = $HOME   # 試し用に差し替えられる
)
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'skills\ai-digest-post'
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HomeDir '.codex' }
$nodeBin = if ($env:AI_DIGEST_NODE_BIN) { $env:AI_DIGEST_NODE_BIN } else { 'node' }
$extrasSource = $env:AI_DIGEST_EXTRAS_SOURCE      # 試し用: <フォルダ>\<名前>\SKILL.md を GitHub の代わりに使う
$assumeTty = [bool]$env:AI_DIGEST_INSTALL_ASSUME_TTY
$backupRoot = Join-Path $HomeDir '.ai-digest-skill\backup'   # 前の版の置き場（スキルの置き場の外。中に残すと古い版も読み込まれる）
function Get-Label([string]$t) {
  if ($t -eq (Join-Path $HomeDir '.claude\skills')) { return 'claude' }
  if ($t -eq (Join-Path $codexHome 'skills')) { return 'codex' }
  return (Split-Path (Split-Path $t -Parent) -Leaf)
}
function Move-ToBackup([string]$t, [string]$name, [string]$keep) {
  $b = Join-Path $backupRoot (Get-Label $t)
  New-Item -ItemType Directory -Force $b | Out-Null
  $to = Join-Path $b $keep
  if (Test-Path $to) { Remove-Item -Recurse -Force $to }
  Move-Item (Join-Path $t $name) $to
}

# 連携するスキル（入れる版は、確かめた commit に固定する）
$extras = @(
  @{ Name = 'imozuru';  Repo = 'MaryCache/imozuru'; Ref = 'ecb82c71b611872a0f49e783eda3bec987c80d91'; What = '出典を落として読む道具を持つスキル' },
  @{ Name = 'yomiyasu'; Repo = 'nanaism/yomiyasu';  Ref = 'fbe02c93877d697cc53d9377b7a45dd8a1dd99b3'; What = 'AI っぽい日本語を読みやすく整えるスキル' }
)
$want = @{ imozuru = ''; yomiyasu = '' }
if ($WithExtras -or $WithImozuru) { $want.imozuru = 'y' }
if ($WithExtras -or $WithYomiyasu) { $want.yomiyasu = 'y' }
if ($NoExtras) { foreach ($k in @('imozuru', 'yomiyasu')) { if (-not $want[$k]) { $want[$k] = 'n' } } }

$targets = @()
if ($Claude) { $targets += (Join-Path $HomeDir '.claude\skills') }
if ($Codex) { $targets += (Join-Path $codexHome 'skills') }
if ($targets.Count -eq 0) {
  if (Test-Path (Join-Path $HomeDir '.claude')) { $targets += (Join-Path $HomeDir '.claude\skills') }
  if (Test-Path $codexHome) { $targets += (Join-Path $codexHome 'skills') }
}
if (-not (Test-Path (Join-Path $src 'SKILL.md'))) { Write-Error "スキルが見つからない: $src"; exit 1 }
if ($targets.Count -eq 0) { Write-Host "Claude Code（$HomeDir\.claude）も Codex（$codexHome）も見つからない。-Claude か -Codex を付けて実行する"; exit 1 }

# 1. Node.js
# 版は node -v の表示から読む（Windows PowerShell 5.1 は、外のコマンドに渡す引数の中の " を落とすので、式は渡さない）
$nodeOk = $false
$major = $null
$nodeVer = $null
try { $nodeVer = (& $nodeBin -v 2>$null) } catch { $nodeVer = $null }
if ("$nodeVer" -match '^v(\d+)\.') { $major = [int]$Matches[1] }
if ($major -ge 22) {
  $nodeOk = $true
  Write-Host "Node.js: $nodeVer（使える）"
} else {
  $now = if ($major) { "v$major 系" } else { '入っていない' }
  Write-Host "注意: Node.js 22 以上が見つからない（今: $now）。送る道具と送る前の確かめに要る"
  Write-Host '  入れ方（Windows）: https://nodejs.org/ja/download から入れるか、winget install OpenJS.NodeJS.LTS'
  Write-Host '  スキルは入れておく。Node.js を入れた後は、入れ直さずにそのまま使える'
}

# 投稿者名の確かめと書き込みは post.mjs に任せる（名前の決まりを 1 か所にする）
$nameFile = Join-Path $HomeDir '.config\ai-digest\name'
function Invoke-SkillScript([string]$script, [string[]]$scriptArgs) {
  # スキルの道具（post.mjs・key.mjs）を動かして、終わりの番号を返す。
  # Node の出力（UTF-8）を崩さずに受け、試し用の HomeDir も Node に渡す。Node が標準エラーに書いても止めない
  $prevEap = $ErrorActionPreference
  $prevHome = $env:HOME
  $prevProfile = $env:USERPROFILE
  $prevEnc = $null
  $ErrorActionPreference = 'Continue'
  try { $prevEnc = [Console]::OutputEncoding; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch { $prevEnc = $null }
  try {
    $env:HOME = $HomeDir
    $env:USERPROFILE = $HomeDir
    $msg = & $nodeBin (Join-Path $src "scripts\$script") @scriptArgs 2>&1
    $code = $LASTEXITCODE
  } finally {
    $env:HOME = $prevHome
    $env:USERPROFILE = $prevProfile
    if ($prevEnc) { try { [Console]::OutputEncoding = $prevEnc } catch {} }
    $ErrorActionPreference = $prevEap
  }
  foreach ($l in @($msg)) { Write-Host "$l" }
  return $code
}
function Invoke-SetName([string]$n) { return ((Invoke-SkillScript 'post.mjs' @('--set-name', $n)) -eq 0) }
function Get-CurrentName {
  if (-not (Test-Path -LiteralPath $nameFile)) { return '' }
  try { return ('' + (Get-Content -LiteralPath $nameFile -Encoding UTF8 -TotalCount 1)).Trim() } catch { return '' }
}
$authorGiven = $PSBoundParameters.ContainsKey('AuthorName')
if ($authorGiven) {
  if ($nodeOk) {
    if (-not (Invoke-SetName $AuthorName)) { Write-Host '-AuthorName の名前を直して、もう一度実行する（スキルはまだ入れていない）'; exit 2 }
  } else {
    Write-Host '投稿者名: Node.js が無いので登録できない。Node.js を入れた後に -AuthorName を付けて実行し直すか、記事を書く時にスキルが聞く'
  }
}

# 投稿用の鍵を作るのは key.mjs（鍵は表示せず、運営に送る1行＝鍵のハッシュ値を出す）
$keyFile = Join-Path $HomeDir '.config\ai-digest\key'
$keyNameFile = Join-Path $HomeDir '.config\ai-digest\key-name'
$keyMade = $false
$newKeyGiven = $PSBoundParameters.ContainsKey('NewKey')
if ($newKeyGiven) {
  if ($nodeOk) {
    $keyArgs = @('new', $NewKey)
    if ($ReplaceKey) { $keyArgs += '--replace' }
    if ((Invoke-SkillScript 'key.mjs' $keyArgs) -eq 0) { $keyMade = $true }
    else { Write-Host '-NewKey を直して、もう一度実行する（スキルはまだ入れていない。もう鍵があって作り直す時は -ReplaceKey も付ける）'; exit 2 }
  } else {
    Write-Host '投稿用の鍵: Node.js が無いので作れない。Node.js を入れた後に -NewKey を付けて実行し直すか、記事を書く時にスキルが作る'
  }
}

# 2. スキル（入れる先の skills フォルダを先に作る。無いと Copy-Item が違う場所へ写すため）
foreach ($t in $targets) {
  New-Item -ItemType Directory -Force $t | Out-Null
  $dest = Join-Path $t 'ai-digest-post'
  # 前のインストーラーが置き場の中に残した控え（*.bak）は、読み込まれないよう外へ移す
  foreach ($old in @('ai-digest-post.bak', 'imozuru.bak', 'yomiyasu.bak')) {
    if (Test-Path (Join-Path $t $old)) { Move-ToBackup $t $old $old; Write-Host ("移した（置き場の外へ）: {0} → {1}" -f (Join-Path $t $old), (Join-Path (Join-Path $backupRoot (Get-Label $t)) $old)) }
  }
  if (Test-Path $dest) { Move-ToBackup $t 'ai-digest-post' 'ai-digest-post' }
  Copy-Item -Recurse $src $dest
  Write-Host ("入れた: {0}（前の版は {1}）" -f $dest, (Join-Path (Join-Path $backupRoot (Get-Label $t)) 'ai-digest-post'))
}

# 3. 連携するスキル（取ってきた物は一時フォルダに置き、終わる時に消す）
$extrasFailed = $false
$work = Join-Path ([IO.Path]::GetTempPath()) ('ai-digest-install-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $work | Out-Null
try {
  foreach ($x in $extras) {
    $name = $x.Name
    $missing = @($targets | Where-Object { -not (Test-Path (Join-Path (Join-Path $_ $name) 'SKILL.md')) })
    if ($missing.Count -eq 0) { Write-Host "${name}: すでに入っている。記事を書く時に使われる"; continue }
    $w = $want[$name]
    if (-not $w) {
      if ($assumeTty -or ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected)) {
        $ans = Read-Host ("{0}（{1}・https://github.com/{2}・MIT）も入れますか？ 無くても記事は書けます [y/N]" -f $name, $x.What, $x.Repo)
        $w = if ($ans -match '^(y|yes|はい)$') { 'y' } else { 'n' }
      } else {
        Write-Host "${name}: 聞けないので入れない（端末でない）。入れる時は -With$((Get-Culture).TextInfo.ToTitleCase($name)) を付けて実行し直す。無くても記事は書ける"
        continue
      }
    }
    if ($w -ne 'y') { Write-Host "${name}: 入れない。無くても記事は書ける。後から入れれば、記事を書くたびにスキルが見つけて使う"; continue }
    $dir = $null
    try {
      if ($extrasSource) {
        $dir = Join-Path $extrasSource $name
      } else {
        $zip = Join-Path $work "$name.zip"
        Invoke-WebRequest -UseBasicParsing -Uri ("https://codeload.github.com/{0}/zip/{1}" -f $x.Repo, $x.Ref) -OutFile $zip
        Expand-Archive -Path $zip -DestinationPath (Join-Path $work $name) -Force
        $dir = Join-Path (Join-Path $work $name) (("{0}-{1}\skills\{2}" -f ($x.Repo -split '/')[1], $x.Ref, $name))
      }
      if (-not (Test-Path (Join-Path $dir 'SKILL.md'))) { throw 'SKILL.md が無い' }
    } catch {
      Write-Host ("${name}: 取れなかった（https://github.com/{0} ・版 {1}）。ネットにつながるかを見て、もう一度実行する" -f $x.Repo, $x.Ref.Substring(0, 7))
      $extrasFailed = $true
      continue
    }
    foreach ($t in $targets) {
      $d = Join-Path $t $name
      if (Test-Path (Join-Path $d 'SKILL.md')) { Write-Host "${name}: すでに入っている（そのまま使う）: $d"; continue }
      if (Test-Path $d) { Move-ToBackup $t $name $name }   # 壊れた物（SKILL.md が無い）は置き場の外に残して入れ直す
      Copy-Item -Recurse $dir $d
      Write-Host ("入れた: {0}（{1} の版 {2}）" -f $d, $x.Repo, $x.Ref.Substring(0, 7))
    }
  }
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

# 4. 投稿者名（-AuthorName で決めた時は聞かない）
$instPost = Join-Path $targets[0] 'ai-digest-post\scripts\post.mjs'
if (-not $authorGiven) {
  $cur = Get-CurrentName
  if (-not $nodeOk) {
    if ($cur) { Write-Host "投稿者名: $cur（登録済み）" } else { Write-Host ('投稿者名: Node.js を入れた後に node "{0}" --set-name "<名前>" で登録する。記事を書く時にスキルも聞く' -f $instPost) }
  } elseif ($assumeTty -or ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected)) {
    Write-Host '投稿者名を決めます。記事の下に「投稿者：<名前>」と表示され、サイトを読む人に見えます。本名でなくてかまいません（30 字まで）'
    while ($true) {
      $prompt = if ($cur) { "投稿者名（今: $cur。Enter でそのまま）" } else { '投稿者名（Enter で後にする）' }
      $ans = Read-Host $prompt
      if (-not $ans) {
        if ($cur) { Write-Host "投稿者名: $cur のまま" } else { Write-Host ('投稿者名: 後にした。記事を書く時にスキルが聞く（node "{0}" --set-name "<名前>" でも登録できる）' -f $instPost) }
        break
      }
      if (Invoke-SetName $ans) { break }   # だめな名前なら、理由（post.mjs が出す）を見せて聞き直す
    }
  } elseif ($cur) {
    Write-Host "投稿者名: $cur（登録済み。記事の下に「投稿者：$cur」と表示される）"
  } else {
    Write-Host '投稿者名: 聞けないので決めなかった（端末でない）。-AuthorName "<名前>" を付けて実行し直すか、記事を書く時にスキルが聞く'
  }
}

# 5. 投稿用の鍵（-NewKey で作った時は聞かない）
$instKey = Join-Path $targets[0] 'ai-digest-post\scripts\key.mjs'
function Read-KeyName([bool]$replace) {
  $cur = ''
  if (Test-Path -LiteralPath $keyNameFile) { try { $cur = ('' + (Get-Content -LiteralPath $keyNameFile -Encoding UTF8 -TotalCount 1)).Trim() } catch { $cur = '' } }
  Write-Host '鍵の名前は、運営が誰の鍵かを見分けるための名前です。英小文字・数字・_- で32字まで。記事には出ません（記事に出るのは投稿者名）'
  while ($true) {
    $prompt = if ($cur) { "鍵の名前（今: $cur。Enter でそのまま）" } else { '鍵の名前（例 tanaka。Enter で後にする）' }
    $ans = Read-Host $prompt
    if (-not $ans) { $ans = $cur }
    if (-not $ans) { Write-Host ('投稿用の鍵: 後にした。記事を書く時にスキルが作る（node "{0}" new <鍵の名前> でも作れる）' -f $instKey); return $false }
    $a = @('new', $ans)
    if ($replace) { $a += '--replace' }
    if ((Invoke-SkillScript 'key.mjs' $a) -eq 0) { return $true }
    $cur = ''   # だめな名前なら、理由（key.mjs が出す）を見せて聞き直す
  }
}
if (-not $newKeyGiven) {
  $canAsk = $assumeTty -or ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected)
  if (-not $nodeOk) {
    Write-Host ('投稿用の鍵: Node.js を入れた後に node "{0}" new <鍵の名前> で作る。記事を書く時にスキルも作る' -f $instKey)
  } elseif ($env:AI_DIGEST_API_KEY) {
    Write-Host '投稿用の鍵: 環境変数 AI_DIGEST_API_KEY の鍵を使う（ここでは作らない）'
  } elseif (Test-Path -LiteralPath $keyFile) {
    if ($canAsk) {
      $ans = Read-Host '投稿用の鍵はもう登録されています。作り直しますか？ 作り直すと、運営が新しいハッシュ値を登録するまで投稿できません [y/N]'
      if ($ans -match '^(y|yes|はい)$') { if (Read-KeyName $true) { $keyMade = $true } }
      else { Write-Host ('投稿用の鍵: そのまま使う（運営に送る1行をもう一度出す: node "{0}" hash）' -f $instKey) }
    } else {
      Write-Host '投稿用の鍵: 登録済み（作り直す時は -NewKey <鍵の名前> -ReplaceKey）'
    }
  } elseif ($canAsk) {
    Write-Host '投稿用の鍵を作ります。鍵はこのPCに置き、運営には鍵のハッシュ値だけを送ります。運営から鍵を受け取っている人は n を押し、references\setup.md の「運営から鍵を受け取った時」の手順で登録してください'
    $ans = Read-Host '投稿用の鍵を作りますか？ [Y/n]'
    if ($ans -match '^(n|no|いいえ)$') { Write-Host '投稿用の鍵: 作らなかった' }
    elseif (Read-KeyName $false) { $keyMade = $true }
  } else {
    Write-Host '投稿用の鍵: 聞けないので作らなかった（端末でない）。-NewKey <鍵の名前> を付けて実行し直すか、記事を書く時にスキルが作る'
  }
}

# 次にすること（登録済みの物は出さない）
$urlFile = Join-Path $HomeDir '.config\ai-digest\url'
$needKey = -not ($env:AI_DIGEST_API_KEY -or ((Test-Path -LiteralPath $keyFile) -and (Get-Item -LiteralPath $keyFile).Length -gt 0))
$needUrl = -not ($env:AI_DIGEST_API_URL -or ((Test-Path -LiteralPath $urlFile) -and (Get-Item -LiteralPath $urlFile).Length -gt 0))
Write-Host '次にすること:'
if ($keyMade) { Write-Host '  - 上に出した1行（鍵のハッシュ値）を運営に送る。運営が登録すると投稿できる' }
if ($needKey) { Write-Host ('  - 投稿用の鍵を作る（node "{0}" new <鍵の名前>）か、運営から受け取った鍵を references\setup.md の手順で登録する' -f $instKey) }
if ($needUrl) { Write-Host '  - 運営から受け取ったサイトの URL を登録する: references\setup.md の「2. サイトの URL を登録する」（入れた先のフォルダの中）' }
if (-not $keyMade -and -not $needKey -and -not $needUrl) { Write-Host '  - なし（投稿用の鍵とサイトの URL は登録済み）' }
Write-Host ('確かめ: node "{0}\ai-digest-post\scripts\post.mjs" --check' -f $targets[0])
if (-not $nodeOk) { exit 3 }
if ($extrasFailed) { exit 4 }
exit 0
