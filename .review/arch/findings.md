# Prompt / Token Review Findings

## HIGH - Acceptance criteria extraction scans the entire ticket and poisons downstream context

**Files:** `src/input/normalize.js:5-10`, `src/input/normalize.js:300-350`, `src/input/normalize.js:420-429`

`parseAcceptanceCriteria()` treats every bullet or numbered line in the canonical ticket as an acceptance criterion, regardless of section. That output then drives:

- `buildClarificationQuestions()` readiness logic
- `previewNormalizedInput()` metadata and acceptance counts
- `normalizeInput()` acceptance criteria persisted into run artifacts

That means bullets from `## Scope`, `## Open Questions`, `## Reference Links`, and similar sections are misclassified as acceptance criteria. In practice this does two harmful things at once:

- it inflates token usage by copying non-acceptance bullets into plans, tasks, and scorecards
- it suppresses clarification because the heuristic believes acceptance criteria already exist

I reproduced this locally with a markdown ticket containing only `## Scope` and `## Open Questions` bullets. `previewNormalizedInput()` reported `acceptance_criteria_count: 3`, populated those three bullets as acceptance criteria, and returned no clarification questions.

**Why this matters for proprietary context:** the system ends up amplifying the wrong parts of the ticket and may skip the clarification pass exactly when the actual requirements are still underspecified.

**Recommendation:** parse acceptance criteria only from the `## Acceptance Criteria` section. If prompt-mode inputs need inference, infer once during `sectionsFromPrompt()` and never re-scan the fully expanded canonical ticket globally.

## HIGH - Supplemental context is written to disk but never surfaced in the prompts

**Files:** `src/input/normalize.js:404-417`, `src/review/evidence.js:62-78`, `src/core/workflow.js:408-451`, `src/core/workflow.js:613-623`, `src/core/workflow.js:2431-2437`

The input pipeline copies or writes the following artifacts into `work/input/`:

- `extra-context.md`
- `constraints.md`
- `acceptance-criteria.md`
- `review-target.md`
- `debate-topic.md`

Review mode also builds:

- `repo/file-index.json`
- `repo/evidence-map.json`

But the prompt assembly path only passes `ticketContext`, aggregate `evidence` counts, and prior stage response paths into `buildPromptText()`. The generated prompt never references these supplemental artifacts by path and never summarizes their contents.

The result is a silent context drop: users can provide proprietary supporting material and reasonably expect it to shape the council, but the model only sees it if it decides to explore the artifact tree on its own.

**Why this matters for token efficiency and effectiveness:** this is the worst of both worlds. The system pays the I/O and complexity cost to normalize the material, but the model does not reliably benefit from it.

**Recommendation:** add an `## Additional Context Artifacts` block to prompts that lists any present auxiliary files, and include a short inline summary for the highest-signal ones. Review mode should explicitly reference `input/review-target.md` and `repo/file-index.json`.

## MEDIUM - Prompt-mode normalization duplicates the full request text, doubling proposal-stage cost

**Files:** `src/input/normalize.js:19-47`

For freeform prompt input, `sectionsFromPrompt()` writes the entire prompt into both:

- `## Summary`
- `## Business Goal`

That duplicates the same user text inside the canonical ticket before the proposal stage embeds the full ticket into each proposal participant prompt.

This increases token consumption for the most common input path and also amplifies the acceptance-criteria parsing bug above, because the same bullet lines are repeated across multiple sections.

**Why this matters for proprietary context:** long internal requests become more expensive before any real reasoning begins, and repeated wording can distort model salience by over-weighting whichever phrasing happened to be copied.

**Recommendation:** keep the original prompt in `## Summary`, derive a concise one-line business goal, or leave `## Business Goal` empty unless the user explicitly supplied distinct content.

## MEDIUM - `arg` prompt transport remains fragile for large prompts on Windows

**Files:** `config/providers.json:45-61`, `src/providers/index.js:104-133`

`gemini` and `copilot` are configured with `prompt_transport: "arg"` and inject the full prompt through `{{PROMPT_TEXT}}`. On Windows, `resolveProcessInvocation()` may route `.cmd` and `.bat` shims through `cmd.exe /c`, which makes the launch path sensitive to command-line length limits.

As ticket size grows, the most context-heavy runs become the most likely to fail or become brittle at launch time. This is especially risky for:

- proposal stages that still carry the full canonical ticket
- review prompts with long proprietary context
- multi-agent runs where the same large prompt is fanned out repeatedly

**Recommendation:** prefer `stdin` or `file` transport wherever the CLI supports it. When `arg` transport is unavoidable, add a preflight length guard and fail fast with a clear recommendation instead of attempting a brittle launch.

## MEDIUM - Later stages rely on a summary that silently drops requirements when the ticket is large

**Files:** `src/input/normalize.js:238-277`, `src/core/workflow.js:416-419`

The shared ticket summary intentionally caps what later stages see by default:

- scope: first 4 items
- acceptance criteria: first 6 items
- constraints: first 4 items
- references: first 4 items
- clarification answers: first 4 items

That is a good token-saving direction, but the summary does not record omission counts. Later stages are told the full ticket is available if they need exact wording, yet nothing in the prompt explicitly signals that the summary may be incomplete.

For large tickets, critique, synthesis, and validation can therefore operate on a lossy subset of requirements without knowing anything was omitted.

**Recommendation:** when any section is truncated, add an omission notice such as `3 more acceptance criteria omitted; open input/ticket-definition.md for the full list.` That preserves the token win while making the loss explicit.

## Notes

Several earlier token and safety issues appear to already be improved in the current worktree:

- later stages now use `ticket-summary.md` instead of repeating the full ticket
- clarification can be skipped heuristically for clear requests
- provider stdout/stderr capture is byte-bounded
- malformed JSON reads now fall back safely

## Verification

I validated the findings by reading the current source and by running targeted local reproductions for `previewNormalizedInput()`. I could not run the Node test suite end-to-end in this sandbox because `node --test` failed with `spawn EPERM`.
