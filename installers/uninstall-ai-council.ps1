param(
  [string]$InstallRoot = "$HOME\.ai-council\framework",
  [string]$BinDir = "$HOME\.ai-council\bin"
)

function Resolve-AICouncilBinDir {
  param([string]$Candidate)

  if ($Candidate) {
    return [System.IO.Path]::GetFullPath($Candidate)
  }

  return [System.IO.Path]::GetFullPath((Join-Path $HOME ".ai-council\bin"))
}

function Normalize-PathEntry {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  return $Value.Trim().TrimEnd([char[]]@([char]'\', [char]'/')).ToLowerInvariant()
}

function Remove-PathEntry {
  param(
    [string]$PathValue,
    [string]$Entry
  )

  $NormalizedEntry = Normalize-PathEntry $Entry
  if (-not $NormalizedEntry) {
    return $PathValue
  }

  $Remaining = @()
  foreach ($Item in ($PathValue -split ';')) {
    if ((Normalize-PathEntry $Item) -ne $NormalizedEntry -and -not [string]::IsNullOrWhiteSpace($Item)) {
      $Remaining += $Item
    }
  }

  return ($Remaining -join ';')
}

$ErrorActionPreference = "Stop"
$sourceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Push-Location $sourceRoot
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 20+ is required to uninstall AI Council."
  }

  node src/cli/main.js uninstall-framework --install-root $InstallRoot --bin-dir $BinDir
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $ResolvedBinDir = Resolve-AICouncilBinDir $BinDir
  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $UpdatedUserPath = Remove-PathEntry $UserPath $ResolvedBinDir
  [Environment]::SetEnvironmentVariable("Path", $UpdatedUserPath, "User")
  $env:Path = Remove-PathEntry $env:Path $ResolvedBinDir

  Write-Host "Removed $ResolvedBinDir from the user PATH."
  Write-Host "AI Council uninstalled."
} finally {
  Pop-Location
}

