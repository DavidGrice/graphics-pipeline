# Build graphics_fp_bridge.zip for Windows pykrita install.
# Unzip into %APPDATA%\krita\pykrita\ → graphics_fp_bridge\ + graphics_fp_bridge.desktop
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Out = Join-Path $Root "graphics_fp_bridge.zip"
$Init = Join-Path $Root "graphics_fp_bridge\__init__.py"
$Desktop = Join-Path $Root "graphics_fp_bridge.desktop"
if (-not (Test-Path -LiteralPath $Init)) { throw "missing $Init — checkout enhancement/s2b-firstparty-bridge" }
if (-not (Test-Path -LiteralPath $Desktop)) { throw "missing $Desktop" }

$Stage = Join-Path $env:TEMP ("gfp-bridge-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Path (Join-Path $Stage "graphics_fp_bridge") | Out-Null
Copy-Item $Init (Join-Path $Stage "graphics_fp_bridge\__init__.py")
Copy-Item $Desktop (Join-Path $Stage "graphics_fp_bridge.desktop")
if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Force }
Compress-Archive -Path (Join-Path $Stage "graphics_fp_bridge"), (Join-Path $Stage "graphics_fp_bridge.desktop") -DestinationPath $Out -CompressionLevel Optimal
Remove-Item -Recurse -Force $Stage
Write-Host "Wrote $Out"
Write-Host "Next: In Krita use Tools → Scripts → Import Python Plugin from File… and select this zip; enable Graphics FP Bridge."
