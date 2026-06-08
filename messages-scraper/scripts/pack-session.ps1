# pack-session.ps1
# Packs browser-data folder into session.zip for upload to ahlacard.net
#
# Usage:
#   cd messages-scraper
#   .\scripts\pack-session.ps1
# Output: session.zip in the messages-scraper root.

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$src  = Join-Path $root 'browser-data'
$dst  = Join-Path $root 'session.zip'

if (-not (Test-Path $src)) {
    Write-Error "browser-data folder not found at $src. Run 'npm run spike' first and scan QR."
    exit 1
}

if (Test-Path $dst) {
    Remove-Item $dst -Force
}

Write-Host "[pack] Compressing $src ..."
# Compress contents (not the parent folder) so server extracts directly into /data/gmsg-browser-data
Compress-Archive -Path (Join-Path $src '*') -DestinationPath $dst -CompressionLevel Fastest

$sizeMB = [math]::Round((Get-Item $dst).Length / 1MB, 2)
Write-Host "[pack] Done: $dst  ($sizeMB MB)"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1) Open https://ahlacard.net/bank"
Write-Host "  2) Click the green 'Upload session' button in the Google Messages card"
Write-Host "  3) Pick: $dst"
