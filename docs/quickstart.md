# Quickstart

## Create a Planning Run

```powershell
ai-council run --repo C:\repo --mode plan --prompt "Plan a new council CLI"
```

## Review a Repository

```powershell
ai-council run --repo C:\repo --mode review --prompt "Review this implementation"
```

## Guided Shell

```powershell
ai-council shell --repo C:\repo
```

On first run, the shell will:

- show the banner and overview
- wait for an Enter keypress
- ask you to assign providers to `proposal`, `critique`, `refinement`, `synthesis`, and `validation`
- save those assignments for future runs

## Outputs

Each run creates:

- `result/...`
- `result/execution-summary.md`
- `work/input/ticket-definition.md`
- `work/session/session.json`
- `work/session/visual-reference.md`
- `work/logs/session.log`
- `work/rounds/.../*.prompt.md`

If a provider launch fails, check:

- `result/execution-summary.md`
- `work/logs/provider-launches.json`
- `work/rounds/<stage>/<provider>.stderr.txt`
- `work/session/provider-sessions.json`

By default these runs are written under `.ai-council/result`. You can change that in the shell configuration flow or pass `--output-root <path>` on the command line.
Repo-specific settings, stage assignments, and provider startup preflight commands are stored under `.ai-council/settings.json`.

## Shell Tips

- `/home` returns to the main dashboard
- `/run` starts a new deliberation run
- `/artifacts` shows the latest result package
- `/configure` updates the output folder, council agents, and stage participants
- `/cycle` shows the proposal -> critique -> refinement -> synthesis -> validation flow
