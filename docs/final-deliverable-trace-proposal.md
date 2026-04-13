# Final Deliverable And Deliberation Trace Proposal

Status: implemented in the current workflow. This document captures the design direction behind the live result-and-trace split.

## Intent

AI Agents Council should produce two different outcomes at the end of a run:

1. a clean final deliverable that is ready to hand to a human or downstream AI workflow
2. a preserved deliberation trace that keeps the council process available for audit, learning, and later analysis

The final deliverable should not read like a stitched transcript of proposal, critique, refinement, synthesis, and validation. It should read like the final answer.

The deliberation trace should preserve how Axiom, Sentinel, Forge, Vector, and the Collective reached that answer.

## Problem

The implementation already separated `result/` from `work/`, which was the right direction.

Before this change, the content inside `result/` still mixed two concerns:

- deliverable artifacts such as `plan.md` and `solution-design.md`
- process-oriented artifacts such as `debate-output.md`

This was most visible in debate mode, where `recommendation.md` pointed the reader back to `debate-output.md` instead of standing on its own as the final artifact.

That makes the result package less useful for direct delivery and pushes the user back into internal process material.

## Goal

At the end of the deliberation cycle, the system should generate:

- one primary deliverable per mode
- optional supporting deliverables that help execution
- one preserved trace package under `work/` for process inspection

The rule should be simple:

- `result/` is for the final answer
- `work/` is for how the council got there

## Proposal Summary

Keep the current stage flow:

1. Proposal
2. Critique
3. Refinement
4. Synthesis
5. Validation

After validation completes, Vector should synthesize a clean delivery artifact for the selected mode, and the Collective should validate that artifact as the package to approve.

At the same time, the system should preserve the full round-by-round trace for later analysis without making that trace the primary thing the user has to read.

## Proposed Artifact Model

### Result Package

`result/` should contain only delivery-oriented artifacts.

Recommended structure:

```text
result/
  summary.md
  <primary deliverable>
  <supporting deliverables>
```

`summary.md` remains a compact package manifest and approval summary. It is not the main deliverable.

### Trace Package

`work/` should continue to hold prompts, logs, and round outputs, but it should also gain an explicit trace artifact that is easy to inspect when we want to understand the council process.

Recommended additions:

```text
work/
  rounds/
  logs/
  session/
  synth/
    execution-summary.md
    deliberation-trace.md
    trace-index.json
```

This keeps the existing raw materials and adds one normalized trace view.

## Mode-Specific Deliverables

### Plan Mode

Primary deliverable:

- `result/plan.md`

Supporting deliverables:

- `result/implementation-outline.md`
- `result/tasks.json`

Expectation:

`plan.md` should read like the approved plan, not like a transcript. It can include synthesized rationale, but not stage-by-stage debate formatting.

### Design Mode

Primary deliverable:

- `result/solution-design.md`

Supporting deliverables:

- optional future files such as `decision-log.md`, `alternatives.md`, or `risks.md`

Expectation:

`solution-design.md` should present the final design, key decisions, tradeoffs, assumptions, and rollout implications in delivery-ready form.

### Spike Mode

Primary deliverable:

- `result/spike.md`

Supporting deliverables:

- optional future files such as `unknowns.md`, `hypotheses.md`, or `experiment-matrix.md`

Expectation:

`spike.md` should present the investigation outcome and the recommended next move, not the council transcript.

### Debate Mode

Primary deliverable:

- `result/recommendation.md`

Supporting deliverables:

- optional future files such as `consensus.md` or `minority-concerns.md`

Expectation:

`recommendation.md` must become a standalone final recommendation. It should summarize the issue, the considered positions, the chosen direction, why it won, and any unresolved minority concerns.

It should not tell the reader to open `debate-output.md` in order to understand the answer.

### Review Mode

Primary deliverable:

- `result/review-summary.md`

Supporting deliverables:

- `result/findings.md`
- `result/scorecard.json`
- `result/recommendation.md`

Expectation:

`review-summary.md` should be the delivery document. `findings.md` and `scorecard.json` remain useful supporting detail.

## Trace Requirements

The deliberation trace should preserve:

- stage name
- council identity
- participant label and model if present
- response classification such as actual, pending, or blocked
- path to the raw response file
- normalized round content for analysis

`work/synth/deliberation-trace.md` should provide one readable narrative package for internal analysis.

Suggested sections:

```text
# Deliberation Trace

## Ticket Summary
## Proposal
## Critique
## Refinement
## Synthesis
## Validation
## Final Deliverable References
```

`work/synth/trace-index.json` should make the trace machine-readable for future tooling.

## Proposed Workflow Changes

### 1. Make the final deliverable explicit

Refactor `createModeArtifacts()` so it produces:

- `primary_deliverable`
- `supporting_deliverables`
- `trace_artifacts`

The function should stop treating debate output as a peer to the final deliverable in `result/`.

### 2. Move process-oriented artifacts out of `result/`

`debate-output.md` should move to `work/synth/deliberation-trace.md` or become one section inside that file.

If we want a transition period for compatibility, we can keep writing `result/debate-output.md` for one release, but mark it as legacy and stop presenting it as the main output.

### 3. Synthesize final documents from consensus responses

For each mode, generate a delivery-ready document from the validated synthesis rather than dumping rendered stage responses into the result artifact.

In practice that means:

- preserve round responses in `work/rounds/`
- derive the final deliverable from the best validated synthesis
- keep rationale concise and reader-oriented

### 4. Update manifest metadata

The session manifest should expose:

- `primary_deliverable`
- `supporting_deliverables`
- `trace_artifacts`

That will let the shell and downstream automation show the correct file first.

### 5. Update approval UX

The approval step should point the user to the primary deliverable first.

Suggested next-action language:

- "Review `result/plan.md` and approve, request changes, or reject."
- "Review `result/solution-design.md` and approve, request changes, or reject."

Trace artifacts should remain available, but secondary.

### 6. Keep AWF export aligned with final artifacts

AWF export should continue to consume delivery artifacts first:

- plan uses `result/plan.md`
- design uses `result/solution-design.md`
- review can use `result/review-summary.md` and `result/findings.md`

Trace files should be optional context, not the default handoff surface.

## Implementation Steps

1. Add a trace builder that aggregates stage outputs into `work/synth/deliberation-trace.md` and `work/synth/trace-index.json`.
2. Refactor mode artifact generation so each mode yields one primary deliverable and optional supporting files.
3. Rewrite debate mode so `recommendation.md` is the final answer instead of a pointer to the trace.
4. Add `review-summary.md` and keep findings plus scorecard as support.
5. Update session manifest fields and interactive shell rendering to prioritize the primary deliverable.
6. Update approval, resume, and export flows to consume the new metadata.
7. Update tests to distinguish final deliverables from trace artifacts.

## Test Updates

Add or revise tests to prove:

- `result/` contains delivery artifacts only
- `work/synth/deliberation-trace.md` is created when council responses exist
- debate mode produces a standalone `recommendation.md`
- review mode produces `review-summary.md`
- approval and resume surfaces point to the primary deliverable first
- AWF export prefers primary deliverables and treats trace as optional context

## Migration Guidance

To reduce breakage:

- keep current file names where they already fit the model, such as `plan.md` and `solution-design.md`
- introduce new files only where the current output is too process-oriented
- consider a short compatibility window for `result/debate-output.md`

## Definition Of Done

This proposal is complete when the implementation ensures:

- every mode ends with a clean, standalone final deliverable
- the deliberation process remains fully inspectable
- `result/` is optimized for delivery
- `work/` is optimized for traceability
- users no longer need debate-oriented artifacts to understand the final answer

## Recommended Direction

Proceed with a dual-artifact model:

- a clean final deliverable in `result/`
- a preserved deliberation trace in `work/`

That gives us the best of both behaviors:

- a delivery-ready outcome for humans and downstream systems
- full council traceability when we want to inspect how the answer was formed
