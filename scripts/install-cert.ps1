# ─────────────────────────────────────────────────────────────────────────────
# Installs the code-signing certificate into Trusted Root Certification
# Authorities and Trusted Publishers on this machine.
# Run ONCE on each company machine as Administrator.
#
# Usage:
#   1. Copy C:\certs\topten.cer (from the build machine) to this machine.
#   2. Right-click this script → Run with PowerShell (as Administrator)
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'

$cerPath = "C:\certs\topten.cer"

if (-not (Test-Path $cerPath)) {
    Write-Host ""
    Write-Host "ERROR: Certificate not found at $cerPath" -ForegroundColor Red
    Write-Host "Copy topten.cer from the build machine to C:\certs\ and try again."
    exit 1
}

Write-Host ""
Write-Host "Installing certificate on this machine..." -ForegroundColor Cyan

# Trusted Root Certification Authorities — trusts the CA itself
Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\Root" | Out-Null

# Trusted Publishers — marks the app as a trusted publisher
Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher" | Out-Null

Write-Host "Done!" -ForegroundColor Green
Write-Host "The app will now run without security warnings on this machine."
