# ─────────────────────────────────────────────────────────────────────────────
# Builds the signed Electron installer using the code-signing certificate.
# Run from the project root after running scripts\create-cert.ps1.
#
# Usage:
#   Right-click → Run with PowerShell  (no admin needed)
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'

$env:CSC_LINK         = "C:\certs\topten.pfx"
$env:CSC_KEY_PASSWORD = "TopTen@2024!"

Write-Host ""
Write-Host "Building signed installer..." -ForegroundColor Cyan
Write-Host "Certificate : $env:CSC_LINK"
Write-Host ""

Set-Location (Split-Path -Parent $PSScriptRoot)
npm run dist

Write-Host ""
Write-Host "Build complete. Signed installer is in dist-exe\" -ForegroundColor Green
