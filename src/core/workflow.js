import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.js";
import { createRunWorkspace, writeCouncilLog, writeSessionManifest, writeTimeline } from "./session.js";
import { formatCouncilLog, getCouncilVisualReference, getDeliberationCycle, getStageIdentity } from "./identity.js";
import { normalizeClarificationResult, runClarificationStage, writeClarificationArtifacts } from "../clarification/stage.js";
import { buildClarificationQuestions, normalizeInput } from "../input/normalize.js";
import { detectProviders, maybeLaunchPrompt, maybeRunProviderStartup, resolveProvidersByNames, writeCouncilPlan } from "../providers/index.js";
import { buildReviewEvidence } from "../review/evidence.js";
import { copyFile, ensureDir, pathExists, readJson, readText, removeDir, resolveRepoRoot, slugify, writeJson, writeText } from "../utils/fs.js";

const MODE_SUMMARIES = {
  plan: "Generate an implementation roadmap.",
  design: "Shape a technical solution and tradeoffs.",
  spike: "Reduce uncertainty with structured investigation.",
  debate: "Contrast options and converge on a recommendation.",
  review: "Evaluate an implementation against the ticket."
};

function resolveOutputRoot(rootPath, config, options = {}) {
  return path.resolve(rootPath, options.output_root ?? config.user?.output_root ?? ".ai-council/result");
}

function latestRunPath(rootPath, outputRoot) {
  const runsRoot = path.resolve(rootPath, outputRoot);
  if (!pathExists(runsRoot)) {
    return null;
  }

  const entries = fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return entries.length > 0 ? path.join(runsRoot, entries.at(-1)) : null;
}

function nowIso() {
  return new Date().toISOString();
}

function parseTicketSections(content) {
  const sections = {};
  let current = null;
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      current = heading[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      sections[current] = [];
      continue;
    }

    if (current) {
      sections[current].push(line);
    }
  }

  return Object.fromEntries(Object.entries(sections).map(([key, lines]) => [key, lines.join("\n").trim()]));
}

function extractList(sectionText) {
  return String(sectionText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+|^\d+\.\s+/, "").trim())
    .filter((line) => line && !/^none recorded yet$/i.test(line));
}

function buildTasks(acceptanceCriteria = []) {
  const source = acceptanceCriteria.length > 0
    ? acceptanceCriteria
    : ["Clarify and decompose the implementation into concrete tasks."];

  return source.map((criterion, index) => ({
    id: `TASK-${String(index + 1).padStart(3, "0")}`,
    title: criterion,
    description: criterion,
    status: "pending",
    acceptance_criteria: [criterion]
  }));
}

function parseClarificationAnswersFromTicket(ticketText) {
  const answers = [];
  const lines = String(ticketText ?? "").split(/\r?\n/);
  let inSection = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+Clarification Answers\s*$/i.test(line.trim())) {
      inSection = true;
      continue;
    }

    if (inSection && /^##\s+/.test(line.trim())) {
      break;
    }

    if (!inSection) {
      continue;
    }

    const promptMatch = line.match(/^\d+\.\s+(.+)$/);
    if (!promptMatch) {
      continue;
    }

    const answerLine = lines[index + 1] ?? "";
    const answerMatch = answerLine.match(/^Answer:\s*(.+)$/i);
    if (!answerMatch) {
      continue;
    }

    answers.push({
      id: `clarification-${answers.length + 1}`,
      prompt: promptMatch[1].trim(),
      answer: answerMatch[1].trim()
    });
    index += 1;
  }

  return answers;
}

function collectStageResponses(workPath) {
  const roundsRoot = path.join(workPath, "rounds");
  if (!pathExists(roundsRoot)) {
    return [];
  }

  const responses = [];
  for (const round of fs.readdirSync(roundsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const stageName = round.name.replace(/^\d+-/, "");
    const stageDir = path.join(roundsRoot, round.name);
    for (const file of fs.readdirSync(stageDir).filter((entry) => entry.endsWith(".response.md")).sort()) {
      const fullPath = path.join(stageDir, file);
      const content = readText(fullPath).trim();
      if (!content) {
        continue;
      }

      responses.push({
        stage: stageName,
        participant: file.replace(/\.response\.md$/, ""),
        path: path.relative(workPath, fullPath).replace(/\\/g, "/"),
        content
      });
    }
  }

  return responses;
}

function classifyStageResponseContent(content) {
  const normalized = String(content ?? "").trim();
  if (!normalized) {
    return {
      kind: "empty",
      meaningful: false
    };
  }

  if (/^# Pending Provider Response\b/i.test(normalized)) {
    return {
      kind: "pending",
      meaningful: false
    };
  }

  if (/^# Provider Result\b/i.test(normalized) && /\bBLOCKED:/i.test(normalized)) {
    return {
      kind: "blocked",
      meaningful: false
    };
  }

  return {
    kind: "actual",
    meaningful: true
  };
}

function partitionStageResponses(responses = []) {
  const actual = [];
  const pending = [];
  const blocked = [];

  for (const response of responses) {
    const classified = classifyStageResponseContent(response.content);
    const enriched = {
      ...response,
      response_kind: classified.kind
    };

    if (classified.kind === "actual") {
      actual.push(enriched);
      continue;
    }

    if (classified.kind === "pending") {
      pending.push(enriched);
      continue;
    }

    if (classified.kind === "blocked") {
      blocked.push(enriched);
    }
  }

  return { actual, pending, blocked };
}

export { classifyStageResponseContent, partitionStageResponses };

function writeResultText(filePath, lines) {
  const content = Array.isArray(lines) ? lines.join("\n") : String(lines ?? "");
  const normalized = content.trim();
  if (!normalized) {
    return false;
  }
  writeText(filePath, `${normalized}\n`);
  return true;
}

function renderDebateOutput(responses) {
  return responses.flatMap((entry, index) => [
    `## ${index + 1}. ${entry.stage} - ${entry.participant}`,
    "",
    entry.content,
    ""
  ]);
}

function buildResponseArtifactContent(stage, participant, launchResult) {
  const capturedOutput = String(launchResult.stdout ?? "").trim();
  if (capturedOutput) {
    return `${capturedOutput}\n`;
  }

  if (launchResult.launched) {
    const lines = [
      "# Provider Result",
      "",
      `Stage: ${stage.stage}`,
      `Participant: ${participant.label ?? participant.name}`,
      `Exit code: ${launchResult.exit_code ?? "unknown"}`,
      `Timed out: ${launchResult.timed_out === true ? "yes" : "no"}`,
      "",
      "BLOCKED: The provider run did not produce Markdown output on stdout."
    ];
    if (launchResult.stderr) {
      lines.push("", "## STDERR", "", "```text", String(launchResult.stderr).trim(), "```");
    }
    return `${lines.join("\n").trim()}\n`;
  }

  return [
    "# Pending Provider Response",
    "",
    `Stage: ${stage.stage}`,
    `Participant: ${participant.label ?? participant.name}`,
    "",
    "The prompt was prepared, but the provider was not launched automatically in this run.",
    "",
    "Open the matching `.prompt.md`, run it with the selected CLI, and replace this file with the actual response when available."
  ].join("\n").trim() + "\n";
}

function createModeArtifacts(mode, context) {
  const { resultPath, title, sections, acceptanceCriteria, responses, evidence, rubric } = context;
  const responseGroups = partitionStageResponses(responses);
  const consensusResponses = responseGroups.actual;
  const files = [];
  const tasks = buildTasks(acceptanceCriteria);
  const debateLines = consensusResponses.length > 0
    ? ["# Debate Output", "", ...renderDebateOutput(consensusResponses)]
    : [];

  const summaryLines = [
    "# Summary",
    "",
    `Title: ${title}`,
    `Mode: ${mode}`,
    `Council outputs captured: ${consensusResponses.length}`,
    `Pending provider responses: ${responseGroups.pending.length}`,
    `Blocked provider responses: ${responseGroups.blocked.length}`,
    "Status: pending approval",
    ""
  ];

  if (consensusResponses.length === 0 && (responseGroups.pending.length > 0 || responseGroups.blocked.length > 0)) {
    summaryLines.push(
      "No AI consensus was captured for this run yet.",
      responseGroups.pending.length > 0
        ? "One or more providers were prepared but not launched, so the result package excludes placeholder responses."
        : "One or more providers launched without producing usable Markdown output, so the result package excludes blocked responses.",
      ""
    );
  }

  if (mode === "plan") {
    const planLines = [
      "# Plan",
      "",
      "## Goal",
      "",
      sections.summary || sections.business_goal || title,
      ""
    ];
    if (acceptanceCriteria.length > 0) {
      planLines.push("## Acceptance Criteria", "", ...acceptanceCriteria.map((item) => `- ${item}`), "");
    }
    if (consensusResponses.length > 0) {
      planLines.push("## Council Synthesis", "", ...renderDebateOutput(consensusResponses));
    }

    if (writeResultText(path.join(resultPath, "plan.md"), planLines)) files.push("plan.md");
    if (writeResultText(path.join(resultPath, "implementation-outline.md"), [
      "# Implementation Outline",
      "",
      ...tasks.flatMap((task, index) => [
        `## ${index + 1}. ${task.title}`,
        "",
        task.description,
        ""
      ])
    ])) files.push("implementation-outline.md");
    writeJson(path.join(resultPath, "tasks.json"), { tasks });
    files.push("tasks.json");
    if (debateLines.length > 0 && writeResultText(path.join(resultPath, "debate-output.md"), debateLines)) files.push("debate-output.md");
  } else if (mode === "design") {
    const designLines = [
      "# Solution Design",
      "",
      sections.summary || sections.technical_objective || title,
      ""
    ];
    if (consensusResponses.length > 0) {
      designLines.push("## Council Synthesis", "", ...renderDebateOutput(consensusResponses));
    }
    if (writeResultText(path.join(resultPath, "solution-design.md"), designLines)) files.push("solution-design.md");
    if (debateLines.length > 0 && writeResultText(path.join(resultPath, "debate-output.md"), debateLines)) files.push("debate-output.md");
  } else if (mode === "spike") {
    const spikeLines = [
      "# Spike",
      "",
      sections.summary || sections.technical_objective || title,
      ""
    ];
    if (consensusResponses.length > 0) {
      spikeLines.push("## Investigation Output", "", ...renderDebateOutput(consensusResponses));
    }
    if (writeResultText(path.join(resultPath, "spike.md"), spikeLines)) files.push("spike.md");
    if (debateLines.length > 0 && writeResultText(path.join(resultPath, "debate-output.md"), debateLines)) files.push("debate-output.md");
  } else if (mode === "debate") {
    if (debateLines.length > 0 && writeResultText(path.join(resultPath, "debate-output.md"), debateLines)) files.push("debate-output.md");
    if (writeResultText(path.join(resultPath, "recommendation.md"), [
      "# Recommendation",
      "",
      consensusResponses.length > 0
        ? `The council debate for **${title}** is captured in \`debate-output.md\`. Review the proposal, critique, refinement, synthesis, and validation outputs before approving.`
        : `No debate output was captured for **${title}**.`
    ])) files.push("recommendation.md");
  } else {
    if (writeResultText(path.join(resultPath, "findings.md"), [
      "# Findings",
      "",
      consensusResponses.length > 0 ? renderDebateOutput(consensusResponses).join("\n") : "No review findings were captured."
    ])) files.push("findings.md");
    writeJson(path.join(resultPath, "scorecard.json"), {
      rubric: rubric?.name ?? "review",
      status: "pending_approval",
      total_score: null,
      blocking_findings: 0,
      non_blocking_findings: 0,
      confidence: consensusResponses.length > 0 ? "medium" : "low",
      evidence: evidence
        ? {
          file_count: evidence.file_count,
          doc_count: evidence.doc_count,
          test_count: evidence.test_count
        }
        : null
    });
    files.push("scorecard.json");
    if (writeResultText(path.join(resultPath, "recommendation.md"), [
      "# Recommendation",
      "",
      consensusResponses.length > 0
        ? `Review the findings for **${title}** and decide whether to approve, request changes, or reject the implementation.`
        : `No review recommendation was captured for **${title}**.`
    ])) files.push("recommendation.md");
  }

  summaryLines.push("Artifacts:", ...files.map((file) => `- ${file}`));
  writeResultText(path.join(resultPath, "summary.md"), summaryLines);
  return ["summary.md", ...files].sort();
}

function buildPromptText(mode, stageName, participantName, ticketText, evidence = null, stageArtifacts = [], participantModel = null) {
  const identity = getStageIdentity(stageName);
  const modelBlock = participantModel ? `\n## Requested Model\n${participantModel}\n` : "";
  const evidenceBlock = evidence
    ? `\n## Review Evidence\n- Repo path: ${evidence.repo_path}\n- Files indexed: ${evidence.file_count}\n- Docs found: ${evidence.doc_count}\n- Tests found: ${evidence.test_count}\n`
    : "";
  const priorArtifactsBlock = stageArtifacts.length > 0
    ? `\n## Prior Stage Artifacts\n${stageArtifacts.map((item) => `- ${item}`).join("\n")}\n`
    : "";

  return `# AI Council Prompt

## Mode
${mode}

## Stage
${stageName}

## Participant
${participantName}
${modelBlock}

## Council Identity
The stage leader is ${identity.name.toUpperCase()}, master of ${identity.function}.

## Objective
${MODE_SUMMARIES[mode]}
${evidenceBlock}
${priorArtifactsBlock}
## Automation Contract
- Respond with the actual council contribution as Markdown on stdout.
- Do not create, edit, rename, or delete files for this stage.
- Do not attempt to save your answer into \`.response.md\`; the orchestrator captures stdout and writes the artifact.
- Use shell or file tools only when they are truly needed to inspect the repo or referenced files.
- If you are blocked by missing access, missing files, or CLI limitations, start the response with \`BLOCKED:\` and explain the blocker briefly.

## Canonical Ticket

${ticketText}

## Required Output
Produce a stage-appropriate contribution that is explicit about tradeoffs, risks, assumptions, and next actions.
`;
}

function buildDeliberationPlan(stageAssignments, providers, fallbackProvider, councilAgents = []) {
  const cycle = getDeliberationCycle();
  return cycle.map((stage) => ({
    ...stage,
    participants: resolveProvidersByNames(providers, stageAssignments?.[stage.stage] ?? [], fallbackProvider, councilAgents)
  }));
}

function mergeClarificationAnswers(existingAnswers = [], newAnswers = []) {
  const merged = [];
  const seen = new Set();

  for (const entry of [...existingAnswers, ...newAnswers]) {
    const prompt = String(entry?.prompt ?? "").trim();
    const answer = String(entry?.answer ?? "").trim();
    if (!prompt || !answer) {
      continue;
    }

    const id = String(entry?.id ?? prompt).trim() || prompt;
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    merged.push({
      id,
      prompt,
      answer
    });
  }

  return merged;
}

function resolveStageAssignmentTarget(entry, councilAgents = []) {
  const agentMap = new Map((councilAgents ?? []).map((agent) => [agent.id, agent]));

  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) {
      return null;
    }

    const agent = agentMap.get(trimmed);
    return agent
      ? { provider: agent.provider, label: agent.label ?? agent.id, target: trimmed }
      : { provider: trimmed, label: trimmed, target: trimmed };
  }

  if (entry && typeof entry === "object" && String(entry.provider ?? "").trim()) {
    return {
      provider: String(entry.provider).trim(),
      label: String(entry.label ?? entry.id ?? entry.provider).trim(),
      target: String(entry.id ?? entry.label ?? entry.provider).trim()
    };
  }

  return null;
}

function validateRequestedParticipants(stageAssignments, providers, councilAgents = []) {
  const providerMap = new Map((providers ?? []).map((provider) => [provider.name, provider]));
  const issues = [];

  for (const [stage, assignments] of Object.entries(stageAssignments ?? {})) {
    for (const assignment of Array.isArray(assignments) ? assignments : []) {
      const resolved = resolveStageAssignmentTarget(assignment, councilAgents);
      if (!resolved) {
        continue;
      }

      const provider = providerMap.get(resolved.provider);
      if (!provider) {
        issues.push({
          stage,
          label: resolved.label,
          provider: resolved.provider,
          reason: "Provider is not configured."
        });
        continue;
      }

      if (provider.enabled !== true) {
        issues.push({
          stage,
          label: resolved.label,
          provider: resolved.provider,
          reason: "Provider is disabled."
        });
        continue;
      }

      if (provider.available !== true) {
        issues.push({
          stage,
          label: resolved.label,
          provider: resolved.provider,
          reason: provider.compatibility_note ?? "Provider command is unavailable."
        });
      }
    }
  }

  return issues;
}

function formatParticipantValidationError(issues = []) {
  const lines = [
    "Configured council agents are unavailable, so the run was stopped before deliberation.",
    ""
  ];

  for (const issue of issues) {
    lines.push(`- ${issue.stage}: ${issue.label} -> ${issue.provider}. ${issue.reason}`);
  }

  return lines.join("\n");
}

function emitProgress(callback, event) {
  if (typeof callback === "function") {
    callback(event);
  }
}

function ensureProviderSession(providerSessions, participant, workPath) {
  if (!providerSessions[participant.name]) {
    providerSessions[participant.name] = {
      provider: participant.name,
      session_mode: participant.session_mode ?? "fresh",
      session_file: path.join(workPath, "session", `${participant.name}.session.json`),
      active: false,
      stages: []
    };
  }

  return providerSessions[participant.name];
}

async function executeStageParticipant({
  workPath,
  repoPath,
  workflow,
  stage,
  stageDir,
  ticketText,
  evidence,
  launch,
  onProgress,
  participant,
  stageArtifacts,
  providerSession,
  completedStepsRef,
  totalSteps
}) {
  const promptFile = path.join(stageDir, `${participant.name}.prompt.md`);
  const outputFile = path.join(stageDir, `${participant.name}.response.md`);
  writeText(
    promptFile,
    buildPromptText(
      workflow.mode,
      stage.stage,
      participant.label ?? participant.name,
      ticketText,
      evidence,
      stageArtifacts,
      participant.model
    )
  );
  emitProgress(onProgress, {
    type: "participant_started",
    stage: stage.stage,
    provider: participant.name,
    participant_label: participant.label ?? participant.name,
    model: participant.model ?? null,
    prompt_file: promptFile
  });
  emitProgress(onProgress, {
    type: "participant_waiting",
    stage: stage.stage,
    provider: participant.name,
    participant_label: participant.label ?? participant.name,
    model: participant.model ?? null,
    timeout_ms: participant.timeout_ms ?? 120000,
    completed_steps: completedStepsRef.value,
    total_steps: totalSteps
  });

  const launchResult = await maybeLaunchPrompt(promptFile, outputFile, repoPath, participant, launch, providerSession, workPath);
  const responseArtifactContent = buildResponseArtifactContent(stage, participant, launchResult);
  writeText(outputFile, responseArtifactContent);
  if (launchResult.stdout) {
    writeText(path.join(stageDir, `${participant.name}.stdout.txt`), launchResult.stdout);
  }
  if (launchResult.stderr) {
    writeText(path.join(stageDir, `${participant.name}.stderr.txt`), launchResult.stderr);
  }

  writeCouncilLog(
    workPath,
    formatCouncilLog(
      stage.leader,
      launchResult.launched
        ? `Executed provider ${participant.name} for ${stage.stage} (${launchResult.exit_code ?? "unknown"}).`
        : `Prepared provider handoff for ${stage.stage} with ${participant.name}.`
    )
  );

  const normalizedResponse = String(responseArtifactContent ?? "").trim();
  const accessBlocked = workflow.mode === "review"
    && (
      /unable to access required source materials/i.test(normalizedResponse)
      || ((/^BLOCKED:/i.test(normalizedResponse) || /\nBLOCKED:/i.test(normalizedResponse))
        && /(access|permission|source materials?|repository|repo|workspace|file|directory)/i.test(normalizedResponse))
    );

  providerSession.active = launchResult.launched && launchResult.exit_code === 0;
  providerSession.stages.push({
    stage: stage.stage,
    exit_code: launchResult.exit_code ?? null,
    timed_out: launchResult.timed_out === true
  });
  writeJson(providerSession.session_file, providerSession);

  completedStepsRef.value += 1;
  emitProgress(onProgress, {
    type: "participant_result",
    stage: stage.stage,
    provider: participant.name,
    participant_label: participant.label ?? participant.name,
    model: participant.model ?? null,
    launched: launchResult.launched,
    exit_code: launchResult.exit_code ?? null,
    timed_out: launchResult.timed_out === true,
    command_preview: launchResult.command_preview ?? "",
    stderr: launchResult.stderr ?? "",
    output_file: outputFile,
    completed_steps: completedStepsRef.value,
    total_steps: totalSteps
  });

  return {
    access_blocked: accessBlocked,
    output_file: outputFile,
    result: {
      stage: stage.stage,
      leader: stage.leader,
      participant: participant.name,
      participant_label: participant.label ?? participant.name,
      model: participant.model ?? null,
      ...launchResult
    }
  };
}

async function createDeliberationArtifacts(workPath, repoPath, workflow, deliberationPlan, ticketText, evidence, launch, onProgress = null) {
  const results = [];
  const producedArtifacts = [];
  const startedProviders = new Set();
  const providerSessions = {};
  const totalSteps = deliberationPlan.reduce((sum, stage) => sum + stage.participants.length, 0);
  const completedStepsRef = { value: 0 };

  for (const [index, stage] of deliberationPlan.entries()) {
    const stageDir = path.join(workPath, "rounds", `${String(index + 1).padStart(2, "0")}-${slugify(stage.stage)}`);
    ensureDir(stageDir);
    writeCouncilLog(workPath, formatCouncilLog(stage.leader, `Starting ${stage.stage} with ${stage.participants.length} participant(s).`));
    emitProgress(onProgress, {
      type: "stage_started",
      stage: stage.stage,
      leader: stage.leader,
      participant_count: stage.participants.length,
      completed_steps: completedStepsRef.value,
      total_steps: totalSteps
    });

    const priorStageArtifacts = [...producedArtifacts];
    for (const participant of stage.participants) {
      ensureProviderSession(providerSessions, participant, workPath);
      if (startedProviders.has(participant.name)) {
        continue;
      }

      emitProgress(onProgress, {
        type: "startup_begin",
        stage: stage.stage,
        provider: participant.name,
        participant_label: participant.label ?? participant.name,
        model: participant.model ?? null,
        completed_steps: completedStepsRef.value,
        total_steps: totalSteps
      });
      const startup = await maybeRunProviderStartup(participant, repoPath, launch);
      if (startup.command_preview) {
        writeCouncilLog(
          workPath,
          formatCouncilLog(stage.leader, startup.launched
            ? `Ran startup preflight for ${participant.name} (${startup.exit_code ?? "unknown"}).`
            : `Startup preflight available for ${participant.name}: ${startup.command_preview}`)
        );
      }
      emitProgress(onProgress, {
        type: "startup_result",
        stage: stage.stage,
        provider: participant.name,
        participant_label: participant.label ?? participant.name,
        model: participant.model ?? null,
        launched: startup.launched,
        exit_code: startup.exit_code ?? null,
        timed_out: startup.timed_out === true,
        command_preview: startup.command_preview ?? "",
        stderr: startup.stderr ?? "",
        completed_steps: completedStepsRef.value,
        total_steps: totalSteps
      });
      startedProviders.add(participant.name);
    }

    const stageRuns = stage.participants.map((participant) =>
      executeStageParticipant({
        workPath,
        repoPath,
        workflow,
        stage,
        stageDir,
        ticketText,
        evidence,
        launch,
        onProgress,
        participant,
        stageArtifacts: priorStageArtifacts,
        providerSession: ensureProviderSession(providerSessions, participant, workPath),
        completedStepsRef,
        totalSteps
      })
    );
    const stageResults = await Promise.all(stageRuns);

    const accessBlockedResult = stageResults.find((entry) => entry.access_blocked);
    if (accessBlockedResult) {
      const blockedParticipant = stage.participants.find((participant) =>
        path.join(stageDir, `${participant.name}.response.md`) === accessBlockedResult.output_file
      );
      throw new Error(`Unable to access required source materials for comprehensive architectural review. ${blockedParticipant?.label ?? blockedParticipant?.name ?? "A participant"} reported an access blocker.`);
    }

    for (const stageResult of stageResults) {
      producedArtifacts.push(path.relative(workPath, stageResult.output_file).replace(/\\/g, "/"));
      results.push(stageResult.result);
    }
  }

  writeJson(path.join(workPath, "logs", "provider-launches.json"), results);
  writeJson(path.join(workPath, "session", "provider-sessions.json"), providerSessions);
  return { executionResults: results, providerSessions };
}

function writeExecutionSummary(workPath, executionResults, providerSessions) {
  const synthDir = path.join(workPath, "synth");
  ensureDir(synthDir);
  const failures = executionResults.filter((entry) => entry.exit_code && entry.exit_code !== 0);
  const successful = executionResults.filter((entry) => entry.exit_code === 0);

  writeJson(path.join(synthDir, "execution-summary.json"), {
    total_steps: executionResults.length,
    successful_steps: successful.length,
    failed_steps: failures.length,
    provider_sessions: Object.values(providerSessions),
    failures: failures.map((entry) => ({
      stage: entry.stage,
      participant: entry.participant,
      participant_label: entry.participant_label ?? entry.participant,
      model: entry.model ?? null,
      exit_code: entry.exit_code,
      timed_out: entry.timed_out === true,
      command_preview: entry.command_preview,
      stderr: entry.stderr
    }))
  });

  writeText(
    path.join(synthDir, "execution-summary.md"),
    `# Execution Summary

## Overall

- Total steps: ${executionResults.length}
- Successful steps: ${successful.length}
- Failed steps: ${failures.length}

## Failures

${failures.length > 0
  ? failures.map((entry) => `- ${entry.stage} / ${entry.participant_label ?? entry.participant}${entry.model ? ` [${entry.model}]` : ""}: exit ${entry.exit_code}${entry.timed_out ? " (timeout)" : ""}\n  Command: ${entry.command_preview || "(none)"}\n  Error: ${entry.stderr || "(no stderr captured)"}`).join("\n")
  : "- No failures were recorded."}

## Notes

- Raw CLI results live in \`work/logs/provider-launches.json\`
- Per-step stdout/stderr files live alongside prompts in \`work/rounds/<stage>/\`
- Provider session state lives in \`work/session/provider-sessions.json\`
`
  );
}

export function toolingStatus(frameworkRoot, repoPath) {
  const resolvedRepoPath = resolveRepoRoot(repoPath);
  const config = loadConfig(frameworkRoot, resolvedRepoPath);
  return {
    ok: true,
    framework_root: frameworkRoot,
    repo_path: resolvedRepoPath,
    output_root: resolveOutputRoot(resolvedRepoPath, config),
    providers: detectProviders(config.providers, config.user?.provider_overrides),
    mcp: {
      enabled: config.mcp.enabled === true,
      jira_reader_command: config.mcp.jira?.reader_command ?? []
    }
  };
}

function latestSession(rootPath, outputRoot) {
  const runPath = latestRunPath(rootPath, outputRoot);
  if (!runPath) {
    return null;
  }

  return {
    runPath,
    workPath: path.join(runPath, "work"),
    resultPath: path.join(runPath, "result"),
    sessionPath: path.join(runPath, "work", "session", "session.json"),
    session: readJson(path.join(runPath, "work", "session", "session.json"), {})
  };
}

function availableActions(session) {
  if (session.status === "awaiting_clarification") {
    return ["answer_clarifications", "start_new_run"];
  }
  if (session.status === "pending_approval") {
    return ["approve", "request_changes", "reject"];
  }
  if (session.status === "approved") {
    return ["export_awf", "start_new_run"];
  }
  if (session.status === "changes_requested" || session.status === "rejected") {
    return ["start_new_run"];
  }
  return [];
}

function readOptionalInputText(inputDir, fileName) {
  const filePath = path.join(inputDir, fileName);
  return pathExists(filePath) ? readText(filePath).trim() : "";
}

function buildStatusPayload(frameworkRoot, repoPath, outputRoot, latest) {
  const finalFiles = pathExists(latest.resultPath) ? fs.readdirSync(latest.resultPath).sort() : [];
  return {
    ok: true,
    framework_root: frameworkRoot,
    repo_path: repoPath,
    output_root: outputRoot,
    has_runs: true,
    latest_run: latest.runPath,
    mode: latest.session.mode ?? null,
    family: latest.session.family ?? null,
    title: latest.session.title ?? null,
    review_repo_path: latest.session.review_repo?.repo_path ?? null,
    current_stage: latest.session.current_stage ?? null,
    status: latest.session.status ?? "prepared",
    final_files: finalFiles,
    available_actions: availableActions(latest.session),
    questions: latest.session.questions ?? latest.session.clarification?.questions ?? [],
    review: latest.session.review ?? null,
    clarification: latest.session.clarification ?? null,
    recommended_action: latest.session.next_action ?? "Review result/ first, then inspect work/ if you need the intermediate deliberation trail."
  };
}

export function getStatus(frameworkRoot, repoPath) {
  const resolvedRepoPath = resolveRepoRoot(repoPath);
  const config = loadConfig(frameworkRoot, resolvedRepoPath);
  const outputRoot = resolveOutputRoot(resolvedRepoPath, config);
  const latest = latestSession(resolvedRepoPath, outputRoot);
  if (!latest) {
    return {
      ok: true,
      framework_root: frameworkRoot,
      repo_path: resolvedRepoPath,
      output_root: outputRoot,
      has_runs: false,
      recommended_action: "Run ai-council run --mode plan --prompt \"Describe the work\""
    };
  }

  return buildStatusPayload(frameworkRoot, resolvedRepoPath, outputRoot, latest);
}

export function resumeLatest(frameworkRoot, repoPath) {
  const status = getStatus(frameworkRoot, repoPath);
  return status.has_runs ? { ...status, resume_status: "resumed" } : status;
}

function writeLatestSession(latest, session) {
  writeJson(latest.sessionPath, session);
  return session;
}

const AWF_PHASE_AGENTS = {
  intake: "awf-intake",
  planning: "awf-planner",
  implementation: "awf-implementer",
  review: "awf-reviewer",
  final_verification: "awf-verifier"
};

const AWF_BUILTIN_ADAPTERS = ["claude", "codex", "gemini", "copilot"];

const DEFAULT_AWF_JIRA_SOURCE = {
  enabled: true,
  provider: "atlassian-rovo-mcp",
  command: ["npx", "-y", "mcp-remote@latest", "https://mcp.atlassian.com/v1/mcp"],
  issue_tool: "getJiraIssue",
  remote_links_tool: "getJiraIssueRemoteIssueLinks",
  resources_tool: "getAccessibleAtlassianResources"
};

function normalizeStringArray(values = []) {
  const items = Array.isArray(values) ? values.flat(Infinity) : [values];
  return [...new Set(items
    .map((item) => String(item ?? "").trim())
    .filter(Boolean))];
}

function toRepoRelativePath(repoPath, targetPath) {
  return path.relative(repoPath, targetPath).replace(/\\/g, "/");
}

function toAbsoluteRepoArtifactPath(repoPath, repoRelativePath) {
  return path.join(repoPath, ...String(repoRelativePath ?? "").split("/"));
}

function extractSectionLists(sections, ...keys) {
  return normalizeStringArray(keys.flatMap((key) => extractList(sections[key])));
}

function preferredAwfExecutionConfig(latest, config) {
  const configuredAgents = Array.isArray(latest.session.effective_config?.council_agents)
    ? latest.session.effective_config.council_agents
    : [];
  const preferredProvider = latest.session.effective_config?.provider_preference
    ?? config.user?.default_provider
    ?? config.providers?.default_provider
    ?? "copilot";
  const preferredAgent = configuredAgents.find((agent) => String(agent.provider ?? "").trim() === preferredProvider)
    ?? configuredAgents[0]
    ?? {};

  return {
    adapter: preferredAgent.provider ?? preferredProvider,
    model: preferredAgent.model ?? null,
    agent: AWF_PHASE_AGENTS.implementation,
    custom_prompt: null
  };
}

function mergeAwfConfig(repoPath, existingConfig = {}, executionConfig = {}) {
  const defaultAdapter = String(
    existingConfig.default_adapter
      ?? executionConfig.adapter
      ?? "copilot"
  ).trim() || "copilot";
  const merged = { ...existingConfig };

  merged.framework_version ??= "ai-council-export";
  merged.target_repo ??= path.basename(repoPath);
  merged.default_adapter = defaultAdapter;
  merged.last_ai_selection ??= null;
  merged.language ??= null;
  merged.repo_agents_file ??= "AGENTS.md";
  merged.protected_paths = Array.isArray(merged.protected_paths) ? merged.protected_paths : [];
  merged.default_verification = Array.isArray(merged.default_verification) ? merged.default_verification : [];
  merged.review_policy ??= {
    enabled: true,
    mode: "optional",
    triggers: ["story_near_complete", "repeated_failure", "manual_request"]
  };
  merged.human_review ??= { enabled: false };
  merged.stage_approvals ??= {
    enabled: true,
    phases: {
      intake: true,
      planning: true,
      implementation: true,
      review: true,
      final_verification: true
    }
  };
  merged.supervised_autonomy ??= {
    enabled: false,
    max_auto_transitions: 6,
    stop_on_human_review: true,
    stop_on_review_gaps: true,
    stop_on_blocked: true
  };
  merged.auto_commit ??= { enabled: false };
  merged.phase_execution = { ...(merged.phase_execution ?? {}) };

  for (const [phaseName, agentName] of Object.entries(AWF_PHASE_AGENTS)) {
    const current = merged.phase_execution[phaseName] ?? {};
    const phaseAdapter = current.adapter ?? (phaseName === "implementation" ? executionConfig.adapter ?? defaultAdapter : defaultAdapter);
    const phaseModel = current.model ?? (phaseName === "implementation" ? executionConfig.model ?? null : null);
    merged.phase_execution[phaseName] = {
      adapter: phaseAdapter,
      model: phaseModel,
      agent: current.agent ?? agentName,
      custom_prompt: Object.hasOwn(current, "custom_prompt") ? current.custom_prompt : null
    };
  }

  merged.adapters = { ...(merged.adapters ?? {}) };
  for (const adapterName of AWF_BUILTIN_ADAPTERS) {
    const current = merged.adapters[adapterName];
    if (current && typeof current === "object") {
      merged.adapters[adapterName] = {
        ...current,
        enabled: current.enabled ?? (adapterName === defaultAdapter)
      };
      continue;
    }

    merged.adapters[adapterName] = {
      enabled: adapterName === defaultAdapter
    };
  }

  merged.story_sources = { ...(merged.story_sources ?? {}) };
  merged.story_sources.jira ??= { ...DEFAULT_AWF_JIRA_SOURCE };

  return merged;
}

function emptyAwfClarification() {
  return {
    status: "not_requested",
    phase: null,
    summary: null,
    questions: [],
    answered_questions: [],
    risks: [],
    extracted_acceptance_criteria: [],
    requested_at: null,
    updated_at: null,
    resolved_at: null
  };
}

function emptyAwfBlockers() {
  return {
    blockers: []
  };
}

function emptyAwfHumanReview() {
  return {
    status: "not_requested",
    kind: "stage",
    phase: null,
    resume_phase: null,
    subject_id: null,
    reviewer: null,
    summary: null,
    reason: null,
    notes: null,
    changed_files: [],
    requested_at: null,
    decided_at: null
  };
}

function buildAwfQuestionsMarkdown(answers = []) {
  if (!Array.isArray(answers) || answers.length === 0) {
    return "";
  }

  return [
    "# Imported Clarification Context",
    "",
    "These answers were captured during the approved AI Council run.",
    "",
    ...answers.flatMap((entry, index) => [
      `${index + 1}. ${entry.prompt}`,
      `Answer: ${entry.answer}`,
      ""
    ])
  ].join("\n").trimEnd() + "\n";
}

function buildAwfStorySlice(story) {
  return {
    id: story.story_id,
    title: story.title,
    goal: story.goal,
    actors: normalizeStringArray(story.actors ?? []),
    in_scope: normalizeStringArray(story.in_scope ?? []),
    out_of_scope: normalizeStringArray(story.out_of_scope ?? []),
    dependencies: normalizeStringArray(story.dependencies ?? []),
    constraints: normalizeStringArray(story.constraints ?? []),
    references: normalizeStringArray(story.references ?? []),
    verification_evidence: normalizeStringArray(story.verification_evidence ?? [])
  };
}

function buildAwfTaskAcceptanceSlice(acceptance, task) {
  if (!task) {
    return [];
  }

  const refs = new Set(normalizeStringArray(task.ac_refs ?? []));
  if (refs.size === 0) {
    return [];
  }

  return (acceptance.criteria ?? [])
    .filter((criterion) => refs.has(criterion.id))
    .map((criterion) => ({
      id: criterion.id,
      text: criterion.text,
      status: criterion.status ?? "pending"
    }));
}

function buildAwfConcepts(story, task, orientation) {
  return {
    axiom: [
      story.goal,
      ...normalizeStringArray(story.constraints ?? []),
      ...normalizeStringArray(orientation.active_invariants ?? [])
    ].filter(Boolean).slice(0, 4),
    vector: [
      task?.title,
      ...buildAwfTaskAcceptanceSlice({ criteria: story.acceptance_criteria ?? [] }, task).map((criterion) => criterion.text),
      ...normalizeStringArray(orientation.next_task_considerations ?? [])
    ].filter(Boolean).slice(0, 4),
    forge: [
      task?.priority_reason ?? null,
      ...normalizeStringArray(orientation.key_changes ?? [])
    ].filter(Boolean).slice(0, 4),
    sentinel: normalizeStringArray(orientation.open_risks ?? []).slice(0, 4)
  };
}

function buildAwfContinuityPreview(orientation = {}) {
  return {
    current_slice: orientation.current_slice ?? null,
    last_task_id: orientation.last_task_id ?? null,
    last_task_outcome: orientation.last_task_outcome ?? "not_started",
    changed_files: normalizeStringArray(orientation.changed_files ?? []).slice(0, 3),
    open_risks: normalizeStringArray(orientation.open_risks ?? []).slice(0, 2),
    next_task_considerations: normalizeStringArray(orientation.next_task_considerations ?? []).slice(0, 2),
    concepts: {
      axiom: normalizeStringArray(orientation.concepts?.axiom ?? []).slice(0, 2),
      vector: normalizeStringArray(orientation.concepts?.vector ?? []).slice(0, 2),
      forge: normalizeStringArray(orientation.concepts?.forge ?? []).slice(0, 2),
      sentinel: normalizeStringArray(orientation.concepts?.sentinel ?? []).slice(0, 2)
    }
  };
}

function buildAwfRuntimePacket(repoPath, story, acceptance, task, orientation, executionConfig, extraContextFiles = []) {
  const contextFiles = [];
  if (pathExists(path.join(repoPath, "AGENTS.md"))) {
    contextFiles.push("AGENTS.md");
  }

  return {
    generated_at: nowIso(),
    story: buildAwfStorySlice(story),
    task: task
      ? {
        id: task.id,
        title: task.title,
        description: task.description,
        priority_class: task.priority_class ?? "standard_feature",
        priority_rank: task.priority_rank ?? 3,
        priority_reason: task.priority_reason ?? null,
        ac_refs: task.ac_refs ?? [],
        acceptance_criteria: buildAwfTaskAcceptanceSlice(acceptance, task),
        verification: task.verification ?? [],
        dependencies: task.dependencies ?? []
      }
      : null,
    current_changed_files: [],
    orientation_file: ".wi/runtime/orientation.json",
    continuity: buildAwfContinuityPreview(orientation),
    context_files: contextFiles,
    optional_context_files: normalizeStringArray([
      ".wi/acceptance.json",
      ".wi/story.json",
      ".wi/tasks.json",
      ...extraContextFiles
    ]),
    instructions: [
      "Read task.json first and use the embedded story/task slice as the implementation contract.",
      "Use orientation.json for continuity details instead of replaying prior chat history.",
      "Open the imported council artifacts only when task execution, design tradeoffs, or validation setup need deeper context.",
      "Execute exactly one task, and only report it completed after its verification commands pass."
    ],
    concepts: buildAwfConcepts(story, task, orientation),
    adapter: {
      name: executionConfig?.adapter ?? null,
      model: executionConfig?.model ?? null,
      agent: executionConfig?.agent ?? null,
      handoff_file: ".wi/runtime/council-handoff.md",
      mode: "manual",
      last_run: null
    },
    next_phase: "implementer"
  };
}

function buildFallbackAwfPlan(latest, story, tasks) {
  const lines = [
    `# ${story.title}`,
    "",
    "## Imported From AI Council",
    "",
    `Run ID: ${latest.session.run_id}`,
    `Mode: ${latest.session.mode ?? "plan"}`,
    "",
    "## Goal",
    "",
    story.goal || story.title
  ];

  if ((story.acceptance_criteria ?? []).length > 0) {
    lines.push("", "## Acceptance Criteria", "", ...story.acceptance_criteria.map((criterion) => `- ${criterion.text}`));
  }

  if ((tasks.tasks ?? []).length > 0) {
    lines.push("", "## Tasks", "", ...tasks.tasks.map((task) => `- ${task.id}: ${task.title}`));
  }

  return `${lines.join("\n").trim()}\n`;
}

function buildFallbackImplementationOutline(tasks) {
  const lines = [
    "# Implementation Outline",
    ""
  ];

  if ((tasks.tasks ?? []).length === 0) {
    lines.push("No implementation tasks were imported.");
    return `${lines.join("\n").trim()}\n`;
  }

  for (const [index, task] of tasks.tasks.entries()) {
    lines.push(`## ${index + 1}. ${task.title}`, "", task.description || task.title, "");
  }

  return `${lines.join("\n").trim()}\n`;
}

function copyCouncilArtifactsIntoAwf(latest, repoPath, wiRoot, story, tasks) {
  const copied = [];
  const mappings = [
    ["plan.md", "plan.md"],
    ["solution-design.md", "solution-design.md"],
    ["implementation-outline.md", "implementation-outline.md"],
    ["summary.md", "ai-council-summary.md"],
    ["debate-output.md", "ai-council-debate-output.md"],
    ["recommendation.md", "ai-council-recommendation.md"],
    ["findings.md", "ai-council-findings.md"],
    ["scorecard.json", "ai-council-scorecard.json"]
  ];

  for (const [sourceName, targetName] of mappings) {
    const sourcePath = path.join(latest.resultPath, sourceName);
    if (!pathExists(sourcePath)) {
      continue;
    }

    const targetPath = path.join(wiRoot, targetName);
    copyFile(sourcePath, targetPath);
    copied.push(`.wi/${targetName}`);
  }

  if (!pathExists(path.join(wiRoot, "plan.md"))) {
    writeText(path.join(wiRoot, "plan.md"), buildFallbackAwfPlan(latest, story, tasks));
    copied.push(".wi/plan.md");
  }

  if (!pathExists(path.join(wiRoot, "implementation-outline.md"))) {
    writeText(path.join(wiRoot, "implementation-outline.md"), buildFallbackImplementationOutline(tasks));
    copied.push(".wi/implementation-outline.md");
  }

  return normalizeStringArray(copied);
}

function buildCouncilImportMetadata(latest, repoPath, story, tasks, copiedArtifacts, executionConfig, activeTaskId) {
  return {
    imported_at: nowIso(),
    source: {
      tool: "ai-council",
      run_id: latest.session.run_id,
      mode: latest.session.mode ?? "plan",
      title: latest.session.title ?? story.title,
      run_path: toRepoRelativePath(repoPath, latest.runPath),
      result_path: toRepoRelativePath(repoPath, latest.resultPath)
    },
    awf: {
      story_id: story.story_id,
      task_count: tasks.tasks.length,
      active_task_id: activeTaskId,
      execution: {
        adapter: executionConfig.adapter ?? null,
        model: executionConfig.model ?? null,
        agent: executionConfig.agent ?? null
      }
    },
    copied_artifacts: copiedArtifacts
  };
}

function buildCouncilHandoffMarkdown(latest, story, task, acceptance, copiedArtifacts, importMetadata) {
  const acceptanceSlice = buildAwfTaskAcceptanceSlice(acceptance, task);
  const lines = [
    "# AI Council Implementation Handoff",
    "",
    `Imported from approved AI Council run \`${latest.session.run_id}\`.`,
    "",
    "Start with `.wi/runtime/task.json` and use this handoff for provenance plus the larger plan/design context.",
    "",
    "## Story",
    "",
    `- Title: ${story.title}`,
    `- Goal: ${story.goal || story.title}`,
    `- Source mode: ${latest.session.mode ?? "plan"}`,
    "",
    "## Active Task",
    "",
    `- ${task.id}: ${task.title}`,
    `- Priority: ${task.priority_class ?? "standard_feature"}`,
    ""
  ];

  if (task.description) {
    lines.push(task.description, "");
  }

  if (acceptanceSlice.length > 0) {
    lines.push("## Acceptance Slice", "", ...acceptanceSlice.map((criterion) => `- ${criterion.id}: ${criterion.text}`), "");
  }

  if (copiedArtifacts.length > 0) {
    lines.push("## Supporting Artifacts", "", ...copiedArtifacts.map((artifact) => `- ${artifact}`), "");
  }

  lines.push(
    "## Provenance",
    "",
    `- Original run: ${importMetadata.source.run_path}`,
    `- Original result: ${importMetadata.source.result_path}`,
    "",
    "## Working Guidance",
    "",
    "- Use the imported plan/design docs when implementation details or tradeoffs are unclear.",
    "- Keep the implementation scoped to this single task and leave broader completion to AWF review and verification."
  );

  return `${lines.join("\n").trim()}\n`;
}

const LARGE_RESULT_TASK_THRESHOLD = 6;
const LARGE_RESULT_ACCEPTANCE_THRESHOLD = 8;
const LARGE_RESULT_WORD_THRESHOLD = 2200;
const STORY_SPLIT_MAX_TASKS = 4;

function countWords(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function resultArtifactRefs(latest, repoPath) {
  const refs = [];
  const inputRefs = [
    path.join(latest.workPath, "input", "ticket-definition.md"),
    path.join(latest.resultPath, "summary.md"),
    path.join(latest.resultPath, "plan.md"),
    path.join(latest.resultPath, "solution-design.md"),
    path.join(latest.resultPath, "implementation-outline.md"),
    path.join(latest.resultPath, "debate-output.md"),
    path.join(latest.resultPath, "recommendation.md"),
    path.join(latest.resultPath, "findings.md"),
    path.join(latest.resultPath, "scorecard.json")
  ];

  for (const targetPath of inputRefs) {
    if (pathExists(targetPath)) {
      refs.push(toRepoRelativePath(repoPath, targetPath));
    }
  }

  return normalizeStringArray(refs);
}

function latestResultWordCount(latest) {
  const files = [
    path.join(latest.resultPath, "summary.md"),
    path.join(latest.resultPath, "plan.md"),
    path.join(latest.resultPath, "solution-design.md"),
    path.join(latest.resultPath, "implementation-outline.md"),
    path.join(latest.resultPath, "debate-output.md"),
    path.join(latest.resultPath, "recommendation.md"),
    path.join(latest.resultPath, "findings.md")
  ];

  return files.reduce((total, filePath) => total + (pathExists(filePath) ? countWords(readText(filePath)) : 0), 0);
}

function splitTasksIntoStoryChunks(tasks, preferredMaxTasks = STORY_SPLIT_MAX_TASKS) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return [];
  }

  if (tasks.length === 1) {
    return [tasks];
  }

  const chunkSize = tasks.length <= preferredMaxTasks
    ? Math.max(1, Math.ceil(tasks.length / 2))
    : preferredMaxTasks;
  const chunks = [];
  for (let index = 0; index < tasks.length; index += chunkSize) {
    chunks.push(tasks.slice(index, index + chunkSize));
  }

  return chunks;
}

function buildStoryExportDescription(latest, story, tasks, index = 0, total = 1) {
  const focus = tasks.map((task) => task.title).filter(Boolean).slice(0, 3);
  const descriptionLines = [
    story.goal || story.title || "Approved AI Council story."
  ];

  if (total > 1) {
    descriptionLines.push(`This story is part ${index + 1} of ${total} from the approved ${latest.session.mode ?? "plan"} council result.`);
  } else {
    descriptionLines.push(`This story packages the approved ${latest.session.mode ?? "plan"} council result into one implementation-ready handoff.`);
  }

  if (focus.length > 0) {
    descriptionLines.push(`Primary focus: ${focus.join("; ")}.`);
  }

  return descriptionLines.join(" ");
}

function buildStructuredStoryRecord(latest, repoPath, story, acceptance, tasks, options = {}) {
  const index = options.index ?? 0;
  const total = options.total ?? 1;
  const storyId = total > 1
    ? `${story.story_id}-S${String(index + 1).padStart(2, "0")}`
    : story.story_id;
  const title = total > 1
    ? `${story.title} - Story ${index + 1}`
    : story.title;
  const taskIds = new Set(tasks.map((task) => task.id));
  const acceptanceSlice = (acceptance.criteria ?? []).filter((criterion) =>
    (criterion.task_ids ?? []).some((taskId) => taskIds.has(taskId))
      || (tasks.some((task) => (task.ac_refs ?? []).includes(criterion.id)))
  );

  return {
    story_id: storyId,
    title,
    mode: latest.session.mode ?? "plan",
    description: buildStoryExportDescription(latest, story, tasks, index, total),
    goal: story.goal,
    in_scope: normalizeStringArray(story.in_scope ?? []),
    out_of_scope: normalizeStringArray(story.out_of_scope ?? []),
    constraints: normalizeStringArray(story.constraints ?? []),
    dependencies: normalizeStringArray(tasks.flatMap((task) => task.dependencies ?? [])),
    references: resultArtifactRefs(latest, repoPath),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      priority_class: task.priority_class ?? "standard_feature",
      priority_rank: task.priority_rank ?? 3,
      priority_reason: task.priority_reason ?? null,
      dependencies: normalizeStringArray(task.dependencies ?? []),
      acceptance_refs: normalizeStringArray(task.ac_refs ?? []),
      verification: normalizeStringArray(task.verification ?? [])
    })),
    acceptance_criteria: acceptanceSlice.map((criterion) => ({
      id: criterion.id,
      text: criterion.text,
      task_ids: normalizeStringArray(criterion.task_ids ?? []),
      status: criterion.status ?? "pending"
    })),
    source_run: {
      run_id: latest.session.run_id,
      run_path: toRepoRelativePath(repoPath, latest.runPath),
      result_path: toRepoRelativePath(repoPath, latest.resultPath)
    }
  };
}

function renderStructuredStoryMarkdown(record) {
  const lines = [
    `# ${record.title}`,
    "",
    "## Description",
    "",
    record.description
  ];

  if (record.goal) {
    lines.push("", "## Goal", "", record.goal);
  }

  if (record.tasks.length > 0) {
    lines.push("", "## Tasks", "");
    for (const [index, task] of record.tasks.entries()) {
      lines.push(`${index + 1}. ${task.title}`);
      lines.push(`   - ID: ${task.id}`);
      if (task.description) {
        lines.push(`   - Description: ${task.description}`);
      }
      if (task.acceptance_refs.length > 0) {
        lines.push(`   - Acceptance refs: ${task.acceptance_refs.join(", ")}`);
      }
      if (task.dependencies.length > 0) {
        lines.push(`   - Dependencies: ${task.dependencies.join(", ")}`);
      }
      if (task.verification.length > 0) {
        lines.push(`   - Verification: ${task.verification.join(" | ")}`);
      }
    }
  }

  if (record.acceptance_criteria.length > 0) {
    lines.push("", "## Acceptance Criteria", "", ...record.acceptance_criteria.map((criterion) => `- ${criterion.id}: ${criterion.text}`));
  }

  if (record.constraints.length > 0) {
    lines.push("", "## Constraints", "", ...record.constraints.map((item) => `- ${item}`));
  }

  if (record.dependencies.length > 0) {
    lines.push("", "## Dependencies", "", ...record.dependencies.map((item) => `- ${item}`));
  }

  if (record.references.length > 0) {
    lines.push("", "## References", "", ...record.references.map((item) => `- ${item}`));
  }

  lines.push(
    "",
    "## Source Run",
    "",
    `- Run ID: ${record.source_run.run_id}`,
    `- Run path: ${record.source_run.run_path}`,
    `- Result path: ${record.source_run.result_path}`
  );

  return `${lines.join("\n").trim()}\n`;
}

function exportRunToStoryPackage(latest, repoPath, options = {}) {
  const mode = String(options.mode ?? "single").trim().toLowerCase() === "split" ? "split" : "single";
  const awf = buildAwfArtifactsFromSession(latest);
  const exportRoot = path.join(latest.resultPath, "story-export");
  const packageRoot = path.join(exportRoot, mode === "split" ? "split-stories" : "single-story");
  ensureDir(packageRoot);

  const taskChunks = mode === "split"
    ? splitTasksIntoStoryChunks(awf.tasks.tasks, options.max_tasks_per_story ?? STORY_SPLIT_MAX_TASKS)
    : [awf.tasks.tasks];
  const records = taskChunks.map((taskChunk, index) => buildStructuredStoryRecord(
    latest,
    repoPath,
    awf.story,
    awf.acceptance,
    taskChunk,
    { index, total: taskChunks.length }
  ));
  const manifest = {
    created_at: nowIso(),
    mode,
    run_id: latest.session.run_id,
    story_count: records.length,
    stories: records.map((record, index) => {
      const baseName = mode === "split"
        ? `story-${String(index + 1).padStart(2, "0")}`
        : "story";
      const jsonPath = path.join(packageRoot, `${baseName}.json`);
      const markdownPath = path.join(packageRoot, `${baseName}.md`);
      writeJson(jsonPath, record);
      writeText(markdownPath, renderStructuredStoryMarkdown(record));
      return {
        id: record.story_id,
        title: record.title,
        json_path: toRepoRelativePath(repoPath, jsonPath),
        markdown_path: toRepoRelativePath(repoPath, markdownPath)
      };
    })
  };

  writeJson(path.join(packageRoot, "manifest.json"), manifest);

  const indexLines = [
    "# Story Export",
    "",
    `Mode: ${mode}`,
    `Run ID: ${latest.session.run_id}`,
    `Stories: ${manifest.story_count}`,
    "",
    ...manifest.stories.flatMap((story, index) => [
      `## ${index + 1}. ${story.title}`,
      "",
      `- JSON: ${story.json_path}`,
      `- Markdown: ${story.markdown_path}`,
      ""
    ])
  ];
  writeText(path.join(packageRoot, "README.md"), `${indexLines.join("\n").trim()}\n`);

  return {
    ok: true,
    mode,
    root: packageRoot,
    story_count: manifest.story_count,
    stories: manifest.stories
  };
}

function storyPackagingPreviewFromLatest(latest) {
  const awf = buildAwfArtifactsFromSession(latest);
  const taskCount = awf.tasks.tasks.length;
  const acceptanceCount = awf.acceptance.criteria.length;
  const wordCount = latestResultWordCount(latest);
  const canSplit = taskCount >= 2;
  const suggestedStoryCount = canSplit
    ? splitTasksIntoStoryChunks(awf.tasks.tasks, STORY_SPLIT_MAX_TASKS).length
    : 1;
  const isLargeResult = taskCount >= LARGE_RESULT_TASK_THRESHOLD
    || acceptanceCount >= LARGE_RESULT_ACCEPTANCE_THRESHOLD
    || wordCount >= LARGE_RESULT_WORD_THRESHOLD;

  return {
    task_count: taskCount,
    acceptance_count: acceptanceCount,
    word_count: wordCount,
    can_split: canSplit,
    is_large_result: isLargeResult,
    suggested_story_count: suggestedStoryCount
  };
}

function buildAwfArtifactsFromSession(latest) {
  const inputMetadata = readJson(path.join(latest.workPath, "input", "input-metadata.json"), {});
  const ticketText = readText(path.join(latest.workPath, "input", "ticket-definition.md"));
  const sections = parseTicketSections(ticketText);
  const tasksPayload = readJson(path.join(latest.resultPath, "tasks.json"), { tasks: [] });
  const rawTasks = Array.isArray(tasksPayload.tasks) && tasksPayload.tasks.length > 0
    ? tasksPayload.tasks
    : buildTasks(extractSectionLists(sections, "acceptance_criteria"));
  const acceptanceCriteria = normalizeStringArray([
    ...extractSectionLists(sections, "acceptance_criteria"),
    ...rawTasks.flatMap((task) => normalizeStringArray(task.acceptance_criteria ?? []))
  ]);
  const criteria = acceptanceCriteria.map((text, index) => ({
    id: `AC-${String(index + 1).padStart(3, "0")}`,
    text,
    status: "pending",
    task_ids: []
  }));

  const story = {
    story_id: latest.session.run_id ?? slugify(latest.session.title ?? inputMetadata.title ?? "council-run"),
    title: latest.session.title ?? inputMetadata.title ?? "Council approved result",
    goal: sections.summary || sections.business_goal || latest.session.title || "Council approved result",
    actors: [],
    in_scope: extractSectionLists(sections, "scope"),
    out_of_scope: extractSectionLists(sections, "out_of_scope", "non_goals"),
    dependencies: extractSectionLists(sections, "dependencies"),
    constraints: extractSectionLists(sections, "constraints"),
    references: extractSectionLists(sections, "reference_links"),
    verification_evidence: extractSectionLists(sections, "validation", "verification_evidence"),
    acceptance_criteria: criteria,
    status: "intake_complete",
    created_at: nowIso(),
    updated_at: nowIso()
  };

  return {
    story,
    tasks: {
      story_id: story.story_id,
      generated_at: nowIso(),
      tasks: rawTasks.map((task, index) => {
        const taskId = task.id ?? `TASK-${String(index + 1).padStart(3, "0")}`;
        const derivedRefs = Array.isArray(task.ac_refs) && task.ac_refs.length > 0
          ? normalizeStringArray(task.ac_refs)
          : normalizeStringArray(task.acceptance_criteria ?? [])
            .map((criterionText) => criteria.find((criterion) => criterion.text === criterionText)?.id ?? null)
            .filter(Boolean);

        for (const ref of derivedRefs) {
          const criterion = criteria.find((item) => item.id === ref);
          if (criterion && !criterion.task_ids.includes(taskId)) {
            criterion.task_ids.push(taskId);
          }
        }

        return {
          id: taskId,
          title: task.title ?? `Council task ${index + 1}`,
          description: task.description ?? task.title ?? `Council task ${index + 1}`,
          priority_class: task.priority_class ?? "standard_feature",
          priority_rank: task.priority_rank ?? 3,
          priority_reason: task.priority_reason ?? "Imported from approved AI Council result.",
          status: "pending",
          dependencies: normalizeStringArray(task.dependencies ?? []),
          ac_refs: derivedRefs,
          verification: normalizeStringArray(task.verification ?? []),
          result: {
            summary: null,
            changed_files: [],
            last_verification: null
          }
        };
      })
    },
    acceptance: {
      story_id: story.story_id,
      criteria
    },
    clarification_answers: parseClarificationAnswersFromTicket(ticketText)
  };
}

function exportRunToAwf(latest, repoPath, config) {
  const awf = buildAwfArtifactsFromSession(latest);
  const wiRoot = path.join(repoPath, ".wi");
  const runtimeDir = path.join(wiRoot, "runtime");
  const logsDir = path.join(wiRoot, "logs");
  ensureDir(runtimeDir);
  ensureDir(logsDir);

  const executionConfig = preferredAwfExecutionConfig(latest, config);
  const existingAwfConfig = readJson(path.join(wiRoot, "config.json"), null);
  const mergedConfig = mergeAwfConfig(repoPath, existingAwfConfig ?? {}, executionConfig);
  const copiedArtifacts = copyCouncilArtifactsIntoAwf(latest, repoPath, wiRoot, awf.story, awf.tasks);

  awf.story.references = normalizeStringArray([
    ...awf.story.references,
    ...copiedArtifacts,
    toRepoRelativePath(repoPath, latest.resultPath)
  ]);

  const activeTask = awf.tasks.tasks.find((task) => task.status === "pending") ?? null;
  if (activeTask) {
    activeTask.status = "in_progress";
  }

  const nextTaskId = awf.tasks.tasks.find((task) => task.status === "pending")?.id ?? null;
  const taskAcceptance = activeTask
    ? awf.acceptance.criteria.filter((criterion) => (activeTask.ac_refs ?? []).includes(criterion.id))
    : [];
  const orientation = {
    current_slice: activeTask?.title ?? awf.story.title,
    last_task_id: null,
    last_task_outcome: "not_started",
    changed_files: [],
    key_changes: [],
    active_invariants: normalizeStringArray(awf.story.constraints ?? []).slice(0, 4),
    open_risks: [],
    next_task_considerations: normalizeStringArray([
      activeTask ? `Start with ${activeTask.id}.` : null,
      copiedArtifacts.includes(".wi/plan.md") ? "Use .wi/plan.md as the approved council plan." : null,
      copiedArtifacts.includes(".wi/solution-design.md") ? "Use .wi/solution-design.md when design tradeoffs matter." : null
    ]),
    concepts: {
      axiom: [
        awf.story.goal,
        ...normalizeStringArray(awf.story.constraints ?? [])
      ].filter(Boolean).slice(0, 4),
      vector: [
        activeTask?.title ?? null,
        ...taskAcceptance.map((criterion) => criterion.text)
      ].filter(Boolean).slice(0, 4),
      forge: normalizeStringArray(copiedArtifacts).slice(0, 4),
      sentinel: []
    },
    refreshed_at: nowIso()
  };
  const runtimeTask = buildAwfRuntimePacket(
    repoPath,
    awf.story,
    awf.acceptance,
    activeTask,
    orientation,
    mergedConfig.phase_execution.implementation,
    [...copiedArtifacts, ".wi/council-import.json"]
  );
  const importMetadata = buildCouncilImportMetadata(
    latest,
    repoPath,
    awf.story,
    awf.tasks,
    copiedArtifacts,
    mergedConfig.phase_execution.implementation,
    activeTask?.id ?? null
  );

  writeJson(path.join(wiRoot, "config.json"), mergedConfig);
  writeJson(path.join(wiRoot, "story.json"), awf.story);
  writeJson(path.join(wiRoot, "tasks.json"), awf.tasks);
  writeJson(path.join(wiRoot, "acceptance.json"), awf.acceptance);
  writeJson(path.join(wiRoot, "intake-context.json"), {
    story_source: {
      type: "ai_council_approved_run",
      ref: latest.session.run_id,
      text: readText(path.join(latest.workPath, "input", "ticket-definition.md"))
    },
    supporting_context: copiedArtifacts.map((artifact) => ({
      kind: artifact.endsWith(".json") ? "council_artifact_json" : "council_artifact",
      label: artifact.replace(/^\.wi\//, ""),
      ref: artifact,
      file_path: toAbsoluteRepoArtifactPath(repoPath, artifact),
      repo_relative_path: artifact,
      text: readText(toAbsoluteRepoArtifactPath(repoPath, artifact))
    })),
    updated_at: nowIso()
  });
  writeJson(path.join(wiRoot, "clarification.json"), emptyAwfClarification());
  writeJson(path.join(wiRoot, "blockers.json"), emptyAwfBlockers());
  writeJson(path.join(wiRoot, "human-review.json"), emptyAwfHumanReview());
  writeJson(path.join(wiRoot, "state.json"), {
    story_id: awf.story.story_id,
    story_status: activeTask ? "implementation_in_progress" : "implementation_ready",
    current_phase: activeTask ? "implementation" : "implementation_ready",
    active_task_id: activeTask?.id ?? null,
    next_task_id: nextTaskId,
    review_status: "not_requested",
    verification_status: "not_run",
    last_completed_task_id: null,
    updated_at: nowIso()
  });
  writeJson(path.join(runtimeDir, "orientation.json"), orientation);
  writeJson(path.join(runtimeDir, "task.json"), runtimeTask);
  writeText(path.join(runtimeDir, "council-handoff.md"), buildCouncilHandoffMarkdown(latest, awf.story, activeTask ?? awf.tasks.tasks[0], awf.acceptance, copiedArtifacts, importMetadata));
  writeJson(path.join(wiRoot, "council-import.json"), importMetadata);
  writeText(path.join(wiRoot, "questions.md"), buildAwfQuestionsMarkdown(awf.clarification_answers));
  if (!pathExists(path.join(logsDir, "progress.ndjson"))) {
    writeText(path.join(logsDir, "progress.ndjson"), "");
  }
  if (!pathExists(path.join(logsDir, "review.ndjson"))) {
    writeText(path.join(logsDir, "review.ndjson"), "");
  }
  if (!pathExists(path.join(wiRoot, "README.md"))) {
    writeText(path.join(wiRoot, "README.md"), `# AWF Import\n\nImported from approved AI Council run \`${latest.session.run_id}\`.\n`);
  }

  return {
    ok: true,
    wi_root: wiRoot,
    story_id: awf.story.story_id,
    active_task_id: activeTask?.id ?? null,
    next_task_id: nextTaskId,
    handoff_file: path.join(runtimeDir, "council-handoff.md")
  };
}

async function rerunLatestWithChanges(frameworkRoot, repoPath, latest, config, options = {}) {
  const inputDir = path.join(latest.workPath, "input");
  const ticketText = readText(path.join(inputDir, "ticket-definition.md"));
  const prompt = String(options.prompt ?? options.reason ?? "").trim();
  const priorContext = readOptionalInputText(inputDir, "extra-context.md");
  const clarificationAnswers = parseClarificationAnswersFromTicket(ticketText);
  const revisionContext = [
    priorContext,
    prompt
      ? [
        "## Revision Request",
        prompt,
        "",
        `Revise the latest AI Council output to address this feedback while preserving the original request unless the feedback explicitly changes it.`
      ].join("\n")
      : ""
  ].filter(Boolean).join("\n\n").trim();

  return await runCouncil(frameworkRoot, repoPath, {
    mode: latest.session.mode ?? "plan",
    title: latest.session.title ?? null,
    output_root: outputRootFromLatestSession(config, latest),
    "ticket-file": path.join(inputDir, "ticket-definition.md"),
    "extra-context": revisionContext || undefined,
    clarification_answers: clarificationAnswers,
    "constraints-file": pathExists(path.join(inputDir, "constraints.md")) ? path.join(inputDir, "constraints.md") : undefined,
    "acceptance-file": pathExists(path.join(inputDir, "acceptance-criteria.md")) ? path.join(inputDir, "acceptance-criteria.md") : undefined,
    "review-target-file": pathExists(path.join(inputDir, "review-target.md")) ? path.join(inputDir, "review-target.md") : undefined,
    "debate-topic-file": pathExists(path.join(inputDir, "debate-topic.md")) ? path.join(inputDir, "debate-topic.md") : undefined,
    provider: latest.session.effective_config?.provider_preference ?? config.user?.default_provider ?? config.providers.default_provider,
    launch: latest.session.effective_config?.launch === true,
    stage_assignments: latest.session.effective_config?.stage_assignments ?? config.user?.stage_assignments ?? {},
    council_agents: latest.session.effective_config?.council_agents ?? config.user?.council_agents ?? [],
    repo: latest.session.review_repo?.repo_path ?? repoPath
  });
}

function outputRootFromLatestSession(config, latest) {
  return latest.session.effective_config?.output_root
    ?? config.user?.output_root
    ?? ".ai-council/result";
}

export function previewLatestStoryPackaging(frameworkRoot, repoPath, options = {}) {
  const resolvedRepoPath = resolveRepoRoot(repoPath);
  const config = loadConfig(frameworkRoot, resolvedRepoPath);
  const outputRoot = resolveOutputRoot(resolvedRepoPath, config, options);
  const latest = latestSession(resolvedRepoPath, outputRoot);
  if (!latest) {
    throw new Error("No AI Council runs exist yet.");
  }

  return {
    ok: true,
    run_id: latest.session.run_id ?? null,
    title: latest.session.title ?? null,
    mode: latest.session.mode ?? null,
    ...storyPackagingPreviewFromLatest(latest)
  };
}

export async function clarifyLatest(frameworkRoot, repoPath, options = {}) {
  const resolvedRepoPath = resolveRepoRoot(repoPath);
  const config = loadConfig(frameworkRoot, resolvedRepoPath);
  const outputRoot = resolveOutputRoot(resolvedRepoPath, config, options);
  const latest = latestSession(resolvedRepoPath, outputRoot);
  if (!latest) {
    throw new Error("No AI Council runs exist yet.");
  }

  if (latest.session.status !== "awaiting_clarification") {
    throw new Error("The latest AI Council run is not waiting for clarification.");
  }

  const inputDir = path.join(latest.workPath, "input");
  const ticketText = readText(path.join(inputDir, "ticket-definition.md"));
  const combinedAnswers = mergeClarificationAnswers(
    parseClarificationAnswersFromTicket(ticketText),
    Array.isArray(options.clarification_answers) ? options.clarification_answers : []
  );
  if (combinedAnswers.length === 0) {
    throw new Error("Clarification answers are required before the council can continue.");
  }

  return await runCouncil(frameworkRoot, resolvedRepoPath, {
    mode: latest.session.mode ?? "plan",
    title: latest.session.title ?? null,
    output_root: outputRootFromLatestSession(config, latest),
    "ticket-file": path.join(inputDir, "ticket-definition.md"),
    clarification_answers: combinedAnswers,
    "extra-context": readOptionalInputText(inputDir, "extra-context.md") || undefined,
    "constraints-file": pathExists(path.join(inputDir, "constraints.md")) ? path.join(inputDir, "constraints.md") : undefined,
    "acceptance-file": pathExists(path.join(inputDir, "acceptance-criteria.md")) ? path.join(inputDir, "acceptance-criteria.md") : undefined,
    "review-target-file": pathExists(path.join(inputDir, "review-target.md")) ? path.join(inputDir, "review-target.md") : undefined,
    "debate-topic-file": pathExists(path.join(inputDir, "debate-topic.md")) ? path.join(inputDir, "debate-topic.md") : undefined,
    provider: latest.session.effective_config?.provider_preference ?? config.user?.default_provider ?? config.providers.default_provider,
    launch: latest.session.effective_config?.launch === true,
    stage_assignments: latest.session.effective_config?.stage_assignments ?? config.user?.stage_assignments ?? {},
    council_agents: latest.session.effective_config?.council_agents ?? config.user?.council_agents ?? [],
    repo: latest.session.review_repo?.repo_path ?? resolvedRepoPath,
    on_progress: options.on_progress ?? null
  });
}

export async function decideLatest(frameworkRoot, repoPath, options = {}) {
  const resolvedRepoPath = resolveRepoRoot(repoPath);
  const config = loadConfig(frameworkRoot, resolvedRepoPath);
  const outputRoot = resolveOutputRoot(resolvedRepoPath, config, options);
  const latest = latestSession(resolvedRepoPath, outputRoot);
  if (!latest) {
    throw new Error("No AI Council runs exist yet.");
  }

  const decision = String(options.decision ?? "").trim();
  if (!["approve", "request_changes", "reject"].includes(decision)) {
    throw new Error("Decision must be approve, request_changes, or reject.");
  }
  const storyExportMode = String(options.story_export_mode ?? options.storyExportMode ?? "").trim().toLowerCase();

  if (decision === "request_changes") {
    const rerun = await rerunLatestWithChanges(frameworkRoot, resolvedRepoPath, latest, config, options);
    const refreshed = latestSession(resolvedRepoPath, outputRootFromLatestSession(config, latest));
    return {
      ok: true,
      status: rerun.status,
      current_stage: rerun.status === "pending_approval" ? "awaiting_approval" : rerun.current_stage ?? null,
      available_actions: refreshed ? availableActions(refreshed.session) : ["approve", "request_changes", "reject"],
      review: {
        decision,
        prompt: String(options.prompt ?? options.reason ?? "").trim() || null,
        notes: String(options.notes ?? "").trim() || null,
        decided_at: nowIso()
      },
      rerun
    };
  }

  latest.session.status = decision === "approve" ? "approved" : decision === "request_changes" ? "changes_requested" : "rejected";
  latest.session.current_stage = decision === "approve" ? "approved" : decision;
  latest.session.review = {
    decision,
    prompt: String(options.prompt ?? options.reason ?? "").trim() || null,
    notes: String(options.notes ?? "").trim() || null,
    decided_at: nowIso()
  };
  latest.session.pending_actions = availableActions(latest.session);
  latest.session.next_action = decision === "approve"
    ? "Approved result is ready. Export to AWF if you want to start implementation."
    : "Start a new council run and use the review prompt as the change request context.";

  let storyExport = null;
  let awfExport = null;
  if (decision === "approve" && storyExportMode) {
    if (!["single", "split", "none"].includes(storyExportMode)) {
      throw new Error("Story export mode must be single, split, or none.");
    }

    if (storyExportMode === "split" && options.create_awf === true) {
      throw new Error("AWF export requires a single story package. Choose single or skip --create-awf.");
    }

    if (storyExportMode !== "none") {
      storyExport = exportRunToStoryPackage(latest, resolvedRepoPath, {
        mode: storyExportMode
      });
      latest.session.story_export = {
        mode: storyExport.mode,
        root: storyExport.root,
        story_count: storyExport.story_count,
        stories: storyExport.stories,
        created_at: nowIso()
      };
    }
  }

  if (decision === "approve" && options.create_awf === true) {
    awfExport = exportRunToAwf(latest, resolvedRepoPath, config);
  }

  latest.session.next_action = decision === "approve"
    ? awfExport
      ? "Approved result is packaged and AWF artifacts are ready. Start from .wi/runtime/task.json and .wi/runtime/council-handoff.md."
      : storyExport?.mode === "split"
        ? "Approved result is split into implementation stories. Review the story-export package and pick the first story to implement."
        : storyExport?.mode === "single"
          ? "Approved result is packaged as a single implementation story. Review the story-export package or export it to AWF when you are ready."
          : "Approved result is ready. Export to AWF if you want to start implementation."
    : "Start a new council run and use the review prompt as the change request context.";

  writeLatestSession(latest, latest.session);
  return {
    ok: true,
    status: latest.session.status,
    current_stage: latest.session.current_stage,
    available_actions: availableActions(latest.session),
    review: latest.session.review,
    story_export: storyExport,
    awf_export: awfExport
  };
}

export function exportLatestToAwf(frameworkRoot, repoPath, options = {}) {
  const resolvedRepoPath = resolveRepoRoot(repoPath);
  const config = loadConfig(frameworkRoot, resolvedRepoPath);
  const outputRoot = resolveOutputRoot(resolvedRepoPath, config, options);
  const latest = latestSession(resolvedRepoPath, outputRoot);
  if (!latest) {
    throw new Error("No AI Council runs exist yet.");
  }
  if (latest.session.status !== "approved") {
    throw new Error("Only an approved AI Council result can be exported to AWF.");
  }

  const exported = exportRunToAwf(latest, resolvedRepoPath, config);
  latest.session.pending_actions = availableActions(latest.session);
  latest.session.next_action = "AWF implementation artifacts are ready. Start from .wi/runtime/task.json and .wi/runtime/council-handoff.md.";
  writeLatestSession(latest, latest.session);
  return exported;
}

export async function runCouncil(frameworkRoot, repoPath, options = {}) {
  const resolvedRepoPath = resolveRepoRoot(repoPath);
  const config = loadConfig(frameworkRoot, resolvedRepoPath);
  const onProgress = options.on_progress ?? null;
  const mode = options.mode ?? config.app.default_mode ?? "plan";
  const outputRoot = resolveOutputRoot(resolvedRepoPath, config, options);
  const workflow = config.workflows[mode];
  if (!workflow?.mode) {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  const title = options.title ?? options.prompt ?? options["jira-url"] ?? options["ticket-file"] ?? options["ticket-source"] ?? `${mode} council run`;
  const { runId, runPath, workPath, resultPath } = createRunWorkspace(resolvedRepoPath, outputRoot, mode, title);
  emitProgress(onProgress, { type: "run_created", mode, run_path: runPath, result_path: resultPath, work_path: workPath });
  const normalizedInput = normalizeInput(workPath, options);
  emitProgress(onProgress, {
    type: "input_normalized",
    ticket_path: path.join(workPath, "input", "ticket-definition.md"),
    source_type: normalizedInput.metadata.source_type,
    title: normalizedInput.metadata.title
  });
  const providers = detectProviders(config.providers, config.user?.provider_overrides);
  const council = config.councils[workflow.council] ?? config.councils[config.app.default_council];
  const stageAssignments = options.stage_assignments ?? config.user?.stage_assignments ?? {};
  const councilAgents = options.council_agents ?? config.user?.council_agents ?? [];
  const clarificationAnswersProvided = Array.isArray(options.clarification_answers) && options.clarification_answers.length > 0;
  const participantIssues = validateRequestedParticipants(stageAssignments, providers, councilAgents);
  if (participantIssues.length > 0) {
    throw new Error(formatParticipantValidationError(participantIssues));
  }
  let clarification = null;
  if (!clarificationAnswersProvided) {
    const preferredProvider = options.provider ?? config.user?.default_provider ?? config.providers.default_provider;
    const clarificationParticipant = resolveProvidersByNames(
      providers,
      stageAssignments?.proposal ?? [],
      preferredProvider,
      councilAgents
    )[0] ?? null;

    emitProgress(onProgress, {
      type: "clarification_started",
      stage: "clarification",
      provider: clarificationParticipant?.name ?? preferredProvider ?? null,
      participant_label: clarificationParticipant?.label ?? clarificationParticipant?.name ?? preferredProvider ?? null,
      model: clarificationParticipant?.model ?? null
    });
    emitProgress(onProgress, {
      type: "clarification_waiting",
      stage: "clarification",
      provider: clarificationParticipant?.name ?? preferredProvider ?? null,
      participant_label: clarificationParticipant?.label ?? clarificationParticipant?.name ?? preferredProvider ?? null,
      model: clarificationParticipant?.model ?? null,
      timeout_ms: clarificationParticipant?.timeout_ms ?? 120000
    });

    const clarificationStage = await runClarificationStage({
      workPath,
      repoPath: mode === "review"
        ? resolveRepoRoot(options.repo ?? resolvedRepoPath)
        : resolvedRepoPath,
      mode,
      title: normalizedInput.metadata.title,
      ticketText: normalizedInput.canonical_content,
      providers,
      stageAssignments,
      preferredProvider,
      councilAgents,
      launch: options.launch === true
    });

    let clarificationResult = clarificationStage.analysis;
    let clarificationSource = clarificationStage.analysis ? "ai" : "fallback";
    if (!clarificationResult) {
      const fallbackQuestions = buildClarificationQuestions(normalizedInput.canonical_content, mode);
      clarificationResult = normalizeClarificationResult({
        status: fallbackQuestions.length > 0 ? "needs_clarification" : "ready_for_planning",
        summary: clarificationStage.launch_result?.launched
          ? "The clarification stage did not return a structured payload, so AI Council used local fallback questions."
          : "AI clarification was not launched, so AI Council used local fallback questions.",
        questions: fallbackQuestions
      });
    }

    clarification = writeClarificationArtifacts(workPath, clarificationResult, {
      source: clarificationSource,
      provider: clarificationStage.participant?.name ?? null,
      participant_label: clarificationStage.participant?.label ?? clarificationStage.participant?.name ?? null,
      model: clarificationStage.participant?.model ?? null,
      launched: clarificationStage.launch_result?.launched === true,
      command_preview: clarificationStage.launch_result?.command_preview ?? "",
      prompt_file: clarificationStage.prompt_file,
      response_file: clarificationStage.response_file
    });

    writeTimeline(workPath, "clarification_completed", {
      status: clarification.status,
      question_count: clarification.question_count,
      blocking_question_count: clarification.blocking_question_count,
      source: clarification.source,
      provider: clarification.provider
    });
    writeCouncilLog(
      workPath,
      formatCouncilLog("Axiom", clarification.status === "needs_clarification"
        ? `Clarification stage found ${clarification.blocking_question_count} blocking question(s) before proposal.`
        : "Clarification stage found the request ready for proposal.")
    );
    emitProgress(onProgress, {
      type: "clarification_result",
      stage: "clarification",
      provider: clarification.provider,
      participant_label: clarification.participant_label,
      model: clarification.model,
      status: clarification.status,
      question_count: clarification.question_count,
      blocking_question_count: clarification.blocking_question_count,
      launched: clarification.launched === true
    });
  } else {
    clarification = writeClarificationArtifacts(workPath, normalizeClarificationResult({
      status: "ready_for_planning",
      summary: "Clarification answers were provided before proposal started.",
      questions: []
    }), {
      source: "answered",
      answered_questions: options.clarification_answers
    });
  }

  const deliberationPlan = buildDeliberationPlan(
    stageAssignments,
    providers,
    options.provider ?? config.user?.default_provider ?? config.providers.default_provider,
    councilAgents
  );
  writeCouncilPlan(workPath, { cycle: deliberationPlan });
  writeTimeline(workPath, "run_created", { mode, title: normalizedInput.metadata.title });
  writeCouncilLog(workPath, formatCouncilLog("Axiom", "Parsing input and structuring the ticket definition."));
  writeCouncilLog(workPath, formatCouncilLog("Vector", `Initializing ${mode} council workflow.`));

  let evidence = null;
  const targetRepoPath = mode === "review"
    ? resolveRepoRoot(options.repo ?? resolvedRepoPath)
    : resolvedRepoPath;
  if (mode === "review") {
    evidence = buildReviewEvidence(workPath, targetRepoPath);
    writeTimeline(workPath, "review_evidence_created", { repo_path: evidence.repo_path, file_count: evidence.file_count });
    writeCouncilLog(workPath, formatCouncilLog("Sentinel", `Captured review evidence from ${evidence.repo_path}.`));
    emitProgress(onProgress, { type: "review_evidence_created", repo_path: evidence.repo_path, file_count: evidence.file_count });
  }

  const manifest = {
    run_id: runId,
    run_path: runPath,
    mode,
    family: workflow.family,
    title: normalizedInput.metadata.title,
    workflow,
    council: council.name,
    status: "running",
    current_stage: "deliberation",
    pending_actions: [],
    clarification,
    review: null,
    review_repo: evidence ? { repo_path: evidence.repo_path } : null,
    next_action: "Waiting for council output.",
    effective_config: {
      provider_preference: options.provider ?? config.user?.default_provider ?? config.providers.default_provider,
      output_root: outputRoot,
      launch: options.launch === true,
      workflow,
      council,
      stage_assignments: stageAssignments,
      council_agents: councilAgents,
      rubric: mode === "review" ? config.rubrics.review : null
    }
  };

  writeSessionManifest(workPath, manifest);
  writeJson(path.join(workPath, "synth", "input-summary.json"), normalizedInput.metadata);
  if (clarification.status === "needs_clarification" && !clarificationAnswersProvided) {
    manifest.status = "awaiting_clarification";
    manifest.current_stage = "awaiting_clarification";
    manifest.pending_actions = ["answer_clarifications"];
    manifest.questions = clarification.questions;
    manifest.next_action = "Answer the clarification questions before proposal starts.";
    writeLatestSession({
      sessionPath: path.join(workPath, "session", "session.json")
    }, manifest);

    return {
      ok: true,
      status: manifest.status,
      run_id: runId,
      run_path: runPath,
      result_path: resultPath,
      work_path: workPath,
      output_root: outputRoot,
      mode,
      questions: clarification.questions,
      question_count: clarification.question_count,
      next_action: manifest.next_action
    };
  }
  writeJson(path.join(workPath, "session", "visual-reference.json"), { council: getCouncilVisualReference() });
  writeText(
    path.join(workPath, "session", "visual-reference.md"),
    `# Council Visual Reference

| Function | Council Identity | ID |
| --- | --- | --- |
${getCouncilVisualReference().map((entry) => `| ${entry.function} | ${entry.name} | ${entry.id} |`).join("\n")}

## Deliberation Cycle
| Stage | Leader | Description |
| --- | --- | --- |
${getDeliberationCycle().map((entry) => `| ${entry.stage} | ${entry.leader} | ${entry.description} |`).join("\n")}
`
  );
  writeJson(path.join(workPath, "session", "deliberation-plan.json"), {
    cycle: deliberationPlan.map((stage) => ({
      stage: stage.stage,
      leader: stage.leader,
      participants: stage.participants.map((participant) => participant.name),
      participant_labels: stage.participants.map((participant) => participant.label ?? participant.name),
      participant_models: stage.participants.map((participant) => participant.model ?? null)
    }))
  });
  const { executionResults, providerSessions } = await createDeliberationArtifacts(
    workPath,
    targetRepoPath,
    workflow,
    deliberationPlan,
    normalizedInput.canonical_content,
    evidence,
    options.launch === true,
    onProgress
  );

  removeDir(resultPath);
  ensureDir(resultPath);
  const responses = collectStageResponses(workPath);
  const sections = parseTicketSections(normalizedInput.canonical_content);
  const deliverables = createModeArtifacts(mode, {
    resultPath,
    title: normalizedInput.metadata.title,
    sections,
    acceptanceCriteria: normalizedInput.acceptance_criteria,
    responses,
    evidence,
    rubric: config.rubrics.review
  });
  writeExecutionSummary(workPath, executionResults, providerSessions);
  const responseGroups = partitionStageResponses(responses);

  manifest.status = "pending_approval";
  manifest.current_stage = "awaiting_approval";
  manifest.pending_actions = ["approve", "request_changes", "reject"];
  manifest.deliverables = deliverables;
  manifest.response_summary = {
    actual: responseGroups.actual.length,
    pending: responseGroups.pending.length,
    blocked: responseGroups.blocked.length
  };
  manifest.next_action = responseGroups.actual.length === 0 && responseGroups.pending.length > 0
    ? "Providers were prepared but not launched. Enable auto-launch or rerun with launch enabled, then review result/."
    : "Review result/ and choose approve, request changes, or reject.";
  writeLatestSession({
    sessionPath: path.join(workPath, "session", "session.json")
  }, manifest);

  writeTimeline(workPath, "final_artifacts_created", { final_outputs: deliverables });
  writeCouncilLog(workPath, formatCouncilLog("Vector", "Final artifacts are ready for review and follow-up AI work."));
  emitProgress(onProgress, { type: "final_artifacts_created", result_path: resultPath, final_outputs: deliverables });

  return {
    ok: true,
    status: manifest.status,
    run_id: runId,
    run_path: runPath,
    result_path: resultPath,
    work_path: workPath,
    output_root: outputRoot,
    mode,
    family: workflow.family,
    ticket_path: "input/ticket-definition.md",
    council: council.name,
    rounds: workflow.rounds,
    deliberation_cycle: deliberationPlan.map((stage) => ({
      stage: stage.stage,
      leader: stage.leader,
      participants: stage.participants.map((participant) => participant.name),
      participant_labels: stage.participants.map((participant) => participant.label ?? participant.name),
      participant_models: stage.participants.map((participant) => participant.model ?? null)
    })),
    final_outputs: deliverables,
    providers,
    evidence_summary: evidence,
    available_actions: availableActions(manifest),
    next_action: manifest.next_action
  };
}
