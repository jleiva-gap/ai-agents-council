import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadRepoSettings, saveRepoSettings } from "../src/core/config.js";

test("repo settings default to auto-launch enabled", () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-defaults-"));

  try {
    const settings = loadRepoSettings(repoPath);
    assert.equal(settings.auto_launch, true);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("repo settings support council agent profiles and legacy provider stage assignments", () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-config-"));

  try {
    saveRepoSettings(repoPath, {
      first_run_complete: true,
      default_provider: "copilot",
      auto_launch: true,
      output_root: ".ai-council/result",
      stage_assignments: {
        proposal: ["copilot", "gemini"],
        critique: ["copilot"],
        refinement: [],
        synthesis: [],
        validation: ["copilot"]
      },
      provider_overrides: {}
    });

    const settings = loadRepoSettings(repoPath);
    assert.equal(Array.isArray(settings.council_agents), true);
    assert.equal(settings.council_agents.length >= 2, true);
    assert.equal(Array.isArray(settings.stage_assignments.proposal), true);
    assert.equal(settings.stage_assignments.proposal.length >= 2, true);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("repo settings preserve duplicate council agents using the same provider and model", () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-agents-"));

  try {
    saveRepoSettings(repoPath, {
      first_run_complete: true,
      default_provider: "copilot",
      default_participant: {
        id: "agent-1",
        provider: "copilot",
        model: "gpt-5",
        label: "Copilot Primary"
      },
      auto_launch: true,
      output_root: ".ai-council/result",
      council_agents: [
        { id: "agent-1", provider: "copilot", model: "gpt-5", label: "Copilot Primary" },
        { id: "agent-2", provider: "copilot", model: "gpt-5", label: "Copilot Challenger" }
      ],
      stage_assignments: {
        proposal: ["agent-1", "agent-2"],
        critique: ["agent-2"],
        refinement: ["agent-1"],
        synthesis: ["agent-1"],
        validation: ["agent-1", "agent-2"]
      },
      provider_overrides: {}
    });

    const settings = loadRepoSettings(repoPath);
    assert.equal(settings.council_agents.length, 2);
    assert.deepEqual(settings.stage_assignments.proposal, ["agent-1", "agent-2"]);
    assert.equal(settings.council_agents[0].model, "gpt-5");
    assert.equal(settings.council_agents[1].model, "gpt-5");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
