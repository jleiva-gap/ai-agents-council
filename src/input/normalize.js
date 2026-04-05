import path from "node:path";

import { copyFile, readText, writeJson, writeText } from "../utils/fs.js";

function parseAcceptanceCriteria(content) {
  return String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+|^\d+\.\s+/, ""));
}

function sectionsFromPrompt(prompt, title) {
  const acceptance = parseAcceptanceCriteria(prompt);
  return `# Ticket Definition

## Title
${title || "Untitled request"}

## Source
Prompt

## Summary
${prompt.trim()}

## Business Goal
${prompt.trim()}

## Technical Objective
Clarify the best path to deliver the request.

## Scope
- Interpret the request faithfully
- Produce mode-specific council outputs

## Acceptance Criteria
${acceptance.length > 0 ? acceptance.map((item) => `- ${item}`).join("\n") : "- Acceptance criteria were not explicitly listed in the input."}

## Open Questions
- None recorded yet
`;
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
    return {
      sourceType: "jira",
      canonicalContent: `# Ticket Definition

## Title
${title || "Jira ticket"}

## Source
Jira URL

## Reference Links
- ${options["jira-url"]}

## Summary
This ticket was normalized from a Jira URL. MCP-backed field extraction can be added later, but the council can already work from this canonical file.

## Open Questions
- Pull Jira field content through MCP when configured
`
    };
  }

  if (inferredJira) {
    return {
      sourceType: "jira",
      canonicalContent: `# Ticket Definition

## Title
${title || "Jira ticket"}

## Source
Jira URL

## Reference Links
- ${ticketSource}

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

function looksPlaceholder(text) {
  return /no prompt supplied|normalized from a jira url|none recorded yet|clarify the best path/i.test(String(text ?? "").trim());
}

export function buildClarificationQuestions(canonicalContent, mode = "plan") {
  const sections = parseSections(canonicalContent);
  const acceptance = parseAcceptanceCriteria(canonicalContent);
  const questions = [];

  if (!sections.summary || looksPlaceholder(sections.summary)) {
    questions.push({
      id: "clarify-summary",
      prompt: "What is the concrete request or outcome the council should optimize for?"
    });
  }

  if (acceptance.length === 0 && mode !== "debate") {
    questions.push({
      id: "clarify-acceptance",
      prompt: "What acceptance criteria or success signals should the council treat as the delivery target?"
    });
  }

  if (!sections.scope && ["plan", "design", "spike"].includes(mode)) {
    questions.push({
      id: "clarify-scope",
      prompt: "What is in scope for this request, and what should the council avoid expanding into?"
    });
  }

  if (!sections.constraints && ["plan", "design", "review"].includes(mode)) {
    questions.push({
      id: "clarify-constraints",
      prompt: "What constraints, non-goals, or implementation boundaries must the council preserve?"
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
      acceptance_criteria_count: parseAcceptanceCriteria(canonicalContent).length
    },
    acceptance_criteria: parseAcceptanceCriteria(canonicalContent),
    canonical_content: canonicalContent,
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
  if (sourceType === "jira") {
    writeJson(path.join(inputDir, "jira-source.json"), { url: options["jira-url"] ?? String(options["ticket-source"] ?? "").trim() });
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

  const acceptance = parseAcceptanceCriteria(canonicalContent);
  const metadata = {
    source_type: sourceType,
    title:
      options.title ??
      canonicalContent.match(/## Title\s+([\s\S]*?)\n## /)?.[1]?.trim() ??
      "Untitled request",
    canonical_ticket: "input/ticket-definition.md",
    acceptance_criteria_count: acceptance.length
  };

  writeJson(path.join(inputDir, "input-metadata.json"), metadata);

  return {
    ticket_path: ticketPath,
    metadata,
    acceptance_criteria: acceptance,
    canonical_content: canonicalContent || readText(ticketPath)
  };
}
