import path from "node:path";
import readline from "node:readline/promises";

import { hasCompletedFirstRun, loadRepoSettings, saveRepoSettings } from "../core/config.js";
import { getCouncilVisualReference, getDeliberationCycle } from "../core/identity.js";
import { getStatus, runCouncil, toolingStatus } from "../core/workflow.js";

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m"
};

function paint(text, ...styles) {
  return `${styles.join("")}${text}${ANSI.reset}`;
}

function strong(text) {
  return paint(text, ANSI.bold);
}

function accent(text) {
  return paint(text, ANSI.bold, ANSI.cyan);
}

function muted(text) {
  return paint(text, ANSI.dim, ANSI.gray);
}

function success(text) {
  return paint(text, ANSI.bold, ANSI.green);
}

function warn(text) {
  return paint(text, ANSI.bold, ANSI.yellow);
}

function info(text) {
  return paint(text, ANSI.blue);
}

function icon(name) {
  const icons = {
    app: "AIC",
    next: "[>]",
    info: "[i]",
    ok: "[ok]",
    warn: "[!]",
    tools: "[tools]",
    run: "[run]"
  };
  return icons[name] ?? "[*]";
}

function truncate(value, width) {
  const text = String(value ?? "");
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 3))}...`;
}

function panel(title, rows = []) {
  const width = 92;
  console.log(strong(`+${"-".repeat(width - 2)}+`));
  console.log(strong(`| ${truncate(title, width - 4).padEnd(width - 4)} |`));
  console.log(strong(`+${"-".repeat(width - 2)}+`));
  for (const row of rows) {
    console.log(`| ${truncate(row, width - 4).padEnd(width - 4)} |`);
  }
  console.log(strong(`+${"-".repeat(width - 2)}+`));
}

function clearScreen() {
  process.stdout.write("\u001bc");
}

async function waitForContinue(rl, label = "Press Enter to continue...") {
  await rl.question(label);
}

function writeBanner() {
  const lines = [
    "    _    ___    ______                     _ __ ",
    "   / \\  |_ _|  / ____/___  __  _______  __(_) / ",
    "  / _ \\  / /  / /   / __ \\/ / / / __ \\/ / / /  ",
    " / ___ \\/ /  / /___/ /_/ / /_/ / / / / /_/ /   ",
    "/_/  /_/___/  \\____/\\____/\\__,_/_/ /_/\\__,_/_/  ",
    "AI Council"
  ];

  for (const line of lines) {
    console.log(accent(line));
  }
}

function renderWelcome(tools, settings, repoPath) {
  clearScreen();
  console.log("");
  writeBanner();
  panel(`${icon("app")} Welcome`, [
    "AI Council is a multi-agent engineering console for proposal, critique, refinement, synthesis, and validation.",
    "",
    `Target repo: ${repoPath}`,
    `Output root: ${settings.output_root ?? ".ai-council/result"}`,
    `Detected providers: ${tools.providers.map((provider) => `${provider.name}:${provider.available ? "ready" : "missing"}`).join(", ")}`,
    "",
    "What you can expect:",
    "- a guided shell with recommended next steps and slash commands",
    "- durable result artifacts separated from intermediate work files",
    "- per-repo deliberation settings and provider startup preflight"
  ]);
  console.log(muted("Press Enter to continue into configuration and the home screen."));
}

function renderHelp() {
  panel(`${icon("tools")} Shell Commands`, [
    "/home       Show the home screen",
    "/status     Show the latest run summary",
    "/configure  Reconfigure repo output folder and stage participants",
    "/run        Start a new deliberation run",
    "/artifacts  Show latest result artifacts",
    "/cycle      Show the deliberation cycle",
    "/clear      Clear the screen",
    "/help       Show this help",
    "/exit       Leave the shell"
  ]);
}

function renderCycle() {
  panel(`${icon("info")} Deliberation Cycle`, [
    ...getDeliberationCycle().flatMap((entry) => [
      `${strong(entry.stage)} led by ${entry.leader}`,
      entry.description
    ])
  ]);
}

function renderArtifacts(status) {
  if (!status.has_runs) {
    panel(`${icon("warn")} Artifacts`, [
      "No runs have been created yet.",
      `Suggested command: ai-council run --mode plan --prompt "Describe the work"`
    ]);
    return;
  }

  panel(`${icon("info")} Latest Artifacts`, [
    `Run path: ${status.latest_run}`,
    `Output root: ${status.output_root}`,
    `Mode: ${status.mode}`,
    `Family: ${status.family}`,
    `Final files: ${status.final_files.length > 0 ? status.final_files.join(", ") : "(none)"}`,
    `Next action: ${status.recommended_action}`
  ]);
}

function renderHome(status, settings, repoPath) {
  clearScreen();
  writeBanner();

  panel(`${icon("run")} Repo Overview`, [
    `Target repo: ${repoPath}`,
    `Output root: ${settings.output_root ?? ".ai-council/result"}`,
    `Default participant: ${settings.default_participant?.label ?? settings.default_provider ?? "(not set)"}`,
    `Auto launch: ${settings.auto_launch ? "enabled" : "disabled"}`,
    `First-time setup: ${settings.first_run_complete ? success("complete") : warn("pending")}`
  ]);

  panel(`${icon("info")} Council Identities`, getCouncilVisualReference().map((entry) => `${entry.name}: ${entry.function}`));
  panel(`${icon("tools")} Council Agents`, (settings.council_agents ?? []).length > 0
    ? settings.council_agents.map((agent, index) => `${index + 1}. ${agent.label} -> ${agent.provider}${agent.model ? ` [${agent.model}]` : ""}`)
    : ["No council agents configured yet."]);

  if (!status.has_runs) {
    panel(`${icon("next")} Next Steps`, [
      `${icon("next")} Recommended: ${accent("Create your first council run")}`,
      "Why: there is no previous deliberation output yet",
      `${icon("info")} Command: ${info("ai-council run --mode plan --prompt \"Describe the work\"")}`,
      "",
      "1. Start a new run",
      "2. Configure this repo",
      "3. Show cycle",
      "4. Help",
      "5. Exit"
    ]);
  } else {
    panel(`${icon("next")} Latest Run`, [
      `Mode: ${status.mode}`,
      `Title: ${status.title ?? "(untitled)"}`,
      `Latest run: ${status.latest_run}`,
      `Output root: ${status.output_root}`,
      `${icon("next")} Recommended: ${accent("Inspect the latest result artifacts or launch a new run")}`,
      `Why: ${status.recommended_action}`
    ]);
    panel(`${icon("next")} Next Steps`, [
      "1. Start a new run",
      "2. Show latest artifacts",
      "3. Configure this repo",
      "4. Show cycle",
      "5. Help",
      "6. Exit"
    ]);
  }

  console.log("");
  console.log(muted("Use numbers for guided actions or slash commands for speed: /help /home /status /configure /run /artifacts /cycle /exit"));
}

async function chooseProviders(rl, choices, label, minimum = 1, fallbackIndexes = [0]) {
  const response = (await rl.question(`${label} provider numbers (comma separated)> `)).trim();
  const selected = response
    .split(",")
    .map((value) => Number(value.trim()) - 1)
    .filter((index) => !Number.isNaN(index))
    .map((index) => choices[index])
    .filter(Boolean)
    .map((provider) => provider.name);

  const finalList = selected.length >= minimum
    ? selected
    : fallbackIndexes.map((index) => choices[index]?.name).filter(Boolean);

  return [...new Set(finalList)];
}

function parseNumberSelection(input, min, max) {
  if (!String(input ?? "").trim()) {
    return null;
  }

  const value = Number.parseInt(String(input).trim(), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }

  return value;
}

async function promptForNumberInRange(rl, prompt, min, max, defaultValue = null) {
  while (true) {
    const suffix = defaultValue !== null ? ` [${defaultValue}]` : "";
    const input = (await rl.question(`${prompt}${suffix}> `)).trim();
    if (!input && defaultValue !== null) {
      return defaultValue;
    }

    const selected = parseNumberSelection(input, min, max);
    if (selected !== null) {
      return selected;
    }

    console.log(warn(`Select a number between ${min} and ${max}.`));
  }
}

async function promptForChoice(rl, prompt, choices, defaultValue) {
  const normalizedChoices = choices.map((choice) => String(choice).trim()).filter(Boolean);
  const defaultChoice = normalizedChoices.includes(defaultValue) ? defaultValue : normalizedChoices[0];

  while (true) {
    const input = (await rl.question(`${prompt} [${normalizedChoices.join("|")}] (${defaultChoice})> `)).trim();
    if (!input) {
      return defaultChoice;
    }

    const selected = normalizedChoices.find((choice) => choice.toLowerCase() === input.toLowerCase());
    if (selected) {
      return selected;
    }

    console.log(warn(`Select one of: ${normalizedChoices.join(", ")}.`));
  }
}

async function promptForAgentList(rl, label, councilAgents, minimum = 1, fallbackIndexes = [0]) {
  while (true) {
    const response = (await rl.question(`${label} agent numbers (comma separated)> `)).trim();
    if (!response) {
      const fallback = fallbackIndexes.map((index) => councilAgents[index]?.id).filter(Boolean);
      if (fallback.length >= minimum) {
        return fallback;
      }
    }

    const parts = response.split(",").map((value) => value.trim()).filter(Boolean);
    const invalid = parts.some((value) => parseNumberSelection(value, 1, councilAgents.length) === null);
    if (invalid) {
      console.log(warn(`Select valid agent numbers between 1 and ${councilAgents.length}.`));
      continue;
    }

    const selected = [...new Set(parts.map((value) => councilAgents[Number.parseInt(value, 10) - 1]?.id).filter(Boolean))];
    if (selected.length >= minimum) {
      return selected;
    }

    console.log(warn(`Select at least ${minimum} agent${minimum === 1 ? "" : "s"} for ${label.toLowerCase()}.`));
  }
}

async function chooseProviderFromList(rl, choices, existingProvider = null, agentIndex = 0) {
  panel(`${icon("tools")} Council Agent ${agentIndex + 1} CLI`, choices.map((provider, index) =>
    `${index + 1}. ${provider.name} (${provider.available ? "ready" : "missing"})`
  ));
  const fallbackIndex = Math.max(0, choices.findIndex((provider) => provider.name === existingProvider));
  const defaultChoice = fallbackIndex >= 0 ? fallbackIndex + 1 : 1;
  const selected = await promptForNumberInRange(rl, `Agent ${agentIndex + 1} provider number`, 1, choices.length, defaultChoice);
  return choices[selected - 1] ?? choices[fallbackIndex] ?? choices[0];
}

async function chooseModelFromList(rl, provider, existingModel = null, agentIndex = 0) {
  const models = Array.isArray(provider?.models) ? provider.models : [];
  if (models.length === 0) {
    return (await rl.question(`Agent ${agentIndex + 1} model${existingModel ? ` [${existingModel}]` : " (optional)"}> `)).trim() || existingModel || "";
  }

  panel(`${icon("tools")} ${provider.name} Models`, [
    ...models.map((model, index) => `${index + 1}. ${model}`),
    `${models.length + 1}. Custom model`,
    `${models.length + 2}. No model`
  ]);

  const matchedIndex = models.findIndex((model) => model === existingModel);
  const defaultChoice = existingModel
    ? (matchedIndex >= 0 ? matchedIndex + 1 : models.length + 1)
    : models.length + 2;
  const selectedIndex = (await promptForNumberInRange(rl, `Agent ${agentIndex + 1} model number`, 1, models.length + 2, defaultChoice)) - 1;

  if (selectedIndex >= 0 && selectedIndex < models.length) {
    return models[selectedIndex];
  }

  if (selectedIndex === models.length) {
    return (await rl.question(`Custom model${existingModel ? ` [${existingModel}]` : ""}> `)).trim() || existingModel || "";
  }

  return "";
}

async function configureCouncilAgents(rl, choices, existingAgents = []) {
  const currentCount = existingAgents.length > 0 ? existingAgents.length : 2;
  const countInput = (await rl.question(`How many council agents? [${currentCount}]> `)).trim();
  const agentCount = Math.max(1, Number.parseInt(countInput || String(currentCount), 10) || currentCount);
  const councilAgents = [];

  for (let index = 0; index < agentCount; index += 1) {
    const existing = existingAgents[index] ?? {};
    panel(`${icon("tools")} Council Agent ${index + 1}`, [
      "Choose the CLI and optional model for this council seat.",
      "Using the same CLI twice with different models creates two distinct agents.",
      "Using the same CLI and same model twice also creates two distinct council agents."
    ]);
    const provider = await chooseProviderFromList(rl, choices, existing.provider, index);
    const model = await chooseModelFromList(rl, provider, existing.model, index);
    const labelDefault = [provider?.name, model].filter(Boolean).join(" / ") || `agent-${index + 1}`;
    const label = (await rl.question(`Agent ${index + 1} label [${existing.label ?? labelDefault}]> `)).trim() || existing.label || labelDefault;
    councilAgents.push({
      id: `agent-${index + 1}`,
      provider: provider?.name ?? existing.provider ?? "manual",
      model: model || null,
      label
    });
  }

  return councilAgents;
}

async function chooseCouncilAgents(rl, councilAgents, label, minimum = 1, fallbackIndexes = [0]) {
  const rows = councilAgents.map((agent, index) => `${index + 1}. ${agent.label} -> ${agent.provider}${agent.model ? ` [${agent.model}]` : ""}`);
  panel(`${icon("tools")} ${label} Participants`, rows);
  return promptForAgentList(rl, label, councilAgents, minimum, fallbackIndexes);
}

async function configureWorkspace(repoPath, rl, tools, existingSettings = {}) {
  clearScreen();
  panel(`${icon("tools")} Configure Repo`, [
    "Set the output folder and stage participants for this target repo.",
    `Repo: ${repoPath}`,
    `Default output folder: ${existingSettings.output_root ?? ".ai-council/result"}`
  ]);

  const outputInput = (await rl.question("Output folder [.ai-council/result]> ")).trim();
  const outputRoot = outputInput || existingSettings.output_root || ".ai-council/result";

  const choices = tools.providers.filter((provider) => provider.enabled);
  panel(`${icon("tools")} Providers`, choices.map((provider, index) => `${index + 1}. ${provider.name} (${provider.available ? "ready" : "missing"})`));

  const councilAgents = await configureCouncilAgents(rl, choices, existingSettings.council_agents ?? []);
  const proposal = await chooseCouncilAgents(rl, councilAgents, "Proposal", 2, [0, 1]);
  const critique = await chooseCouncilAgents(rl, councilAgents, "Critique", 1, [0]);
  const refinement = await chooseCouncilAgents(rl, councilAgents, "Refinement", 1, [0]);
  const synthesis = await chooseCouncilAgents(rl, councilAgents, "Synthesis", 1, [0]);
  const validation = await chooseCouncilAgents(rl, councilAgents, "Validation", 2, [0, 1]);
  const autoLaunchInput = (await rl.question("Auto-launch provider commands when available? [y/N] ")).trim().toLowerCase();
  const autoLaunch = autoLaunchInput === "y" || autoLaunchInput === "yes";
  const selectedProviders = [...new Set(councilAgents.map((agent) => agent.provider))];
  const providerOverrides = { ...(existingSettings.provider_overrides ?? {}) };

  for (const providerName of selectedProviders) {
    const existing = providerOverrides[providerName]?.startup_command ?? "";
    const startupCommand = (await rl.question(`Optional startup/trust command for ${providerName} (leave blank to keep${existing ? " current" : " empty"})> `)).trim();
    if (startupCommand) {
      providerOverrides[providerName] = {
        ...(providerOverrides[providerName] ?? {}),
        startup_command: startupCommand
      };
    }
  }

  const settings = {
    first_run_complete: true,
    default_provider: councilAgents[0]?.provider ?? "codex",
    default_participant: councilAgents[0] ?? null,
    auto_launch: autoLaunch,
    output_root: outputRoot,
    council_agents: councilAgents,
    council_assignments: {
      axiom: proposal[0] ?? null,
      vector: synthesis[0] ?? null,
      forge: refinement[0] ?? null,
      sentinel: critique[0] ?? null
    },
    stage_assignments: {
      proposal,
      critique,
      refinement,
      synthesis,
      validation
    },
    provider_overrides: providerOverrides
  };

  saveRepoSettings(repoPath, settings);

  panel(`${icon("ok")} Repo Configuration Saved`, [
    `Output root: ${path.resolve(repoPath, outputRoot)}`,
    `Council agents: ${councilAgents.map((agent) => agent.label).join(", ")}`,
    `Proposal: ${proposal.map((id) => councilAgents.find((agent) => agent.id === id)?.label ?? id).join(", ")}`,
    `Critique: ${critique.map((id) => councilAgents.find((agent) => agent.id === id)?.label ?? id).join(", ")}`,
    `Refinement: ${refinement.map((id) => councilAgents.find((agent) => agent.id === id)?.label ?? id).join(", ")}`,
    `Synthesis: ${synthesis.map((id) => councilAgents.find((agent) => agent.id === id)?.label ?? id).join(", ")}`,
    `Validation: ${validation.map((id) => councilAgents.find((agent) => agent.id === id)?.label ?? id).join(", ")}`,
    `Auto launch: ${autoLaunch ? "enabled" : "disabled"}`,
    `Startup preflight configured for: ${selectedProviders.filter((name) => providerOverrides[name]?.startup_command).join(", ") || "(none)"}`
  ]);

  await waitForContinue(rl);
  return settings;
}

async function promptRun(rl, frameworkRoot, repoPath, settings) {
  clearScreen();
  panel(`${icon("run")} New Run`, [
    "Create a new council deliberation run.",
    `Repo: ${repoPath}`,
    `Output root: ${settings.output_root ?? ".ai-council/result"}`
  ]);

  const mode = await promptForChoice(rl, "Mode", ["plan", "design", "spike", "debate", "review"], "plan");
  const source = await promptForChoice(rl, "Input source", ["prompt", "markdown", "jira", "resume"], "prompt");
  if (source === "resume") {
    return { result: getStatus(frameworkRoot, repoPath), settings };
  }

  const title = (await rl.question("Title (optional)> ")).trim();
  const options = {
    mode,
    title: title || undefined,
    provider: settings.default_participant?.provider ?? settings.default_provider,
    launch: settings.auto_launch === true,
    output_root: settings.output_root,
    council_assignments: settings.council_assignments,
    stage_assignments: settings.stage_assignments,
    council_agents: settings.council_agents
  };

  if (source === "markdown") {
    options["ticket-file"] = (await rl.question("Markdown file path> ")).trim();
  } else if (source === "jira") {
    options["jira-url"] = (await rl.question("Jira URL> ")).trim();
  } else {
    options.prompt = (await rl.question("Prompt> ")).trim();
  }

  if (mode === "review") {
    options.repo = (await rl.question("Repo path to review> ")).trim() || repoPath;
  }

  const summary = {
    mode,
    repo_path: repoPath,
    output_root: path.resolve(repoPath, settings.output_root ?? ".ai-council/result"),
    source,
    title: title || "",
    stage_summary: Object.entries(settings.stage_assignments ?? {})
      .map(([stage, participants]) => `${stage}:${(participants ?? []).map((id) => settings.council_agents?.find((agent) => agent.id === id)?.label ?? id).join("/") || "-"}`)
      .join(" | ")
  };

  while (true) {
    clearScreen();
    renderRunSummary(summary);
    const selection = (await rl.question("Select [1]> ")).trim() || "1";
    if (selection === "2") {
      return { reconfigure: true, settings };
    }
    if (selection === "3" || selection.toLowerCase() === "cancel") {
      return { cancelled: true, settings };
    }
    if (selection && selection !== "1") {
      continue;
    }

    const progressState = {
      mode,
      started_at: Date.now(),
      run_path: "",
      result_path: "",
      current_stage: "",
      current_provider: "",
      waiting_for: "",
      waiting_model: "",
      current_timeout_ms: 0,
      completed_steps: 0,
      total_steps: 0,
      is_waiting: false,
      pulse: 0,
      events: []
    };
    let spinnerTimer = null;
    options.on_progress = (event) => {
      if (event.run_path) progressState.run_path = event.run_path;
      if (event.result_path) progressState.result_path = event.result_path;
      if (event.stage) progressState.current_stage = event.stage;
      if (event.provider) progressState.current_provider = event.provider;
      if (event.completed_steps !== undefined) progressState.completed_steps = event.completed_steps;
      if (event.total_steps !== undefined) progressState.total_steps = event.total_steps;
      if (event.type === "participant_waiting") {
        progressState.is_waiting = true;
        progressState.waiting_for = event.participant_label ?? event.provider ?? "";
        progressState.waiting_model = event.model ?? "";
        progressState.current_timeout_ms = event.timeout_ms ?? 0;
        if (!spinnerTimer) {
          spinnerTimer = setInterval(() => {
            progressState.pulse += 1;
            renderProgressView(progressState);
          }, 150);
        }
      } else if (event.type === "participant_result" || event.type === "final_artifacts_created") {
        progressState.is_waiting = false;
        progressState.waiting_for = "";
        progressState.waiting_model = "";
        progressState.current_timeout_ms = 0;
        if (spinnerTimer) {
          clearInterval(spinnerTimer);
          spinnerTimer = null;
        }
      }
      progressState.pulse += 1;
      progressState.events.push(formatProgressEvent(event));
      renderProgressView(progressState);
    };
    try {
      return { result: await runCouncil(frameworkRoot, repoPath, options), settings };
    } finally {
      if (spinnerTimer) {
        clearInterval(spinnerTimer);
      }
    }
  }
}

function renderRunResult(result) {
  panel(`${icon("ok")} Run Prepared`, [
    `Mode: ${result.mode}`,
    `Run path: ${result.run_path}`,
    `Output root: ${result.output_root}`,
    `Stages: ${result.deliberation_cycle.map((stage) => `${stage.stage}:${(stage.participant_labels ?? stage.participants).join("/")}`).join(" | ")}`,
    `Next action: ${result.next_action}`
  ]);
}

function renderRunSummary(summary) {
  panel(`${icon("run")} Run Summary`, [
    `Mode: ${summary.mode}`,
    `Repo: ${summary.repo_path}`,
    `Output root: ${summary.output_root}`,
    `Source: ${summary.source}`,
    `Title: ${summary.title || "(untitled)"}`,
    `Stages: ${summary.stage_summary}`,
    "",
    "1. Start run",
    "2. Change configuration",
    "3. Cancel"
  ]);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function progressPulse(frame = 0) {
  const frames = ["|", "/", "-", "\\"];
  return frames[frame % frames.length];
}

function renderProgressView(progressState) {
  clearScreen();
  const elapsedMs = Date.now() - progressState.started_at;
  const waitingFor = progressState.waiting_for
    ? `${progressState.waiting_for}${progressState.waiting_model ? ` [${progressState.waiting_model}]` : ""}`
    : "(none)";
  panel(`${icon("run")} Council Progress`, [
    `Mode: ${progressState.mode}`,
    `Progress: ${progressState.completed_steps}/${progressState.total_steps || "?"} steps complete`,
    `Elapsed: ${formatDuration(elapsedMs)}`,
    `Run path: ${progressState.run_path || "(creating...)"}`,
    `Current stage: ${progressState.current_stage || "(starting...)"}`,
    `Current provider: ${progressState.current_provider || "(none)"}`,
    `Active wait: ${progressState.is_waiting ? `${progressPulse(progressState.pulse)} waiting on ${waitingFor}` : "idle"}`,
    `Step timeout: ${progressState.current_timeout_ms ? formatDuration(progressState.current_timeout_ms) : "(n/a)"}`,
    `Result path: ${progressState.result_path || "(pending)"}`,
    "",
    "Tip: a static screen during a provider wait usually means the CLI is still running.",
    "If a step exceeds its timeout, the run will continue and record the failure summary.",
    "",
    "Recent events:",
    ...progressState.events.slice(-10)
  ]);
}

function formatProgressEvent(event) {
  switch (event.type) {
    case "run_created":
      return "Created run workspace";
    case "input_normalized":
      return `Normalized ${event.source_type} input for "${event.title}"`;
    case "review_evidence_created":
      return `Indexed ${event.file_count} files for review`;
    case "stage_started":
      return `Stage ${event.stage} started with ${event.participant_count} participant(s)`;
    case "startup_begin":
      return `Startup preflight for ${event.participant_label ?? event.provider}`;
    case "startup_result":
      return event.launched
        ? `Startup ${event.participant_label ?? event.provider}: exit ${event.exit_code ?? "?"}${event.timed_out ? " (timeout)" : event.exit_code && event.exit_code !== 0 ? " (check error)" : ""}`
        : `Startup available for ${event.participant_label ?? event.provider}${event.command_preview ? " (not launched)" : ""}`;
    case "participant_started":
      return `${event.participant_label ?? event.provider}${event.model ? ` [${event.model}]` : ""} handling ${event.stage}`;
    case "participant_waiting":
      return `${event.participant_label ?? event.provider}${event.model ? ` [${event.model}]` : ""} running ${event.stage} (timeout ${formatDuration(event.timeout_ms ?? 0)})`;
    case "participant_result":
      return event.launched
        ? `${event.participant_label ?? event.provider}${event.model ? ` [${event.model}]` : ""} finished ${event.stage} with exit ${event.exit_code ?? "?"}${event.timed_out ? " (timeout)" : event.exit_code && event.exit_code !== 0 ? " (error)" : ""}`
        : `${event.participant_label ?? event.provider} prompt prepared for ${event.stage}`;
    case "final_artifacts_created":
      return "Final artifacts created";
    default:
      return event.type;
  }
}

async function handleSlashCommand(command, rl, frameworkRoot, repoPath, tools, settings) {
  switch (command) {
    case "/home":
    case "/status":
      return { kind: "home", settings };
    case "/help":
      clearScreen();
      renderHelp();
      await waitForContinue(rl);
      return { kind: "home", settings };
    case "/cycle":
      clearScreen();
      renderCycle();
      await waitForContinue(rl);
      return { kind: "home", settings };
    case "/artifacts":
      clearScreen();
      renderArtifacts(getStatus(frameworkRoot, repoPath));
      await waitForContinue(rl);
      return { kind: "home", settings };
    case "/configure":
      return { kind: "configured", settings: await configureWorkspace(repoPath, rl, tools, settings) };
    case "/run":
      return { kind: "run", ...(await promptRun(rl, frameworkRoot, repoPath, settings)) };
    case "/clear":
      clearScreen();
      return { kind: "home", settings };
    case "/exit":
    case "/quit":
      return { kind: "exit", settings };
    default:
      panel(`${icon("warn")} Unknown Command`, [`Unknown shell command: ${command}`, "Use /help to see the available commands."]);
      await waitForContinue(rl);
      return { kind: "home", settings };
  }
}

export async function startShell(frameworkRoot, repoPath) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const tools = toolingStatus(frameworkRoot, repoPath);
    let settings = loadRepoSettings(repoPath);

    renderWelcome(tools, settings, repoPath);
    await waitForContinue(rl, "");

    if (!hasCompletedFirstRun(repoPath)) {
      settings = await configureWorkspace(repoPath, rl, tools, settings);
    }

    while (true) {
      const status = getStatus(frameworkRoot, repoPath);
      renderHome(status, settings, repoPath);
      const response = ((await rl.question(status.has_runs ? "Select [1]> " : "Select [1]> ")).trim() || "1");

      if (response.startsWith("/")) {
        const action = await handleSlashCommand(response.toLowerCase(), rl, frameworkRoot, repoPath, tools, settings);
        settings = action.settings ?? settings;
        if (action.kind === "exit") {
          return { status: "exited" };
        }
        if (action.kind === "run") {
          if (action.cancelled) {
            continue;
          }
          if (action.reconfigure) {
            settings = await configureWorkspace(repoPath, rl, tools, settings);
            continue;
          }
          clearScreen();
          renderRunResult(action.result);
          await waitForContinue(rl);
        }
        continue;
      }

      if (!status.has_runs) {
        if (response === "1") {
          const action = await promptRun(rl, frameworkRoot, repoPath, settings);
          if (action.cancelled) {
            continue;
          }
          if (action.reconfigure) {
            settings = await configureWorkspace(repoPath, rl, tools, settings);
            continue;
          }
          clearScreen();
          renderRunResult(action.result);
          await waitForContinue(rl);
          continue;
        }
        if (response === "2") {
          settings = await configureWorkspace(repoPath, rl, tools, settings);
          continue;
        }
        if (response === "3") {
          clearScreen();
          renderCycle();
          await waitForContinue(rl);
          continue;
        }
        if (response === "4") {
          clearScreen();
          renderHelp();
          await waitForContinue(rl);
          continue;
        }
        if (response === "5" || response.toLowerCase() === "exit") {
          return { status: "exited" };
        }
        continue;
      }

      if (response === "1") {
        const action = await promptRun(rl, frameworkRoot, repoPath, settings);
        if (action.cancelled) {
          continue;
        }
        if (action.reconfigure) {
          settings = await configureWorkspace(repoPath, rl, tools, settings);
          continue;
        }
        clearScreen();
        renderRunResult(action.result);
        await waitForContinue(rl);
        continue;
      }
      if (response === "2") {
        clearScreen();
        renderArtifacts(status);
        await waitForContinue(rl);
        continue;
      }
      if (response === "3") {
        settings = await configureWorkspace(repoPath, rl, tools, settings);
        continue;
      }
      if (response === "4") {
        clearScreen();
        renderCycle();
        await waitForContinue(rl);
        continue;
      }
      if (response === "5") {
        clearScreen();
        renderHelp();
        await waitForContinue(rl);
        continue;
      }
      if (response === "6" || response.toLowerCase() === "exit") {
        return { status: "exited" };
      }
    }
  } finally {
    rl.close();
  }
}
