# S2-A Windows live smoke — real PNG→GLB; fail-closed Blender + Krita health.
# Usage (PowerShell):
#   $env:BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
#   .\apps\blender-pipeline\smoke_live.ps1 [slug]
$ErrorActionPreference = "Stop"
$Repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Repo
$env:SMOKE_LIVE = "1"
Remove-Item Env:KRITA_HEALTH_MODE -ErrorAction SilentlyContinue
$Slug = if ($args.Count -ge 1) { $args[0] } else { "s2a-smoke" }

function Resolve-BlenderBin {
  param([string]$Bin)
  if (-not $Bin) { return $null }
  if (Test-Path -LiteralPath $Bin) { return (Resolve-Path -LiteralPath $Bin).Path }
  $cmd = Get-Command $Bin -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  return $null
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
$env:BLENDER_BIN = $resolved

Write-Host '[smoke_live] probing Krita bridge health…'
npm run build -w @graphics-pipeline/mcp-krita | Out-Null
node --input-type=module -e @"
  import { createKritaMcpAdapter } from './apps/mcp-krita/dist/index.js';
  const h = await createKritaMcpAdapter({ repoRoot: process.cwd() }).health();
  console.log(JSON.stringify(h, null, 2));
  if (!h.ok) process.exit(1);
"@
if ($LASTEXITCODE -ne 0) {
  Write-Error 'health red — Krita MCP bridge down. Start Krita + MCP Bridge.'
  exit 1
}

# Prefer Git Bash pipeline if available; else call blender directly after ensuring inbox PNG
$bash = Get-Command bash -ErrorAction SilentlyContinue
if ($bash) {
  & bash "$PSScriptRoot/run_mvp.sh" $Slug
  exit $LASTEXITCODE
}

$Inbox = Join-Path $Repo "data\inbox\$Slug"
if (-not (Test-Path $Inbox)) { New-Item -ItemType Directory -Path $Inbox | Out-Null }
$Png = Get-ChildItem -Path $Inbox -Filter *.png -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Png) {
  # Avoid parenthesized lists with semicolons inside double quotes (PowerShell subexpression trap).
  Write-Error "SMOKE_LIVE=1 requires a real inbox PNG under $Inbox. Use export_png first. Do not use --demo-png."
  exit 1
}
$id = [guid]::NewGuid().ToString()
$OutDir = Join-Path $Repo "data\assets\$id"
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$OutGlb = Join-Path $OutDir "model.glb"
Copy-Item $Png.FullName (Join-Path $OutDir "preview.png")
& $env:BLENDER_BIN --background --python "$PSScriptRoot\png_to_glb.py" -- $Png.FullName $OutGlb
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$Api = if ($env:API) { $env:API } else { "http://127.0.0.1:8787" }
$Preview = Join-Path $OutDir 'preview.png'
node "$PSScriptRoot\register_asset.mjs" --id=$id --slug=$Slug --glb=$OutGlb --preview=$Preview --source=$($Png.FullName) --api=$Api --armature --weights
Write-Host "MVP asset id=$id slug=$Slug"
