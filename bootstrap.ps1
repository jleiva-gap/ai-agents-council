param(
  [switch]$SkipTest
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Bootstrapping AI Council in $root"
Push-Location $root
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 20+ is required."
  }

  if (-not (Test-Path (Join-Path $root "node_modules"))) {
    Write-Host "No local node_modules folder detected. This project currently has no external npm dependencies."
  }

  if (-not $SkipTest) {
    npm test
  }

  Write-Host "Bootstrap completed."
} finally {
  Pop-Location
}
