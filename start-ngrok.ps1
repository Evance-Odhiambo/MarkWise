# MarkWise ngrok Startup Script
# This script starts the Next.js dev server and ngrok tunnel

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "   MarkWise ngrok Startup Script     " -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Check if ngrok is installed
$ngrokInstalled = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrokInstalled) {
    Write-Host "ERROR: ngrok is not installed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install ngrok using one of these methods:" -ForegroundColor Yellow
    Write-Host "1. Using Chocolatey: choco install ngrok" -ForegroundColor Yellow
    Write-Host "2. Download from: https://ngrok.com/download" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "After installation, run this script again." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "✓ ngrok is installed" -ForegroundColor Green
Write-Host ""

# Check if authtoken is configured
Write-Host "Checking ngrok authentication..." -ForegroundColor Cyan
$authConfigured = $true
try {
    $result = ngrok config check 2>&1
    if ($LASTEXITCODE -ne 0) {
        $authConfigured = $false
    }
} catch {
    $authConfigured = $false
}

if (-not $authConfigured) {
    Write-Host ""
    Write-Host "WARNING: ngrok authtoken not configured!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To configure:" -ForegroundColor Yellow
    Write-Host "1. Sign up at https://dashboard.ngrok.com/signup" -ForegroundColor Yellow
    Write-Host "2. Get your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor Yellow
    Write-Host "3. Run: ngrok config add-authtoken YOUR_TOKEN" -ForegroundColor Yellow
    Write-Host ""
    $continue = Read-Host "Continue without authtoken? (y/n)"
    if ($continue -ne "y") {
        exit 1
    }
}

Write-Host ""
Write-Host "Starting MarkWise with ngrok..." -ForegroundColor Cyan
Write-Host ""

# Check if port 3000 is already in use
$portInUse = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "WARNING: Port 3000 is already in use!" -ForegroundColor Yellow
    Write-Host "Please stop any services running on port 3000 and try again." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "✓ Port 3000 is available" -ForegroundColor Green
Write-Host ""

# Start Next.js dev server in background
Write-Host "Starting Next.js development server..." -ForegroundColor Cyan
$webPath = Join-Path $PSScriptRoot "apps\web"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$webPath'; npm run dev" -WindowStyle Normal

Write-Host "✓ Next.js server starting..." -ForegroundColor Green
Write-Host ""

# Wait for server to start
Write-Host "Waiting for server to start (10 seconds)..." -ForegroundColor Cyan
Start-Sleep -Seconds 10

# Start ngrok
Write-Host ""
Write-Host "Starting ngrok tunnel..." -ForegroundColor Cyan
Write-Host ""
Write-Host "=====================================" -ForegroundColor Green
Write-Host "  COPY THE HTTPS URL FROM BELOW     " -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""

ngrok http 3000

Write-Host ""
Write-Host "ngrok tunnel closed." -ForegroundColor Yellow
