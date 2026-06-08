# pack-session.ps1 — ضغط مجلد browser-data إلى session.zip لرفعه على ahlacard.net
#
# الاستخدام:
#   cd messages-scraper
#   .\scripts\pack-session.ps1
# الناتج: session.zip في جذر مجلد messages-scraper.

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$src  = Join-Path $root 'browser-data'
$dst  = Join-Path $root 'session.zip'

if (-not (Test-Path $src)) {
    Write-Error "مجلد browser-data غير موجود في $src — شغّل 'npm run spike' أوّلاً وامسح QR."
    exit 1
}

if (Test-Path $dst) {
    Remove-Item $dst -Force
}

Write-Host "[pack] جارٍ ضغط $src ..."
# نضغط المحتويات (لا المجلد نفسه) كي يفكّ السيرفر مباشرة داخل /data/gmsg-browser-data
Compress-Archive -Path (Join-Path $src '*') -DestinationPath $dst -CompressionLevel Fastest

$sizeMB = [math]::Round((Get-Item $dst).Length / 1MB, 2)
Write-Host "[pack] تم: $dst  (${sizeMB} MB)"
Write-Host ""
Write-Host "الخطوة التالية:"
Write-Host "  1) افتح https://ahlacard.net/bank"
Write-Host "  2) في بطاقة 'مصدر الرسائل: Google Messages Web' → اضغط 'رفع جلسة'"
Write-Host "  3) اختر الملف: $dst"
