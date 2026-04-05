param(
  [string]$InstallRoot = "$HOME\.ai-council\framework",
  [string]$BinDir = "$HOME\.ai-council\bin",
  [switch]$Force,
  [switch]$SkipTest
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

function Test-PathContainsEntry {
  param(
    [string]$PathValue,
    [string]$Entry
  )

  $NormalizedEntry = Normalize-PathEntry $Entry
  if (-not $NormalizedEntry) {
    return $false
  }

  foreach ($Item in ($PathValue -split ';')) {
    if ((Normalize-PathEntry $Item) -eq $NormalizedEntry) {
      return $true
    }
  }

  return $false
}

$ErrorActionPreference = "Stop"
$sourceRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Push-Location $sourceRoot
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 20+ is required to install AI Council."
  }

  if (-not $SkipTest) {
    npm test
  }

  $args = @(
    "src/cli/main.js",
    "install-framework",
    "--install-root", $InstallRoot,
    "--bin-dir", $BinDir
  )

  if ($Force) {
    $args += "--force"
  }

  node @args
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  $ResolvedBinDir = Resolve-AICouncilBinDir $BinDir
  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")

  if (-not (Test-PathContainsEntry $UserPath $ResolvedBinDir)) {
    $UpdatedUserPath = if ([string]::IsNullOrWhiteSpace($UserPath)) {
      $ResolvedBinDir
    } else {
      "$UserPath;$ResolvedBinDir"
    }

    [Environment]::SetEnvironmentVariable("Path", $UpdatedUserPath, "User")
    if (-not (Test-PathContainsEntry $env:Path $ResolvedBinDir)) {
      $env:Path = "$env:Path;$ResolvedBinDir"
    }

    Write-Host "Added $ResolvedBinDir to the user PATH. Open a new terminal if 'ai-council' is not available immediately."
  } else {
    Write-Host "$ResolvedBinDir is already on the user PATH."
  }

  Write-Host ""
  Write-Host "AI Council installed."
  Write-Host "Try: ai-council help"
} finally {
  Pop-Location
}

