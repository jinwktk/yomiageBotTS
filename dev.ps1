# PowerShell script for development with logging
Write-Host "Starting yomiage-bot in development mode with logging..." -ForegroundColor Green

# Create log directory if it doesn't exist
if (!(Test-Path "logs")) {
    New-Item -ItemType Directory -Path "logs"
}

# Start nodemon with logging
$logFile = "yomiage.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host "Logging to: $logFile" -ForegroundColor Yellow
Write-Host "Started at: $timestamp" -ForegroundColor Yellow

# Start nodemon (uses nodemon.json config) and redirect all output to log file
# Use Start-Process to avoid file locking issues
$process = Start-Process -FilePath "nodemon" -ArgumentList @() -NoNewWindow -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $logFile

# Wait for the process to complete
$process.WaitForExit()

Write-Host "Development server stopped." -ForegroundColor Red 