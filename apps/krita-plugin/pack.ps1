# Build graphics_fp_bridge.zip for Krita Import Python Plugin (Windows).
# Zip must use forward-slash entries + an explicit graphics_fp_bridge/ dir
# entry -- Krita's importer rejects Compress-Archive (backslash) zips.
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Out = Join-Path $Root "graphics_fp_bridge.zip"
$Init = Join-Path $Root "graphics_fp_bridge\__init__.py"
$Desktop = Join-Path $Root "graphics_fp_bridge.desktop"
if (-not (Test-Path -LiteralPath $Init)) { throw "missing $Init --- checkout enhancement/s2b-firstparty-bridge" }
if (-not (Test-Path -LiteralPath $Desktop)) { throw "missing $Desktop" }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Force }

$fs = [System.IO.File]::Open($Out, [System.IO.FileMode]::CreateNew)
try {
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    [void]$zip.CreateEntry("graphics_fp_bridge/")

    $entryInit = $zip.CreateEntry("graphics_fp_bridge/__init__.py", [System.IO.Compression.CompressionLevel]::Optimal)
    $src = [System.IO.File]::OpenRead($Init)
    try {
      $dest = $entryInit.Open()
      try { $src.CopyTo($dest) } finally { $dest.Dispose() }
    } finally { $src.Dispose() }

    $entryDesk = $zip.CreateEntry("graphics_fp_bridge.desktop", [System.IO.Compression.CompressionLevel]::Optimal)
    $src2 = [System.IO.File]::OpenRead($Desktop)
    try {
      $dest2 = $entryDesk.Open()
      try { $src2.CopyTo($dest2) } finally { $dest2.Dispose() }
    } finally { $src2.Dispose() }
  } finally { $zip.Dispose() }
} finally { $fs.Dispose() }

Write-Host "Wrote $Out"
Write-Host "Entries: graphics_fp_bridge/, graphics_fp_bridge/__init__.py, graphics_fp_bridge.desktop"
Write-Host "Next: In Krita use Tools -> Scripts -> Import Python Plugin from File... and select this zip; enable Graphics FP Bridge."
