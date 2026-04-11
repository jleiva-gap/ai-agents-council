import path from "node:path";

import { copyFile, readText, writeJson, writeText } from "../utils/fs.js";

function parseListItems(content) {
  return String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+|^\d+\.\s+/, ""));
}

function normalizeAcceptanceCriteria(items = []) {
  return items
    .map((item) => String(item ?? "").trim())
    .filter((item) => item && !/^(acceptance criteria were not explicitly listed in the input|none recorded yet|tbd|not provided)$/i.test(item));
}

function parseAcceptanceCriteria(content) {
  const sections = parseSections(content);
  return parseListItems(sections.acceptance_criteria);
}

function sectionsFromPrompt(prompt, title) {
  const acceptance = parseListItems(prompt);
  const businessGoal = deriveBusinessGoal(prompt);
  return `# Ticket Definition

## Title
${title || "Untitled request"}

## Source
Prompt

## Summary
${prompt.trim()}

## Business Goal
${businessGoal}

## Technical Objective
Clarify the best path to deliver the request.

## Scope
- Interpret the request faithfully
- Produce mode-specific council outputs

## Acceptance Criteria
${acceptance.length > 0 ? acceptance.map((item) => `- ${item}`).join("\n") : ""}

## Open Questions
- None recorded yet
`;
}

function normalizeUrl(value, optionName = "--jira-url") {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`${optionName} must be a valid HTTPS URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${optionName} must use HTTPS.`);
  }

  return parsed.toString();
}

function inferCanonicalInput(options = {}) {
  const title = options.title ?? null;
  const ticketSource = String(options["ticket-source"] ?? "").trim();
  const inferredJira = !options["jira-url"] && /^https?:\/\//i.test(ticketSource);
  const inferredMarkdown = !options["ticket-file"] && /\.md$/i.test(ticketSource);

  if (options["ticket-file"]) {
    return {
      sourceType: "markdown",
      canonicalContent: readText(path.resolve(options["ticket-file"]))
    };
  }

  if (options["prompt-file"]) {
    return {
      sourceType: "prompt-file",
      canonicalContent: sectionsFromPrompt(readText(path.resolve(options["prompt-file"])), title)
    };
  }

  if (options["jira-url"]) {
    const jiraUrl = normalizeUrl(options["jira-url"], "--jira-url");
    return {
      sourceType: "jira",
      canonicalContent: `# Ticket Definition

## Title
${title || "Jira ticket"}

## Source
Jira URL

## Reference Links
- ${jiraUrl}

## Summary
This ticket was normalized from a Jira URL. MCP-backed field extraction can be added later, but the council can already work from this canonical file.

## Open Questions
- Pull Jira field content through MCP when configured
`
    };
  }

  if (inferredJira) {
    const jiraUrl = normalizeUrl(ticketSource, "--ticket-source");
    return {
      sourceType: "jira",
      canonicalContent: `# Ticket Definition

## Title
${title || "Jira ticket"}

## Source
Jira URL

## Reference Links
- ${jiraUrl}

## Summary
This ticket was normalized from a Jira URL. MCP-backed field extraction can be added later, but the council can already work from this canonical file.
`
    };
  }

  if (inferredMarkdown) {
    return {
      sourceType: "markdown",
      canonicalContent: readText(path.resolve(ticketSource))
    };
  }

  return {
    sourceType: "prompt",
    canonicalContent: sectionsFromPrompt(options.prompt ?? ticketSource ?? "No prompt supplied.", title)
  };
}

function parseSections(content) {
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

function deriveBusinessGoal(prompt) {
  const lines = String(prompt ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = lines.find((line) => !/^[-*]\s+/.test(line) && !/^\d+\.\s+/.test(line)) ?? lines[0] ?? "";
  return compactText(candidate.replace(/^#+\s*/, ""), 160) || "Clarify the business outcome to deliver the request.";
}

function compactText(text, maxLength = 280) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function buildOmissionNote(omittedCount, label) {
  if (!Number.isFinite(omittedCount) || omittedCount <= 0) {
    return "";
  }

  return `- Note: ${omittedCount} more ${label} omitted. Open \`input/ticket-definition.md\` for the full list.`;
}

function summarizeList(text, limit = 4, itemMaxLength = 140) {
  const items = parseListItems(text)
    .map((item) => compactText(item, itemMaxLength))
    .filter((item) => item && !looksPlaceholder(item))
  return {
    items: items.slice(0, limit),
    omitted_count: Math.max(0, items.length - limit)
  };
}

function appendSummarySection(lines, heading, summary, label) {
  if ((summary?.items?.length ?? 0) === 0 && (summary?.omitted_count ?? 0) === 0) {
    return;
  }

  lines.push("", `## ${heading}`, "");
  for (const item of summary.items ?? []) {
    lines.push(`- ${item}`);
  }

  const omissionNote = buildOmissionNote(summary?.omitted_count ?? 0, label);
  if (omissionNote) {
    lines.push(omissionNote);
  }
}

function parseClarificationAnswerPairs(content) {
  const answers = [];
  const lines = String(content ?? "").split(/\r?\n/);
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
      prompt: compactText(promptMatch[1], 100),
      answer: compactText(answerMatch[1], 140)
    });
    index += 1;
  }

  return answers;
}

function looksPlaceholder(text) {
  return /no prompt supplied|normalized from a jira url|none recorded yet|clarify the best path/i.test(String(text ?? "").trim());
}

export function buildCanonicalTicketSummary(content) {
  const sections = parseSections(content);
  const title = compactText(sections.title, 120) || "Untitled request";
  const summary = compactText(sections.summary || sections.business_goal || sections.technical_objective, 320);
  const businessGoal = compactText(sections.business_goal, 220);
  const technicalObjective = compactText(sections.technical_objective, 220);
  const scope = summarizeList(sections.scope, 4, 120);
  const acceptance = summarizeList(sections.acceptance_criteria, 6, 120);
  const constraints = summarizeList(sections.constraints, 4, 120);
  const references = summarizeList(sections.reference_links, 4, 120);
  const allClarificationAnswers = parseClarificationAnswerPairs(content);
  const clarificationAnswers = allClarificationAnswers.slice(0, 4);
  const clarificationOmittedCount = Math.max(0, allClarificationAnswers.length - clarificationAnswers.length);
  const lines = [
    "# Canonical Ticket Summary",
    "",
    `- Title: ${title}`
  ];

  if (summary && !looksPlaceholder(summary)) {
    lines.push(`- Summary: ${summary}`);
  }
  if (businessGoal && !looksPlaceholder(businessGoal)) {
    lines.push(`- Business goal: ${businessGoal}`);
  }
  if (technicalObjective && !looksPlaceholder(technicalObjective)) {
    lines.push(`- Technical objective: ${technicalObjective}`);
  }

  appendSummarySection(lines, "Scope", scope, "scope items");
  appendSummarySection(lines, "Acceptance Criteria", acceptance, "acceptance criteria");
  appendSummarySection(lines, "Constraints", constraints, "constraints");
  if (clarificationAnswers.length > 0) {
    lines.push(
      "",
      "## Clarification Answers",
      "",
      ...clarificationAnswers.map((entry) => `- ${entry.prompt}: ${entry.answer}`)
    );
    const clarificationNote = buildOmissionNote(clarificationOmittedCount, "clarification answers");
    if (clarificationNote) {
      lines.push(clarificationNote);
    }
  }
  appendSummarySection(lines, "Reference Links", references, "reference links");

  return `${lines.join("\n").trimEnd()}\n`;
}

function summarizeTicketIntent(sections, acceptance) {
  const summary = String(sections.summary ?? sections.business_goal ?? sections.technical_objective ?? "").trim();
  if (summary && !looksPlaceholder(summary)) {
    return summary;
  }

  return acceptance[0] ?? "";
}

function hasExplicitBoundarySignal(text) {
  return /\b(only|without|must not|do not|don't|keep existing|keep [a-z0-9_\s-]+ unchanged|leave [a-z0-9_\s-]+ unchanged|preserve|exclude|out of scope|no api change|unchanged)\b/i.test(String(text ?? ""));
}

function hasImplicitAcceptanceSignal(text) {
  return /\b(so|that)\b.+\b(add|record|persist|write|return|keep|leave|preserve|remain|stay|emit|validate|pass)(?:s|ed|ing)?\b/i.test(String(text ?? ""))
    || /\bevery\s+(successful|new|updated?)\b/i.test(String(text ?? ""));
}

function likelyBroadOrAmbiguousBoundary(text) {
  return /\b(and more|etc|as needed|if needed|end-to-end|overall|entire|whole system|improve|enhance|update the system|handle this)\b/i.test(String(text ?? ""));
}

export function buildClarificationQuestions(canonicalContent, mode = "plan") {
  const sections = parseSections(canonicalContent);
  const acceptance = normalizeAcceptanceCriteria(parseAcceptanceCriteria(canonicalContent));
  const questions = [];
  const intent = summarizeTicketIntent(sections, acceptance);
  const boundaryContext = [intent, ...acceptance, sections.constraints, sections.scope].filter(Boolean).join(" ");
  const implicitAcceptance = hasImplicitAcceptanceSignal(intent);
  const needsAcceptanceClarification = acceptance.length === 0 && mode !== "debate" && !implicitAcceptance;

  if (!sections.summary || looksPlaceholder(sections.summary)) {
    questions.push({
      id: "clarify-summary",
      prompt: "What is the concrete request or outcome the council should optimize for?"
    });
  }

  if (needsAcceptanceClarification) {
    questions.push({
      id: "clarify-acceptance",
      prompt: `Reading the request, what concrete outcomes or checks should tell the council that "${intent || "this work"}" is done?`
    });
  }

  if (!sections.scope && ["plan", "design", "spike"].includes(mode)
    && (needsAcceptanceClarification || likelyBroadOrAmbiguousBoundary(boundaryContext))) {
    questions.push({
      id: "clarify-scope",
      prompt: `Should "${intent || "this request"}" stay tightly focused on the described outcome, or does the story also expect nearby follow-on work to be included?`
    });
  }

  if (!sections.constraints && ["plan", "design", "review"].includes(mode) && !hasExplicitBoundarySignal(boundaryContext)) {
    questions.push({
      id: "clarify-constraints",
      prompt: `What important boundary or non-goal should the council preserve while working on "${intent || "this request"}"?`
    });
  }

  return questions;
}

export function previewNormalizedInput(options = {}, mode = "plan") {
  const { sourceType, canonicalContent } = inferCanonicalInput(options);
  return {
    metadata: {
      source_type: sourceType,
      title:
        options.title ??
        canonicalContent.match(/## Title\s+([\s\S]*?)\n## /)?.[1]?.trim() ??
        "Untitled request",
      acceptance_criteria_count: normalizeAcceptanceCriteria(parseAcceptanceCriteria(canonicalContent)).length
    },
    acceptance_criteria: normalizeAcceptanceCriteria(parseAcceptanceCriteria(canonicalContent)),
    canonical_content: canonicalContent,
    canonical_summary: buildCanonicalTicketSummary(canonicalContent),
    clarification_questions: buildClarificationQuestions(canonicalContent, mode)
  };
}

function appendClarificationAnswers(canonicalContent, answers = []) {
  if (!Array.isArray(answers) || answers.length === 0) {
    return canonicalContent;
  }

  const lines = [
    canonicalContent.trimEnd(),
    "",
    "## Clarification Answers",
    "",
    ...answers.flatMap((entry, index) => [
      `${index + 1}. ${entry.prompt}`,
      `Answer: ${entry.answer}`,
      ""
    ])
  ];

  return lines.join("\n").trimEnd() + "\n";
}

export function normalizeInput(runPath, options = {}) {
  const inputDir = path.join(runPath, "input");
  const ticketPath = path.join(inputDir, "ticket-definition.md");
  const summaryPath = path.join(inputDir, "ticket-summary.md");
  const preview = previewNormalizedInput(options, options.mode ?? "plan");
  const sourceType = preview.metadata.source_type;
  let canonicalContent = appendClarificationAnswers(preview.canonical_content, options.clarification_answers);

  if (sourceType === "markdown" && options["ticket-file"]) {
    copyFile(path.resolve(options["ticket-file"]), ticketPath);
    canonicalContent = appendClarificationAnswers(readText(ticketPath), options.clarification_answers);
  } else if (sourceType === "markdown" && options["ticket-source"] && /\.md$/i.test(String(options["ticket-source"]))) {
    copyFile(path.resolve(String(options["ticket-source"])), ticketPath);
    canonicalContent = appendClarificationAnswers(readText(ticketPath), options.clarification_answers);
  }

  writeText(ticketPath, canonicalContent);
  const canonicalSummary = buildCanonicalTicketSummary(canonicalContent);
  writeText(summaryPath, canonicalSummary);
  if (sourceType === "jira") {
    writeJson(path.join(inputDir, "jira-source.json"), {
      url: options["jira-url"]
        ? normalizeUrl(options["jira-url"], "--jira-url")
        : normalizeUrl(String(options["ticket-source"] ?? "").trim(), "--ticket-source")
    });
  }

  for (const [optionName, filename] of [
    ["extra-context-file", "extra-context.md"],
    ["constraints-file", "constraints.md"],
    ["acceptance-file", "acceptance-criteria.md"],
    ["review-target-file", "review-target.md"],
    ["debate-topic-file", "debate-topic.md"]
  ]) {
    if (options[optionName]) {
      copyFile(path.resolve(options[optionName]), path.join(inputDir, filename));
    }
  }

  if (options["extra-context"]) {
    writeText(path.join(inputDir, "extra-context.md"), String(options["extra-context"]));
  }

  const acceptance = normalizeAcceptanceCriteria(parseAcceptanceCriteria(canonicalContent));
  const metadata = {
    source_type: sourceType,
    title:
      options.title ??
      canonicalContent.match(/## Title\s+([\s\S]*?)\n## /)?.[1]?.trim() ??
      "Untitled request",
    canonical_ticket: "input/ticket-definition.md",
    canonical_ticket_summary: "input/ticket-summary.md",
    acceptance_criteria_count: acceptance.length
  };

  writeJson(path.join(inputDir, "input-metadata.json"), metadata);

  return {
    ticket_path: ticketPath,
    ticket_summary_path: summaryPath,
    metadata,
    acceptance_criteria: acceptance,
    canonical_content: canonicalContent || readText(ticketPath),
    canonical_summary: canonicalSummary
  };
}
