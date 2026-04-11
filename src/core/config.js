import path from "node:path";

import { pathExists, readJson, resolveRepoRoot, writeJson } from "../utils/fs.js";

function normalizeAgentProfile(agent, index = 0) {
  if (!agent || typeof agent !== "object") {
    return null;
  }

  const provider = String(agent.provider ?? "").trim();
  if (!provider) {
    return null;
  }

  const model = String(agent.model ?? "").trim();
  const id = String(agent.id ?? `agent-${index + 1}`).trim() || `agent-${index + 1}`;
  const label = String(agent.label ?? ([provider, model].filter(Boolean).join(" / ") || id)).trim();

  return { id, provider, model: model || null, label };
}

function normalizeStageAssignments(settings) {
  const stageAssignments = settings.stage_assignments ?? {};
  const councilAgents = Array.isArray(settings.council_agents)
    ? settings.council_agents.map((agent, index) => normalizeAgentProfile(agent, index)).filter(Boolean)
    : [];
  const councilAgentIds = new Set(councilAgents.map((agent) => agent.id));

  if (councilAgents.length === 0) {
    const fallbackProvider = settings.default_provider ?? null;
    if (fallbackProvider) {
      councilAgents.push({
        id: "agent-1",
        provider: fallbackProvider,
        model: null,
        label: fallbackProvider
      });
      councilAgentIds.add("agent-1");
    }
  }

  const normalizeStageValue = (values = [], stageName, fallbackProvider = null) => {
    const normalized = [];
    for (const value of Array.isArray(values) ? values : []) {
      if (typeof value === "string") {
        if (councilAgentIds.has(value)) {
          normalized.push(value);
        } else if (value.trim()) {
          const generatedId = `${stageName}-${normalized.length + 1}`;
          councilAgents.push({
            id: generatedId,
            provider: value,
            model: null,
            label: value
          });
          councilAgentIds.add(generatedId);
          normalized.push(generatedId);
        }
        continue;
      }

      if (value && typeof value === "object") {
        const normalizedAgent = normalizeAgentProfile(value, councilAgents.length);
        if (normalizedAgent) {
          if (!councilAgentIds.has(normalizedAgent.id)) {
            councilAgents.push(normalizedAgent);
            councilAgentIds.add(normalizedAgent.id);
          }
          normalized.push(normalizedAgent.id);
        }
      }
    }

    if (normalized.length === 0 && councilAgents.length > 0) {
      return councilAgents.map((agent) => agent.id);
    }

    if (normalized.length === 0 && fallbackProvider) {
      const fallbackId = `fallback-${stageName}`;
      if (!councilAgentIds.has(fallbackId)) {
        councilAgents.push({
          id: fallbackId,
          provider: fallbackProvider,
          model: null,
          label: fallbackProvider
        });
        councilAgentIds.add(fallbackId);
      }
      normalized.push(fallbackId);
    }

    return normalized;
  };

  const fallbackProvider = settings.default_provider ?? null;
  return {
    council_agents: councilAgents,
    stage_assignments: {
      proposal: normalizeStageValue(stageAssignments.proposal, "proposal", fallbackProvider),
      critique: normalizeStageValue(stageAssignments.critique, "critique", fallbackProvider),
      refinement: normalizeStageValue(stageAssignments.refinement, "refinement", fallbackProvider),
      synthesis: normalizeStageValue(stageAssignments.synthesis, "synthesis", fallbackProvider),
      validation: normalizeStageValue(stageAssignments.validation, "validation", fallbackProvider)
    }
  };
}

export function repoSettingsPath(repoPath) {
  return path.join(resolveRepoRoot(repoPath), ".ai-council", "settings.json");
}

export function loadRepoSettings(repoPath) {
  const settings = readJson(repoSettingsPath(repoPath), {
    first_run_complete: false,
    default_provider: null,
    default_participant: null,
    auto_launch: true,
    output_root: ".ai-council/result",
    council_agents: [],
    council_assignments: {
      axiom: null,
      vector: null,
      forge: null,
      sentinel: null
    },
    stage_assignments: {
      proposal: [],
      critique: [],
      refinement: [],
      synthesis: [],
      validation: []
    },
    provider_overrides: {}
  });
  const normalized = normalizeStageAssignments(settings);
  return {
    ...settings,
    council_agents: normalized.council_agents,
    stage_assignments: normalized.stage_assignments
  };
}

export function saveRepoSettings(repoPath, settings) {
  return writeJson(repoSettingsPath(repoPath), settings);
}

export function hasCompletedFirstRun(repoPath) {
  if (!pathExists(repoSettingsPath(repoPath))) {
    return false;
  }

  const settings = loadRepoSettings(repoPath);
  return settings.first_run_complete === true;
}

export function loadConfig(frameworkRoot, repoPath = frameworkRoot) {
  const resolvedRepoPath = resolveRepoRoot(repoPath);
  const app = readJson(path.join(frameworkRoot, "config", "app.settings.json"), {});
  const providers = readJson(path.join(frameworkRoot, "config", "providers.json"), {});
  const mcp = readJson(path.join(frameworkRoot, "config", "mcp.settings.json"), {});
  const user = loadRepoSettings(resolvedRepoPath);
  const workflows = {
    plan: readJson(path.join(frameworkRoot, "config", "workflows", "plan.json"), {}),
    design: readJson(path.join(frameworkRoot, "config", "workflows", "design.json"), {}),
    spike: readJson(path.join(frameworkRoot, "config", "workflows", "spike.json"), {}),
    debate: readJson(path.join(frameworkRoot, "config", "workflows", "debate.json"), {}),
    review: readJson(path.join(frameworkRoot, "config", "workflows", "review.json"), {})
  };
  const councils = {
    "default-council": readJson(path.join(frameworkRoot, "config", "councils", "default-council.json"), {}),
    "design-council": readJson(path.join(frameworkRoot, "config", "councils", "design-council.json"), {}),
    "spike-council": readJson(path.join(frameworkRoot, "config", "councils", "spike-council.json"), {}),
    "debate-council": readJson(path.join(frameworkRoot, "config", "councils", "debate-council.json"), {}),
    "review-council": readJson(path.join(frameworkRoot, "config", "councils", "review-council.json"), {})
  };
  const rubrics = {
    review: readJson(path.join(frameworkRoot, "config", "rubrics", "review-rubric.json"), {})
  };

  return { app, providers, mcp, workflows, councils, rubrics, user };
}
