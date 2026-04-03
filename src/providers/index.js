import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

import { commandExists, writeJson } from "../utils/fs.js";
import { getCouncilIdentity } from "../core/identity.js";

function probeProviderCommand(command, providerName) {
  if (!commandExists(command)) {
    return {
      installed: false,
      compatible: false,
      compatibility_note: "Command not found on PATH."
    };
  }

  const result = spawnSync(command, ["--help"], {
    encoding: "utf8",
    timeout: 5000
  });
  const helpText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();

  switch (providerName) {
    case "claude":
      return {
        installed: true,
        compatible: helpText.includes("--permission-mode") && (helpText.includes("-p, --print") || helpText.includes("--print")),
        compatibility_note: "Expected Claude Code non-interactive flags (-p/--print, --permission-mode)."
      };
    case "gemini":
      return {
        installed: true,
        compatible: helpText.includes("-p, --prompt") && helpText.includes("--approval-mode"),
        compatibility_note: "Expected Gemini CLI headless prompt flags (-p/--prompt, --approval-mode)."
      };
    case "copilot":
      return {
        installed: true,
        compatible: helpText.includes("-p, --prompt") && helpText.includes("--allow-all-tools"),
        compatibility_note: "Expected Copilot CLI prompt and permission flags (-p/--prompt, --allow-all-tools)."
      };
    case "codex":
      return {
        installed: true,
        compatible: helpText.includes(" run") || helpText.includes("--prompt-file"),
        compatibility_note: "Expected a Codex CLI that supports non-interactive run/prompt-file execution."
      };
    default:
      return {
        installed: true,
        compatible: true,
        compatibility_note: null
      };
  }
}

export function detectProviders(providerConfig = {}, providerOverrides = {}) {
  const providers = providerConfig.providers ?? {};
  return Object.entries(providers).map(([name, config]) => {
    const resolvedCommand = providerOverrides?.[name]?.command ?? config.command;
    const probe = probeProviderCommand(resolvedCommand, name);
    return {
      name,
      enabled: config.enabled === true,
      command: resolvedCommand,
      models: Array.isArray(config.models) ? config.models : [],
      installed: probe.installed,
      compatible: probe.compatible,
      available: config.enabled === true && probe.installed === true && probe.compatible === true,
      compatibility_note: probe.compatibility_note,
      launch_command: providerOverrides?.[name]?.launch_command ?? config.launch_command ?? [],
      continue_command: providerOverrides?.[name]?.continue_command ?? config.continue_command ?? null,
      startup_command: providerOverrides?.[name]?.startup_command ?? config.startup_command ?? null,
      timeout_ms: providerOverrides?.[name]?.timeout_ms ?? config.timeout_ms ?? 120000,
      session_mode: providerOverrides?.[name]?.session_mode ?? config.session_mode ?? "fresh",
      prompt_transport: providerOverrides?.[name]?.prompt_transport ?? config.prompt_transport ?? "file"
    };
  });
}

export function buildLaunchCommand(launchCommand, substitutions) {
  return launchCommand.map((part) =>
    String(part).replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => substitutions[`{{${key}}}`] ?? `{{${key}}}`)
  );
}

export function assignProviders(council, providerStatus, preferredProvider = null) {
  const pool = providerStatus.filter((provider) => provider.enabled && provider.available);
  return (council.roles ?? []).map((role, index) => {
    const preferred = preferredProvider ? pool.find((provider) => provider.name === preferredProvider) : null;
    const provider = preferred ?? pool[index % pool.length] ?? { name: "manual", available: false, launch_command: [] };
    return { role, identity: getCouncilIdentity(role), ...provider };
  });
}

export function assignCouncilProviders(council, providerStatus, councilAssignments = {}, fallbackProvider = null) {
  const pool = providerStatus.filter((provider) => provider.enabled && provider.available);
  return (council.roles ?? []).map((role, index) => {
    const identity = getCouncilIdentity(role);
    const configuredProviderName = councilAssignments?.[identity.id] ?? fallbackProvider;
    const configuredProvider = configuredProviderName
      ? pool.find((provider) => provider.name === configuredProviderName)
      : null;
    const fallback = fallbackProvider ? pool.find((provider) => provider.name === fallbackProvider) : null;
    const provider = configuredProvider ?? fallback ?? pool[index % pool.length] ?? { name: "manual", available: false, launch_command: [] };
    return { role, identity, ...provider };
  });
}

function createParticipant(provider, assignment = {}, occurrence = 1) {
  const model = assignment.model ? String(assignment.model).trim() : null;
  const agentId = assignment.id ?? `${provider.name}-${occurrence}`;
  const label = assignment.label ?? ([provider.name, model].filter(Boolean).join(" / ") || provider.name);
  const slugBase = [provider.name, model, occurrence > 1 ? String(occurrence) : ""]
    .filter(Boolean)
    .join("-");
  const safeName = slugBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || provider.name;

  return {
    ...provider,
    agent_id: agentId,
    label,
    model,
    name: safeName
  };
}

export function resolveProvidersByNames(providerStatus, names = [], fallbackProvider = null, councilAgents = []) {
  const pool = providerStatus.filter((provider) => provider.enabled && provider.available);
  const agentMap = new Map(councilAgents.map((agent) => [agent.id, agent]));
  const occurrences = new Map();
  const resolved = [];

  for (const entry of names) {
    let assignment = null;
    if (typeof entry === "string") {
      assignment = agentMap.get(entry) ?? { id: entry, provider: entry, model: null, label: entry };
    } else if (entry && typeof entry === "object") {
      assignment = entry;
    }

    if (!assignment?.provider) {
      continue;
    }

    const provider = pool.find((candidate) => candidate.name === assignment.provider);
    if (!provider) {
      continue;
    }

    const key = `${assignment.provider}::${assignment.model ?? ""}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    resolved.push(createParticipant(provider, assignment, occurrence));
  }

  if (resolved.length > 0) {
    return resolved;
  }

  const fallback = fallbackProvider ? pool.find((provider) => provider.name === fallbackProvider) : null;
  return fallback ? [createParticipant(fallback, { provider: fallback.name, label: fallback.name }, 1)] : pool.slice(0, 1).map((provider) => createParticipant(provider, { provider: provider.name, label: provider.name }, 1));
}

export function writeCouncilPlan(runPath, assignments) {
  const plan = { assignments };
  writeJson(path.join(runPath, "session", "council-plan.json"), plan);
  return plan;
}

function spawnProcessAsync(executable, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeoutId = null;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve(result);
    };

    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      finish({
        status: 1,
        stdout,
        stderr: stderr || error.message,
        timed_out: false
      });
    });

    child.on("close", (code) => {
      finish({
        status: timedOut ? 1 : (code ?? 1),
        stdout,
        stderr,
        timed_out: timedOut
      });
    });

    if (options.timeout && options.timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeout);
    }
  });
}

export async function maybeLaunchPrompt(promptFile, outputFile, workingDirectory, provider, launch = false, sessionState = null) {
  const promptText = fs.readFileSync(promptFile, "utf8");
  const commandTemplate = provider.session_mode === "session" && sessionState?.active && provider.continue_command
    ? provider.continue_command
    : provider.launch_command;
  let command = buildLaunchCommand(commandTemplate ?? [], {
    "{{PROMPT_FILE}}": promptFile,
    "{{OUTPUT_FILE}}": outputFile,
    "{{WORKING_DIRECTORY}}": workingDirectory,
    "{{SESSION_FILE}}": sessionState?.session_file ?? "",
    "{{PROMPT_TEXT}}": promptText,
    "{{MODEL}}": provider.model ?? ""
  });
  let commandPreview = buildLaunchCommand(commandTemplate ?? [], {
    "{{PROMPT_FILE}}": promptFile,
    "{{OUTPUT_FILE}}": outputFile,
    "{{WORKING_DIRECTORY}}": workingDirectory,
    "{{SESSION_FILE}}": sessionState?.session_file ?? "",
    "{{PROMPT_TEXT}}": "<prompt>",
    "{{MODEL}}": provider.model ?? ""
  });

  if (provider.model) {
    const hasModelFlag = command.includes("--model");
    if (!hasModelFlag && provider.command !== "codex") {
      command = [...command, "--model", provider.model];
      commandPreview = [...commandPreview, "--model", provider.model];
    }
  }

  if (!launch || command.length === 0 || provider.available !== true) {
    return { launched: false, command_preview: commandPreview.join(" "), timed_out: false };
  }

  const [executable, ...args] = command;
  const result = await spawnProcessAsync(executable, args, {
    cwd: workingDirectory,
    env: {
      ...process.env,
      ...(provider.model ? { AI_COUNCIL_MODEL: provider.model } : {})
    },
    input: provider.prompt_transport === "stdin" ? promptText : undefined,
    timeout: provider.timeout_ms
  });

  let effectiveStdout = result.stdout ?? "";
  if (!effectiveStdout && fs.existsSync(outputFile)) {
    effectiveStdout = fs.readFileSync(outputFile, "utf8");
  }

  return {
    launched: true,
    command_preview: commandPreview.join(" "),
    exit_code: result.status ?? 1,
    stdout: effectiveStdout,
    stderr: result.stderr ?? "",
    timed_out: result.timed_out === true
  };
}

function renderCommandString(commandValue, substitutions) {
  if (Array.isArray(commandValue)) {
    return buildLaunchCommand(commandValue, substitutions).join(" ");
  }

  return String(commandValue ?? "").replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => substitutions[`{{${key}}}`] ?? `{{${key}}}`);
}

export async function maybeRunProviderStartup(provider, targetRepo, launch = false) {
  const commandText = renderCommandString(provider.startup_command, {
    "{{TARGET_REPO}}": targetRepo
  }).trim();

  if (!launch || !commandText) {
    return { launched: false, command_preview: commandText };
  }

  const shell = process.platform === "win32"
    ? (commandExists("pwsh") ? "pwsh" : "powershell")
    : "bash";
  const args = process.platform === "win32"
    ? ["-NoProfile", "-Command", commandText]
    : ["-lc", commandText];
  const result = await spawnProcessAsync(shell, args, {
    cwd: targetRepo,
    timeout: provider.timeout_ms
  });

  return {
    launched: true,
    command_preview: commandText,
    exit_code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timed_out: result.timed_out === true
  };
}
