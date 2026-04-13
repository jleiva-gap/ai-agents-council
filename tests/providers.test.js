import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { analyzeProviderHelp, findArgTransportLengthIssue, maybeLaunchPrompt, resolveProcessInvocation } from "../src/providers/index.js";

test("claude analysis discovers model aliases from CLI help and validates launch flags", () => {
  const helpText = `
Usage: claude [options] [command] [prompt]
  --model <model>  Model for the current session. Provide an alias for the latest model (e.g. 'sonnet' or 'opus') or a model's full name (e.g. 'claude-sonnet-4-5-20250929').
  --permission-mode <mode>  Permission mode to use for the session
  -p, --print  Print response and exit
  --add-dir <directories...>  Additional directories to allow tool access to
`;

  const result = analyzeProviderHelp(
    "claude",
    helpText,
    ["claude", "-p", "--permission-mode", "acceptEdits", "--add-dir", "{{ARTIFACT_DIRECTORY}}"],
    ["claude-sonnet-4-5", "claude-opus-4-1"],
    "stdin"
  );

  assert.equal(result.compatible, true);
  assert.equal(result.launch_command_valid, true);
  assert.equal(result.model_source, "cli+config");
  assert.match(result.cli_discovered_models.join(","), /sonnet/i);
  assert.match(result.cli_discovered_models.join(","), /opus/i);
});

test("codex analysis validates exec launch shape and falls back to configured models", () => {
  const helpText = `
Run Codex non-interactively
Usage: codex exec [OPTIONS] [PROMPT] [COMMAND]
  -m, --model <MODEL>  Model the agent should use
  -C, --cd <DIR>  Tell the agent to use the specified directory as its working root
  --skip-git-repo-check  Allow running Codex outside a Git repository
  --add-dir <DIR>  Additional directories that should be writable alongside the primary workspace
`;

  const result = analyzeProviderHelp(
    "codex",
    helpText,
    ["codex", "exec", "-C", "{{WORKING_DIRECTORY}}", "--skip-git-repo-check", "--add-dir", "{{ARTIFACT_DIRECTORY}}"],
    ["gpt-5.4", "gpt-5.4-mini"],
    "stdin"
  );

  assert.equal(result.compatible, true);
  assert.equal(result.launch_command_valid, true);
  assert.equal(result.model_source, "config");
  assert.deepEqual(result.models, ["gpt-5.4", "gpt-5.4-mini"]);
});

test("copilot analysis flags non-interactive launch commands that omit required approval flags", () => {
  const helpText = `
Usage: copilot [options] [command]
  --model <model>  Set the AI model to use
  --add-dir <directory>  Add a directory to the allowed list for file access
  --allow-all-tools  Allow all tools to run automatically without confirmation; required for non-interactive mode
  --no-ask-user  Disable the ask_user tool
  -p, --prompt <text>  Execute a prompt in non-interactive mode
`;

  const result = analyzeProviderHelp(
    "copilot",
    helpText,
    ["copilot", "-p", "{{PROMPT_TEXT}}", "--add-dir", "{{ARTIFACT_DIRECTORY}}"],
    ["gpt-5.2"],
    "arg"
  );

  assert.equal(result.compatible, true);
  assert.equal(result.launch_command_valid, false);
  assert.match(result.launch_command_note ?? "", /allow-all-tools/i);
});

test("gemini analysis rejects arg transport when the prompt placeholder is missing", () => {
  const helpText = `
Usage: gemini [options] [command]
  -m, --model  Model
  -p, --prompt  Run in non-interactive (headless) mode with the given prompt
  --approval-mode  Set the approval mode
  --include-directories  Additional directories to include in the workspace
`;

  const result = analyzeProviderHelp(
    "gemini",
    helpText,
    ["gemini", "--approval-mode", "auto_edit", "--include-directories", "{{ARTIFACT_DIRECTORY}}"],
    ["gemini-2.5-pro"],
    "arg"
  );

  assert.equal(result.compatible, true);
  assert.equal(result.launch_command_valid, false);
  assert.match(result.launch_command_note ?? "", /prompt transport/i);
});

test("resolveProcessInvocation uses a Windows-safe wrapper for explicit PowerShell scripts", () => {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-provider-invocation-"));
  const scriptPath = path.join(scriptDir, "shim.ps1");
  fs.writeFileSync(scriptPath, "Write-Output 'ok'\n", "utf8");

  try {
    const invocation = resolveProcessInvocation(scriptPath, ["--help"]);
    if (process.platform === "win32") {
      assert.match(String(invocation.executable), /pwsh|powershell/i);
      assert.deepEqual(invocation.args.slice(0, 3), ["-NoProfile", "-File", scriptPath]);
      assert.equal(invocation.args.at(-1), "--help");
    } else {
      assert.equal(invocation.executable, scriptPath);
      assert.deepEqual(invocation.args, ["--help"]);
    }
  } finally {
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test("resolveProcessInvocation escapes percent expansion for cmd wrappers on Windows", () => {
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-provider-cmd-"));
  const scriptPath = path.join(scriptDir, "shim.cmd");
  fs.writeFileSync(scriptPath, "@echo off\r\necho ok\r\n", "utf8");

  try {
    const invocation = resolveProcessInvocation(scriptPath, ["%PATH%", "safe"]);
    if (process.platform === "win32") {
      assert.match(String(invocation.executable), /cmd\.exe/i);
      assert.match(String(invocation.args[3]), /%%PATH%%/);
    } else {
      assert.equal(invocation.executable, scriptPath);
      assert.deepEqual(invocation.args, ["%PATH%", "safe"]);
    }
  } finally {
    fs.rmSync(scriptDir, { recursive: true, force: true });
  }
});

test("maybeLaunchPrompt does not trust provider-written output files when stdout is empty", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-provider-output-"));
  const promptFile = path.join(root, "prompt.md");
  const outputFile = path.join(root, "response.md");
  fs.writeFileSync(promptFile, "# Prompt\n", "utf8");
  fs.writeFileSync(outputFile, "# Injected\n", "utf8");

  const result = await maybeLaunchPrompt(promptFile, outputFile, root, {
    available: true,
    model: null,
    prompt_transport: "stdin",
    timeout_ms: 1000,
    max_capture_bytes: 4096,
    launch_command: ["node", "-e", "process.exit(0)"]
  }, true, null, root);

  assert.equal(result.launched, true);
  assert.equal(result.stdout, "");
});

test("maybeLaunchPrompt truncates oversized stdout capture instead of growing unbounded", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-provider-truncate-"));
  const promptFile = path.join(root, "prompt.md");
  const outputFile = path.join(root, "response.md");
  fs.writeFileSync(promptFile, "# Prompt\n", "utf8");

  const result = await maybeLaunchPrompt(promptFile, outputFile, root, {
    available: true,
    model: null,
    prompt_transport: "stdin",
    timeout_ms: 2000,
    max_capture_bytes: 256,
    launch_command: ["node", "-e", "process.stdout.write('x'.repeat(2048))"]
  }, true, null, root);

  assert.equal(result.launched, true);
  assert.equal(result.stdout_truncated, true);
  assert.match(result.stdout, /\[stdout truncated after 256 bytes\]/i);
  assert.equal(result.stdout.length < 512, true);
});

test("findArgTransportLengthIssue flags oversized Windows arg launches", () => {
  const issue = findArgTransportLengthIssue(["copilot", "-p", "x".repeat(7100)], "win32");
  assert.match(issue ?? "", /windows-safe limit/i);
});
