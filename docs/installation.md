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

## Standalone Install

```powershell
cd C:\GAP\agents\ai-council
.\installers\install-ai-council.ps1
```

This performs a complete standalone install:
- installs the framework into `~\.ai-council\framework`
- writes command wrappers into `~\.ai-council\bin`
- makes `ai-council` available from any terminal once that bin folder is on `PATH`

You can also install directly through Node:

```powershell
node src/cli/main.js install-framework
```

## Uninstall

```powershell
cd C:\GAP\agents\ai-council
.\installers\uninstall-ai-council.ps1
```

Or:

```powershell
node src/cli/main.js uninstall-framework
```

## First Checks

```powershell
ai-council help
ai-council tooling-status --repo C:\repo
ai-council shell --repo C:\repo
```

`tooling-status` now probes each configured AI CLI, validates the non-interactive launch shape against the CLI's own help output, and reports whether each model list came from CLI discovery or config fallback.

For normal interactive use, prefer `ai-council shell --repo C:\repo`. You can also pass any nested path inside the repo and AI Agents Council will resolve the repo root automatically. The other commands remain available for scripting and direct automation.
