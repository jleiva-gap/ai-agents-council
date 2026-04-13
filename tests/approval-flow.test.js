import test from "node:test";
import assert from "node:assert/strict";

import { defaultApprovalStoryExportMode } from "../src/core/workflow.js";

function buildConfig(command = "node") {
  return {
    providers: {
      default_provider: "test-provider",
      providers: {
        "test-provider": {
          enabled: true,
          command,
          models: [],
          timeout_ms: 4000,
          session_mode: "fresh",
          prompt_transport: "file",
          launch_command: ["node", "--version"]
        }
      }
    },
    user: {
      default_provider: "test-provider",
      provider_overrides: {}
    }
  };
}

function buildLatest(councilAgents) {
  return {
    session: {
      effective_config: {
        provider_preference: "test-provider",
        council_agents: councilAgents
      }
    }
  };
}

test("defaultApprovalStoryExportMode chooses single when exactly one story export agent is available", () => {
  const latest = buildLatest([
    { id: "agent-1", provider: "test-provider", model: "model-a", label: "Story Agent A" }
  ]);

  assert.equal(defaultApprovalStoryExportMode(latest, buildConfig()), "single");
});

test("defaultApprovalStoryExportMode falls back to none when story agent selection would be ambiguous", () => {
  const latest = buildLatest([
    { id: "agent-1", provider: "test-provider", model: "model-a", label: "Story Agent A" },
    { id: "agent-2", provider: "test-provider", model: "model-b", label: "Story Agent B" }
  ]);

  assert.equal(defaultApprovalStoryExportMode(latest, buildConfig()), "none");
});

test("defaultApprovalStoryExportMode falls back to none when the export provider is unavailable", () => {
  const latest = buildLatest([
    { id: "agent-1", provider: "test-provider", model: "model-a", label: "Story Agent A" }
  ]);

  assert.equal(defaultApprovalStoryExportMode(latest, buildConfig("definitely-not-a-real-command")), "none");
});
