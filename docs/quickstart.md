# Quickstart

The preferred way to use AI Agents Council is the guided shell. The direct commands below are still supported when you want scripting or a one-shot run.

## Guided Shell

```powershell
ai-council shell --repo C:\repo
```

You can also point `--repo` at a nested folder inside that repository. AI Agents Council will resolve it to the repo root automatically.

On first run, the shell will:

- show the banner and overview
- wait for an Enter keypress
- ask you to assign providers to `proposal`, `critique`, `refinement`, `synthesis`, and `validation`
- default each stage to all configured council agents unless you narrow it
- save those assignments for future runs

When a request is still ambiguous, the shell now lets the clarification stage run before proposal. If the clarification stage finds blocking questions, the shell asks them one by one, then lets you review and revise the captured answers before the council continues.

If the latest run is still waiting for a decision, re-entering the shell will reopen that pending approval flow so you can approve, reject, or request changes.

## Create a Planning Run

```powershell
ai-council run --repo C:\repo --mode plan --prompt "Plan a new council CLI"
```

## Review a Repository

```powershell
ai-council run --repo C:\repo --mode review --prompt "Review this implementation"
```

Review runs now fail fast if the target repo cannot be indexed or the required source materials are inaccessible, instead of continuing with a misleading partial result.

## Outputs

Each run creates:

- `result/summary.md`
- `result/<mode-specific deliverable>.md`
- `work/input/ticket-definition.md`
- `work/session/session.json`
- `work/session/visual-reference.md`
- `work/logs/session.log`
- `work/rounds/.../*.prompt.md`
- `work/synth/execution-summary.md`
- `work/synth/deliberation-trace.md`

If a provider launch fails, check:

- `work/synth/execution-summary.md`
- `work/logs/provider-launches.json`
- `work/rounds/<stage>/<provider>.stderr.txt`
- `work/session/provider-sessions.json`

By default these runs are written under `.ai-council/result`. You can change that in the shell configuration flow or pass `--output-root <path>` on the command line.
Repo-specific settings, stage assignments, and provider startup preflight commands are stored under `.ai-council/settings.json`.

When you choose `Request changes`, AI Agents Council creates a follow-up run using the latest ticket plus the change request context, rewrites the newest `result/` artifacts, and returns to pending approval.

## Shell Tips

- `/home` returns to the main dashboard
- `/run` starts a new deliberation run
- `/artifacts` shows the latest primary deliverable, result package, and trace artifacts
- `/configure` updates the output folder, council agents, and stage participants
- `/cycle` shows the proposal -> critique -> refinement -> synthesis -> validation flow
