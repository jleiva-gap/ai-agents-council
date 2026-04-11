import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeClarificationResult } from "../src/clarification/stage.js";
import { clarifyLatest, classifyStageResponseContent, decideLatest, partitionStageResponses, previewLatestStoryPackaging, resumeLatest, runCouncil } from "../src/core/workflow.js";
import { main } from "../src/cli/main.js";
import { saveRepoSettings } from "../src/core/config.js";

function copyDir(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === ".runs") {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clarificationAnswers() {
  return [
    {
      id: "clarify-summary",
      prompt: "What is the concrete request or outcome the council should optimize for?",
      answer: "Create a plan for the requested change."
    },
    {
      id: "clarify-acceptance",
      prompt: "What acceptance criteria or success signals should the council treat as the delivery target?",
      answer: "The requested work is implemented and validated."
    },
    {
      id: "clarify-scope",
      prompt: "What is in scope for this request, and what should the council avoid expanding into?",
      answer: "Only the requested change is in scope."
    },
    {
      id: "clarify-constraints",
      prompt: "What constraints, non-goals, or implementation boundaries must the council preserve?",
      answer: "Keep unrelated code unchanged."
    }
  ];
}

test("plan mode normalizes prompt input and writes meaningful result artifacts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-plan-"));
  copyDir(path.resolve("."), root);

  const result = await runCouncil(root, root, {
    mode: "plan",
    title: "Add council planning",
    prompt: "Create a plan.\n- Define the CLI\n- Add tests",
    clarification_answers: clarificationAnswers()
  });

  assert.equal(result.ok, true);
  assert.match(result.run_path, /[\\\/]\.ai-council[\\\/]result[\\\/]/);
  assert.equal(result.status, "pending_approval");
  assert.equal(fs.existsSync(path.join(result.result_path, "plan.md")), true);
  assert.equal(fs.existsSync(path.join(result.result_path, "implementation-outline.md")), true);
  assert.equal(fs.existsSync(path.join(result.result_path, "tasks.json")), true);
  assert.equal(fs.existsSync(path.join(result.result_path, "summary.md")), true);
  assert.equal(fs.existsSync(path.join(result.result_path, "execution-summary.md")), false);
  assert.equal(fs.existsSync(path.join(result.work_path, "input", "ticket-definition.md")), true);
  assert.equal(fs.existsSync(path.join(result.work_path, "logs", "session.log")), true);
  assert.equal(fs.existsSync(path.join(result.work_path, "session", "visual-reference.md")), true);
  assert.equal(fs.existsSync(path.join(result.work_path, "session", "deliberation-plan.json")), true);
  assert.equal(fs.existsSync(path.join(result.work_path, "synth", "execution-summary.md")), true);

  const tasks = JSON.parse(fs.readFileSync(path.join(result.result_path, "tasks.json"), "utf8"));
  assert.equal(tasks.tasks.length >= 2, true);
  const logText = fs.readFileSync(path.join(result.work_path, "logs", "session.log"), "utf8");
  assert.match(logText, /\[ AXIOM \]/);
  const plan = JSON.parse(fs.readFileSync(path.join(result.work_path, "session", "deliberation-plan.json"), "utf8"));
  assert.equal(Array.isArray(plan.cycle), true);
  const proposalDir = path.join(result.work_path, "rounds", "01-proposal");
  const promptFile = fs.readdirSync(proposalDir).find((file) => file.endsWith(".prompt.md"));
  if (promptFile) {
    const promptText = fs.readFileSync(path.join(proposalDir, promptFile), "utf8");
    assert.match(promptText, /The stage leader is AXIOM/);
    assert.match(promptText, /Respond with the actual council contribution as Markdown on stdout/);
  }
});

test("ticket-source infers a markdown file without asking for an explicit source type", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-ticket-source-"));
  copyDir(path.resolve("."), root);

  const ticketPath = path.join(root, "story.md");
  fs.writeFileSync(ticketPath, "# Story\n\n## Acceptance Criteria\n- keep result artifacts meaningful\n", "utf8");

  const result = await runCouncil(root, root, {
    mode: "plan",
    "ticket-source": ticketPath
  });

  assert.equal(result.ok, true);
  const metadata = JSON.parse(fs.readFileSync(path.join(result.work_path, "input", "input-metadata.json"), "utf8"));
  assert.equal(metadata.source_type, "markdown");
});

test("ambiguous input pauses for clarification before proposal starts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-clarify-"));
  copyDir(path.resolve("."), root);

  const result = await runCouncil(root, root, {
    mode: "plan",
    prompt: "Need help with the implementation."
  });

  assert.equal(result.status, "awaiting_clarification");
  assert.equal(result.question_count > 0, true);
  assert.equal(fs.existsSync(path.join(result.work_path, "input", "clarification.json")), true);
  assert.equal(fs.existsSync(path.join(result.work_path, "rounds", "01-proposal")), false);
  const clarification = JSON.parse(fs.readFileSync(path.join(result.work_path, "input", "clarification.json"), "utf8"));
  assert.equal(clarification.questions.some((question) => /acceptance criteria/i.test(question.prompt)), false);
});

test("clarification answers allow proposal to continue", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-clarify-answers-"));
  copyDir(path.resolve("."), root);

  const result = await runCouncil(root, root, {
    mode: "plan",
    prompt: "Need help with the implementation.",
    clarification_answers: [
      {
        id: "clarify-summary",
        prompt: "What is the concrete request or outcome the council should optimize for?",
        answer: "Create a plan for a CLI command with tests."
      },
      {
        id: "clarify-acceptance",
        prompt: "What acceptance criteria or success signals should the council treat as the delivery target?",
        answer: "The CLI command works and has automated tests."
      },
      {
        id: "clarify-scope",
        prompt: "What is in scope for this request, and what should the council avoid expanding into?",
        answer: "Scope includes the command and tests only."
      },
      {
        id: "clarify-constraints",
        prompt: "What constraints, non-goals, or implementation boundaries must the council preserve?",
        answer: "Do not rewrite unrelated modules."
      }
    ]
  });

  assert.equal(result.status, "pending_approval");
  assert.equal(fs.existsSync(path.join(result.work_path, "rounds", "01-proposal")), true);
});

test("implicit acceptance criteria plus an explicit boundary can skip clarification", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-implicit-ac-"));
  copyDir(path.resolve("."), root);

  const result = await runCouncil(root, root, {
    mode: "plan",
    prompt: "Add an audit trail so every successful student update records an audit entry and the public API stays unchanged."
  });

  assert.equal(result.status, "pending_approval");
  const clarification = JSON.parse(fs.readFileSync(path.join(result.work_path, "input", "clarification.json"), "utf8"));
  assert.equal(clarification.status, "ready_for_planning");
  assert.equal(clarification.questions.some((question) => question.id === "clarify-scope"), false);
  assert.equal(clarification.questions.some((question) => /acceptance criteria/i.test(question.prompt)), false);
  assert.equal(clarification.questions.some((question) => /scope/i.test(question.prompt)), false);
  assert.equal(clarification.questions.some((question) => /boundary or non-goal/i.test(question.prompt)), false);
});

test("round response artifacts are registered even when providers are not auto-launched", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-response-artifacts-"));
  copyDir(path.resolve("."), root);
  const providersPath = path.join(root, "config", "providers.json");
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  providers.default_provider = "test-provider";
  providers.providers["test-provider"] = {
    enabled: true,
    command: "node",
    models: ["test-model"],
    timeout_ms: 1000,
    session_mode: "fresh",
    prompt_transport: "file",
    launch_command: ["node", "--version"]
  };
  fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2), "utf8");
  saveRepoSettings(root, {
    first_run_complete: true,
    default_provider: "test-provider",
    default_participant: {
      id: "agent-1",
      provider: "test-provider",
      model: "test-model",
      label: "Test Provider"
    },
    auto_launch: false,
    output_root: ".ai-council/result",
    council_agents: [
      { id: "agent-1", provider: "test-provider", model: "test-model", label: "Test Provider" }
    ],
    council_assignments: {
      axiom: "agent-1",
      vector: "agent-1",
      forge: "agent-1",
      sentinel: "agent-1"
    },
    stage_assignments: {
      proposal: ["agent-1"],
      critique: ["agent-1"],
      refinement: ["agent-1"],
      synthesis: ["agent-1"],
      validation: ["agent-1"]
    },
    provider_overrides: {}
  });

  const result = await runCouncil(root, root, {
    mode: "plan",
    prompt: "Create a plan.\n- Define the CLI\n- Add tests",
    launch: false,
    clarification_answers: clarificationAnswers()
  });

  const proposalDir = path.join(result.work_path, "rounds", "01-proposal");
  const proposalStage = result.deliberation_cycle.find((stage) => stage.stage === "proposal");
  const responseFiles = fs.readdirSync(proposalDir).filter((file) => file.endsWith(".response.md"));
  if (!proposalStage || proposalStage.participants.length === 0) {
    assert.equal(responseFiles.length, 0);
    return;
  }
  assert.equal(responseFiles.length > 0, true);

  const responseText = fs.readFileSync(path.join(proposalDir, responseFiles[0]), "utf8");
  assert.match(responseText, /Pending Provider Response|Provider Result|^#/);
});

test("placeholder and blocked provider responses are excluded from consensus packaging", () => {
  const pending = classifyStageResponseContent(`# Pending Provider Response

Stage: proposal
Participant: 5.2

The prompt was prepared, but the provider was not launched automatically in this run.
`);
  const blocked = classifyStageResponseContent(`# Provider Result

BLOCKED: The provider run did not produce Markdown output on stdout.
`);
  const actual = classifyStageResponseContent(`# Proposal

Ship the CLI with a resumable approval gate.
`);

  assert.equal(pending.kind, "pending");
  assert.equal(pending.meaningful, false);
  assert.equal(blocked.kind, "blocked");
  assert.equal(blocked.meaningful, false);
  assert.equal(actual.kind, "actual");
  assert.equal(actual.meaningful, true);

  const grouped = partitionStageResponses([
    { stage: "proposal", participant: "copilot", content: "# Pending Provider Response\n\nWaiting." },
    { stage: "critique", participant: "copilot", content: "# Provider Result\n\nBLOCKED: The provider run did not produce Markdown output on stdout." },
    { stage: "synthesis", participant: "copilot", content: "# Synthesis\n\nUse a numbered approval prompt." }
  ]);

  assert.equal(grouped.pending.length, 1);
  assert.equal(grouped.blocked.length, 1);
  assert.equal(grouped.actual.length, 1);
  assert.equal(grouped.actual[0].response_kind, "actual");
});

test("proposal participants use the same prior-stage artifact snapshot", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-stage-snapshot-"));
  copyDir(path.resolve("."), root);

  const providersPath = path.join(root, "config", "providers.json");
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  providers.default_provider = "test-provider";
  providers.providers = {
    "test-provider": {
      enabled: true,
      command: "node",
      models: ["model-a", "model-b"],
      timeout_ms: 1000,
      session_mode: "fresh",
      prompt_transport: "arg",
      launch_command: ["test-provider", "--prompt", "{{PROMPT_TEXT}}"]
    }
  };
  fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2), "utf8");

  saveRepoSettings(root, {
    first_run_complete: true,
    default_provider: "test-provider",
    default_participant: {
      id: "agent-1",
      provider: "test-provider",
      model: "model-a",
      label: "Test Provider A"
    },
    auto_launch: false,
    output_root: ".ai-council/result",
    council_agents: [
      { id: "agent-1", provider: "test-provider", model: "model-a", label: "Test Provider A" },
      { id: "agent-2", provider: "test-provider", model: "model-b", label: "Test Provider B" }
    ],
    council_assignments: {
      axiom: "agent-1",
      vector: "agent-1",
      forge: "agent-1",
      sentinel: "agent-1"
    },
    stage_assignments: {
      proposal: ["agent-1", "agent-2"],
      critique: ["agent-1"],
      refinement: ["agent-1"],
      synthesis: ["agent-1"],
      validation: ["agent-1"]
    },
    provider_overrides: {}
  });

  const result = await runCouncil(root, root, {
    mode: "plan",
    prompt: "Create a plan.\n- Define the CLI\n- Add tests",
    launch: false,
    clarification_answers: clarificationAnswers()
  });

  const proposalDir = path.join(result.work_path, "rounds", "01-proposal");
  const proposalPromptFiles = fs.readdirSync(proposalDir).filter((file) => file.endsWith(".prompt.md")).sort();
  assert.equal(proposalPromptFiles.length, 2);

  for (const promptFile of proposalPromptFiles) {
    const proposalPrompt = fs.readFileSync(path.join(proposalDir, promptFile), "utf8");
    assert.doesNotMatch(proposalPrompt, /## Prior Stage Artifacts/);
  }

  const critiqueDir = path.join(result.work_path, "rounds", "02-critique");
  const critiquePromptFile = fs.readdirSync(critiqueDir).find((file) => file.endsWith(".prompt.md"));
  assert.equal(Boolean(critiquePromptFile), true);
  const critiquePrompt = fs.readFileSync(path.join(critiqueDir, critiquePromptFile), "utf8");
  assert.match(critiquePrompt, /## Prior Stage Artifacts/);

  const proposalResponseFiles = fs.readdirSync(proposalDir).filter((file) => file.endsWith(".response.md")).sort();
  assert.equal(proposalResponseFiles.length, 2);
  for (const responseFile of proposalResponseFiles) {
    assert.match(critiquePrompt, new RegExp(escapeRegExp(`rounds/01-proposal/${responseFile}`)));
  }
});

test("proposal participants execute in parallel before later stages continue", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-stage-parallel-"));
  copyDir(path.resolve("."), root);

  const scriptPath = path.join(root, "sleep-provider.cjs");
  const eventLogPath = path.join(root, "provider-events.log");
  fs.writeFileSync(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const delay = Number(process.argv[2] ?? '0');",
      "const eventLogPath = process.argv[3];",
      "const promptFile = process.argv[4] ?? '';",
      "const stageLabel = `${path.basename(path.dirname(promptFile))}/${path.basename(promptFile, '.prompt.md')}`;",
      "fs.appendFileSync(eventLogPath, `${stageLabel}|start|${Date.now()}\\n`, 'utf8');",
      "setTimeout(() => {",
      "  fs.appendFileSync(eventLogPath, `${stageLabel}|end|${Date.now()}\\n`, 'utf8');",
      "  process.stdout.write(`# Response\\n\\nDelay ${delay}\\n`);",
      "}, delay);"
    ].join("\n"),
    "utf8"
  );

  const providersPath = path.join(root, "config", "providers.json");
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  providers.default_provider = "fast-provider";
  providers.providers = {
    "slow-provider": {
      enabled: true,
      command: "node",
      models: [],
      timeout_ms: 5000,
      session_mode: "fresh",
      prompt_transport: "file",
      launch_command: ["node", scriptPath, "600", eventLogPath, "{{PROMPT_FILE}}"]
    },
    "fast-provider": {
      enabled: true,
      command: "node",
      models: [],
      timeout_ms: 5000,
      session_mode: "fresh",
      prompt_transport: "file",
      launch_command: ["node", scriptPath, "10", eventLogPath, "{{PROMPT_FILE}}"]
    }
  };
  fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2), "utf8");

  saveRepoSettings(root, {
    first_run_complete: true,
    default_provider: "fast-provider",
    default_participant: {
      id: "fast-agent",
      provider: "fast-provider",
      model: "",
      label: "Fast Provider"
    },
    auto_launch: true,
    output_root: ".ai-council/result",
    council_agents: [
      { id: "slow-agent-1", provider: "slow-provider", model: "", label: "Slow Provider 1" },
      { id: "slow-agent-2", provider: "slow-provider", model: "", label: "Slow Provider 2" },
      { id: "fast-agent", provider: "fast-provider", model: "", label: "Fast Provider" }
    ],
    council_assignments: {
      axiom: "slow-agent-1",
      vector: "fast-agent",
      forge: "fast-agent",
      sentinel: "fast-agent"
    },
    stage_assignments: {
      proposal: ["slow-agent-1", "slow-agent-2"],
      critique: ["fast-agent"],
      refinement: ["fast-agent"],
      synthesis: ["fast-agent"],
      validation: ["fast-agent"]
    },
    provider_overrides: {}
  });

  const result = await runCouncil(root, root, {
    mode: "plan",
    prompt: "Create a plan.\n- Run proposal participants in parallel",
    launch: true,
    clarification_answers: clarificationAnswers()
  });

  assert.equal(result.ok, true);
  const eventLines = fs.readFileSync(eventLogPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const spans = new Map();
  for (const line of eventLines) {
    const [label, phase, timestamp] = line.split("|");
    if (!label || !phase || !timestamp) {
      continue;
    }

    const entry = spans.get(label) ?? {};
    entry[phase] = Number(timestamp);
    spans.set(label, entry);
  }

  const proposalOne = spans.get("01-proposal/slow-provider");
  const proposalTwo = spans.get("01-proposal/slow-provider-2");
  const critique = spans.get("02-critique/fast-provider");

  assert.equal(Boolean(proposalOne?.start && proposalOne?.end), true);
  assert.equal(Boolean(proposalTwo?.start && proposalTwo?.end), true);
  assert.equal(Boolean(critique?.start), true);
  assert.equal(proposalOne.start < proposalTwo.end && proposalTwo.start < proposalOne.end, true);
  assert.equal(critique.start >= Math.max(proposalOne.end, proposalTwo.end), true);
});

test("cli run inherits repo auto-launch when --launch is omitted", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-cli-launch-"));
  copyDir(path.resolve("."), root);

  const output = [];
  const originalLog = console.log;
  console.log = (value) => output.push(String(value));

  try {
    await main([
      "run",
      "--root", root,
      "--repo", root,
      "--mode", "plan",
      "--prompt", "Create a plan.\n- Define the CLI\n- Add tests",
      "--title", "CLI launch default"
    ]);
  } finally {
    console.log = originalLog;
  }

  const result = JSON.parse(output.join("\n"));
  assert.equal(result.ok, true);
  const session = JSON.parse(fs.readFileSync(path.join(result.work_path, "session", "session.json"), "utf8"));
  assert.equal(session.effective_config.launch, true);
});

test("resume exposes pending approval actions and approval can export AWF artifacts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-approval-"));
  copyDir(path.resolve("."), root);

  const result = await runCouncil(root, root, {
    mode: "plan",
    title: "Add council planning",
    prompt: "Create a plan.\n- Define the CLI\n- Add tests",
    clarification_answers: clarificationAnswers()
  });

  const resumed = resumeLatest(root, root);
  assert.equal(resumed.status, "pending_approval");
  assert.deepEqual(resumed.available_actions, ["approve", "request_changes", "reject"]);

  const approved = await decideLatest(root, root, {
    decision: "approve",
    create_awf: true
  });

  assert.equal(approved.status, "approved");
  assert.equal(fs.existsSync(path.join(root, ".wi", "story.json")), true);
  assert.equal(fs.existsSync(path.join(root, ".wi", "tasks.json")), true);
  assert.equal(fs.existsSync(path.join(root, ".wi", "plan.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".wi", "implementation-outline.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".wi", "runtime", "task.json")), true);
  assert.equal(fs.existsSync(path.join(root, ".wi", "runtime", "council-handoff.md")), true);
  const state = JSON.parse(fs.readFileSync(path.join(root, ".wi", "state.json"), "utf8"));
  assert.equal(state.current_phase, "implementation");
  assert.equal(typeof state.active_task_id, "string");
  const runtimeTask = JSON.parse(fs.readFileSync(path.join(root, ".wi", "runtime", "task.json"), "utf8"));
  assert.equal(runtimeTask.task.id, state.active_task_id);
  assert.equal(runtimeTask.adapter.handoff_file, ".wi/runtime/council-handoff.md");
});

test("AWF export preserves existing repo config while seeding the implementation packet", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-awf-config-"));
  copyDir(path.resolve("."), root);

  fs.mkdirSync(path.join(root, ".wi"), { recursive: true });
  fs.writeFileSync(path.join(root, ".wi", "config.json"), JSON.stringify({
    default_adapter: "claude",
    default_verification: ["npm test"],
    phase_execution: {
      planning: {
        adapter: "gemini",
        model: "gemini-2.5-pro",
        agent: "awf-planner",
        custom_prompt: "Preserve planning guidance."
      },
      implementation: {
        adapter: "claude",
        model: "claude-sonnet-4-5",
        agent: "awf-implementer",
        custom_prompt: null
      }
    },
    adapters: {
      claude: { enabled: true },
      gemini: { enabled: true }
    },
    story_sources: {
      jira: {
        enabled: false
      }
    }
  }, null, 2), "utf8");

  await runCouncil(root, root, {
    mode: "plan",
    title: "Preserve AWF config",
    prompt: "Create a plan.\n- Keep existing AWF planning settings\n- Seed an implementation handoff packet",
    clarification_answers: clarificationAnswers()
  });

  await decideLatest(root, root, {
    decision: "approve",
    create_awf: true
  });

  const awfConfig = JSON.parse(fs.readFileSync(path.join(root, ".wi", "config.json"), "utf8"));
  assert.equal(awfConfig.default_adapter, "claude");
  assert.deepEqual(awfConfig.default_verification, ["npm test"]);
  assert.equal(awfConfig.phase_execution.planning.adapter, "gemini");
  assert.equal(awfConfig.phase_execution.planning.model, "gemini-2.5-pro");
  assert.equal(awfConfig.phase_execution.review.agent, "awf-reviewer");
  assert.equal(awfConfig.story_sources.jira.enabled, false);

  const runtimeTask = JSON.parse(fs.readFileSync(path.join(root, ".wi", "runtime", "task.json"), "utf8"));
  assert.equal(runtimeTask.task != null, true);
  assert.equal(runtimeTask.adapter.name, "claude");
  assert.equal(runtimeTask.adapter.model, "claude-sonnet-4-5");
});

test("large approved results can be previewed and split into multiple structured stories", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-story-split-"));
  copyDir(path.resolve("."), root);

  const result = await runCouncil(root, root, {
    mode: "plan",
    title: "Split large result",
    prompt: [
      "Create a plan.",
      "- Define the CLI shell UX",
      "- Add the approval packaging flow",
      "- Add structured story exports",
      "- Preserve existing AWF config",
      "- Generate a first runtime packet",
      "- Add tests for split story export",
      "- Add tests for single story AWF export"
    ].join("\n"),
    clarification_answers: clarificationAnswers()
  });

  const preview = previewLatestStoryPackaging(root, root);
  assert.equal(preview.is_large_result, true);
  assert.equal(preview.can_split, true);
  assert.equal(preview.suggested_story_count >= 2, true);

  const approved = await decideLatest(root, root, {
    decision: "approve",
    story_export_mode: "split"
  });

  assert.equal(approved.status, "approved");
  assert.equal(approved.story_export.mode, "split");
  assert.equal(approved.story_export.story_count >= 2, true);
  assert.equal(fs.existsSync(path.join(root, ".wi")), false);

  const manifest = JSON.parse(fs.readFileSync(path.join(result.result_path, "story-export", "split-stories", "manifest.json"), "utf8"));
  assert.equal(manifest.story_count >= 2, true);
  const firstStoryPath = path.join(root, manifest.stories[0].json_path);
  const firstStory = JSON.parse(fs.readFileSync(firstStoryPath, "utf8"));
  assert.equal(typeof firstStory.description, "string");
  assert.equal(Array.isArray(firstStory.tasks), true);
  assert.equal(Array.isArray(firstStory.acceptance_criteria), true);
  assert.equal(Array.isArray(firstStory.references), true);
});

test("story export with multiple council agents requires an explicit ticket agent selection", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-story-agent-"));
  copyDir(path.resolve("."), root);

  const providersPath = path.join(root, "config", "providers.json");
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  providers.default_provider = "test-provider";
  providers.providers = {
    "test-provider": {
      enabled: true,
      command: "node",
      models: [],
      timeout_ms: 2000,
      session_mode: "fresh",
      prompt_transport: "file",
      launch_command: ["node", "-e", "process.stdout.write('# Response\\n')", "{{PROMPT_FILE}}"]
    }
  };
  fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2), "utf8");

  saveRepoSettings(root, {
    first_run_complete: true,
    default_provider: "test-provider",
    default_participant: {
      id: "agent-1",
      provider: "test-provider",
      model: "model-a",
      label: "Story Agent A"
    },
    auto_launch: false,
    output_root: ".ai-council/result",
    council_agents: [
      { id: "agent-1", provider: "test-provider", model: "model-a", label: "Story Agent A" },
      { id: "agent-2", provider: "test-provider", model: "model-b", label: "Story Agent B" }
    ],
    council_assignments: {
      axiom: "agent-1",
      vector: "agent-1",
      forge: "agent-1",
      sentinel: "agent-1"
    },
    stage_assignments: {
      proposal: ["agent-1", "agent-2"],
      critique: ["agent-1"],
      refinement: ["agent-1"],
      synthesis: ["agent-1"],
      validation: ["agent-1"]
    },
    provider_overrides: {}
  });

  const result = await runCouncil(root, root, {
    mode: "plan",
    title: "Story agent selection",
    prompt: [
      "Create a plan.",
      "- Define the CLI shell UX",
      "- Add the approval packaging flow",
      "- Add structured story exports",
      "- Preserve existing AWF config",
      "- Generate a first runtime packet",
      "- Add tests for split story export"
    ].join("\n"),
    clarification_answers: clarificationAnswers()
  });

  const preview = previewLatestStoryPackaging(root, root);
  assert.equal(Array.isArray(preview.story_agents), true);
  assert.equal(preview.story_agents.length, 2);
  assert.equal(preview.story_agent_required, true);

  await assert.rejects(
    () => decideLatest(root, root, {
      decision: "approve",
      story_export_mode: "split"
    }),
    /requires selecting which AI agent will create the tickets/i
  );

  const approved = await decideLatest(root, root, {
    decision: "approve",
    story_export_mode: "split",
    story_agent: "agent-2"
  });

  assert.equal(approved.status, "approved");
  assert.equal(approved.story_export.ticket_agent.id, "agent-2");
  assert.equal(approved.story_export.ticket_agent.label, "Story Agent B");

  const manifest = JSON.parse(fs.readFileSync(path.join(result.result_path, "story-export", "split-stories", "manifest.json"), "utf8"));
  assert.equal(manifest.ticket_agent.id, "agent-2");
  const firstStoryPath = path.join(root, manifest.stories[0].json_path);
  const firstStory = JSON.parse(fs.readFileSync(firstStoryPath, "utf8"));
  assert.equal(firstStory.ticket_agent.id, "agent-2");
});

test("single story approval export can package a structured story and seed AWF together", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-story-single-"));
  copyDir(path.resolve("."), root);

  const result = await runCouncil(root, root, {
    mode: "plan",
    title: "Single story export",
    prompt: [
      "Create a plan.",
      "- Define the CLI shell UX",
      "- Add the approval packaging flow",
      "- Add structured story exports",
      "- Preserve existing AWF config",
      "- Generate a first runtime packet",
      "- Add tests for split story export"
    ].join("\n"),
    clarification_answers: clarificationAnswers()
  });

  const approved = await decideLatest(root, root, {
    decision: "approve",
    story_export_mode: "single",
    create_awf: true
  });

  assert.equal(approved.status, "approved");
  assert.equal(approved.story_export.mode, "single");
  assert.equal(fs.existsSync(path.join(result.result_path, "story-export", "single-story", "story.json")), true);
  assert.equal(fs.existsSync(path.join(result.result_path, "story-export", "single-story", "story.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".wi", "story.json")), true);
  assert.equal(fs.existsSync(path.join(root, ".wi", "runtime", "task.json")), true);

  const storyPackage = JSON.parse(fs.readFileSync(path.join(result.result_path, "story-export", "single-story", "story.json"), "utf8"));
  assert.equal(Array.isArray(storyPackage.tasks), true);
  assert.equal(Array.isArray(storyPackage.acceptance_criteria), true);
  assert.equal(Array.isArray(storyPackage.references), true);
});

test("design approval export carries the solution design into AWF implementation artifacts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-design-awf-"));
  copyDir(path.resolve("."), root);

  await runCouncil(root, root, {
    mode: "design",
    title: "Design AWF handoff",
    prompt: "Design the export path.\n- Preserve existing AWF config\n- Generate a first implementation task packet",
    clarification_answers: clarificationAnswers()
  });

  await decideLatest(root, root, {
    decision: "approve",
    create_awf: true
  });

  assert.equal(fs.existsSync(path.join(root, ".wi", "solution-design.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".wi", "plan.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".wi", "runtime", "council-handoff.md")), true);

  const runtimeTask = JSON.parse(fs.readFileSync(path.join(root, ".wi", "runtime", "task.json"), "utf8"));
  assert.equal(runtimeTask.task != null, true);
  assert.equal(runtimeTask.optional_context_files.includes(".wi/solution-design.md"), true);
});

test("request changes reruns the latest process and leaves the new result pending approval", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-request-changes-"));
  copyDir(path.resolve("."), root);

  const initial = await runCouncil(root, root, {
    mode: "plan",
    title: "Refine approval loop",
    prompt: "Create a plan.\n- Update the approval loop\n- Add tests",
    clarification_answers: clarificationAnswers()
  });

  const requested = await decideLatest(root, root, {
    decision: "request_changes",
    prompt: "Add a follow-up task that explicitly covers resuming pending approvals."
  });

  assert.equal(requested.status, "pending_approval");
  assert.equal(requested.current_stage, "awaiting_approval");
  assert.deepEqual(requested.available_actions, ["approve", "request_changes", "reject"]);
  assert.notEqual(requested.rerun.run_id, initial.run_id);

  const resumed = resumeLatest(root, root);
  assert.equal(resumed.status, "pending_approval");
  assert.equal(resumed.current_stage, "awaiting_approval");
  assert.deepEqual(resumed.available_actions, ["approve", "request_changes", "reject"]);

  const latestTicket = fs.readFileSync(path.join(requested.rerun.work_path, "input", "extra-context.md"), "utf8");
  assert.match(latestTicket, /Revision Request/);
  assert.match(latestTicket, /resuming pending approvals/i);
});

test("custom output root is respected", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-output-"));
  copyDir(path.resolve("."), root);

  const result = await runCouncil(root, root, {
    mode: "plan",
    prompt: "Create a plan.",
    output_root: "custom-results"
  });

  assert.equal(result.ok, true);
  assert.match(result.run_path, /custom-results/);
});

test("review mode writes evidence artifacts and review package", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-review-"));
  copyDir(path.resolve("."), root);

  const repo = path.join(root, "sample-repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.mkdirSync(path.join(repo, "tests"), { recursive: true });
  fs.writeFileSync(path.join(repo, "README.md"), "# Sample\n", "utf8");
  fs.writeFileSync(path.join(repo, "src", "index.js"), "export const ok = true;\n", "utf8");
  fs.writeFileSync(path.join(repo, "tests", "index.test.js"), "// test\n", "utf8");

  const result = await runCouncil(root, root, {
    mode: "review",
    prompt: "Review whether the repo meets the ticket.",
    repo,
    clarification_answers: clarificationAnswers()
  });

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(result.work_path, "repo", "evidence-map.json")), true);
  assert.equal(fs.existsSync(path.join(result.result_path, "scorecard.json")), true);
  assert.equal(fs.existsSync(path.join(result.work_path, "session", "visual-reference.json")), true);

  const evidence = JSON.parse(fs.readFileSync(path.join(result.work_path, "repo", "evidence-map.json"), "utf8"));
  assert.equal(evidence.test_count, 1);
});

test("semantic clarification payloads preserve story-specific blocking questions", () => {
  const normalized = normalizeClarificationResult({
    status: "needs_clarification",
    summary: "The request needs a concrete completion signal before proposal starts.",
    questions: [
      {
        id: "CLARIFY-Q001",
        prompt: "Reading \"Add audit trail\", what observable outcome proves the work is done?",
        required: true,
        observation: "The ticket names the feature but not the completion condition.",
        answer_guidance: "State the observable system outcome in one sentence."
      }
    ],
    risks: [
      {
        code: "missing_completion_signal",
        level: "blocking",
        summary: "Planning would guess at the delivery target."
      }
    ]
  });

  assert.equal(normalized.status, "needs_clarification");
  assert.equal(normalized.blocking_question_count, 1);
  assert.match(normalized.questions[0].prompt, /observable outcome proves the work is done/i);
  assert.match(normalized.questions[0].observation, /completion condition/i);
  assert.equal(normalized.risks[0].code, "missing_completion_signal");
});

test("clarifyLatest continues the council after clarification answers are supplied", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-ai-clarify-latest-"));
  copyDir(path.resolve("."), root);

  const providersPath = path.join(root, "config", "providers.json");
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  providers.default_provider = "test-provider";
  providers.providers = {
    "test-provider": {
      enabled: true,
      command: "node",
      models: [],
      timeout_ms: 3000,
      session_mode: "fresh",
      prompt_transport: "stdin",
      launch_command: [
        "node",
        "-e",
        "let data='';process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>{if(data.includes('AI Agents Council Clarification Prompt')){process.stdout.write(JSON.stringify({status:'needs_clarification',summary:'Need one blocking clarification.',questions:[{id:'CLARIFY-Q001',prompt:'Reading \"Add audit trail\", what observable outcome proves the work is done?',required:true}],risks:[{code:'missing_completion_signal',level:'blocking',summary:'Planning would guess at the delivery target.'}]}));}else{process.stdout.write('# Proposal\\n\\nThe council can proceed with the clarified request.');}});"
      ]
    }
  };
  fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2), "utf8");

  saveRepoSettings(root, {
    first_run_complete: true,
    default_provider: "test-provider",
    default_participant: {
      id: "agent-1",
      provider: "test-provider",
      model: null,
      label: "Semantic Clarifier"
    },
    auto_launch: true,
    output_root: ".ai-council/result",
    council_agents: [
      { id: "agent-1", provider: "test-provider", model: null, label: "Semantic Clarifier" }
    ],
    council_assignments: {
      axiom: "agent-1",
      vector: "agent-1",
      forge: "agent-1",
      sentinel: "agent-1"
    },
    stage_assignments: {
      proposal: ["agent-1"],
      critique: ["agent-1"],
      refinement: ["agent-1"],
      synthesis: ["agent-1"],
      validation: ["agent-1"]
    },
    provider_overrides: {}
  });

  const first = await runCouncil(root, root, {
    mode: "plan",
    prompt: "Add audit trail",
    launch: true
  });

  assert.equal(first.status, "awaiting_clarification");

  const clarified = await clarifyLatest(root, root, {
    clarification_answers: [
      {
        id: "CLARIFY-Q001",
        prompt: first.questions[0].prompt,
        answer: "A successful student update writes an audit entry and preserves the current public API contract."
      }
    ]
  });

  assert.equal(clarified.status, "pending_approval");
  assert.equal(fs.existsSync(path.join(clarified.work_path, "rounds", "01-proposal")), true);
  const clarification = JSON.parse(fs.readFileSync(path.join(clarified.work_path, "input", "clarification.json"), "utf8"));
  assert.equal(clarification.source, "answered");
  assert.equal(clarification.answered_questions.length, 1);
});

test("nested repo paths resolve to the repo root for outputs and provider launch context", async () => {
  const frameworkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-framework-"));
  copyDir(path.resolve("."), frameworkRoot);

  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-target-"));
  fs.mkdirSync(path.join(targetRepo, ".git"), { recursive: true });
  const nestedRepoPath = path.join(targetRepo, "src", "features");
  fs.mkdirSync(nestedRepoPath, { recursive: true });

  const providersPath = path.join(frameworkRoot, "config", "providers.json");
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  providers.default_provider = "test-provider";
  providers.providers = {
    "test-provider": {
      enabled: true,
      command: "node",
      models: ["test-model"],
      timeout_ms: 1000,
      session_mode: "fresh",
      prompt_transport: "arg",
      launch_command: ["test-provider", "--cwd", "{{WORKING_DIRECTORY}}", "--artifacts", "{{ARTIFACT_DIRECTORY}}", "--prompt", "{{PROMPT_TEXT}}"]
    }
  };
  fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2), "utf8");

  saveRepoSettings(targetRepo, {
    first_run_complete: true,
    default_provider: "test-provider",
    default_participant: {
      id: "agent-1",
      provider: "test-provider",
      model: "test-model",
      label: "Test Provider"
    },
    auto_launch: false,
    output_root: ".ai-council/result",
    council_agents: [
      { id: "agent-1", provider: "test-provider", model: "test-model", label: "Test Provider" }
    ],
    council_assignments: {
      axiom: "agent-1",
      vector: "agent-1",
      forge: "agent-1",
      sentinel: "agent-1"
    },
    stage_assignments: {
      proposal: ["agent-1"],
      critique: ["agent-1"],
      refinement: ["agent-1"],
      synthesis: ["agent-1"],
      validation: ["agent-1"]
    },
    provider_overrides: {}
  });

  const result = await runCouncil(frameworkRoot, nestedRepoPath, {
    mode: "plan",
    prompt: "Create a plan.\n- Keep outputs rooted at the repository base",
    launch: false,
    clarification_answers: clarificationAnswers()
  });

  assert.equal(result.run_path.startsWith(path.join(targetRepo, ".ai-council", "result")), true);

  const launches = JSON.parse(fs.readFileSync(path.join(result.work_path, "logs", "provider-launches.json"), "utf8"));
  assert.equal(launches.length > 0, true);
  assert.equal(String(launches[0].command_preview).includes(targetRepo), true);
  assert.equal(String(launches[0].command_preview).includes(result.work_path), true);
});

test("review mode resolves a nested repo path to the repository root", async () => {
  const frameworkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-framework-review-"));
  copyDir(path.resolve("."), frameworkRoot);

  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-review-target-"));
  fs.mkdirSync(path.join(targetRepo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(targetRepo, "src", "feature"), { recursive: true });
  fs.mkdirSync(path.join(targetRepo, "tests"), { recursive: true });
  fs.writeFileSync(path.join(targetRepo, "README.md"), "# Review Target\n", "utf8");
  fs.writeFileSync(path.join(targetRepo, "src", "feature", "index.js"), "export const ready = true;\n", "utf8");
  fs.writeFileSync(path.join(targetRepo, "tests", "feature.test.js"), "// ok\n", "utf8");

  const result = await runCouncil(frameworkRoot, path.join(targetRepo, "src", "feature"), {
    mode: "review",
    prompt: "Review the implementation against the ticket.",
    launch: false,
    clarification_answers: clarificationAnswers()
  });

  assert.equal(result.evidence_summary.repo_path, targetRepo);
});

test("review mode stops when source materials cannot be accessed", async () => {
  const frameworkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-framework-blocked-"));
  copyDir(path.resolve("."), frameworkRoot);

  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-empty-review-target-"));
  fs.mkdirSync(path.join(targetRepo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(targetRepo, "src"), { recursive: true });

  await assert.rejects(
    async () => runCouncil(frameworkRoot, path.join(targetRepo, "src"), {
      mode: "review",
      prompt: "Review the implementation against the ticket.",
      launch: false,
      clarification_answers: clarificationAnswers()
    }),
    /Unable to access required source materials for comprehensive architectural review/
  );
});

test("configured but unavailable providers stop the run instead of silently dropping participants", async () => {
  const frameworkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-framework-providers-"));
  copyDir(path.resolve("."), frameworkRoot);

  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-provider-target-"));
  fs.mkdirSync(path.join(targetRepo, ".git"), { recursive: true });

  const providersPath = path.join(frameworkRoot, "config", "providers.json");
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  providers.default_provider = "ready-provider";
  providers.providers = {
    "ready-provider": {
      enabled: true,
      command: "node",
      models: ["ready-model"],
      timeout_ms: 1000,
      session_mode: "fresh",
      prompt_transport: "arg",
      launch_command: ["ready-provider", "--prompt", "{{PROMPT_TEXT}}"]
    },
    "missing-provider": {
      enabled: true,
      command: "definitely-missing-ai-cli",
      models: ["missing-model"],
      timeout_ms: 1000,
      session_mode: "fresh",
      prompt_transport: "arg",
      launch_command: ["missing-provider", "--prompt", "{{PROMPT_TEXT}}"]
    }
  };
  fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2), "utf8");

  saveRepoSettings(targetRepo, {
    first_run_complete: true,
    default_provider: "ready-provider",
    default_participant: {
      id: "agent-1",
      provider: "ready-provider",
      model: "ready-model",
      label: "Ready Provider"
    },
    auto_launch: false,
    output_root: ".ai-council/result",
    council_agents: [
      { id: "agent-1", provider: "ready-provider", model: "ready-model", label: "Ready Provider" },
      { id: "agent-2", provider: "missing-provider", model: "missing-model", label: "Missing Provider" }
    ],
    council_assignments: {
      axiom: "agent-1",
      vector: "agent-1",
      forge: "agent-1",
      sentinel: "agent-1"
    },
    stage_assignments: {
      proposal: ["agent-1", "agent-2"],
      critique: [],
      refinement: [],
      synthesis: [],
      validation: []
    },
    provider_overrides: {}
  });

  await assert.rejects(
    async () => runCouncil(frameworkRoot, targetRepo, {
      mode: "plan",
      prompt: "Create a plan.\n- Use both configured participants",
      launch: false,
      clarification_answers: clarificationAnswers()
    }),
    /Configured council agents are unavailable/
  );
});

test("later stages use the shared ticket summary instead of repeating the full ticket body", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-shared-summary-"));
  copyDir(path.resolve("."), root);

  const deepMarker = "UNIQUE-DEEP-MARKER";
  const result = await runCouncil(root, root, {
    mode: "plan",
    title: "Shared ticket context",
    prompt: [
      "Ship the council export flow.",
      "- Keep the public API unchanged.",
      "- Add automated tests.",
      `Extended background: ${"details ".repeat(80)}${deepMarker}`
    ].join("\n"),
    launch: false,
    clarification_answers: clarificationAnswers()
  });

  const proposalDir = path.join(result.work_path, "rounds", "01-proposal");
  const critiqueDir = path.join(result.work_path, "rounds", "02-critique");
  const proposalPromptFile = fs.readdirSync(proposalDir).find((file) => file.endsWith(".prompt.md"));
  const critiquePromptFile = fs.readdirSync(critiqueDir).find((file) => file.endsWith(".prompt.md"));
  const proposalPrompt = fs.readFileSync(path.join(proposalDir, proposalPromptFile), "utf8");
  const critiquePrompt = fs.readFileSync(path.join(critiqueDir, critiquePromptFile), "utf8");

  assert.match(proposalPrompt, /<canonical_ticket>/);
  assert.match(proposalPrompt, new RegExp(escapeRegExp(deepMarker)));
  assert.match(critiquePrompt, /<shared_ticket_summary>/);
  assert.match(critiquePrompt, /input\/ticket-summary\.md/);
  assert.doesNotMatch(critiquePrompt, new RegExp(escapeRegExp(deepMarker)));
});

test("stage prompts reference supplemental context artifacts when they are provided", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-extra-context-"));
  copyDir(path.resolve("."), root);

  const providersPath = path.join(root, "config", "providers.json");
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  providers.default_provider = "test-provider";
  providers.providers = {
    "test-provider": {
      enabled: true,
      command: "node",
      models: [],
      timeout_ms: 2000,
      session_mode: "fresh",
      prompt_transport: "file",
      launch_command: ["node", "-e", "process.stdout.write('# Response\\n')", "{{PROMPT_FILE}}"]
    }
  };
  fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2), "utf8");

  saveRepoSettings(root, {
    first_run_complete: true,
    default_provider: "test-provider",
    default_participant: {
      id: "agent-1",
      provider: "test-provider",
      model: null,
      label: "Test Provider"
    },
    auto_launch: false,
    output_root: ".ai-council/result",
    council_agents: [
      { id: "agent-1", provider: "test-provider", model: null, label: "Test Provider" }
    ],
    council_assignments: {
      axiom: "agent-1",
      vector: "agent-1",
      forge: "agent-1",
      sentinel: "agent-1"
    },
    stage_assignments: {
      proposal: ["agent-1"],
      critique: ["agent-1"],
      refinement: ["agent-1"],
      synthesis: ["agent-1"],
      validation: ["agent-1"]
    },
    provider_overrides: {}
  });

  const extraContextPath = path.join(root, "extra-context-source.md");
  const constraintsPath = path.join(root, "constraints-source.md");
  fs.writeFileSync(extraContextPath, "# Background\n\nSequence the rollout carefully to avoid audit gaps.\n", "utf8");
  fs.writeFileSync(constraintsPath, "# Constraints\n\n- Preserve the public API.\n", "utf8");

  const result = await runCouncil(root, root, {
    mode: "plan",
    prompt: "Add audit logging for successful student updates.",
    "extra-context-file": extraContextPath,
    "constraints-file": constraintsPath,
    launch: false,
    clarification_answers: clarificationAnswers()
  });

  const proposalDir = path.join(result.work_path, "rounds", "01-proposal");
  const proposalPromptFile = fs.readdirSync(proposalDir).find((file) => file.endsWith(".prompt.md"));
  const proposalPrompt = fs.readFileSync(path.join(proposalDir, proposalPromptFile), "utf8");

  assert.match(proposalPrompt, /## Additional Context Artifacts/);
  assert.match(proposalPrompt, /input\/extra-context\.md/);
  assert.match(proposalPrompt, /input\/constraints\.md/);
  assert.match(proposalPrompt, /Sequence the rollout carefully to avoid audit gaps/i);
  assert.match(proposalPrompt, /Preserve the public API/i);
});

test("review prompts reference generated repository evidence artifacts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-review-context-"));
  copyDir(path.resolve("."), root);
  fs.writeFileSync(path.join(root, "review-target.js"), "export const ok = true;\n", "utf8");

  const providersPath = path.join(root, "config", "providers.json");
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  providers.default_provider = "test-provider";
  providers.providers = {
    "test-provider": {
      enabled: true,
      command: "node",
      models: [],
      timeout_ms: 2000,
      session_mode: "fresh",
      prompt_transport: "file",
      launch_command: ["node", "-e", "process.stdout.write('# Response\\n')", "{{PROMPT_FILE}}"]
    }
  };
  fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2), "utf8");

  saveRepoSettings(root, {
    first_run_complete: true,
    default_provider: "test-provider",
    default_participant: {
      id: "agent-1",
      provider: "test-provider",
      model: null,
      label: "Test Provider"
    },
    auto_launch: false,
    output_root: ".ai-council/result",
    council_agents: [
      { id: "agent-1", provider: "test-provider", model: null, label: "Test Provider" }
    ],
    council_assignments: {
      axiom: "agent-1",
      vector: "agent-1",
      forge: "agent-1",
      sentinel: "agent-1"
    },
    stage_assignments: {
      proposal: ["agent-1"],
      critique: ["agent-1"],
      refinement: ["agent-1"],
      synthesis: ["agent-1"],
      validation: ["agent-1"]
    },
    provider_overrides: {}
  });

  const result = await runCouncil(root, root, {
    mode: "review",
    prompt: "Review the implementation for correctness and completeness.",
    launch: false,
    clarification_answers: clarificationAnswers()
  });

  const proposalDir = path.join(result.work_path, "rounds", "01-proposal");
  const proposalPromptFile = fs.readdirSync(proposalDir).find((file) => file.endsWith(".prompt.md"));
  const proposalPrompt = fs.readFileSync(path.join(proposalDir, proposalPromptFile), "utf8");

  assert.match(proposalPrompt, /input\/review-target\.md/);
  assert.match(proposalPrompt, /repo\/file-index\.json/);
  assert.match(proposalPrompt, /repo\/evidence-map\.json/);
});

test("clear tickets skip the AI clarification round-trip before proposal starts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-skip-clarification-"));
  copyDir(path.resolve("."), root);

  const promptLogPath = path.join(root, "provider-prompts.log");
  const scriptPath = path.join(root, "record-provider.cjs");
  fs.writeFileSync(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const logPath = process.argv[2];",
      "let data = '';",
      "process.stdin.on('data', chunk => data += chunk);",
      "process.stdin.on('end', () => {",
      "  fs.appendFileSync(logPath, data + '\\n---PROMPT---\\n', 'utf8');",
      "  process.stdout.write('# Response\\n\\nReady.');",
      "});"
    ].join("\n"),
    "utf8"
  );

  const providersPath = path.join(root, "config", "providers.json");
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  providers.default_provider = "test-provider";
  providers.providers = {
    "test-provider": {
      enabled: true,
      command: "node",
      models: [],
      timeout_ms: 2000,
      session_mode: "fresh",
      prompt_transport: "stdin",
      launch_command: ["node", scriptPath, promptLogPath]
    }
  };
  fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2), "utf8");

  saveRepoSettings(root, {
    first_run_complete: true,
    default_provider: "test-provider",
    default_participant: {
      id: "agent-1",
      provider: "test-provider",
      model: null,
      label: "Test Provider"
    },
    auto_launch: true,
    output_root: ".ai-council/result",
    council_agents: [
      { id: "agent-1", provider: "test-provider", model: null, label: "Test Provider" }
    ],
    council_assignments: {
      axiom: "agent-1",
      vector: "agent-1",
      forge: "agent-1",
      sentinel: "agent-1"
    },
    stage_assignments: {
      proposal: ["agent-1"],
      critique: ["agent-1"],
      refinement: ["agent-1"],
      synthesis: ["agent-1"],
      validation: ["agent-1"]
    },
    provider_overrides: {}
  });

  const result = await runCouncil(root, root, {
    mode: "plan",
    prompt: [
      "Add audit logging for successful student updates.",
      "- Record an audit entry for every successful student update.",
      "- Keep the public API unchanged."
    ].join("\n"),
    launch: true
  });

  assert.equal(result.status, "pending_approval");
  assert.equal(fs.existsSync(path.join(result.work_path, "clarification", "axiom.prompt.md")), false);

  const clarification = JSON.parse(fs.readFileSync(path.join(result.work_path, "input", "clarification.json"), "utf8"));
  assert.equal(clarification.source, "heuristic");
  assert.equal(clarification.status, "ready_for_planning");

  const promptLog = fs.readFileSync(promptLogPath, "utf8");
  assert.doesNotMatch(promptLog, /AI Agents Council Clarification Prompt/);
});
