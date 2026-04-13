import path from "node:path";
import readline from "node:readline/promises";

import { deriveClarificationAnswerOptions } from "../clarification/stage.js";
import { hasCompletedFirstRun, loadRepoSettings, saveRepoSettings } from "../core/config.js";
import { getCouncilVisualReference, getDeliberationCycle } from "../core/identity.js";
import { clarifyLatest, decideLatest, exportLatestToAwf, exportLatestToStoryPackage, getStatus, previewLatestStoryPackaging, runCouncil, toolingStatus } from "../core/workflow.js";
import { formatPanelLines } from "./render.js";

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

function panel(title, rows = []) {
  for (const line of formatPanelLines(title, rows)) {
    console.log(line.strong ? strong(line.text) : line.text);
  }
}

function clearScreen() {
  process.stdout.write("\u001bc");
}

async function waitForContinue(rl, label = "Press Enter to continue...") {
  await rl.question(label);
}

function centerText(text, width) {
  const raw = String(text ?? "");
  const padding = Math.max(0, width - raw.length);
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return `${" ".repeat(left)}${raw}${" ".repeat(right)}`;
}

function writeBanner() {
  const width = Math.min(88, Math.max(64, (process.stdout.columns ?? 88) - 8));
  const innerWidth = width - 2;
  const top = `+${"=".repeat(innerWidth)}+`;
  const bottom = `+${"=".repeat(innerWidth)}+`;
  const blank = `|${" ".repeat(innerWidth)}|`;
  const title = "[*] AI AGENTS COUNCIL";
  const subtitle = "Command-line orchestration for council runs.";
  const cycle = "proposal -> critique -> refinement -> synthesis -> validation";
  const roster = "Axiom | Vector | Forge | Sentinel";
  const bannerRows = [
    top,
    blank,
    `|${centerText(title, innerWidth)}|`,
    `|${centerText(subtitle, innerWidth)}|`,
    `|${centerText(cycle, innerWidth)}|`,
    `|${centerText(roster, innerWidth)}|`,
    blank,
    bottom
  ];

  for (const line of bannerRows) {
    if (line === top || line === bottom) {
      console.log(accent(line));
      continue;
    }

    if (line === blank) {
      console.log(muted(line));
      continue;
    }

    if (line.includes(title)) {
      console.log(paint(line, ANSI.bold, ANSI.cyan));
      continue;
    }

    if (line.includes(cycle)) {
      console.log(muted(line));
      continue;
    }

    if (line.includes(roster)) {
      console.log(paint(line, ANSI.bold, ANSI.blue));
      continue;
    }

    console.log(muted(line));
  }
}

function renderWelcome(tools, settings, repoPath) {
  clearScreen();
  console.log("");
  writeBanner();
  panel(`${icon("app")} Welcome`, [
    "AI Agents Council is a multi-agent engineering console for proposal, critique, refinement, synthesis, and validation.",
    "",
    `Target repo: ${repoPath}`,
    `Output root: ${settings.output_root ?? ".ai-council/result"}`,
    `Detected providers: ${tools.providers.map((provider) => provider.name).join(", ") || "(none)"}`,
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
      `Status: ${status.status ?? "prepared"}`,
      `${icon("next")} Recommended: ${accent(
        status.current_stage === "awaiting_clarification"
          ? "Answer the clarification questions before proposal continues"
          : status.current_stage === "awaiting_approval"
            ? "Review and decide on the latest result"
            : "Inspect the latest result artifacts or launch a new run"
      )}`,
      `Why: ${status.recommended_action}`
    ]);
    if (status.current_stage === "awaiting_clarification") {
      panel(`${icon("next")} Next Steps`, [
        "1. Answer clarification questions",
        "2. Show latest artifacts",
        "3. Start a new run",
        "4. Configure this repo",
        "5. Exit"
      ]);
    } else if (status.current_stage === "awaiting_approval") {
      panel(`${icon("next")} Next Steps`, [
        "1. Review latest result",
        "2. Approve result",
        "3. Request changes",
        "4. Reject result",
        "5. Show latest artifacts",
        "6. Start a new run",
        "7. Configure this repo",
        "8. Exit"
      ]);
    } else if (status.status === "approved") {
      panel(`${icon("next")} Next Steps`, status.story_export
        ? [
          "1. Export approved result to AWF",
          "2. Show latest artifacts",
          "3. Start a new run",
          "4. Configure this repo",
          "5. Exit"
        ]
        : [
          "1. Package approved result as a story",
          "2. Export approved result to AWF",
          "3. Show latest artifacts",
          "4. Start a new run",
          "5. Configure this repo",
          "6. Exit"
        ]);
    } else {
      panel(`${icon("next")} Next Steps`, [
        "1. Start a new run",
        "2. Show latest artifacts",
        "3. Configure this repo",
        "4. Show cycle",
        "5. Help",
        "6. Exit"
      ]);
    }
  }

  console.log("");
  console.log(muted("Use numbers for guided actions or slash commands for speed: /help /home /status /configure /run /artifacts /cycle /exit"));
}

async function promptLatestClarification(rl, frameworkRoot, repoPath) {
  const status = getStatus(frameworkRoot, repoPath);
  const questions = Array.isArray(status.questions) ? status.questions : [];
  if (questions.length === 0) {
    panel(`${icon("warn")} Clarification`, [
      "The latest run is waiting for clarification, but no questions were captured in the session payload.",
      "Inspect work/input/clarification.json for details."
    ]);
    await waitForContinue(rl);
    return status;
  }

  const answers = await promptClarificationAnswers(rl, questions);
  if (answers.length === 0) {
    return status;
  }

  return clarifyLatest(frameworkRoot, repoPath, {
    clarification_answers: answers
  });
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

  panel(`${icon("tools")} ${prompt}`, normalizedChoices.map((choice, index) => `${index + 1}. ${choice}`));

  while (true) {
    const input = (await rl.question(`${prompt} number [${normalizedChoices.indexOf(defaultChoice) + 1}]> `)).trim();
    if (!input) {
      return defaultChoice;
    }

    const numeric = parseNumberSelection(input, 1, normalizedChoices.length);
    if (numeric !== null) {
      return normalizedChoices[numeric - 1];
    }

    const selected = normalizedChoices.find((choice) => choice.toLowerCase() === input.toLowerCase());
    if (selected) {
      return selected;
    }

    console.log(warn(`Select a number between 1 and ${normalizedChoices.length}.`));
  }
}

function formatStoryAgentOption(agent = {}) {
  const label = String(agent.label ?? agent.id ?? agent.provider ?? "agent").trim();
  const adapter = [agent.provider, agent.model].filter(Boolean).join(" / ");
  return adapter ? `${label} [${adapter}]` : label;
}

async function promptForStoryAgent(rl, storyAgents = []) {
  if (!Array.isArray(storyAgents) || storyAgents.length === 0) {
    return null;
  }

  if (storyAgents.length === 1) {
    return storyAgents[0].id;
  }

  panel(`${icon("tools")} Story Ticket Agent`, [
    "Choose which AI agent should create the exported story tickets.",
    ...storyAgents.map((agent, index) => `${index + 1}. ${formatStoryAgentOption(agent)}`)
  ]);

  const selected = await promptForNumberInRange(rl, "Story ticket agent", 1, storyAgents.length, 1);
  return storyAgents[selected - 1]?.id ?? null;
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
    `${index + 1}. ${provider.name}`
  ));
  const preferredProvider = existingProvider || "copilot";
  const fallbackIndex = Math.max(0, choices.findIndex((provider) => provider.name === preferredProvider));
  const defaultChoice = fallbackIndex >= 0 ? fallbackIndex + 1 : 1;
  const selected = await promptForNumberInRange(rl, `Agent ${agentIndex + 1} provider number`, 1, choices.length, defaultChoice);
  return choices[selected - 1] ?? choices[fallbackIndex] ?? choices[0];
}

async function chooseModelFromList(rl, provider, existingModel = null, agentIndex = 0) {
  const models = Array.isArray(provider?.models) ? provider.models : [];
  if (models.length === 0) {
    return (await rl.question(`Agent ${agentIndex + 1} model${existingModel ? ` [${existingModel}]` : " (optional)"}> `)).trim() || existingModel || "";
  }

  const modelSource = provider?.model_source === "cli"
    ? "CLI-discovered"
    : provider?.model_source === "cli+config"
      ? "CLI-discovered + config fallback"
      : provider?.model_source === "config"
        ? "Config fallback"
        : "Manual";
  panel(`${icon("tools")} ${provider.name} Models`, [
    `Source: ${modelSource}`,
    "",
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

function resolveStageFallbackIndexes(councilAgents, existingAssignments = []) {
  const preferredIndexes = (Array.isArray(existingAssignments) ? existingAssignments : [])
    .map((assignment) => councilAgents.findIndex((agent) => agent.id === assignment))
    .filter((index) => index >= 0);

  if (preferredIndexes.length > 0) {
    return [...new Set(preferredIndexes)];
  }

  return councilAgents.map((_, index) => index);
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
  panel(`${icon("tools")} Providers`, choices.map((provider, index) =>
    `${index + 1}. ${provider.name}`
  ));

  const councilAgents = await configureCouncilAgents(rl, choices, existingSettings.council_agents ?? []);
  const proposal = await chooseCouncilAgents(rl, councilAgents, "Proposal", 1, resolveStageFallbackIndexes(councilAgents, existingSettings.stage_assignments?.proposal));
  const critique = await chooseCouncilAgents(rl, councilAgents, "Critique", 1, resolveStageFallbackIndexes(councilAgents, existingSettings.stage_assignments?.critique));
  const refinement = await chooseCouncilAgents(rl, councilAgents, "Refinement", 1, resolveStageFallbackIndexes(councilAgents, existingSettings.stage_assignments?.refinement));
  const synthesis = await chooseCouncilAgents(rl, councilAgents, "Synthesis", 1, resolveStageFallbackIndexes(councilAgents, existingSettings.stage_assignments?.synthesis));
  const validation = await chooseCouncilAgents(rl, councilAgents, "Validation", 1, resolveStageFallbackIndexes(councilAgents, existingSettings.stage_assignments?.validation));
  const autoLaunchInput = (await rl.question("Auto-launch provider commands when available? [Y/n] ")).trim().toLowerCase();
  const autoLaunch = autoLaunchInput === "" || autoLaunchInput === "y" || autoLaunchInput === "yes";
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
    default_provider: councilAgents[0]?.provider ?? "copilot",
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

  const sourceInput = (await rl.question("Prompt, Markdown path, or Jira URL> ")).trim();
  if (/^https?:\/\//i.test(sourceInput)) {
    options["ticket-source"] = sourceInput;
  } else if (/\.md$/i.test(sourceInput)) {
    options["ticket-source"] = sourceInput;
  } else {
    options.prompt = sourceInput;
  }

  if (mode === "review") {
    options.repo = (await rl.question("Repo path to review> ")).trim() || repoPath;
  }

  const summary = {
    mode,
    repo_path: repoPath,
    output_root: path.resolve(repoPath, settings.output_root ?? ".ai-council/result"),
    source: /^https?:\/\//i.test(sourceInput) ? "jira" : /\.md$/i.test(sourceInput) ? "markdown" : "prompt",
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
      if (event.type === "participant_waiting" || event.type === "clarification_waiting") {
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
      } else if (event.type === "participant_result" || event.type === "clarification_result" || event.type === "final_artifacts_created") {
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
      let result = await runCouncil(frameworkRoot, repoPath, options);
      while (result?.status === "awaiting_clarification" && Array.isArray(result.questions) && result.questions.length > 0) {
        const clarificationAnswers = await promptClarificationAnswers(rl, result.questions);
        if (clarificationAnswers.length === 0) {
          return { result, settings };
        }

        result = await clarifyLatest(frameworkRoot, repoPath, {
          clarification_answers: clarificationAnswers,
          on_progress: options.on_progress
        });
      }

      return { result, settings };
    } finally {
      if (spinnerTimer) {
        clearInterval(spinnerTimer);
      }
    }
  }
}

function renderRunResult(result) {
  const stages = Array.isArray(result.deliberation_cycle)
    ? result.deliberation_cycle.map((stage) => `${stage.stage}:${(stage.participant_labels ?? stage.participants).join("/")}`).join(" | ")
    : "(pending clarification)";
  panel(`${icon("ok")} Run Prepared`, [
    `Mode: ${result.mode}`,
    `Run path: ${result.run_path}`,
    `Output root: ${result.output_root}`,
    `Stages: ${stages}`,
    `Next action: ${result.next_action}`
  ]);
}

async function promptLatestApproval(rl, frameworkRoot, repoPath) {
  const status = getStatus(frameworkRoot, repoPath);
  panel(`${icon("next")} Review Latest Result`, [
    `Title: ${status.title ?? "(untitled)"}`,
    `Status: ${status.status ?? "prepared"}`,
    `Latest run: ${status.latest_run ?? "(none)"}`,
    `Artifacts: ${status.final_files?.length > 0 ? status.final_files.join(", ") : "(none)"}`,
    "",
    "1. Approve",
    "2. Request changes",
    "3. Reject",
    "4. Decide later"
  ]);

  const decision = await promptForNumberInRange(rl, "Decision", 1, 4, 4);
  if (decision === 4) {
    return { status: "pending_approval" };
  }

  if (decision === 1) {
    const packagingChoice = await promptForStoryPackaging(rl, frameworkRoot, repoPath, {
      allowApproveOnly: true,
      cancelLabel: "Decide later"
    });
    if (packagingChoice.cancelled) {
      return { status: "pending_approval" };
    }

    if (packagingChoice.approveOnly) {
      return decideLatest(frameworkRoot, repoPath, {
        decision: "approve",
        story_export_mode: "none"
      });
    }

    return decideLatest(frameworkRoot, repoPath, {
      decision: "approve",
      story_export_mode: packagingChoice.mode,
      story_agent: packagingChoice.storyAgent,
      create_awf: packagingChoice.createAwf
    });
  }

  const prompt = (await rl.question(decision === 2 ? "Change request prompt> " : "Rejection reason> ")).trim();
  return decideLatest(frameworkRoot, repoPath, {
    decision: decision === 2 ? "request_changes" : "reject",
    prompt
  });
}

async function promptForStoryPackaging(rl, frameworkRoot, repoPath, options = {}) {
  const packaging = previewLatestStoryPackaging(frameworkRoot, repoPath);
  const rows = [
    packaging.is_large_result && packaging.can_split
      ? "This result is large enough that packaging it as implementation stories may make handoff easier."
      : "Package the approved result as an implementation story before handing it off.",
    `Tasks: ${packaging.task_count}`,
    `Acceptance criteria: ${packaging.acceptance_count}`,
    `Approximate result words: ${packaging.word_count}`,
    ...(packaging.can_split ? [`Suggested split stories: ${packaging.suggested_story_count}`] : []),
    ...(packaging.suggested_epic_count > 0 ? [`Suggested epics: ${packaging.suggested_epic_count}`] : []),
    ""
  ];

  const choices = [
    { action: "single", label: "Create a single story" },
    ...(packaging.can_split ? [{ action: "split", label: "Split into multiple stories" }] : []),
    ...(options.allowApproveOnly ? [{ action: "approve_only", label: "Approve only" }] : []),
    { action: "cancel", label: options.cancelLabel ?? "Cancel" }
  ];

  panel(`${icon("tools")} Approval Packaging`, [
    ...rows,
    ...choices.map((choice, index) => `${index + 1}. ${choice.label}`)
  ]);

  const defaultSelection = 1;
  const selected = await promptForNumberInRange(rl, "Approval packaging", 1, choices.length, defaultSelection);
  const choice = choices[selected - 1];
  if (!choice || choice.action === "cancel") {
    return { cancelled: true };
  }

  if (choice.action === "approve_only") {
    return { cancelled: false, approveOnly: true };
  }

  const storyAgent = await promptForStoryAgent(rl, packaging.story_agents ?? []);
  const createAwf = choice.action === "single"
    ? (await promptForChoice(rl, "Generate AWF .wi folder now?", ["yes", "no"], "no")) === "yes"
    : false;

  return {
    cancelled: false,
    approveOnly: false,
    mode: choice.action,
    storyAgent,
    createAwf
  };
}

function buildClarificationOptionRows(answerOptions = []) {
  return [
    "Possible answers:",
    ...answerOptions.map((option, index) => `${index + 1}. ${option}`),
    `${answerOptions.length + 1}. Other`
  ];
}

async function promptClarificationTextSelection(rl, answerOptions = []) {
  const otherSelection = answerOptions.length + 1;

  while (true) {
    const selection = (await rl.question("Answer number> ")).trim();
    if (!selection) {
      return "";
    }

    if (selection.toLowerCase() === "exit") {
      return null;
    }

    const numeric = parseNumberSelection(selection, 1, otherSelection);
    if (numeric === otherSelection) {
      const customAnswer = (await rl.question("Other answer> ")).trim();
      if (customAnswer.toLowerCase() === "exit") {
        return null;
      }
      return customAnswer;
    }

    if (numeric !== null) {
      return answerOptions[numeric - 1] ?? "";
    }

    console.log(warn(`Select a number between 1 and ${otherSelection}.`));
  }
}

async function promptClarificationListSelection(rl, answerOptions = []) {
  const selectedAnswers = [];
  const otherSelection = answerOptions.length + 1;

  while (true) {
    const selection = (await rl.question("Answer number> ")).trim();
    if (!selection) {
      break;
    }

    if (selection.toLowerCase() === "exit") {
      return null;
    }

    const numeric = parseNumberSelection(selection, 1, otherSelection);
    if (numeric === otherSelection) {
      const customAnswer = (await rl.question("Other answer> ")).trim();
      if (customAnswer.toLowerCase() === "exit") {
        return null;
      }
      if (customAnswer) {
        selectedAnswers.push(customAnswer);
      }
      continue;
    }

    if (numeric !== null) {
      const option = answerOptions[numeric - 1];
      if (option) {
        selectedAnswers.push(option);
      }
      continue;
    }

    console.log(warn(`Select a number between 1 and ${otherSelection}.`));
  }

  return Array.from(new Set(selectedAnswers)).join("; ").trim();
}

export async function askClarificationQuestion(rl, question, index, total) {
  const answerOptions = deriveClarificationAnswerOptions(question);
  panel(`${icon("warn")} Clarification ${index + 1}/${total}`, [
    question.prompt,
    ...(question.observation ? [`Observation: ${question.observation}`] : []),
    ...(question.answer_guidance ? [`Guidance: ${question.answer_guidance}`] : []),
    ...(answerOptions.length > 0 ? ["", ...buildClarificationOptionRows(answerOptions)] : []),
    "",
    question.response_format === "list"
      ? answerOptions.length > 0
        ? "Select one number at a time, choose Other for a custom item, then press Enter on a blank line to finish."
        : "Enter one item per line, then press Enter on a blank line to finish."
      : answerOptions.length > 0
        ? "Select the number that best fits. Choose Other to type a custom answer."
      : "Provide the shortest answer that removes the planning blocker.",
    "Type `exit` to stop and keep the current clarification state."
  ]);

  if (question.response_format === "list") {
    if (answerOptions.length > 0) {
      return promptClarificationListSelection(rl, answerOptions);
    }

    const entries = [];
    while (true) {
      const entry = (await rl.question("Answer> ")).trim();
      if (entry.toLowerCase() === "exit") {
        return null;
      }
      if (!entry) {
        break;
      }
      entries.push(entry);
    }
    return entries.join("; ").trim();
  }

  if (answerOptions.length > 0) {
    return promptClarificationTextSelection(rl, answerOptions);
  }

  const answer = (await rl.question("Answer> ")).trim();
  if (answer.toLowerCase() === "exit") {
    return null;
  }
  return answer;
}

export async function promptClarificationAnswers(rl, questions = []) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return [];
  }

  panel(`${icon("warn")} Clarification Needed`, [
    "AI Agents Council found blocking questions before proposal can safely start.",
    ...questions.map((question, index) => `${index + 1}. ${question.prompt}`)
  ]);

  const answers = new Map();
  for (const [index, question] of questions.entries()) {
    const answer = await askClarificationQuestion(rl, question, index, questions.length);
    if (answer === null) {
      return [];
    }

    if (answer) {
      answers.set(question.id, {
        id: question.id,
        prompt: question.prompt,
        answer
      });
    }
  }

  while (answers.size > 0) {
    panel("Review Clarification Answers", questions.map((question, index) =>
      `${index + 1}. ${question.prompt} -> ${answers.get(question.id)?.answer ?? "(left blank)"}`
    ));

    const selection = (await rl.question("Enter a question number to revise, or press Enter to continue> ")).trim();
    if (!selection) {
      break;
    }

    if (selection.toLowerCase() === "exit") {
      return [];
    }

    const questionIndex = Number.parseInt(selection, 10);
    if (!Number.isInteger(questionIndex) || questionIndex < 1 || questionIndex > questions.length) {
      console.log(warn(`Select a number between 1 and ${questions.length}.`));
      continue;
    }

    const question = questions[questionIndex - 1];
    const answer = await askClarificationQuestion(rl, question, questionIndex - 1, questions.length);
    if (answer === null) {
      return [];
    }

    if (answer) {
      answers.set(question.id, {
        id: question.id,
        prompt: question.prompt,
        answer
      });
    } else {
      answers.delete(question.id);
    }
  }

  return questions.map((question) => answers.get(question.id)).filter(Boolean);
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
    case "run_resumed":
      return "Resumed existing run workspace";
    case "input_normalized":
      return `Normalized ${event.source_type} input for "${event.title}"`;
    case "review_evidence_created":
      return `Indexed ${event.file_count} files for review`;
    case "clarification_started":
      return `Clarification stage prepared with ${event.participant_label ?? event.provider ?? "Axiom"}`;
    case "clarification_waiting":
      return `${event.participant_label ?? event.provider ?? "Axiom"} reviewing ambiguity before proposal`;
    case "clarification_result":
      return event.status === "needs_clarification"
        ? `Clarification found ${event.blocking_question_count ?? event.question_count ?? 0} blocking question(s)`
        : "Clarification found the request ready for proposal";
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
          if (action.result?.status === "pending_approval") {
            await promptLatestApproval(rl, frameworkRoot, repoPath);
          }
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
          if (action.result?.status === "pending_approval") {
            await promptLatestApproval(rl, frameworkRoot, repoPath);
          }
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

      if (status.current_stage === "awaiting_approval") {
        if (response === "1" || response === "2" || response === "3" || response === "4") {
          if (response === "1") {
            await promptLatestApproval(rl, frameworkRoot, repoPath);
          } else if (response === "2") {
            await decideLatest(frameworkRoot, repoPath, { decision: "approve" });
          } else if (response === "3") {
            const prompt = (await rl.question("Change request prompt> ")).trim();
            await decideLatest(frameworkRoot, repoPath, { decision: "request_changes", prompt });
          } else if (response === "4") {
            const prompt = (await rl.question("Rejection reason> ")).trim();
            await decideLatest(frameworkRoot, repoPath, { decision: "reject", prompt });
          }
          continue;
        }
        if (response === "5") {
          clearScreen();
          renderArtifacts(status);
          await waitForContinue(rl);
          continue;
        }
        if (response === "6") {
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
          if (action.result?.status === "pending_approval") {
            await promptLatestApproval(rl, frameworkRoot, repoPath);
          }
          await waitForContinue(rl);
          continue;
        }
        if (response === "7") {
          settings = await configureWorkspace(repoPath, rl, tools, settings);
          continue;
        }
        if (response === "8" || response.toLowerCase() === "exit") {
          return { status: "exited" };
        }
        continue;
      }

      if (status.current_stage === "awaiting_clarification") {
        if (response === "1") {
          const clarified = await promptLatestClarification(rl, frameworkRoot, repoPath);
          if (clarified?.status === "pending_approval") {
            await promptLatestApproval(rl, frameworkRoot, repoPath);
          }
          continue;
        }
        if (response === "2") {
          clearScreen();
          renderArtifacts(status);
          await waitForContinue(rl);
          continue;
        }
        if (response === "3") {
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
          if (action.result?.status === "pending_approval") {
            await promptLatestApproval(rl, frameworkRoot, repoPath);
          }
          await waitForContinue(rl);
          continue;
        }
        if (response === "4") {
          settings = await configureWorkspace(repoPath, rl, tools, settings);
          continue;
        }
        if (response === "5" || response.toLowerCase() === "exit") {
          return { status: "exited" };
        }
        continue;
      }

      if (status.status === "approved") {
        if (status.story_export) {
          if (response === "1") {
            exportLatestToAwf(frameworkRoot, repoPath);
            continue;
          }
          if (response === "2") {
            clearScreen();
            renderArtifacts(status);
            await waitForContinue(rl);
            continue;
          }
          if (response === "3") {
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
            if (action.result?.status === "pending_approval") {
              await promptLatestApproval(rl, frameworkRoot, repoPath);
            }
            await waitForContinue(rl);
            continue;
          }
          if (response === "4") {
            settings = await configureWorkspace(repoPath, rl, tools, settings);
            continue;
          }
          if (response === "5" || response.toLowerCase() === "exit") {
            return { status: "exited" };
          }
          continue;
        }

        if (response === "1") {
          const packagingChoice = await promptForStoryPackaging(rl, frameworkRoot, repoPath);
          if (packagingChoice.cancelled) {
            continue;
          }
          await exportLatestToStoryPackage(frameworkRoot, repoPath, {
            story_export_mode: packagingChoice.mode,
            story_agent: packagingChoice.storyAgent,
            create_awf: packagingChoice.createAwf
          });
          continue;
        }
        if (response === "2") {
          exportLatestToAwf(frameworkRoot, repoPath);
          continue;
        }
        if (response === "3") {
          clearScreen();
          renderArtifacts(status);
          await waitForContinue(rl);
          continue;
        }
        if (response === "4") {
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
          if (action.result?.status === "pending_approval") {
            await promptLatestApproval(rl, frameworkRoot, repoPath);
          }
          await waitForContinue(rl);
          continue;
        }
        if (response === "5") {
          settings = await configureWorkspace(repoPath, rl, tools, settings);
          continue;
        }
        if (response === "6" || response.toLowerCase() === "exit") {
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
        if (action.result?.status === "pending_approval") {
          await promptLatestApproval(rl, frameworkRoot, repoPath);
        }
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
