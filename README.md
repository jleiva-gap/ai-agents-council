# AI Agents Council

<p align="center"><img src="docs/ai-council.png" alt="AI Agents Council banner" width="100%"/></p>

AI Agents Council is a config-driven engineering council CLI for plan, design, spike, debate, and review workflows.

Council identities are consistent across prompts, run artifacts, and logs:

- `Axiom` for intake and proposal shaping
- `Vector` for planning and synthesis
- `Forge` for refinement and implementation framing
- `Sentinel` for review and validation

The council now follows a deliberation cycle inspired by `converge.md`:

- proposal
- critique
- refinement
- synthesis
- validation

Two or more agents can work on the same ticket during proposal and validation, then converge through later stages into one final result.

## Project Context

AI Agents Council implements a deliberative, multi-agent workflow built around a Cycle of Convergence: proposal, critique, refinement, synthesis, and validation. The system models distinct council roles — `Axiom` (proposal framing), `Sentinel` (critique), `Forge` (refinement), `Vector` (synthesis), and collective validation — so ideas are exposed to structured challenge and evolution until they hold up under pressure. This approach is intended to produce robust engineering decisions by making proposals visible, stress-testing them, refining weaknesses, and converging on unified, validated outcomes.

## Commands

- `ai-council shell`
- `ai-council tooling-status`
- `ai-council status`
- `ai-council run --mode plan --prompt "..."`
- `ai-council run --mode review --ticket-file ticket.md --repo C:\repo`
- `ai-council resume`

## Behavior

The CLI normalizes input into durable run artifacts under `.runs/<timestamp>-<slug>/`, prepares council prompts and round plans, optionally packages review evidence, and writes mode-specific final artifacts that humans or follow-up AI agents can use.

By default the tool is safe and artifact-first. Provider launch commands are detected and previewed, and future runs can opt into automated provider execution with `--launch` when those CLIs are configured.

New runs now default to `.ai-council/result`, and the guided shell lets you change that output folder during configuration. You can also override it directly with `--output-root <path>`.
Each run now separates clean deliverables from process files:

- `result/` contains only the final result artifacts
- `work/` contains prompts, logs, session files, evidence packs, and other intermediate material

The CLI is repo-targeted and now auto-resolves the repository root. You can run it from any folder inside a repo, and it will store configuration in that target repo's `.ai-council/` directory.

## Install And Start

The preferred day-to-day entry point is the guided shell. The direct commands remain available for scripting, automation, and one-off runs.

```powershell
.\bootstrap.ps1
node src/cli/main.js install-framework
node src/cli/main.js tooling-status
ai-council shell --repo C:\some-repo
```

Direct command examples still work when you want a non-interactive flow:

```powershell
ai-council run --repo C:\some-repo --mode plan --prompt "Plan a new council CLI"
ai-council resume --repo C:\some-repo
```

If you point `--repo` at a nested folder inside a repository, AI Agents Council now resolves that path back to the repo root before it loads settings, writes outputs, or launches provider CLIs.

The guided shell now starts with a banner and overview, waits for an Enter keypress, and on first run asks you to configure council agents and stage participants for proposal, critique, refinement, synthesis, and validation so multiple agents can deliberate on the same ticket before the final result is produced. By default, each stage now uses all configured council agents unless you narrow a stage explicitly.
Each council agent is a `CLI + optional model` seat. That means you can:

- use the same CLI twice with different models and treat them as two distinct council agents
- use the same CLI and same model twice when you still want two separate council seats for deliberation

It also provides an AWF-style single-screen home, guided next steps, slash commands, and paged views so you can move through the console without losing context to terminal scroll.
During repo configuration you can also save optional provider startup/trust commands so AI CLIs that require workspace authorization can be preflighted automatically before launch. Provider runs now execute against the target repo root and keep `work/` available as an additional artifact directory, which fixes review-time source access issues in nested repos.
Before proposal starts, AI Agents Council now runs a clarification stage. When launch is enabled, that stage can use the configured AI CLI to review the request semantically and ask only the smallest blocking questions needed before planning. The guided shell then runs those questions interactively and lets you revise answers before the council continues.
When starting a new run from the shell, you now get a summary screen with the option to start, change configuration, or cancel, and the shell shows compact live progress so you can tell whether stages are advancing or returning errors.
Provider execution is now bounded by per-provider timeouts, and the work folder records provider session state so future CLI-specific continue/resume commands can be supported cleanly.
If a configured AI CLI is unavailable, AI Agents Council now stops before deliberation instead of silently dropping that participant. Review mode also stops immediately when required source materials cannot be accessed.

More docs:

- [installation.md](C:\GAP\agents\ai-council\docs\installation.md)
- [quickstart.md](C:\GAP\agents\ai-council\docs\quickstart.md)
- [council-identity.md](C:\GAP\agents\ai-council\docs\council-identity.md)
