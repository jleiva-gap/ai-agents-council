# G1 — Dynamic Deliberation Loop: Design Document

**Finding source:** `gemini_findings.md` — Section 1 (Linear Cycle vs. True Convergence)
**Status:** Deferred (complex architectural change — tracked here for future implementation)

---

## Problem Statement

`workflow.js` implements `buildDeliberationPlan` as a static array of exactly 5 stages that executes exactly once per run. The orchestrator has no mechanism to evaluate whether consensus was actually reached, and `converge.md` explicitly states:

> *"The cycle repeats until: The solution no longer breaks under pressure."*

In practice this means a council where the validation stage flags unresolved conflicts, remaining blockers, or explicitly writes `CONVERGED: no` still completes "successfully" with no indication that another loop is warranted. The deliberation cycle is a one-shot pass, not a convergence loop.

---

## Proposed Design

### Convergence Signal Schema

The validation stage prompt must request a machine-readable convergence signal embedded in the response. Proposed schema (inline in the validation response):

```yaml
CONVERGENCE:
  status: converged | needs_loop | blocked
  unresolved:
    - "Specific open item 1"
    - "Specific open item 2"
  recommended_loop: critique | refinement
  confidence: high | medium | low
```

This block would be embedded in the response by the validation agent. The orchestrator parses it post-stage to decide whether to re-enter the cycle.

### Orchestrator Loop Logic

Replace the single-pass call to `createDeliberationArtifacts` with a convergence loop:

```
loop iteration = 0
while iteration <= max_convergence_loops:
    run: proposal → critique → refinement → synthesis → validation
    parse convergence signal from validation responses
    if signal.status == "converged" OR iteration == max_convergence_loops:
        break
    else:
        strip proposal stage (already fixed), re-run critique → synthesis → validation
        iteration += 1
```

Key decisions:
- The **proposal stage runs once** — looping re-enters at critique with the prior synthesis as the base
- Loop iteration is reflected in stage directory names: `06-critique-2/`, `07-refinement-2/`, `08-synthesis-2/`, `09-validation-2/`
- `max_convergence_loops` defaults to `0` (disabled) and is configurable per council or per run

### Configuration

In council config (`config/councils/*.json`):
```json
{
  "max_convergence_loops": 1
}
```

In `app.settings.json` (user-level default):
```json
{
  "max_convergence_loops": 0
}
```

### Artifact Changes

`trace-index.json` gains a top-level `convergence_loops` field:
```json
{
  "convergence_loops": 1,
  "converged": true,
  "stages": [ ... ]
}
```

The `deliberation-trace.md` gains a `## Convergence` section after all stages:
```markdown
## Convergence
- Loops completed: 1
- Final status: converged
- Confidence: high
```

---

## Implementation Phases

### Phase 1 — Convergence Signal in Validation Prompt

**Scope:** `prompts/roles/reviewer.md`, `src/core/workflow.js` (`buildPromptText`)

- Expand the validation stage prompt (reviewer.md) to require the `CONVERGENCE:` YAML block
- Add instruction that the orchestrator will parse this block and may re-enter the cycle

**Effort:** Small — prompt change + documentation

### Phase 2 — Signal Parser

**Scope:** `src/core/workflow.js`

- Add `parseConvergenceSignal(responseContent)` that extracts the CONVERGENCE block
- Returns `{ status, unresolved, recommended_loop, confidence }` or `null` if absent/malformed
- Add `readLatestConvergenceSignal(validationResponses)` that aggregates signals across multiple validators (majority vote on status)

**Effort:** Medium — new parsing function, logic for multi-validator aggregation

### Phase 3 — Loop Orchestration

**Scope:** `src/core/workflow.js` — `createDeliberationArtifacts`

- Add `maxConvergenceLoops` parameter (sourced from config, default 0)
- After validation stage completes, call `readLatestConvergenceSignal`
- If `needs_loop` and iteration < maxConvergenceLoops:
  - Build a reduced deliberation plan: `[critique, refinement, synthesis, validation]`
  - Use stage index offset so directory names reflect the loop: `06-critique-2`, etc.
  - Run the partial plan against the existing `producedArtifacts`
  - Increment iteration
- Break when `converged` or limit reached

**Key risk:** Stage index numbering must be globally unique across loops. Use a monotonically increasing counter rather than restarting at the current stage's position.

**Effort:** Large — changes to `createDeliberationArtifacts` core loop; careful artifact accumulation across loop iterations

### Phase 4 — Trace and Manifest Updates

**Scope:** `src/core/workflow.js` — `writeDeliberationTraceArtifacts`, `writeSessionManifest`

- Add `convergence_loops` and `converged` to `trace-index.json`
- Add `## Convergence` section to `deliberation-trace.md`
- Add `convergence_summary` to `session.json`

**Effort:** Small once Phase 3 is complete

---

## Design Decisions and Open Questions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Who signals convergence? | Validation stage agents | They are the designated review layer and already evaluate readiness |
| What triggers a loop? | Explicit `CONVERGENCE: needs_loop` signal | Avoids false re-loops from vague responses |
| Does proposal re-run? | No | Proposals are fixed inputs; critique improves upon them |
| Default loop limit | 0 (off) | Safe default; opt-in per council |
| Max supported loops | 3 (hard cap) | Beyond 3 loops, manual intervention is needed |
| What if signal is absent? | Treat as converged | Fail-safe prevents infinite loops |
| Multi-validator disagreement | Majority vote on status | If 2 of 3 say `converged`, treat as converged |

---

## Dependencies

This feature depends on the following completed fixes from `gemini_findings.md` and `review_claude.md`:

- **F3 (shallow detection)** — cross-stage coverage scoring must be in place to meaningfully evaluate loop quality
- **F9 (deliberation tests)** — `createDeliberationArtifacts` must be unit-tested before the loop logic is added
- **F2 (role prompt injection)** — the validation stage prompt must carry the convergence signal schema

---

## Acceptance Criteria

- [ ] A council run with `max_convergence_loops: 1` and a `CONVERGENCE: needs_loop` signal from validation re-enters at critique and completes a second pass
- [ ] A council run with `max_convergence_loops: 0` (default) always exits after one pass regardless of convergence signal
- [ ] Stage directories across loops have globally unique, sequentially increasing numeric prefixes
- [ ] `trace-index.json` records the number of completed loops and the final convergence status
- [ ] If the convergence signal is absent or malformed, the run does not loop and does not fail
- [ ] The total provider invocation count is logged at run completion: `N agents × M stages × L loops`
