# Agents

AI Council uses named agents instead of generic roles so prompts, logs, docs, and run artifacts all speak the same language.

## Core Agents

### Axiom

**Primary focus:** proposal and intake

- Shapes the initial problem statement
- Clarifies assumptions and constraints
- Defines the scope of the work so later stages can challenge it cleanly

Use Axiom when the task is still ambiguous and needs a strong starting frame.

### Sentinel

**Primary focus:** critique and validation

- Challenges assumptions
- Surfaces risks, gaps, and weak reasoning
- Verifies the final result is ready to trust

Use Sentinel when the work needs pressure-testing before adoption.

### Forge

**Primary focus:** refinement and implementation framing

- Improves proposals after critique
- Resolves contradictions
- Strengthens feasibility and execution details

Use Forge when a promising direction needs to be made sturdier and more actionable.

### Vector

**Primary focus:** planning and synthesis

- Integrates multiple perspectives
- Chooses the best path through competing ideas
- Produces the unified plan or final synthesis

Use Vector when several threads need to converge into one coherent direction.

## Deliberation Cycle

The council works through a repeatable convergence cycle:

1. Proposal
2. Critique
3. Refinement
4. Synthesis
5. Validation

Multiple agents may participate in the same phase, especially proposal and validation, before converging on a final result.

## Naming Rules

Use these identities consistently:

- `Axiom`
- `Vector`
- `Forge`
- `Sentinel`

Avoid falling back to generic names like `planner`, `reviewer`, `builder`, or `parser` in user-facing documentation when the council identity is intended.

## Practical Mapping

| Function | Agent |
| --- | --- |
| Intake / Proposal | Axiom |
| Planning / Synthesis | Vector |
| Refinement / Implementation Framing | Forge |
| Review / Validation | Sentinel |

## Artifact Guidance

When writing logs, prompts, or docs:

- keep agent names consistent across the repo
- make the current phase of deliberation explicit
- prefer agent identity plus responsibility over generic role labels

Example log style:

```text
[ AXIOM ] Framing the proposal...
[ SENTINEL ] Challenging assumptions...
[ FORGE ] Refining the approach...
[ VECTOR ] Synthesizing the final direction...
```
