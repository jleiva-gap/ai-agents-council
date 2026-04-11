import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

import { commandExists, writeJson } from "../utils/fs.js";
import { getCouncilIdentity } from "../core/identity.js";

const DEFAULT_MAX_CAPTURE_BYTES = 1024 * 1024;
const WINDOWS_ARG_PROMPT_SOFT_LIMIT = 7000;

const PROVIDER_PROFILES = {
  codex: {
    help_args: ["exec", "--help"],
    required_help_tokens: ["--model", "--skip-git-repo-check", "--add-dir"],
    required_launch_tokens: [["exec"]],
    compatibility_note: "Expected Codex exec support with --model, --skip-git-repo-check, and --add-dir.",
    prompt_modes: ["stdin", "arg"]
  },
  claude: {
    help_args: ["--help"],
    required_help_tokens: ["--permission-mode", "-p, --print", "--model", "--add-dir"],
    required_launch_tokens: [["-p", "--print"], ["--permission-mode"]],
    compatibility_note: "Expected Claude Code non-interactive flags (-p/--print, --permission-mode, --model, --add-dir).",
    prompt_modes: ["stdin", "arg"]
  },
  gemini: {
    help_args: ["--help"],
    required_help_tokens: ["-p, --prompt", "--approval-mode", "--include-directories", "-m, --model"],
    required_launch_tokens: [["-p", "--prompt"], ["--approval-mode"]],
    compatibility_note: "Expected Gemini CLI headless prompt flags (-p/--prompt, --approval-mode, --include-directories, --model).",
    prompt_modes: ["stdin", "arg"]
  },
  copilot: {
    help_args: ["--help"],
    required_help_tokens: ["-p, --prompt", "--allow-all-tools", "--model", "--add-dir", "--no-ask-user"],
    required_launch_tokens: [["-p", "--prompt"], ["--allow-all-tools"]],
    compatibility_note: "Expected Copilot CLI prompt and permission flags (-p/--prompt, --allow-all-tools, --model, --add-dir, --no-ask-user).",
    prompt_modes: ["arg"]
  }
};

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function resolveCommandCandidates(commandName) {
  const normalizedCommand = String(commandName ?? "").trim();
  if (!normalizedCommand) {
    return [];
  }

  const candidates = [];
  const hasExplicitPath = normalizedCommand.includes(path.sep) || (process.platform === "win32" && normalizedCommand.includes("/"));
  const knownExtensions = process.platform === "win32"
    ? String(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean)
    : [""];

  if (path.isAbsolute(normalizedCommand) || hasExplicitPath) {
    candidates.push(normalizedCommand);
    if (process.platform === "win32" && !path.extname(normalizedCommand)) {
      for (const extension of knownExtensions) {
        candidates.push(`${normalizedCommand}${extension}`);
      }
      candidates.push(`${normalizedCommand}.ps1`);
    }
    return uniqueStrings(candidates).filter((candidate) => fs.existsSync(candidate));
  }

  for (const entry of String(process.env.PATH ?? "").split(path.delimiter)) {
    const trimmedEntry = entry.trim().replace(/^"+|"+$/g, "");
    if (!trimmedEntry) {
      continue;
    }

    candidates.push(path.join(trimmedEntry, normalizedCommand));
    if (process.platform === "win32" && !path.extname(normalizedCommand)) {
      for (const extension of knownExtensions) {
        candidates.push(path.join(trimmedEntry, `${normalizedCommand}${extension}`));
      }
      candidates.push(path.join(trimmedEntry, `${normalizedCommand}.ps1`));
    }
  }

  return uniqueStrings(candidates).filter((candidate) => fs.existsSync(candidate));
}

function quoteForCmd(value) {
  const text = String(value ?? "");
  if (!text) {
    return "\"\"";
  }

  const escaped = text.replace(/%/g, "%%");

  if (!/[\s"&^<>|()%]/.test(text)) {
    return escaped;
  }

  return `"${escaped.replace(/"/g, "\"\"")}"`;
}

export function resolveProcessInvocation(command, args = []) {
  const normalizedArgs = normalizeCommandTokens(args);
  if (process.platform !== "win32") {
    return {
      executable: String(command ?? "").trim(),
      args: normalizedArgs
    };
  }

  const candidates = resolveCommandCandidates(command);
  const preference = [".exe", ".cmd", ".bat", ".com", ".ps1", ""];
  const resolvedCommand = candidates.sort((left, right) => {
    const leftRank = preference.indexOf(path.extname(left).toLowerCase());
    const rightRank = preference.indexOf(path.extname(right).toLowerCase());
    return (leftRank === -1 ? preference.length : leftRank) - (rightRank === -1 ? preference.length : rightRank);
  })[0] ?? String(command ?? "").trim();
  const extension = path.extname(resolvedCommand).toLowerCase();

  if (extension === ".ps1") {
    return {
      executable: commandExists("pwsh") ? "pwsh" : "powershell",
      args: ["-NoProfile", "-File", resolvedCommand, ...normalizedArgs]
    };
  }

  if (extension === ".cmd" || extension === ".bat") {
    return {
      executable: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", [quoteForCmd(resolvedCommand), ...normalizedArgs.map((value) => quoteForCmd(value))].join(" ")]
    };
  }

  return {
    executable: resolvedCommand,
    args: normalizedArgs
  };
}

function normalizeCommandTokens(commandValue) {
  return Array.isArray(commandValue)
    ? commandValue.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
}

export function findArgTransportLengthIssue(commandValue = [], platform = process.platform) {
  if (platform !== "win32") {
    return null;
  }

  const commandText = normalizeCommandTokens(commandValue).join(" ");
  if (commandText.length <= WINDOWS_ARG_PROMPT_SOFT_LIMIT) {
    return null;
  }

  return `Prompt launch was blocked because the expanded command is ${commandText.length} characters long, which is above the Windows-safe limit of ${WINDOWS_ARG_PROMPT_SOFT_LIMIT} for argument-based prompt transport. Shorten the prompt context or switch this provider to stdin/file transport.`;
}

function commandIncludesAny(commandTokens, candidates = []) {
  return candidates.some((candidate) => commandTokens.includes(candidate));
}

function formatMissingTokenGroup(group = []) {
  return group.map((token) => `\`${token}\``).join(" or ");
}

function mergeModelCatalogs(discoveredModels = [], fallbackModels = []) {
  const discovered = uniqueStrings(discoveredModels);
  const fallback = uniqueStrings(fallbackModels);
  if (discovered.length === 0) {
    return {
      models: fallback,
      cli_discovered_models: [],
      model_source: fallback.length > 0 ? "config" : "none"
    };
  }

  return {
    models: uniqueStrings([...discovered, ...fallback]),
    cli_discovered_models: discovered,
    model_source: fallback.length > 0 ? "cli+config" : "cli"
  };
}

function discoverProviderModels(providerName, helpText = "", fallbackModels = []) {
  if (providerName === "claude") {
    const modelLine = String(helpText ?? "")
      .split(/\r?\n/)
      .find((line) => line.includes("--model <model>"));
    const discovered = Array.from(String(modelLine ?? "").matchAll(/'([^']+)'/g))
      .map((match) => match[1])
      .filter((value) => /^(sonnet|opus|claude-)/i.test(value));
    return mergeModelCatalogs(discovered, fallbackModels);
  }

  return mergeModelCatalogs([], fallbackModels);
}

function validatePromptTransport(providerName, promptTransport, launchTokens) {
  const profile = PROVIDER_PROFILES[providerName];
  if (!profile) {
    return { valid: true, note: null };
  }

  if (profile.prompt_modes && !profile.prompt_modes.includes(promptTransport)) {
    return {
      valid: false,
      note: `${providerName} does not support prompt transport "${promptTransport}". Supported modes: ${profile.prompt_modes.join(", ")}.`
    };
  }

  if (promptTransport === "arg" && !commandIncludesAny(launchTokens, ["{{PROMPT_TEXT}}", "{{PROMPT_FILE}}"])) {
    return {
      valid: false,
      note: `Prompt transport "${promptTransport}" requires \`{{PROMPT_TEXT}}\` or \`{{PROMPT_FILE}}\` in the launch command.`
    };
  }

  return { valid: true, note: null };
}

export function analyzeProviderHelp(providerName, helpText = "", configuredLaunchCommand = [], fallbackModels = [], promptTransport = "file") {
  const profile = PROVIDER_PROFILES[providerName];
  const normalizedHelpText = String(helpText ?? "");
  const lowercaseHelp = normalizedHelpText.toLowerCase();
  const launchTokens = normalizeCommandTokens(configuredLaunchCommand);
  const missingHelpTokens = (profile?.required_help_tokens ?? []).filter((token) => !lowercaseHelp.includes(String(token).toLowerCase()));
  const missingLaunchGroups = (profile?.required_launch_tokens ?? []).filter((group) => !commandIncludesAny(launchTokens, group));
  const promptValidation = validatePromptTransport(providerName, promptTransport, launchTokens);
  const modelCatalog = discoverProviderModels(providerName, normalizedHelpText, fallbackModels);
  const compatible = missingHelpTokens.length === 0;
  const launchCommandValid = missingLaunchGroups.length === 0 && promptValidation.valid === true;
  const issues = [];

  if (missingHelpTokens.length > 0) {
    issues.push(`Missing help tokens: ${missingHelpTokens.map((token) => `\`${token}\``).join(", ")}`);
  }
  if (missingLaunchGroups.length > 0) {
    issues.push(`Launch command is missing ${missingLaunchGroups.map((group) => formatMissingTokenGroup(group)).join(", ")}`);
  }
  if (promptValidation.note) {
    issues.push(promptValidation.note);
  }

  return {
    compatible,
    compatibility_note: issues.length > 0
      ? `${profile?.compatibility_note ?? "Provider CLI did not expose the expected non-interactive flags."} ${issues.join(" ")}`
      : profile?.compatibility_note ?? null,
    launch_command_valid: launchCommandValid,
    launch_command_note: issues.filter((issue) => issue.startsWith("Launch command") || issue.includes("Prompt transport")).join(" ").trim() || null,
    models: modelCatalog.models,
    cli_discovered_models: modelCatalog.cli_discovered_models,
    model_source: modelCatalog.model_source
  };
}

function runCommandCapture(command, args = []) {
  const invocation = resolveProcessInvocation(command, args);
  return spawnSync(invocation.executable, invocation.args, {
    encoding: "utf8",
    timeout: 5000
  });
}

function probeProviderCommand(command, providerName, providerConfig = {}) {
  if (!commandExists(command)) {
    return {
      installed: false,
      compatible: false,
      compatibility_note: "Command not found on PATH.",
      launch_command_valid: false,
      launch_command_note: "Command not found on PATH.",
      models: uniqueStrings(providerConfig.models),
      cli_discovered_models: [],
      model_source: Array.isArray(providerConfig.models) && providerConfig.models.length > 0 ? "config" : "none"
    };
  }

  const profile = PROVIDER_PROFILES[providerName] ?? { help_args: ["--help"] };
  const helpResult = runCommandCapture(command, profile.help_args ?? ["--help"]);
  const helpText = `${helpResult.stdout ?? ""}\n${helpResult.stderr ?? ""}`.trim();
  const analysis = analyzeProviderHelp(
    providerName,
    helpText,
    providerConfig.launch_command ?? [],
    providerConfig.models ?? [],
    providerConfig.prompt_transport ?? "file"
  );

  return {
    installed: true,
    compatible: analysis.compatible,
    compatibility_note: analysis.compatibility_note,
    launch_command_valid: analysis.launch_command_valid,
    launch_command_note: analysis.launch_command_note,
    models: analysis.models,
    cli_discovered_models: analysis.cli_discovered_models,
    model_source: analysis.model_source
  };
}

export function detectProviders(providerConfig = {}, providerOverrides = {}) {
  const providers = providerConfig.providers ?? {};
  return Object.entries(providers).map(([name, config]) => {
    const resolvedCommand = providerOverrides?.[name]?.command ?? config.command;
    const resolvedLaunchCommand = providerOverrides?.[name]?.launch_command ?? config.launch_command ?? [];
    const resolvedPromptTransport = providerOverrides?.[name]?.prompt_transport ?? config.prompt_transport ?? "file";
    const probe = probeProviderCommand(resolvedCommand, name, {
      ...config,
      launch_command: resolvedLaunchCommand,
      prompt_transport: resolvedPromptTransport
    });
    return {
      name,
      enabled: config.enabled === true,
      command: resolvedCommand,
      models: probe.models,
      cli_discovered_models: probe.cli_discovered_models,
      model_source: probe.model_source,
      installed: probe.installed,
      compatible: probe.compatible,
      available: config.enabled === true && probe.installed === true && probe.compatible === true && probe.launch_command_valid !== false,
      compatibility_note: probe.compatibility_note,
      launch_command_valid: probe.launch_command_valid,
      launch_command_note: probe.launch_command_note,
      launch_command: resolvedLaunchCommand,
      continue_command: providerOverrides?.[name]?.continue_command ?? config.continue_command ?? null,
      startup_command: providerOverrides?.[name]?.startup_command ?? config.startup_command ?? null,
      timeout_ms: providerOverrides?.[name]?.timeout_ms ?? config.timeout_ms ?? 120000,
      max_capture_bytes: providerOverrides?.[name]?.max_capture_bytes ?? config.max_capture_bytes ?? DEFAULT_MAX_CAPTURE_BYTES,
      session_mode: providerOverrides?.[name]?.session_mode ?? config.session_mode ?? "fresh",
      prompt_transport: resolvedPromptTransport
    };
  });
}

export function buildLaunchCommand(launchCommand, substitutions) {
  return launchCommand.map((part) =>
    String(part).replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => substitutions[`{{${key}}}`] ?? `{{${key}}}`)
  );
}

function buildLaunchCommandVariants(launchCommand, substitutions, previewSubstitutions = {}) {
  const command = [];
  const preview = [];

  for (const part of normalizeCommandTokens(launchCommand)) {
    command.push(String(part).replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => substitutions[`{{${key}}}`] ?? `{{${key}}}`));
    preview.push(String(part).replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => previewSubstitutions[`{{${key}}}`] ?? substitutions[`{{${key}}}`] ?? `{{${key}}}`));
  }

  return { command, preview };
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
  const invocation = resolveProcessInvocation(executable, args);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(invocation.executable, invocation.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      const syncResult = spawnSync(invocation.executable, invocation.args, {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8",
        input: options.input,
        timeout: options.timeout,
        maxBuffer: options.max_capture_bytes ?? DEFAULT_MAX_CAPTURE_BYTES
      });
      resolve({
        status: syncResult.status ?? 1,
        stdout: syncResult.stdout ?? "",
        stderr: syncResult.stderr || error.message,
        timed_out: syncResult.signal === "SIGTERM" || syncResult.error?.code === "ETIMEDOUT"
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;
    let timeoutId = null;
    const maxCaptureBytes = Number(options.max_capture_bytes ?? DEFAULT_MAX_CAPTURE_BYTES);

    const appendCapturedChunk = (current, currentBytes, chunk, truncated) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (!Number.isFinite(maxCaptureBytes) || maxCaptureBytes <= 0 || truncated) {
        return { text: current, bytes: currentBytes, truncated };
      }

      const remaining = Math.max(0, maxCaptureBytes - currentBytes);
      const slice = remaining > 0 ? buffer.subarray(0, remaining) : buffer.subarray(0, 0);
      return {
        text: slice.length > 0 ? `${current}${slice.toString("utf8")}` : current,
        bytes: currentBytes + slice.length,
        truncated: truncated || buffer.length > remaining
      };
    };

    const finalizeCapturedText = (text, truncated, streamName) => {
      if (!truncated) {
        return text;
      }

      return `${text}\n\n[${streamName} truncated after ${maxCaptureBytes} bytes]\n`;
    };

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
      const captured = appendCapturedChunk(stdout, stdoutBytes, chunk, stdoutTruncated);
      stdout = captured.text;
      stdoutBytes = captured.bytes;
      stdoutTruncated = captured.truncated;
    });
    child.stderr.on("data", (chunk) => {
      const captured = appendCapturedChunk(stderr, stderrBytes, chunk, stderrTruncated);
      stderr = captured.text;
      stderrBytes = captured.bytes;
      stderrTruncated = captured.truncated;
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
        stdout: finalizeCapturedText(stdout, stdoutTruncated, "stdout"),
        stderr: finalizeCapturedText(stderr, stderrTruncated, "stderr"),
        stdout_truncated: stdoutTruncated,
        stderr_truncated: stderrTruncated,
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

export async function maybeLaunchPrompt(promptFile, outputFile, workingDirectory, provider, launch = false, sessionState = null, artifactDirectory = null) {
  const promptText = fs.readFileSync(promptFile, "utf8");
  const commandTemplate = provider.session_mode === "session" && sessionState?.active && provider.continue_command
    ? provider.continue_command
    : provider.launch_command;
  let { command, preview: commandPreview } = buildLaunchCommandVariants(commandTemplate ?? [], {
    "{{PROMPT_FILE}}": promptFile,
    "{{OUTPUT_FILE}}": outputFile,
    "{{WORKING_DIRECTORY}}": workingDirectory,
    "{{ARTIFACT_DIRECTORY}}": artifactDirectory ?? workingDirectory,
    "{{SESSION_FILE}}": sessionState?.session_file ?? "",
    "{{PROMPT_TEXT}}": promptText,
    "{{MODEL}}": provider.model ?? ""
  }, {
    "{{PROMPT_TEXT}}": "<prompt>"
  });

  if (provider.model) {
    const hasModelFlag = command.includes("--model");
    if (!hasModelFlag) {
      command = [...command, "--model", provider.model];
      commandPreview = [...commandPreview, "--model", provider.model];
    }
  }

  if (!launch || command.length === 0 || provider.available !== true) {
    return { launched: false, command_preview: commandPreview.join(" "), timed_out: false };
  }

  const argTransportLengthIssue = provider.prompt_transport === "arg"
    ? findArgTransportLengthIssue(command)
    : null;
  if (argTransportLengthIssue) {
    return {
      launched: true,
      command_preview: commandPreview.join(" "),
      exit_code: 1,
      stdout: "",
      stderr: argTransportLengthIssue,
      stdout_truncated: false,
      stderr_truncated: false,
      timed_out: false
    };
  }

  const [executable, ...args] = command;
  const result = await spawnProcessAsync(executable, args, {
    cwd: workingDirectory,
    env: {
      ...process.env,
      ...(provider.model ? { AI_COUNCIL_MODEL: provider.model } : {})
    },
    input: provider.prompt_transport === "stdin" ? promptText : undefined,
    timeout: provider.timeout_ms,
    max_capture_bytes: provider.max_capture_bytes ?? DEFAULT_MAX_CAPTURE_BYTES
  });

  return {
    launched: true,
    command_preview: commandPreview.join(" "),
    exit_code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    stdout_truncated: result.stdout_truncated === true,
    stderr_truncated: result.stderr_truncated === true,
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
    timeout: provider.timeout_ms,
    max_capture_bytes: provider.max_capture_bytes ?? DEFAULT_MAX_CAPTURE_BYTES
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
