#Requires -Version 5.1
<#
.SYNOPSIS
  Run LuminaFeed locally (Vite dev server for client/).

.DESCRIPTION
  Zero-backend SPA: this starts the Svelte + Vite dev server defined in
  client/package.json ("dev": "vite", host 0.0.0.0, port 5173).
  Installs client dependencies first when client/node_modules is missing.

.EXAMPLE
  .\run-local.ps1
  # Dev server at http://localhost:5173

.EXAMPLE
  .\run-local.ps1 -Build
  # Production build + local preview (mirrors GitHub Pages output in client/dist)

.EXAMPLE
  .\run-local.ps1 -Port 8080 -SkipInstall
#>
[CmdletBinding()]
param(
  [switch]$Build,
  [switch]$SkipInstall,
  [int]$Port = 5173
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $RepoRoot

function Test-Command($Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command "node")) {
  throw "node was not found on PATH. Install Node.js 18+ from https://nodejs.org, then re-run."
}
if (-not (Test-Command "npm")) {
  throw "npm was not found on PATH. Install Node.js 18+ (bundles npm), then re-run."
}

Write-Host ("Node {0} / npm {1}" -f (node --version), (npm --version))

if (-not $SkipInstall -and -not (Test-Path -LiteralPath "client\node_modules")) {
  Write-Host "Installing client dependencies (npm --prefix client install)..."
  npm --prefix client install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
}

if (-not (Test-Path -LiteralPath "client\.env.local") -and -not (Test-Path -LiteralPath "client\.env")) {
  Write-Warning "No client/.env.local (or client/.env) found. Copy client/.env.example and fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_SUPABASE_BUCKET, or the app runs without cloud storage."
}

if ($Build) {
  Write-Host "Building production bundle..."
  npm --prefix client run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE." }
  Write-Host ("Preview at http://localhost:{0} (LAN phones: use your IPv4 from /api/host-info)" -f $Port)
  npm --prefix client run preview -- --host 0.0.0.0 --port $Port
} else {
  Write-Host ("Dev server at http://localhost:{0} (LAN phones: replace localhost with your IPv4)" -f $Port)
  npm --prefix client run dev -- --host 0.0.0.0 --port $Port
}
