import path from "node:path";

import { maybeLaunchPrompt, resolveProvidersByNames } from "../providers/index.js";
import { writeJson, writeText } from "../utils/fs.js";

function buildClarificationPrompt({ mode, title, ticketText, participantLabel }) {
  return `# AI Agents Council Clarification Prompt

## Mode
${mode}

## Participant
${participantLabel}

## Objective
Review the request semantically before proposal starts. Ask only the smallest blocking clarification questions needed before planning.

## Rules
- Read the ticket as a semantic request, not as a checklist of missing headings.
- Infer safe details when the ticket already implies them clearly.
- Do not ask generic "please provide acceptance criteria" or "please provide scope" questions.
- Ask only questions whose answers would materially change planning, design, or validation.
- If the request is already clear enough to plan, return \`ready_for_planning\` with an empty questions array.
- If clarification answers are already present in the ticket, treat them as authoritative and do not ask duplicates.
- Prefer at most 5 questions.
- Each question must be answerable in one interactive pass without needing another AI exchange.
- Output JSON only. Do not wrap it in Markdown fences.

## Title
${title}

## Canonical Ticket
${ticketText}

## Required JSON Output
{
  "status": "ready_for_planning | needs_clarification",
  "summary": "short explanation",
  "questions": [
    {
      "id": "CLARIFY-Q001",
      "prompt": "story-specific blocking question",
      "required": true,
      "observation": "what made this question necessary",
      "answer_guidance": "how the user should answer",
      "response_format": "text | list"
    }
  ],
  "risks": [
    {
      "code": "short_code",
      "level": "blocking | advisory",
      "summary": "risk summary"
    }
  ]
}
`;
}

function normalizeRisk(risk, index) {
  const summary = String(risk?.summary ?? risk?.message ?? "").trim();
  if (!summary) {
    return null;
  }

  return {
    code: String(risk?.code ?? `clarification-risk-${index + 1}`).trim() || `clarification-risk-${index + 1}`,
    level: String(risk?.level ?? "blocking").trim().toLowerCase() === "advisory" ? "advisory" : "blocking",
    summary
  };
}

function normalizeQuestion(question, index) {
  const prompt = String(question?.prompt ?? question?.question ?? "").trim();
  if (!prompt) {
    return null;
  }

  const responseFormat = String(question?.response_format ?? question?.answer_mode ?? "").trim().toLowerCase();
  return {
    id: String(question?.id ?? `CLARIFY-Q${String(index + 1).padStart(3, "0")}`).trim() || `CLARIFY-Q${String(index + 1).padStart(3, "0")}`,
    prompt,
    required: question?.required !== false,
    observation: String(question?.observation ?? "").trim() || undefined,
    answer_guidance: String(question?.answer_guidance ?? question?.guidance ?? "").trim() || undefined,
    response_format: responseFormat === "list" ? "list" : "text"
  };
}

function tryParseJson(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("Clarification output was empty.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to fenced and substring attempts.
  }

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Clarification output did not contain valid JSON.");
}

export function normalizeClarificationResult(payload = {}, defaults = {}) {
  const questions = Array.isArray(payload.questions)
    ? payload.questions.map((question, index) => normalizeQuestion(question, index)).filter(Boolean)
    : [];
  const risks = Array.isArray(payload.risks)
    ? payload.risks.map((risk, index) => normalizeRisk(risk, index)).filter(Boolean)
    : [];
  const blockingQuestionCount = questions.filter((question) => question.required !== false).length;
  const statusValue = String(payload.status ?? "").trim().toLowerCase();
  const readyForPlanning = statusValue === "ready_for_planning"
    || statusValue === "ready"
    || (statusValue !== "needs_clarification" && blockingQuestionCount === 0);

  return {
    status: readyForPlanning ? "ready_for_planning" : "needs_clarification",
    summary: String(payload.summary ?? defaults.summary ?? "").trim()
      || (readyForPlanning ? "The request is clear enough to plan." : "Clarification is needed before proposal starts."),
    questions,
    question_count: questions.length,
    blocking_question_count: blockingQuestionCount,
    risks
  };
}

function buildQuestionsMarkdown(result, answeredQuestions = []) {
  const answeredMap = new Map((answeredQuestions ?? []).map((entry) => [entry.id, entry.answer]));
  const lines = [
    "# Clarification Questions",
    "",
    `Status: ${result.status}`,
    `Summary: ${result.summary}`,
    ""
  ];

  if ((result.questions ?? []).length === 0) {
    lines.push("No blocking clarification questions remain.", "");
  } else {
    lines.push("## Questions", "");
    for (const [index, question] of result.questions.entries()) {
      lines.push(`${index + 1}. ${question.prompt}`);
      if (question.observation) {
        lines.push(`Observation: ${question.observation}`);
      }
      if (question.answer_guidance) {
        lines.push(`Guidance: ${question.answer_guidance}`);
      }
      if (answeredMap.has(question.id)) {
        lines.push(`Answer: ${answeredMap.get(question.id)}`);
      }
      lines.push("");
    }
  }

  if ((result.risks ?? []).length > 0) {
    lines.push("## Risks", "");
    for (const risk of result.risks) {
      lines.push(`- [${risk.level}] ${risk.code}: ${risk.summary}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function writeClarificationArtifacts(workPath, result, extra = {}) {
  const artifact = {
    status: result.status,
    summary: result.summary,
    questions: result.questions ?? [],
    question_count: result.question_count ?? (result.questions ?? []).length,
    blocking_question_count: result.blocking_question_count ?? (result.questions ?? []).filter((question) => question.required !== false).length,
    risks: result.risks ?? [],
    answered_questions: extra.answered_questions ?? [],
    source: extra.source ?? "local",
    provider: extra.provider ?? null,
    participant_label: extra.participant_label ?? null,
    model: extra.model ?? null,
    launched: extra.launched === true,
    command_preview: extra.command_preview ?? "",
    prompt_file: extra.prompt_file ?? null,
    response_file: extra.response_file ?? null
  };

  writeJson(path.join(workPath, "input", "clarification.json"), artifact);
  writeText(path.join(workPath, "input", "questions.md"), buildQuestionsMarkdown(artifact, artifact.answered_questions));
  return artifact;
}

export async function runClarificationStage({
  workPath,
  repoPath,
  mode,
  title,
  ticketText,
  providers,
  stageAssignments,
  preferredProvider,
  councilAgents,
  launch
}) {
  const participant = resolveProvidersByNames(
    providers,
    stageAssignments?.proposal ?? [],
    preferredProvider,
    councilAgents
  )[0] ?? null;

  const stageDir = path.join(workPath, "clarification");
  const promptFile = path.join(stageDir, "axiom.prompt.md");
  const responseFile = path.join(stageDir, "axiom.response.json");
  const participantLabel = participant?.label ?? participant?.name ?? preferredProvider ?? "clarifier";

  writeText(promptFile, buildClarificationPrompt({
    mode,
    title,
    ticketText,
    participantLabel
  }));

  if (!participant) {
    writeText(responseFile, "# Pending Clarification Response\n\nNo clarification participant was configured.\n");
    return {
      participant: null,
      prompt_file: promptFile,
      response_file: responseFile,
      launch_result: { launched: false, command_preview: "", timed_out: false },
      analysis: null,
      parse_error: "No clarification participant was configured."
    };
  }

  const launchResult = await maybeLaunchPrompt(promptFile, responseFile, repoPath, participant, launch === true, null, workPath);
  const rawOutput = String(launchResult.stdout ?? "").trim();
  if (rawOutput) {
    writeText(responseFile, `${rawOutput}\n`);
  } else if (!launchResult.launched) {
    writeText(
      responseFile,
      [
        "# Pending Clarification Response",
        "",
        "The clarification prompt was prepared, but the provider was not launched automatically in this run.",
        "",
        launchResult.command_preview ? `Command: ${launchResult.command_preview}` : "Command: (none)"
      ].join("\n") + "\n"
    );
  } else {
    writeText(
      responseFile,
      [
        "# Invalid Clarification Response",
        "",
        "The provider launched but did not return a structured clarification payload."
      ].join("\n") + "\n"
    );
  }

  let analysis = null;
  let parseError = null;
  if (rawOutput) {
    try {
      analysis = normalizeClarificationResult(tryParseJson(rawOutput));
    } catch (error) {
      parseError = error.message ?? String(error);
    }
  }

  return {
    participant,
    prompt_file: promptFile,
    response_file: responseFile,
    launch_result: launchResult,
    analysis,
    parse_error: parseError
  };
}
