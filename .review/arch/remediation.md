# Remediation Plan

## Goal

Reduce wasted token consumption while preserving the proprietary context that materially affects planning, critique, and review quality.

## Implemented Remediation

### 1. Fix acceptance criteria extraction at the source

**Status:** Implemented

**Problem**

Acceptance criteria parsing treated every bullet in the canonical ticket as a requirement candidate, including scope bullets and open questions.

**Change**

- acceptance criteria parsing now reads only the `## Acceptance Criteria` section from canonical tickets
- prompt-mode inference still seeds that section once, but later normalization no longer rescans the whole ticket globally
- clarification readiness now depends on real acceptance criteria instead of unrelated bullets

**Expected impact**

- fewer false-positive acceptance criteria
- fewer unnecessary tasks and scorecard entries
- better clarification triggering on underspecified requests

### 2. Stop duplicating the full freeform prompt in `Business Goal`

**Status:** Implemented

**Problem**

Prompt-mode normalization copied the entire freeform request into both `## Summary` and `## Business Goal`, inflating proposal-stage context before any reasoning started.

**Change**

- prompt normalization now derives a concise business-goal line from the first meaningful request sentence
- the full freeform request remains in `## Summary`

**Expected impact**

- lower proposal-stage token usage for prompt-driven runs
- cleaner salience for the highest-level outcome

### 3. Make shared summaries explicit when they are lossy

**Status:** Implemented

**Problem**

Later stages intentionally use a compressed summary, but the old summary gave no indication when items were omitted.

**Change**

- canonical ticket summaries now include omission notes when scope, acceptance criteria, constraints, reference links, or clarification answers exceed the inline limit
- the note explicitly points the provider back to `input/ticket-definition.md`

**Expected impact**

- preserves token savings from summary-mode prompts
- reduces the risk that critique/synthesis/validation assume the summary is complete

### 4. Surface supplemental context artifacts directly in prompts

**Status:** Implemented

**Problem**

Extra context files and generated review artifacts were written to disk but not referenced in stage prompts, so providers had to discover them opportunistically.

**Change**

- stage prompts now include an `## Additional Context Artifacts` section
- prompts reference available artifacts such as:
  - `input/extra-context.md`
  - `input/constraints.md`
  - `input/acceptance-criteria.md`
  - `input/review-target.md`
  - `input/debate-topic.md`
  - `repo/file-index.json`
  - `repo/evidence-map.json`
- prompts include short inline summaries so the provider knows why each artifact matters before deciding whether to open it

**Expected impact**

- better retention of proprietary solution context
- less reliance on provider-side artifact discovery
- higher review effectiveness without embedding full artifact contents inline

### 5. Add a defensive guard for oversized Windows arg-based launches

**Status:** Implemented

**Problem**

Argument-based prompt transport remains fragile on Windows when prompt payloads get large.

**Change**

- added a Windows-specific soft limit check for expanded arg-based launch commands
- oversized launches now fail fast with an actionable error instead of attempting a brittle command invocation

**Expected impact**

- clearer failure mode for large proprietary prompts
- lower risk of confusing provider launch failures on Windows

## Verification

### Automated

- `node --test tests\\input.test.js`
- `node --test tests\\providers.test.js`

### Targeted behavior checks

- verified that markdown tickets with only `Scope` and `Open Questions` bullets no longer create fake acceptance criteria
- verified that prompt-mode normalization produces a concise `Business Goal`
- verified that generated proposal prompts include `## Additional Context Artifacts` with inline summaries
- verified that review prompts reference `input/review-target.md`, `repo/file-index.json`, and `repo/evidence-map.json`

## Remaining Risk

- `tests\\workflow.test.js` is large enough that full execution remains slow in this environment, so workflow verification was completed with direct targeted runs instead of waiting for the entire file to finish.
- `copilot` still requires arg-based prompt transport in the current provider profile, so the implemented protection is a guardrail rather than a full transport redesign.
