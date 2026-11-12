# ─────────────────────────────────────────────────────────────────────────────
# Creates a self-signed code-signing certificate and exports it as a .pfx
# Run ONCE on your build machine as Administrator.
#
# Usage:
#   Right-click → Run with PowerShell (as Administrator)
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = 'Stop'

$pfxPath  = "C:\certs\topten.pfx"
$cerPath  = "C:\certs\topten.cer"
$password = "TopTen@2024!"

# Create the C:\certs folder if it doesn't exist
if (-not (Test-Path "C:\certs")) {
    New-Item -ItemType Directory -Path "C:\certs" | Out-Null
}

Write-Host ""
Write-Host "Creating self-signed code-signing certificate..." -ForegroundColor Cyan

$cert = New-SelfSignedCertificate `
    -Type               CodeSigning `
    -Subject            "CN=Top Ten Website Marketing" `
    -CertStoreLocation  "Cert:\CurrentUser\My"

$securePass = ConvertTo-SecureString -String $password -Force -AsPlainText

# Export PFX — used by electron-builder to sign the exe
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePass | Out-Null

# Export CER — install this on each client machine
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
Write-Host "  PFX (for signing) : $pfxPath"
Write-Host "  CER (for clients) : $cerPath"
Write-Host "  Password          : $password"
Write-Host ""
Write-Host "Next: run scripts\build-signed.ps1 to build the signed installer."
