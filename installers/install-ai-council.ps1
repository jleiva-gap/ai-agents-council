param(
  [string]$InstallDir = "$HOME\\.ai-council"
)

$ErrorActionPreference = "Stop"
$sourceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $sourceRoot "*") -Destination $InstallDir -Recurse -Force

Write-Host "AI Council installed to $InstallDir"
Write-Host "Run: powershell -ExecutionPolicy Bypass -File `"$InstallDir\\Invoke-AICouncil.ps1`" status"
