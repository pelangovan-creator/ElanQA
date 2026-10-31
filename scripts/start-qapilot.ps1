# Starts QA Pilot with Docker on Windows. First run: creates the settings file (.env) with
# random secrets and an admin password, builds the app (5-15 minutes), then opens the browser.
# 'Continue': Windows PowerShell 5.1 treats any stderr output from docker as an error under 'Stop'.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)
$Url = 'http://localhost:8080'
function Say($m) { Write-Host "`n$m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "`n$m`n" -ForegroundColor Red; Read-Host 'Press Enter to close this window'; exit 1 }
function Test-Docker { docker info *> $null; return $LASTEXITCODE -eq 0 }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail 'Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ , open it once, then run this again.'
}
if (-not (Test-Docker)) {
  Say 'Starting Docker Desktop...'
  $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dd) { Start-Process $dd }
  for ($i = 0; $i -lt 60 -and -not (Test-Docker); $i++) { Start-Sleep 3 }
  if (-not (Test-Docker)) { Fail 'Docker is not running. Open Docker Desktop, wait until it says it is running, then run this again.' }
}

function RandHex([int]$bytes) { $b = New-Object byte[] $bytes; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join '' }
function RandWord([int]$n) { $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; $b = New-Object byte[] $n; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $chars[$_ % $chars.Length] }) }

if (-not (Test-Path .env)) {
  Say 'First run: creating your settings and admin password...'
  $Password = "Qa-$(RandWord 10)-7!"
  $lines = Get-Content .env.example | ForEach-Object {
    if ($_ -match '^JWT_SECRET=') { "JWT_SECRET=$(RandHex 32)" }
    elseif ($_ -match '^ENCRYPTION_KEY=') { "ENCRYPTION_KEY=$(RandHex 32)" }
    elseif ($_ -match '^SEED_ADMIN_PASSWORD=') { "SEED_ADMIN_PASSWORD=$Password" }
    else { $_ }
  }
  # UTF-8 without a byte-order mark and with LF line endings, so Docker reads every value exactly
  # (a trailing carriage return would corrupt the keys).
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding $false))
  @"
QA Pilot - your sign-in
=======================
Address:  $Url
Email:    admin@qapilot.local
Password: $Password

Change this password after signing in: click your name (top right) > Change password.
To test against the demo shop, use this environment URL inside QA Pilot: http://demo:4600
Keep the .env file safe: it holds the keys that protect stored passwords. Do not delete it.
"@ | Set-Content -Encoding UTF8 QA-Pilot-login.txt
}

Say 'Building and starting QA Pilot (the first time takes 5-15 minutes)...'
docker compose --profile demo up --build -d
if ($LASTEXITCODE -ne 0) { Fail 'Docker could not start QA Pilot. If port 8080 is in use, add WEB_PORT=8081 to .env and try again.' }

Say 'Waiting for QA Pilot to be ready...'
$ready = $false
for ($i = 0; $i -lt 200 -and -not $ready; $i++) {
  try { Invoke-WebRequest "$Url/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null; $ready = $true } catch { Start-Sleep 3 }
}
if (-not $ready) { Fail 'QA Pilot did not start in time. Run: docker compose logs api' }

Say "QA Pilot is running at $Url"
if (Test-Path QA-Pilot-login.txt) { Get-Content QA-Pilot-login.txt; Start-Process notepad.exe QA-Pilot-login.txt }
Start-Process $Url
Read-Host "`nYou can close this window; QA Pilot keeps running. Press Enter to close"
