# ai-digest の投稿スキル（ai-digest-post）を入れる。Windows の PowerShell 用（Mac・Linux・WSL は install.sh）。
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 [-Claude] [-Codex] [-WithImozuru] [-WithYomiyasu] [-WithExtras] [-NoExtras]
# 流れと終わりの値は install.sh と同じ:
#   Node.js 22 以上を見る（無ければ入れ方を案内）→ スキルを写す（前の版は .bak）→ imozuru と yomiyasu が無ければ入れるかを聞く（y/N）
#   0 済んだ／1 入れる先が無い／3 スキルは入れたが Node.js が要る／4 スキルは入れたが連携するスキルを入れられなかった
param(
  [switch]$Claude, [switch]$Codex,
  [switch]$WithImozuru, [switch]$WithYomiyasu, [switch]$WithExtras, [switch]$NoExtras,
  [string]$HomeDir = $HOME   # 試し用に差し替えられる
)
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'skills\ai-digest-post'
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HomeDir '.codex' }
$nodeBin = if ($env:AI_DIGEST_NODE_BIN) { $env:AI_DIGEST_NODE_BIN } else { 'node' }
$extrasSource = $env:AI_DIGEST_EXTRAS_SOURCE      # 試し用: <フォルダ>\<名前>\SKILL.md を GitHub の代わりに使う
$assumeTty = [bool]$env:AI_DIGEST_INSTALL_ASSUME_TTY

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

# 2. スキル（入れる先の skills フォルダを先に作る。無いと Copy-Item が違う場所へ写すため）
foreach ($t in $targets) {
  New-Item -ItemType Directory -Force $t | Out-Null
  $dest = Join-Path $t 'ai-digest-post'
  if (Test-Path $dest) {
    if (Test-Path "$dest.bak") { Remove-Item -Recurse -Force "$dest.bak" }
    Move-Item $dest "$dest.bak"
  }
  Copy-Item -Recurse $src $dest
  Write-Host "入れた: $dest"
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
      if (Test-Path $d) { if (Test-Path "$d.bak") { Remove-Item -Recurse -Force "$d.bak" }; Move-Item $d "$d.bak" }
      Copy-Item -Recurse $dir $d
      Write-Host ("入れた: {0}（{1} の版 {2}）" -f $d, $x.Repo, $x.Ref.Substring(0, 7))
    }
  }
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

Write-Host '次は鍵とサイトの URL の登録: references\setup.md（入れた先のフォルダの中）'
Write-Host ('確かめ: node "{0}\ai-digest-post\scripts\post.mjs" --check' -f $targets[0])
if (-not $nodeOk) { exit 3 }
if ($extrasFailed) { exit 4 }
exit 0
