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

export function normalizeInput(runPath, options = {}) {
  const inputDir = path.join(runPath, "input");
  const title = options.title ?? null;
  const ticketPath = path.join(inputDir, "ticket-definition.md");
  let sourceType = "prompt";
  let canonicalContent = "";

  if (options["ticket-file"]) {
    sourceType = "markdown";
    copyFile(path.resolve(options["ticket-file"]), ticketPath);
    canonicalContent = readText(ticketPath);
  } else if (options["prompt-file"]) {
    sourceType = "prompt-file";
    canonicalContent = sectionsFromPrompt(readText(path.resolve(options["prompt-file"])), title);
    writeText(ticketPath, canonicalContent);
  } else if (options["jira-url"]) {
    sourceType = "jira";
    canonicalContent = `# Ticket Definition

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
`;
    writeText(ticketPath, canonicalContent);
    writeJson(path.join(inputDir, "jira-source.json"), { url: options["jira-url"] });
  } else {
    canonicalContent = sectionsFromPrompt(options.prompt ?? options["ticket-source"] ?? "No prompt supplied.", title);
    writeText(ticketPath, canonicalContent);
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
      title ??
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
