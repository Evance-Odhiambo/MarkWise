# ============================================================
#  MarkWise – Android Release Keystore Generator (Windows)
# ============================================================
#  Run once before your first release build:
#    powershell -ExecutionPolicy Bypass -File scripts\generate-keystore.ps1
#
#  The script generates the keystore, updates gradle.properties
#  with the passwords you enter, and reminds you to back the
#  keystore file up somewhere safe.
# ============================================================

$keystoreName  = "markwise-release.keystore"
$keystoreDest  = "android\app\$keystoreName"
$gradleProps   = "android\gradle.properties"

Write-Host ""
Write-Host "=== MarkWise Android Release Keystore Generator ===" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $keystoreDest) {
    Write-Host "Warning: $keystoreDest already exists." -ForegroundColor Yellow
    $overwrite = Read-Host "Overwrite? (y/N)"
    if ($overwrite -ne 'y') { exit 0 }
}

$storePass = Read-Host -AsSecureString "Enter keystore password (store password)"
$keyPass   = Read-Host -AsSecureString "Enter key password (can be same as store password)"
$cn        = Read-Host "Enter your name or organisation (e.g. MarkWise Team)"
$ou        = Read-Host "Enter organisational unit (e.g. Engineering)"
$org       = Read-Host "Enter organisation (e.g. MarkWise)"
$city      = Read-Host "Enter city"
$state     = Read-Host "Enter state / county"
$country   = Read-Host "Enter 2-letter country code (e.g. GB)"

$storePlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePass))
$keyPlain   = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyPass))

$dname = "CN=$cn, OU=$ou, O=$org, L=$city, ST=$state, C=$country"

# Locate keytool (bundled with the JDK)
$keytool = Get-Command keytool -ErrorAction SilentlyContinue
if (-not $keytool) {
    # Common JDK paths on Windows
    $candidates = @(
        "$env:JAVA_HOME\bin\keytool.exe",
        "C:\Program Files\Java\jdk*\bin\keytool.exe",
        "C:\Program Files\Microsoft\jdk-*\bin\keytool.exe"
    ) | ForEach-Object { Resolve-Path $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
    if ($candidates) { $keytool = $candidates } else {
        Write-Host "ERROR: keytool not found. Install a JDK and ensure JAVA_HOME is set." -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Generating keystore at $keystoreDest ..." -ForegroundColor Green

& "$keytool" `
    -genkeypair `
    -v `
    -keystore $keystoreDest `
    -alias markwise `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -storepass $storePlain `
    -keypass $keyPlain `
    -dname $dname

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: keytool failed. See output above." -ForegroundColor Red
    exit 1
}

# Patch gradle.properties
$content = Get-Content $gradleProps -Raw
$content = $content -replace 'MYAPP_UPLOAD_STORE_PASSWORD=.*', "MYAPP_UPLOAD_STORE_PASSWORD=$storePlain"
$content = $content -replace 'MYAPP_UPLOAD_KEY_PASSWORD=.*',   "MYAPP_UPLOAD_KEY_PASSWORD=$keyPlain"
Set-Content $gradleProps $content -NoNewline

Write-Host ""
Write-Host "Done! gradle.properties has been updated." -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT:" -ForegroundColor Yellow
Write-Host "  1. Add android\app\$keystoreName to .gitignore" -ForegroundColor Yellow
Write-Host "  2. Back the keystore file up — losing it means you cannot update your app." -ForegroundColor Yellow
Write-Host "  3. The passwords are now stored in gradle.properties — do NOT commit that file." -ForegroundColor Yellow
Write-Host ""
Write-Host "Build a release APK:  npm run build:android:apk" -ForegroundColor Cyan
Write-Host "Build a release AAB:  npm run build:android:aab" -ForegroundColor Cyan
Write-Host ""
