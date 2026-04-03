param(
  [string]$InstallDir = "$HOME\\.ai-council"
)

$ErrorActionPreference = "Stop"

if (Test-Path $InstallDir) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
  Write-Host "Removed $InstallDir"
} else {
  Write-Host "Nothing to remove at $InstallDir"
}
