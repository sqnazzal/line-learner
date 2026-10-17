# Serves Line Learner at http://localhost:8765 and opens it in Chrome.
# A local address (rather than opening index.html directly) lets the browser remember
# microphone permission and keeps your scripts and recordings in one place.
param([int]$Port = 8765, [switch]$NoBrowser)

$root = (Resolve-Path $PSScriptRoot).Path.TrimEnd('\') + '\'
$prefix = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

# Prefer Chrome (best speech recognition support); fall back to the default browser.
function Open-App {
    if ($NoBrowser) { return }
    $chrome = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if ($chrome) { Start-Process -FilePath $chrome -ArgumentList $prefix } else { Start-Process $prefix }
}

try {
    $listener.Start()
} catch {
    Write-Host "Port $Port is busy, so Line Learner is probably already running. Opening it now."
    Open-App
    exit 0
}

Write-Host "Line Learner is running at $prefix"
Write-Host 'Keep this window open while you practice. Close it to stop.'
Open-App

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.json' = 'application/json'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.ico'  = 'image/x-icon'
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $res = $ctx.Response
        try {
            $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
            if ([string]::IsNullOrEmpty($path)) { $path = 'index.html' }
            $file = [IO.Path]::GetFullPath((Join-Path $root $path))
            if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
                $bytes = [IO.File]::ReadAllBytes($file)
                $ext = [IO.Path]::GetExtension($file).ToLower()
                $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
                $res.Headers.Add('Cache-Control', 'no-cache')
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $res.StatusCode = 404
            }
        } catch {
            $res.StatusCode = 500
        } finally {
            $res.Close()
        }
    }
} finally {
    $listener.Stop()
}
