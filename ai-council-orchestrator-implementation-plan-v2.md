# AI Council Orchestrator — Refined Full Implementation Plan
_Ready for direct execution by an AI coding agent_

## 1. Objective

Build a **PowerShell-based AI Council Orchestrator** that coordinates **2 or more AI CLIs** to collaboratively perform one of two major functions:

1. **Designer / Planner**
   - produce plans
   - produce designs
   - run spikes
   - run structured debates and reach a recommendation

2. **Reviewer / Evaluator**
   - review a repository against a ticket definition
   - assess whether implementation meets the intended goal
   - identify gaps, risks, quality issues, and missing acceptance coverage
   - produce comments, findings, and a score

The tool must provide:

- a **rich PowerShell CLI UX** with colors, icons, panels, summaries, and guided flows
- configurable and adaptable workflows
- support for **ticket definition input** from:
  - a Markdown file
  - a freeform prompt
  - a Jira URL
- optional **MCP integration** so Jira can be read and normalized into a local Markdown ticket file
- artifact-based execution with durable files
- final outputs that are directly usable by humans and follow-up AI agents

---

## 2. Refined Product Positioning

This tool is a **multi-agent engineering council console**.

It is not just “send the same prompt to several models.”

It is a configurable system that can act as:

- a **planner**
- a **designer**
- a **spike facilitator**
- a **debate and recommendation engine**
- a **critical implementation reviewer**

This means the same shell should support both:
- **solution creation**
- **solution assessment**

---

## 3. Core Input Model

The CLI must support three main ticket-definition entry paths.

## 3.1 Markdown Ticket File
The user provides an existing `.md` file with ticket definition.

Examples:
- story definition
- requirements doc
- design brief
- acceptance criteria package
- architecture task

## 3.2 Prompt / Freeform Requirement
The user provides a prompt directly in the CLI or via a text file.

The tool should normalize it into a local artifact such as:
- `ticket-definition.md`

## 3.3 Jira URL
The user provides a Jira URL.

The workflow then:
1. uses MCP integration to read the Jira ticket
2. extracts the relevant fields
3. generates a normalized Markdown artifact locally
4. uses that Markdown file as the canonical ticket-definition input for all subsequent rounds

This is important because the rest of the workflow should not depend on live Jira after normalization.

---

## 4. Canonical Input Artifact

Regardless of source, the orchestrator should normalize the requirement into a canonical local file:

```text
input/ticket-definition.md
```

Optional companion files:
- `input/extra-context.md`
- `input/constraints.md`
- `input/acceptance-criteria.md`
- `input/review-target.md`
- `input/debate-topic.md`

The system should prefer normalized files over raw remote inputs.

---

## 5. Required Product Modes

The product must support the following first-class modes.

## 5.1 plan
Purpose:
Generate a practical implementation plan from a ticket definition.

Output emphasis:
- execution phases
- task decomposition
- dependencies
- risks
- sequencing
- verification approach

Use when:
- the requirement is understood enough
- the goal is to produce a ready-to-execute implementation roadmap

## 5.2 design
Purpose:
Produce a technical design, architecture proposal, or design alternatives.

Output emphasis:
- architecture options
- tradeoffs
- major decisions
- assumptions
- interfaces
- impact areas
- recommended approach

Use when:
- the requirement still needs solution shaping
- the main output is a design or solution definition

## 5.3 spike
Purpose:
Investigate uncertainty, evaluate alternatives, or reduce technical ambiguity.

Output emphasis:
- unknowns
- hypotheses
- experiments
- options
- constraints
- findings to gather
- recommendation after investigation framing

Use when:
- there is ambiguity or technical uncertainty
- the team needs a structured research/design spike

### Note on spike vs design
Spike should remain a **separate mode**, even though it is closely related to design.

Reason:
- design assumes the system is trying to define a target solution
- spike assumes the system is trying to reduce uncertainty before finalizing the solution

So spike is not just a subtype of design. It deserves its own prompt behavior, outputs, and evaluation criteria.

## 5.4 debate
Purpose:
Allow the council to debate a topic, prompt, or Markdown input and return a consensus recommendation.

Input can be:
- a topic
- a question
- a Markdown file
- a prompt
- a decision request

Output emphasis:
- arguments for and against
- key tensions
- tradeoffs
- strongest positions
- rebuttals
- consensus recommendation
- minority concerns if unresolved

Use when:
- the user wants a council recommendation
- the user wants reasoned contrast before convergence
- the user wants a decision memo, not a detailed implementation plan

## 5.5 review
Purpose:
Critically review a repository and determine whether its implementation meets the ticket goal.

Inputs:
- normalized ticket definition
- repository path or target folder
- optional branch, scope, or files to prioritize

Output emphasis:
- alignment to ticket goals
- acceptance criteria coverage
- gaps
- quality issues
- risks
- code/design concerns
- strengths
- score
- recommendation

Use when:
- the user wants to assess existing implementation
- the user wants a reviewer, not a designer

This is a critical first-class capability and should be designed explicitly, not bolted on.

---

## 6. Refined Product Vision

The orchestrator should support two major operating families:

### 6.1 Creation Family
- `plan`
- `design`
- `spike`
- `debate`

### 6.2 Evaluation Family
- `review`

The UX should make it obvious which family the user is entering.

---

## 7. Product Principles

### 7.1 Normalize Inputs Early
All raw input sources must be converted into stable local artifacts before the council begins.

### 7.2 Artifact over Transcript
Store all meaningful state in files.

### 7.3 Contrast before Convergence
Independent reasoning first, critique second, synthesis later.

### 7.4 Mode-Specific Output Contracts
Each mode should produce outputs tailored to its purpose.

### 7.5 Review Must Be Evidence-Based
Review mode must ground findings in repository evidence and ticket expectations.

### 7.6 UX Must Guide, Not Overwhelm
The CLI should feel polished and powerful, but not noisy.

### 7.7 Config First
Modes, councils, providers, prompts, and scoring policies should be configurable.

---

## 8. Refined High-Level Architecture

```text
PowerShell UX Shell
    |
    +-- Input Intake Layer
    |     +-- Markdown Loader
    |     +-- Prompt Intake
    |     +-- Jira URL Intake
    |     +-- MCP Jira Reader
    |     +-- Ticket Normalizer
    |
    +-- Session Controller
    |     +-- Workflow Engine
    |     +-- Mode Resolver
    |     +-- Round Manager
    |     +-- State Manager
    |
    +-- Provider Layer
    |     +-- Codex CLI Adapter
    |     +-- Claude CLI Adapter
    |     +-- Gemini CLI Adapter
    |     +-- Copilot CLI Adapter
    |
    +-- Prompt Layer
    |     +-- Prompt Templates
    |     +-- Role Templates
    |     +-- Mode Templates
    |     +-- Output Contracts
    |
    +-- Review Layer
    |     +-- Repo Scanner
    |     +-- Review Packager
    |     +-- Evidence Mapper
    |     +-- Scoring Engine
    |
    +-- Synthesis / Validation
    |     +-- Merge Engine
    |     +-- Conflict Tracker
    |     +-- Consensus Builder
    |     +-- Output Validator
    |
    +-- Artifact Layer
    |     +-- Workspace Creator
    |     +-- Markdown Writer
    |     +-- JSON Writer
    |     +-- Logs / Trace
    |
    +-- Config Layer
          +-- Providers
          +-- Councils
          +-- Workflows
          +-- Review Rubrics
          +-- UX Settings
```

---

## 9. Recommended Repository Structure

```text
ai-council-orchestrator/
├── README.md
├── Invoke-AICouncil.ps1
├── bootstrap.ps1
├── config/
│   ├── app.settings.json
│   ├── ux.settings.json
│   ├── providers.json
│   ├── mcp.settings.json
│   ├── councils/
│   │   ├── default-council.json
│   │   ├── design-council.json
│   │   ├── spike-council.json
│   │   ├── debate-council.json
│   │   └── review-council.json
│   ├── workflows/
│   │   ├── plan.json
│   │   ├── design.json
│   │   ├── spike.json
│   │   ├── debate.json
│   │   └── review.json
│   └── rubrics/
│       ├── design-rubric.json
│       ├── plan-rubric.json
│       ├── spike-rubric.json
│       ├── debate-rubric.json
│       └── review-rubric.json
├── prompts/
│   ├── shared/
│   │   ├── output-contract.md
│   │   ├── critique-rubric.md
│   │   ├── synthesis-rubric.md
│   │   ├── debate-rubric.md
│   │   ├── review-rubric.md
│   │   └── scoring-guidance.md
│   ├── roles/
│   │   ├── planner.md
│   │   ├── architect.md
│   │   ├── challenger.md
│   │   ├── spike-investigator.md
│   │   ├── reviewer.md
│   │   ├── critic.md
│   │   ├── consensus-builder.md
│   │   └── synthesizer.md
│   └── modes/
│       ├── plan.md
│       ├── design.md
│       ├── spike.md
│       ├── debate.md
│       └── review.md
├── src/
│   ├── Core/
│   ├── Input/
│   │   ├── TicketLoader.ps1
│   │   ├── PromptNormalizer.ps1
│   │   ├── JiraInput.ps1
│   │   ├── McpJiraReader.ps1
│   │   └── TicketNormalizer.ps1
│   ├── Providers/
│   ├── Review/
│   │   ├── RepoScope.ps1
│   │   ├── EvidenceMap.ps1
│   │   ├── Scorecard.ps1
│   │   └── ReviewSummary.ps1
│   ├── UX/
│   ├── Artifacts/
│   ├── Validation/
│   └── Utils/
├── schemas/
│   ├── ticket-definition.schema.json
│   ├── proposal.schema.json
│   ├── critique.schema.json
│   ├── synthesis.schema.json
│   ├── debate.schema.json
│   ├── review.schema.json
│   └── final-package.schema.json
├── examples/
├── tests/
└── docs/
```

---

## 10. Input Intake Design

## 10.1 Input Selection UX
The CLI should offer a guided intake menu:

- `1) Markdown ticket definition`
- `2) Prompt / freeform requirement`
- `3) Jira URL`
- `4) Resume previous session`

If `Jira URL` is selected:
- validate URL shape
- confirm MCP availability
- read ticket data through MCP
- generate normalized `ticket-definition.md`

## 10.2 Ticket Normalization Contract
The normalized ticket-definition Markdown should contain sections such as:

- title
- identifier
- source
- summary
- business goal
- technical objective
- scope
- out of scope
- acceptance criteria
- dependencies
- risks
- assumptions
- open questions
- reference links

This lets all modes consume the same normalized structure.

---

## 11. Refined Mode Contracts

## 11.1 Plan Mode Contract
Plan mode should produce:
- final-plan.md
- tasks.json
- dependencies.md
- risks.md
- open-questions.md
- summary.md

Evaluation criteria:
- clarity
- sequencing
- practicality
- AC coverage
- implementation readiness

## 11.2 Design Mode Contract
Design mode should produce:
- design.md
- decision-log.md
- alternatives.md
- risks.md
- assumptions.md
- open-questions.md
- summary.md

Evaluation criteria:
- architectural soundness
- tradeoff reasoning
- requirement alignment
- extensibility
- feasibility

## 11.3 Spike Mode Contract
Spike mode should produce:
- spike-plan.md
- unknowns.md
- hypotheses.md
- experiment-matrix.md
- findings-to-collect.md
- recommendation.md

Evaluation criteria:
- uncertainty coverage
- quality of investigation framing
- feasibility of experiments
- value of expected learning

## 11.4 Debate Mode Contract
Debate mode should produce:
- debate-summary.md
- positions.md
- rebuttals.md
- consensus.md
- minority-concerns.md
- recommendation.md

Evaluation criteria:
- fairness of contrast
- strength of reasoning
- quality of synthesis
- clarity of recommendation

## 11.5 Review Mode Contract
Review mode should produce:
- review-summary.md
- scorecard.json
- findings.md
- comments.md
- gaps.md
- strengths.md
- acceptance-coverage.md
- recommendation.md

Evaluation criteria:
- evidence quality
- ticket alignment
- correctness of gap detection
- usefulness of recommendations
- scoring consistency

---

## 12. Review Mode Design

Review mode is special and must be designed carefully.

## 12.1 Inputs
Required:
- `ticket-definition.md`
- repository path

Optional:
- target branch
- repo subpath
- changed files list
- commit range
- architecture docs
- design baseline

## 12.2 Review Goal
Determine whether the implementation in the repository achieves the ticket goal and how well it does so.

## 12.3 Review Questions
The review council should answer:

1. Does the implementation satisfy the intended objective?
2. Does it satisfy the ticket’s acceptance criteria?
3. What is missing?
4. What is weak, risky, or unclear?
5. What is well done?
6. What score should it receive?
7. What should happen next?

## 12.4 Review Scoring
The scoring engine should support weighted categories such as:

- goal alignment
- acceptance criteria coverage
- technical correctness
- design quality
- maintainability
- testability
- completeness
- risk handling

Suggested output:
- total score
- category scores
- confidence level
- blocking findings count
- non-blocking findings count

## 12.5 Review Comment Style
Comments should be structured and actionable.

Each comment should ideally include:
- id
- severity
- category
- affected area
- finding
- why it matters
- suggested fix
- linked acceptance criterion if applicable

---

## 13. Debate Mode Design

Debate mode must support a more explicit council-discussion format.

## 13.1 Input Types
Debate mode should accept:
- a question
- a topic
- a Markdown memo
- a recommendation request
- a design choice comparison

## 13.2 Debate Stages
Recommended stages:
1. initial positions
2. strongest arguments
3. cross-critique
4. rebuttal
5. convergence
6. consensus statement

## 13.3 Debate Output
The final answer should not just be “what everyone said.”

It should contain:
- strongest arguments on each side
- what changed through debate
- what the council recommends now
- why
- what remains uncertain

---

## 14. Council Types by Mode

Each mode should have a preferred council topology.

## 14.1 Plan Council
Roles:
- planner
- implementer
- challenger
- synthesizer

## 14.2 Design Council
Roles:
- architect
- critic
- challenger
- synthesizer

## 14.3 Spike Council
Roles:
- investigator
- challenger
- pragmatist
- synthesizer

## 14.4 Debate Council
Roles:
- advocate-A
- advocate-B
- critic
- consensus-builder

## 14.5 Review Council
Roles:
- reviewer
- acceptance-checker
- quality-critic
- synthesizer

These should be configurable, but the product should ship with sensible defaults.

---

## 15. Refined Round Design by Mode

## 15.1 Standard Creation Modes
Applies to:
- plan
- design
- spike

Recommended rounds:
1. proposal
2. critique
3. refinement
4. synthesis
5. validation

## 15.2 Debate Mode
Recommended rounds:
1. opening positions
2. challenge
3. rebuttal
4. convergence
5. consensus

## 15.3 Review Mode
Recommended rounds:
1. ticket understanding
2. repo evidence review
3. gap analysis
4. scoring
5. synthesis

Review mode must include an explicit evidence-mapping step.

---

## 16. Workspace Structure Per Run

```text
.runs/<timestamp>-<slug>/
├── input/
│   ├── ticket-definition.md
│   ├── raw-prompt.md
│   ├── jira-source.json
│   ├── constraints.md
│   ├── acceptance-criteria.md
│   ├── debate-topic.md
│   └── review-target.md
├── repo/
│   ├── scope.json
│   ├── file-index.json
│   └── evidence-map.json
├── session/
│   ├── session.json
│   ├── effective-config.json
│   └── timeline.ndjson
├── rounds/
├── synth/
├── final/
└── logs/
```

For review mode, repo-scoped artifacts are mandatory.

---

## 17. UX / UI Refinements

The CLI should feel like a modern guided engineering console.

## 17.1 Entry Experience
Show:
- product banner
- selected mode family
- provider availability
- intake options

## 17.2 Guided Mode Selection
Present clear choices:
- `Plan`
- `Design`
- `Spike`
- `Debate`
- `Review`

Each with a one-line explanation.

## 17.3 Input Source Selection
Show:
- markdown
- prompt
- Jira URL
- resume

## 17.4 Rich Session Summary
Show:
- mode
- input source
- normalized ticket path
- council preset
- providers
- round structure
- output path

## 17.5 Review UX
For review mode, show:
- repo path
- scope mode
- branch if provided
- ticket id/title
- rubric
- scoring categories

## 17.6 Debate UX
For debate mode, show:
- topic
- sides or perspectives
- consensus target
- recommendation style

---

## 18. Config Design Refinements

## 18.1 Workflow Config Must Include
- mode name
- family
- rounds
- required inputs
- optional inputs
- output contract
- council preset
- validation policy

## 18.2 Review Rubric Config
The review rubric must be fully configurable:
- categories
- weights
- score bands
- severity policy
- blocking threshold

## 18.3 MCP Config
The system should define:
- enabled flag
- Jira reader command
- timeout
- parsing strategy
- normalization mapping

---

## 19. Provider and Adapter Design

Provider abstraction remains required.

Each provider adapter must support:
- prompt file input
- output file capture
- metadata capture
- timeout
- normalized result structure

For debate and review, providers may require different role prompts, but the adapter contract should remain stable.

---

## 20. Prompt System Refinements

Prompt assembly should combine:

- role prompt
- mode prompt
- round prompt
- ticket definition
- additional context
- output contract
- scoring or critique rubric
- prior round artifacts if needed

For review mode, prompt assembly must include:
- ticket-definition.md
- review rubric
- repo evidence summary
- optional changed-files scope

For debate mode, prompt assembly must include:
- debate topic
- requested decision
- required consensus style

---

## 21. Review Evidence Model

Review mode should not blindly pass a whole repository if avoidable.

The tool should create an evidence pack containing:
- repo summary
- relevant file list
- changed files if available
- architecture-related files
- tests found
- docs found
- targeted snippets or file references if implemented later

The review process should be designed so future enhancements can add:
- diff-based review
- branch comparison
- PR-based review
- selective file focus

---

## 22. Merge / Consensus Design

## 22.1 Creation Modes
Use structured synthesis with:
- accepted ideas
- rejected ideas
- conflicts
- final chosen path

## 22.2 Debate Mode
Use consensus-specific synthesis:
- strongest argument retained
- strongest counterargument retained
- recommendation
- minority concerns

## 22.3 Review Mode
Use evidence-weighted synthesis:
- findings grouped by severity and category
- score justification
- final go / revise / fail-style recommendation if configured

---

## 23. Final Artifact Sets by Mode

## 23.1 Plan Final Package
```text
final/
├── final-plan.md
├── tasks.json
├── dependencies.md
├── risks.md
├── open-questions.md
└── summary.md
```

## 23.2 Design Final Package
```text
final/
├── design.md
├── decision-log.md
├── alternatives.md
├── assumptions.md
├── risks.md
└── summary.md
```

## 23.3 Spike Final Package
```text
final/
├── spike-plan.md
├── unknowns.md
├── hypotheses.md
├── experiment-matrix.md
├── recommendation.md
└── summary.md
```

## 23.4 Debate Final Package
```text
final/
├── debate-summary.md
├── positions.md
├── rebuttals.md
├── consensus.md
├── minority-concerns.md
└── recommendation.md
```

## 23.5 Review Final Package
```text
final/
├── review-summary.md
├── scorecard.json
├── findings.md
├── comments.md
├── gaps.md
├── strengths.md
├── acceptance-coverage.md
└── recommendation.md
```

---

## 24. Implementation Phases

## Phase 1 — Foundation
- repo scaffold
- config loading
- session creation
- workspace management
- basic UX shell

## Phase 2 — Input Intake
- markdown ticket loading
- prompt normalization
- Jira URL flow
- MCP ticket read
- ticket-definition.md normalization

## Phase 3 — Provider Layer
- provider abstraction
- one real provider adapter
- safe process invocation
- output normalization

## Phase 4 — Creation Workflows
- plan mode
- design mode
- spike mode
- shared synthesis flow

## Phase 5 — Debate Workflow
- opening positions
- rebuttal flow
- consensus generation
- recommendation packaging

## Phase 6 — Review Workflow
- repository targeting
- evidence packaging
- review prompts
- scorecard generation
- findings synthesis

## Phase 7 — UX Polish
- richer panels
- mode-specific summaries
- improved guided prompts
- quiet/verbose modes
- better error handling

## Phase 8 — Hardening
- resume support
- malformed output recovery
- tests
- docs
- examples

---

## 25. Detailed Task Breakdown for AI Agent Execution

### Workstream A — Core Infrastructure
- create folder structure
- add entrypoint
- add session manifest
- add config validation
- add strict error handling

### Workstream B — UX Framework
- create theme helpers
- create icon system with fallback
- create panels and summaries
- create intake menus
- create round progress rendering

### Workstream C — Input Intake
- implement markdown loader
- implement freeform prompt capture
- implement prompt-to-md normalization
- implement Jira URL handler
- implement MCP ticket fetcher
- implement normalized ticket-definition writer

### Workstream D — Provider Adapters
- provider base contract
- safe process runner
- standardized metadata
- one adapter first, then more

### Workstream E — Creation Modes
- implement plan mode
- implement design mode
- implement spike mode
- add synthesis and validation

### Workstream F — Debate Mode
- implement debate round logic
- implement position and rebuttal contracts
- implement consensus builder
- implement recommendation output

### Workstream G — Review Mode
- implement repo path intake
- implement repo evidence pack
- implement review prompt contracts
- implement findings and scorecard generation
- implement final recommendation synthesis

### Workstream H — Artifact and Resume
- stable file naming
- metadata files
- timeline logs
- resumable rounds
- degraded mode behavior

### Workstream I — Quality and Docs
- sample configs
- sample ticket-definition.md
- review examples
- troubleshooting docs
- golden tests

---

## 26. Recommended Initial UX Flow

```text
1. Launch tool
2. Show banner
3. Check provider and MCP availability
4. Select mode: plan / design / spike / debate / review
5. Select input source: md / prompt / Jira URL / resume
6. Normalize input into ticket-definition.md
7. If review mode, ask for repo path and optional scope
8. Show session summary
9. Execute mode-specific council rounds
10. Generate final artifacts
11. Show final summary and next actions
```

---

## 27. Definition of Done

The product is complete for v1 when:

1. The CLI supports input from Markdown, prompt, and Jira URL.
2. Jira URL intake can normalize the ticket into `ticket-definition.md`.
3. The CLI supports modes:
   - plan
   - design
   - spike
   - debate
   - review
4. The creation modes produce structured final artifacts.
5. Debate mode produces a consensus recommendation.
6. Review mode evaluates a repository against the ticket and outputs findings plus a score.
7. The system is config-driven.
8. The terminal UX is rich, guided, and readable.
9. Failures are logged clearly and resume is supported.
10. Outputs are usable by both humans and AI agents.

---

## 28. Recommended v1 Defaults

- keep spike as a separate mode
- ship with five modes
- default to normalized local ticket-definition.md
- default to artifact-based context passing
- default review scoring with weighted rubric
- default debate consensus with minority concerns section
- default interactive mode with non-interactive override
- default Unicode icons with fallback

---

## 29. Final Guidance for the AI Coding Agent

When implementing this system:

- treat **input normalization** as foundational
- keep **spike** separate from design
- design **debate** as a true consensus workflow, not a renamed critique round
- design **review** as an evidence-based evaluator, not a plan mode variant
- make the UX mode-aware and explicit
- keep outputs structured and reusable
- optimize for extensibility and stable contracts

This product should become a reusable multi-agent engineering console for both **solution design** and **solution review**.
