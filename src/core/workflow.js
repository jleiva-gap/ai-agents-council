import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.js";
import { createRunWorkspace, writeCouncilLog, writeSessionManifest, writeTimeline } from "./session.js";
import { formatCouncilLog, getCouncilVisualReference, getDeliberationCycle, getStageIdentity } from "./identity.js";
import { buildClarificationQuestions, normalizeInput } from "../input/normalize.js";
import { detectProviders, maybeLaunchPrompt, maybeRunProviderStartup, resolveProvidersByNames, writeCouncilPlan } from "../providers/index.js";
import { buildReviewEvidence } from "../review/evidence.js";
import { ensureDir, pathExists, readJson, readText, removeDir, slugify, writeJson, writeText } from "../utils/fs.js";

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
    ? `\n## Review Evidence\n- Files indexed: ${evidence.file_count}\n- Docs found: ${evidence.doc_count}\n- Tests found: ${evidence.test_count}\n`
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

function emitProgress(callback, event) {
  if (typeof callback === "function") {
    callback(event);
  }
}

async function createDeliberationArtifacts(workPath, repoPath, workflow, deliberationPlan, ticketText, evidence, launch, onProgress = null) {
  const results = [];
  const producedArtifacts = [];
  const startedProviders = new Set();
  const providerSessions = {};
  const totalSteps = deliberationPlan.reduce((sum, stage) => sum + stage.participants.length, 0);
  let completedSteps = 0;

  for (const [index, stage] of deliberationPlan.entries()) {
    const stageDir = path.join(workPath, "rounds", `${String(index + 1).padStart(2, "0")}-${slugify(stage.stage)}`);
    ensureDir(stageDir);
    writeCouncilLog(workPath, formatCouncilLog(stage.leader, `Starting ${stage.stage} with ${stage.participants.length} participant(s).`));
    emitProgress(onProgress, {
      type: "stage_started",
      stage: stage.stage,
      leader: stage.leader,
      participant_count: stage.participants.length,
      completed_steps: completedSteps,
      total_steps: totalSteps
    });

    for (const participant of stage.participants) {
      if (!providerSessions[participant.name]) {
        providerSessions[participant.name] = {
          provider: participant.name,
          session_mode: participant.session_mode ?? "fresh",
          session_file: path.join(workPath, "session", `${participant.name}.session.json`),
          active: false,
          stages: []
        };
      }

      if (!startedProviders.has(participant.name)) {
        emitProgress(onProgress, {
          type: "startup_begin",
          stage: stage.stage,
          provider: participant.name,
          participant_label: participant.label ?? participant.name,
          model: participant.model ?? null,
          completed_steps: completedSteps,
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
          completed_steps: completedSteps,
          total_steps: totalSteps
        });
        startedProviders.add(participant.name);
      }

      const promptFile = path.join(stageDir, `${participant.name}.prompt.md`);
      const outputFile = path.join(stageDir, `${participant.name}.response.md`);
      writeText(promptFile, buildPromptText(workflow.mode, stage.stage, participant.label ?? participant.name, ticketText, evidence, producedArtifacts, participant.model));
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
        completed_steps: completedSteps,
        total_steps: totalSteps
      });

      const launchResult = await maybeLaunchPrompt(promptFile, outputFile, workPath, participant, launch, providerSessions[participant.name]);
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

      producedArtifacts.push(path.relative(workPath, outputFile).replace(/\\/g, "/"));
      results.push({
        stage: stage.stage,
        leader: stage.leader,
        participant: participant.name,
        participant_label: participant.label ?? participant.name,
        model: participant.model ?? null,
        ...launchResult
      });
      providerSessions[participant.name].active = launchResult.launched && launchResult.exit_code === 0;
      providerSessions[participant.name].stages.push({
        stage: stage.stage,
        exit_code: launchResult.exit_code ?? null,
        timed_out: launchResult.timed_out === true
      });
      writeJson(providerSessions[participant.name].session_file, providerSessions[participant.name]);
      completedSteps += 1;
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
        completed_steps: completedSteps,
        total_steps: totalSteps
      });
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
  const config = loadConfig(frameworkRoot, repoPath);
  return {
    ok: true,
    framework_root: frameworkRoot,
    repo_path: repoPath,
    output_root: resolveOutputRoot(repoPath, config),
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
    review: latest.session.review ?? null,
    recommended_action: latest.session.next_action ?? "Review result/ first, then inspect work/ if you need the intermediate deliberation trail."
  };
}

export function getStatus(frameworkRoot, repoPath) {
  const config = loadConfig(frameworkRoot, repoPath);
  const outputRoot = resolveOutputRoot(repoPath, config);
  const latest = latestSession(repoPath, outputRoot);
  if (!latest) {
    return {
      ok: true,
      framework_root: frameworkRoot,
      repo_path: repoPath,
      output_root: outputRoot,
      has_runs: false,
      recommended_action: "Run ai-council run --mode plan --prompt \"Describe the work\""
    };
  }

  return buildStatusPayload(frameworkRoot, repoPath, outputRoot, latest);
}

export function resumeLatest(frameworkRoot, repoPath) {
  const status = getStatus(frameworkRoot, repoPath);
  return status.has_runs ? { ...status, resume_status: "resumed" } : status;
}

function writeLatestSession(latest, session) {
  writeJson(latest.sessionPath, session);
  return session;
}

function buildAwfArtifactsFromSession(latest) {
  const inputMetadata = readJson(path.join(latest.workPath, "input", "input-metadata.json"), {});
  const ticketText = readText(path.join(latest.workPath, "input", "ticket-definition.md"));
  const sections = parseTicketSections(ticketText);
  const acceptanceCriteria = extractList(sections.acceptance_criteria);
  const tasksPayload = readJson(path.join(latest.resultPath, "tasks.json"), { tasks: [] });
  const tasks = Array.isArray(tasksPayload.tasks) && tasksPayload.tasks.length > 0
    ? tasksPayload.tasks
    : buildTasks(acceptanceCriteria);

  const story = {
    story_id: latest.session.run_id ?? slugify(latest.session.title ?? inputMetadata.title ?? "council-run"),
    title: latest.session.title ?? inputMetadata.title ?? "Council approved result",
    goal: sections.summary || sections.business_goal || latest.session.title || "Council approved result",
    actors: [],
    in_scope: extractList(sections.scope),
    out_of_scope: [],
    dependencies: [],
    constraints: extractList(sections.constraints),
    references: [],
    verification_evidence: [],
    acceptance_criteria: acceptanceCriteria,
    status: "planned",
    created_at: nowIso(),
    updated_at: nowIso()
  };

  return {
    story,
    tasks: {
      story_id: story.story_id,
      generated_at: nowIso(),
      tasks: tasks.map((task, index) => ({
        id: task.id ?? `TASK-${String(index + 1).padStart(3, "0")}`,
        title: task.title,
        description: task.description ?? task.title,
        priority_class: "standard_feature",
        status: "pending",
        dependencies: [],
        ac_refs: acceptanceCriteria[index] ? [`AC-${String(index + 1).padStart(3, "0")}`] : [],
        verification: []
      }))
    },
    acceptance: {
      story_id: story.story_id,
      criteria: acceptanceCriteria.map((text, index) => ({
        id: `AC-${String(index + 1).padStart(3, "0")}`,
        text,
        status: "pending",
        task_ids: tasks[index] ? [tasks[index].id ?? `TASK-${String(index + 1).padStart(3, "0")}`] : []
      }))
    }
  };
}

function exportRunToAwf(latest, repoPath, config) {
  const awf = buildAwfArtifactsFromSession(latest);
  const wiRoot = path.join(repoPath, ".wi");
  const runtimeDir = path.join(wiRoot, "runtime");
  ensureDir(runtimeDir);
  ensureDir(path.join(wiRoot, "logs"));

  writeJson(path.join(wiRoot, "story.json"), awf.story);
  writeJson(path.join(wiRoot, "tasks.json"), awf.tasks);
  writeJson(path.join(wiRoot, "acceptance.json"), awf.acceptance);
  writeJson(path.join(wiRoot, "state.json"), {
    story_id: awf.story.story_id,
    story_status: "planned",
    current_phase: "implementation_ready",
    active_task_id: null,
    next_task_id: awf.tasks.tasks[0]?.id ?? null,
    review_status: "not_requested",
    last_completed_task_id: null,
    updated_at: nowIso()
  });
  writeJson(path.join(runtimeDir, "orientation.json"), {
    current_slice: awf.story.title,
    last_task_id: null,
    last_task_outcome: "not_started",
    changed_files: [],
    key_changes: [],
    open_risks: [],
    next_task_considerations: ["Imported from AI Council approved result."],
    refreshed_at: nowIso()
  });
  writeJson(path.join(runtimeDir, "task.json"), {
    generated_at: nowIso(),
    story: awf.story,
    task: null,
    next_phase: "implementer"
  });
  writeJson(path.join(wiRoot, "config.json"), {
    default_adapter: config.user?.default_provider ?? config.providers?.default_provider ?? "codex",
    default_verification: [],
    adapters: {},
    phase_execution: {
      implementation: {
        adapter: config.user?.default_provider ?? config.providers?.default_provider ?? "codex",
        model: null,
        agent: "awf-implementer",
        custom_prompt: null
      }
    }
  });
  writeText(path.join(wiRoot, "README.md"), `# AWF Import\n\nImported from approved AI Council run \`${latest.session.run_id}\`.\n`);

  return {
    ok: true,
    wi_root: wiRoot,
    story_id: awf.story.story_id,
    next_task_id: awf.tasks.tasks[0]?.id ?? null
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

export async function decideLatest(frameworkRoot, repoPath, options = {}) {
  const config = loadConfig(frameworkRoot, repoPath);
  const outputRoot = resolveOutputRoot(repoPath, config, options);
  const latest = latestSession(repoPath, outputRoot);
  if (!latest) {
    throw new Error("No AI Council runs exist yet.");
  }

  const decision = String(options.decision ?? "").trim();
  if (!["approve", "request_changes", "reject"].includes(decision)) {
    throw new Error("Decision must be approve, request_changes, or reject.");
  }

  if (decision === "request_changes") {
    const rerun = await rerunLatestWithChanges(frameworkRoot, repoPath, latest, config, options);
    const refreshed = latestSession(repoPath, outputRootFromLatestSession(config, latest));
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

  let awfExport = null;
  if (decision === "approve" && options.create_awf === true) {
    awfExport = exportRunToAwf(latest, repoPath, config);
  }

  writeLatestSession(latest, latest.session);
  return {
    ok: true,
    status: latest.session.status,
    current_stage: latest.session.current_stage,
    available_actions: availableActions(latest.session),
    review: latest.session.review,
    awf_export: awfExport
  };
}

export function exportLatestToAwf(frameworkRoot, repoPath, options = {}) {
  const config = loadConfig(frameworkRoot, repoPath);
  const outputRoot = resolveOutputRoot(repoPath, config, options);
  const latest = latestSession(repoPath, outputRoot);
  if (!latest) {
    throw new Error("No AI Council runs exist yet.");
  }
  if (latest.session.status !== "approved") {
    throw new Error("Only an approved AI Council result can be exported to AWF.");
  }

  const exported = exportRunToAwf(latest, repoPath, config);
  latest.session.pending_actions = availableActions(latest.session);
  latest.session.next_action = "AWF artifacts are ready. Start implementation from .wi/.";
  writeLatestSession(latest, latest.session);
  return exported;
}

export async function runCouncil(frameworkRoot, repoPath, options = {}) {
  const config = loadConfig(frameworkRoot, repoPath);
  const onProgress = options.on_progress ?? null;
  const mode = options.mode ?? config.app.default_mode ?? "plan";
  const outputRoot = resolveOutputRoot(repoPath, config, options);
  const workflow = config.workflows[mode];
  if (!workflow?.mode) {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  const title = options.title ?? options.prompt ?? options["jira-url"] ?? options["ticket-file"] ?? options["ticket-source"] ?? `${mode} council run`;
  const { runId, runPath, workPath, resultPath } = createRunWorkspace(repoPath, outputRoot, mode, title);
  emitProgress(onProgress, { type: "run_created", mode, run_path: runPath, result_path: resultPath, work_path: workPath });
  const normalizedInput = normalizeInput(workPath, options);
  const clarificationQuestions = buildClarificationQuestions(normalizedInput.canonical_content, mode);
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
  if (mode === "review") {
    const reviewRepoPath = path.resolve(options.repo ?? repoPath);
    evidence = buildReviewEvidence(workPath, reviewRepoPath);
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
  if (clarificationQuestions.length > 0 && !(Array.isArray(options.clarification_answers) && options.clarification_answers.length > 0)) {
    writeJson(path.join(workPath, "input", "clarification.json"), {
      status: "awaiting_clarification",
      question_count: clarificationQuestions.length,
      questions: clarificationQuestions
    });
    manifest.status = "awaiting_clarification";
    manifest.current_stage = "awaiting_clarification";
    manifest.pending_actions = ["answer_clarifications"];
    manifest.questions = clarificationQuestions;
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
      questions: clarificationQuestions,
      question_count: clarificationQuestions.length,
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
    repoPath,
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
