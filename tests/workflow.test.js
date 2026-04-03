import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCouncil } from "../src/core/workflow.js";

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

test("plan mode normalizes prompt input and writes final artifacts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-plan-"));
  copyDir(path.resolve("."), root);

  const result = await runCouncil(root, root, {
    mode: "plan",
    title: "Add council planning",
    prompt: "Create a plan.\n- Define the CLI\n- Add tests"
  });

  assert.equal(result.ok, true);
  assert.match(result.run_path, /[\\\/]\.ai-council[\\\/]result[\\\/]/);
  assert.equal(fs.existsSync(path.join(result.result_path, "final-plan.md")), true);
  assert.equal(fs.existsSync(path.join(result.result_path, "tasks.json")), true);
  assert.equal(fs.existsSync(path.join(result.work_path, "input", "ticket-definition.md")), true);
  assert.equal(fs.existsSync(path.join(result.work_path, "logs", "session.log")), true);
  assert.equal(fs.existsSync(path.join(result.work_path, "session", "visual-reference.md")), true);
  assert.equal(fs.existsSync(path.join(result.work_path, "session", "deliberation-plan.json")), true);

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
    repo
  });

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(result.work_path, "repo", "evidence-map.json")), true);
  assert.equal(fs.existsSync(path.join(result.result_path, "scorecard.json")), true);
  assert.equal(fs.existsSync(path.join(result.work_path, "session", "visual-reference.json")), true);

  const evidence = JSON.parse(fs.readFileSync(path.join(result.work_path, "repo", "evidence-map.json"), "utf8"));
  assert.equal(evidence.test_count, 1);
});
