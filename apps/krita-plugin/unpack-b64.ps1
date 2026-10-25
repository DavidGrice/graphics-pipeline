# Decode committed graphics_fp_bridge.zip.b64 → graphics_fp_bridge.zip
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$B64 = Join-Path $Root "graphics_fp_bridge.zip.b64"
$Out = Join-Path $Root "graphics_fp_bridge.zip"
$raw = (Get-Content -LiteralPath $B64 -Raw).Trim()
[IO.File]::WriteAllBytes($Out, [Convert]::FromBase64String($raw))
Write-Host "Wrote $Out"
