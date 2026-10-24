# S2-A Windows live smoke — real PNG→GLB; fail-closed Blender + Krita health.
# Usage (PowerShell):
#   $env:BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
#   .\apps\blender-pipeline\smoke_live.ps1 [slug]
#
# Do NOT use Microsoft Store blender-launcher.exe — it is not a reliable --background CLI.
# Prefer the official Blender installer binary (blender.exe under Program Files).
$ErrorActionPreference = "Stop"
$Repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Repo
$env:SMOKE_LIVE = "1"
Remove-Item Env:KRITA_HEALTH_MODE -ErrorAction SilentlyContinue
$Slug = if ($args.Count -ge 1) { $args[0] } else { "s2a-smoke" }

function Exit-Native {
  param([int]$Fallback = 1)
  # PowerShell often leaves $LASTEXITCODE $null after some native/UWP launches.
  if ($null -eq $LASTEXITCODE) { exit $Fallback }
  exit $LASTEXITCODE
}

function Resolve-BlenderBin {
  param([string]$Bin)
  if (-not $Bin) { return $null }
  if (Test-Path -LiteralPath $Bin) { return (Resolve-Path -LiteralPath $Bin).Path }
  $cmd = Get-Command $Bin -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  return $null
}

function Assert-RealBlenderExe {
  param([string]$Path)
  $leaf = [System.IO.Path]::GetFileName($Path)
  if ($leaf -ieq 'blender-launcher.exe') {
    Write-Error @"
BLENDER_BIN points at Microsoft Store blender-launcher.exe, which is not a reliable headless CLI for --background --python.
Install Blender 5.2.3 from https://www.blender.org/download/ and set:
  `$env:BLENDER_BIN = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
"@
    exit 127
  }
  if ($Path -match '(?i)\\WindowsApps\\') {
    Write-Warning "BLENDER_BIN is under WindowsApps (Store sandbox). Prefer the official installer blender.exe under Program Files."
  }
}

$resolved = Resolve-BlenderBin $env:BLENDER_BIN
if (-not $env:BLENDER_BIN) {
  Write-Error 'BLENDER_BIN is unset. Set it to the full path of blender.exe (fail-closed).'
  exit 127
}
if (-not $resolved) {
  Write-Error "BLENDER_BIN not found: $($env:BLENDER_BIN)"
  exit 127
}
Assert-RealBlenderExe $resolved
$env:BLENDER_BIN = $resolved
Write-Host "[smoke_live] BLENDER_BIN=$($env:BLENDER_BIN)"

Write-Host '[smoke_live] probing Krita bridge health…'
npm run build -w @graphics-pipeline/mcp-krita | Out-Null
node --input-type=module -e @"
  import { createKritaMcpAdapter } from './apps/mcp-krita/dist/index.js';
  const h = await createKritaMcpAdapter({ repoRoot: process.cwd() }).health();
  console.log(JSON.stringify(h, null, 2));
  if (!h.ok) process.exit(1);
"@
if ($null -eq $LASTEXITCODE -or $LASTEXITCODE -ne 0) {
  Write-Error 'health red — Krita MCP bridge down. Start Krita + MCP Bridge.'
  Exit-Native 1
}

# Any *.png works — YYYYMMDD-HHMMSS is the export_png naming convention, not a smoke requirement.
$Inbox = Join-Path $Repo "data\inbox\$Slug"
if (-not (Test-Path $Inbox)) { New-Item -ItemType Directory -Path $Inbox | Out-Null }
$Png = Get-ChildItem -Path $Inbox -Filter *.png -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Png) {
  Write-Error "SMOKE_LIVE=1 requires a real inbox PNG under $Inbox. Use export_png first. Do not use --demo-png."
  exit 1
}
Write-Host "[smoke_live] inbox PNG=$($Png.FullName)"

$id = [guid]::NewGuid().ToString()
$OutDir = Join-Path $Repo "data\assets\$id"
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$OutGlb = Join-Path $OutDir "model.glb"
Copy-Item $Png.FullName (Join-Path $OutDir "preview.png")

Write-Host '[smoke_live] running Blender png_to_glb (headless)…'
& $env:BLENDER_BIN --background --python "$PSScriptRoot\png_to_glb.py" -- $Png.FullName $OutGlb
if ($null -eq $LASTEXITCODE -or $LASTEXITCODE -ne 0) {
  Write-Error "Blender png_to_glb failed (exit=$LASTEXITCODE). Confirm BLENDER_BIN is real blender.exe, not blender-launcher."
  Exit-Native 1
}
if (-not (Test-Path -LiteralPath $OutGlb)) {
  Write-Error "Blender exited 0 but model.glb missing: $OutGlb"
  exit 1
}
Write-Host "[smoke_live] wrote $OutGlb"

$Api = if ($env:API) { $env:API } else { "http://127.0.0.1:8787" }
$Preview = Join-Path $OutDir 'preview.png'
Write-Host "[smoke_live] registering asset via $Api …"
node "$PSScriptRoot\register_asset.mjs" --id=$id --slug=$Slug --glb=$OutGlb --preview=$Preview --source=$($Png.FullName) --api=$Api --armature --weights
if ($null -eq $LASTEXITCODE -or $LASTEXITCODE -ne 0) {
  Write-Error "register_asset failed (exit=$LASTEXITCODE). Is world-builder on :8787?"
  Exit-Native 1
}
Write-Host "MVP asset id=$id slug=$Slug"
