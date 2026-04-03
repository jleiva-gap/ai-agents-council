# Installation

## Requirements

- Node.js 20 or newer
- PowerShell 7 recommended on Windows
- Optional provider CLIs on `PATH`: `codex`, `claude`, `gemini`, `copilot`

## Local Setup

```powershell
cd C:\GAP\agents\ai-council
.\bootstrap.ps1
```

## Portable Install

```powershell
cd C:\GAP\agents\ai-council
node src/cli/main.js install-framework
```

This installs the framework into `~\.ai-council\framework` and writes command wrappers into `~\.ai-council\bin`.

## Uninstall

```powershell
node src/cli/main.js uninstall-framework
```

## First Checks

```powershell
ai-council tooling-status --repo C:\repo
ai-council shell --repo C:\repo
```
