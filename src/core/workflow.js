import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.js";
import { createRunWorkspace, writeCouncilLog, writeSessionManifest, writeTimeline } from "./session.js";
import { formatCouncilLog, getCouncilVisualReference, getDeliberationCycle, getStageIdentity } from "./identity.js";
import { normalizeInput } from "../input/normalize.js";
import { detectProviders, maybeLaunchPrompt, maybeRunProviderStartup, resolveProvidersByNames, writeCouncilPlan } from "../providers/index.js";
import { buildReviewEvidence } from "../review/evidence.js";
import { ensureDir, pathExists, readJson, slugify, writeJson, writeText } from "../utils/fs.js";

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

function writePlanArtifacts(finalDir, title, acceptanceCriteria) {
  const tasks = acceptanceCriteria.length > 0
    ? acceptanceCriteria.map((criterion, index) => ({ id: `T${index + 1}`, title: criterion, status: "pending" }))
    : [{ id: "T1", title: "Clarify and decompose implementation work", status: "pending" }];

  writeText(path.join(finalDir, "final-plan.md"), `# Final Plan\n\n## Title\n${title}\n\nA draft council plan has been prepared. Refine it using the round outputs.\n`);
  writeJson(path.join(finalDir, "tasks.json"), { tasks });
  writeText(path.join(finalDir, "dependencies.md"), "# Dependencies\n\n- Confirm implementation dependencies from the ticket and surrounding system context.\n");
  writeText(path.join(finalDir, "risks.md"), "# Risks\n\n- Hidden technical assumptions\n- Missing acceptance coverage\n- Integration friction across affected systems\n");
  writeText(path.join(finalDir, "open-questions.md"), "# Open Questions\n\n- Which assumptions still need validation before implementation starts?\n");
  writeText(path.join(finalDir, "summary.md"), `# Summary\n\nA draft implementation plan package was created for **${title}**.\n`);
}

function writeDesignArtifacts(finalDir, title) {
  writeText(path.join(finalDir, "design.md"), `# Design\n\n## Goal\n${title}\n\n## Recommended Direction\nUse the council rounds to converge on the design with explicit tradeoffs and interfaces.\n`);
  writeText(path.join(finalDir, "decision-log.md"), "# Decision Log\n\n- No final decisions recorded yet.\n");
  writeText(path.join(finalDir, "alternatives.md"), "# Alternatives\n\n- Alternative A\n- Alternative B\n");
  writeText(path.join(finalDir, "risks.md"), "# Risks\n\n- Architecture drift\n- Interface ambiguity\n");
  writeText(path.join(finalDir, "assumptions.md"), "# Assumptions\n\n- System constraints will be clarified during council critique.\n");
  writeText(path.join(finalDir, "open-questions.md"), "# Open Questions\n\n- Which interfaces or ownership boundaries remain uncertain?\n");
  writeText(path.join(finalDir, "summary.md"), `# Summary\n\nA draft design package was created for **${title}**.\n`);
}

function writeSpikeArtifacts(finalDir, title) {
  writeText(path.join(finalDir, "spike-plan.md"), `# Spike Plan\n\n## Topic\n${title}\n\n## Goal\nReduce uncertainty before committing to a final design or implementation approach.\n`);
  writeText(path.join(finalDir, "unknowns.md"), "# Unknowns\n\n- Key technical unknowns go here.\n");
  writeText(path.join(finalDir, "hypotheses.md"), "# Hypotheses\n\n- Hypothesis 1\n");
  writeText(path.join(finalDir, "experiment-matrix.md"), "# Experiment Matrix\n\n| Question | Experiment | Evidence |\n| --- | --- | --- |\n| TBD | TBD | TBD |\n");
  writeText(path.join(finalDir, "recommendation.md"), "# Recommendation\n\n- Run the highest-value experiment first.\n");
  writeText(path.join(finalDir, "summary.md"), `# Summary\n\nA spike framing package was created for **${title}**.\n`);
}

function writeDebateArtifacts(finalDir, title) {
  writeText(path.join(finalDir, "debate-summary.md"), `# Debate Summary\n\n## Topic\n${title}\n\nThe council workspace is ready for position building, challenge, rebuttal, and convergence.\n`);
  writeText(path.join(finalDir, "positions.md"), "# Positions\n\n- Position A\n- Position B\n");
  writeText(path.join(finalDir, "rebuttals.md"), "# Rebuttals\n\n- Rebuttal placeholders\n");
  writeText(path.join(finalDir, "consensus.md"), "# Consensus\n\n- Final consensus will be captured here.\n");
  writeText(path.join(finalDir, "minority-concerns.md"), "# Minority Concerns\n\n- Record unresolved concerns here.\n");
  writeText(path.join(finalDir, "recommendation.md"), "# Recommendation\n\n- The recommendation will be refined after convergence.\n");
}

function writeReviewArtifacts(finalDir, title, evidence, rubric) {
  writeText(path.join(finalDir, "review-summary.md"), `# Review Summary\n\n## Target\n${title}\n\n## Evidence Pack\n- Files indexed: ${evidence.file_count}\n- Docs found: ${evidence.doc_count}\n- Tests found: ${evidence.test_count}\n\nThis is a ready-to-review package for the council.\n`);
  writeJson(path.join(finalDir, "scorecard.json"), {
    rubric: rubric.name,
    status: "pending_council_review",
    total_score: null,
    category_scores: Object.fromEntries((rubric.categories ?? []).map((category) => [category.id, null])),
    blocking_findings: 0,
    non_blocking_findings: 0,
    confidence: "pending"
  });
  writeText(path.join(finalDir, "findings.md"), "# Findings\n\n- Findings will be added after evidence-based review.\n");
  writeText(path.join(finalDir, "comments.md"), "# Comments\n\n- Structured review comments will be recorded here.\n");
  writeText(path.join(finalDir, "gaps.md"), "# Gaps\n\n- Ticket-to-implementation gaps will be recorded here.\n");
  writeText(path.join(finalDir, "strengths.md"), "# Strengths\n\n- Positive implementation observations will be recorded here.\n");
  writeText(path.join(finalDir, "acceptance-coverage.md"), "# Acceptance Coverage\n\n- Acceptance coverage analysis will be recorded here.\n");
  writeText(path.join(finalDir, "recommendation.md"), "# Recommendation\n\n- Pending council recommendation: pass, revise, or fail.\n");
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
      if (launchResult.launched && launchResult.stdout) {
        writeText(outputFile, launchResult.stdout);
      }
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

function writeExecutionSummary(resultPath, executionResults, providerSessions) {
  const failures = executionResults.filter((entry) => entry.exit_code && entry.exit_code !== 0);
  const successful = executionResults.filter((entry) => entry.exit_code === 0);

  writeJson(path.join(resultPath, "execution-summary.json"), {
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
    path.join(resultPath, "execution-summary.md"),
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

export function getStatus(frameworkRoot, repoPath) {
  const config = loadConfig(frameworkRoot, repoPath);
  const outputRoot = resolveOutputRoot(repoPath, config);
  const latest = latestRunPath(repoPath, outputRoot);
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

  const session = readJson(path.join(latest, "session", "session.json"), {});
  const finalFiles = pathExists(path.join(latest, "result")) ? fs.readdirSync(path.join(latest, "result")).sort() : [];
  return {
    ok: true,
    framework_root: frameworkRoot,
    repo_path: repoPath,
    output_root: outputRoot,
    has_runs: true,
    latest_run: latest,
    mode: session.mode ?? null,
    family: session.family ?? null,
    title: session.title ?? null,
    repo_path: session.review?.repo_path ?? null,
    final_files: finalFiles,
    recommended_action: session.next_action ?? "Review result/ first, then inspect work/ if you need the intermediate deliberation trail."
  };
}

export function resumeLatest(frameworkRoot, repoPath) {
  return getStatus(frameworkRoot, repoPath);
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

  const title = options.title ?? options.prompt ?? options["jira-url"] ?? options["ticket-file"] ?? `${mode} council run`;
  const { runId, runPath, workPath, resultPath } = createRunWorkspace(repoPath, outputRoot, mode, title);
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
    review: evidence ? { repo_path: evidence.repo_path } : null,
    next_action: "Open result/ for the final artifacts. Use work/ only when you need the intermediate deliberation trail.",
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

  const finalDir = resultPath;
  if (mode === "plan") {
    writePlanArtifacts(finalDir, normalizedInput.metadata.title, normalizedInput.acceptance_criteria);
  } else if (mode === "design") {
    writeDesignArtifacts(finalDir, normalizedInput.metadata.title);
  } else if (mode === "spike") {
    writeSpikeArtifacts(finalDir, normalizedInput.metadata.title);
  } else if (mode === "debate") {
    writeDebateArtifacts(finalDir, normalizedInput.metadata.title);
  } else {
    writeReviewArtifacts(finalDir, normalizedInput.metadata.title, evidence, config.rubrics.review);
  }
  writeExecutionSummary(finalDir, executionResults, providerSessions);

  writeTimeline(workPath, "final_artifacts_created", { final_outputs: workflow.final_outputs });
  writeCouncilLog(workPath, formatCouncilLog("Vector", "Final artifacts are ready for review and follow-up AI work."));
  emitProgress(onProgress, { type: "final_artifacts_created", result_path: resultPath, final_outputs: workflow.final_outputs });

  return {
    ok: true,
    status: "prepared",
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
    final_outputs: workflow.final_outputs,
    providers,
    evidence_summary: evidence,
    next_action: manifest.next_action
  };
}
