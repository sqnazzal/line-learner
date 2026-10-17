# Rebuilds library/ (the built-in play and monologue library) from the Gutenberg texts in tools/raw.
# Runs tools/build-library.html in headless Chrome and writes what it produces.
# Usage: powershell -ExecutionPolicy Bypass -File tools\build-library.ps1
param([int]$Port = 8798)

$root = Split-Path $PSScriptRoot -Parent
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$utf8 = New-Object System.Text.UTF8Encoding $false
$profileDir = Join-Path $env:TEMP "line-learner-build-$PID"

# Download any source texts not already in tools/raw (the play list lives in build-library.html).
$rawDir = Join-Path $PSScriptRoot 'raw'
New-Item -ItemType Directory -Force $rawDir | Out-Null
$ids = [regex]::Matches([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'build-library.html')), '\[(\d+), ''') | ForEach-Object { $_.Groups[1].Value }
foreach ($id in $ids) {
    $file = Join-Path $rawDir "pg$id.txt"
    if (-not (Test-Path $file)) {
        Write-Host "Downloading Gutenberg text $id"
        Invoke-WebRequest -UseBasicParsing "https://www.gutenberg.org/cache/epub/$id/pg$id.txt" -OutFile $file
    }
}

$server = Start-Job -ScriptBlock { param($p, $port) & powershell -NoProfile -ExecutionPolicy Bypass -File "$p\serve.ps1" -Port $port -NoBrowser } -ArgumentList $root, $Port
try {
    Start-Sleep -Seconds 3
    $dom = & $chrome --headless=new --disable-gpu --no-first-run "--user-data-dir=$profileDir" --virtual-time-budget=60000 --dump-dom "http://localhost:$Port/tools/build-library.html" 2>$null | Out-String
} finally {
    Stop-Job $server; Remove-Job $server -Force
    Remove-Item -Recurse -Force $profileDir -ErrorAction SilentlyContinue
}

$json = [System.Net.WebUtility]::HtmlDecode([regex]::Match($dom, '<pre id="out">([\s\S]*?)</pre>').Groups[1].Value)
if (-not $json.StartsWith('{')) { throw "Build page failed: $($json.Substring(0, [Math]::Min(500, $json.Length)))" }
$data = $json | ConvertFrom-Json

$playsDir = Join-Path $root 'library\plays'
New-Item -ItemType Directory -Force $playsDir | Out-Null
Remove-Item "$playsDir\*.txt" -ErrorAction SilentlyContinue
$index = foreach ($p in $data.plays) {
    $slug = ($p.title.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
    [IO.File]::WriteAllText("$playsDir\$slug.txt", $p.text, $utf8)
    Write-Host ('{0,-34} {1,5} speeches' -f $p.title, $p.speeches)
    [ordered]@{ slug = $slug; title = $p.title; author = $p.author; genre = $p.genre; speeches = $p.speeches; cast = @($p.cast | Select-Object -First 14 | ForEach-Object { $_[0] }) }
}
[IO.File]::WriteAllText((Join-Path $root 'library\plays.json'), (ConvertTo-Json @($index) -Depth 5 -Compress), $utf8)

$missing = @($data.monologues | Where-Object { $_.missing })
foreach ($m in $missing) { Write-Warning "Monologue not found: $($m.who) in $($m.title) ('$($m.phrase)')" }
$found = @($data.monologues | Where-Object { -not $_.missing })
[IO.File]::WriteAllText((Join-Path $root 'library\monologues.json'), (ConvertTo-Json $found -Depth 5 -Compress), $utf8)
Write-Host "$(@($index).Count) plays, $($found.Count) monologues written to library\"
