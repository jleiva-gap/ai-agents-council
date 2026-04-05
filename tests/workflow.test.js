import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { classifyStageResponseContent, decideLatest, partitionStageResponses, resumeLatest, runCouncil } from "../src/core/workflow.js";
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

test("round response artifacts are registered even when providers are not auto-launched", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-response-artifacts-"));
  copyDir(path.resolve("."), root);
  const providersPath = path.join(root, "config", "providers.json");
  const providers = JSON.parse(fs.readFileSync(providersPath, "utf8"));
  providers.default_provider = "test-provider";
  providers.providers["test-provider"] = {
    enabled: true,
    command: "where",
    models: ["test-model"],
    timeout_ms: 1000,
    session_mode: "fresh",
    prompt_transport: "file",
    launch_command: ["where", "where"]
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

  const approved = decideLatest(root, root, {
    decision: "approve",
    create_awf: true
  });

  assert.equal(approved.status, "approved");
  assert.equal(fs.existsSync(path.join(root, ".wi", "story.json")), true);
  assert.equal(fs.existsSync(path.join(root, ".wi", "tasks.json")), true);
  const state = JSON.parse(fs.readFileSync(path.join(root, ".wi", "state.json"), "utf8"));
  assert.equal(state.current_phase, "implementation_ready");
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
