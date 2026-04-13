import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { clarifyLatest, runCouncil } from "../src/core/workflow.js";
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

test("clarifyLatest resumes in the same run folder instead of creating a second run", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-clarify-resume-"));
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

  const resultRoot = path.join(root, ".ai-council", "result");
  const initialRunCount = fs.existsSync(resultRoot)
    ? fs.readdirSync(resultRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
    : 0;

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
  assert.equal(clarified.run_id, first.run_id);
  assert.equal(clarified.run_path, first.run_path);
  assert.equal(clarified.work_path, first.work_path);
  assert.equal(fs.existsSync(path.join(clarified.work_path, "rounds", "01-proposal")), true);

  const clarification = JSON.parse(fs.readFileSync(path.join(clarified.work_path, "input", "clarification.json"), "utf8"));
  assert.equal(clarification.source, "answered");
  assert.equal(clarification.answered_questions.length, 1);
  assert.equal(
    fs.readdirSync(resultRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length,
    initialRunCount + 1
  );
});
