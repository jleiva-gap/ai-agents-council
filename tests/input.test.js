import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeInput, previewNormalizedInput } from "../src/input/normalize.js";

test("previewNormalizedInput rejects non-https jira URLs", () => {
  assert.throws(
    () => previewNormalizedInput({ "jira-url": "http://jira.example.com/browse/ABC-123" }),
    /must use HTTPS/i
  );
});

test("normalizeInput writes a shared canonical ticket summary artifact", () => {
  const runPath = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-input-summary-"));

  const normalized = normalizeInput(runPath, {
    title: "Shared context",
    prompt: [
      "Add audit logging for successful student updates.",
      "- Record an audit entry for every successful student update.",
      "- Keep the public API unchanged."
    ].join("\n")
  });

  const summaryPath = path.join(runPath, "input", "ticket-summary.md");
  assert.equal(fs.existsSync(summaryPath), true);
  assert.equal(normalized.metadata.canonical_ticket_summary, "input/ticket-summary.md");

  const summaryText = fs.readFileSync(summaryPath, "utf8");
  assert.match(summaryText, /Canonical Ticket Summary/);
  assert.match(summaryText, /Keep the public API unchanged/i);
});

test("previewNormalizedInput only counts explicit acceptance criteria section items", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-input-acceptance-"));
  const ticketPath = path.join(root, "ticket.md");
  fs.writeFileSync(
    ticketPath,
    [
      "# Ticket Definition",
      "",
      "## Title",
      "Example",
      "",
      "## Summary",
      "Need a plan.",
      "",
      "## Scope",
      "- Preserve API shape",
      "- Touch only reporting",
      "",
      "## Open Questions",
      "- Which report format matters most?"
    ].join("\n"),
    "utf8"
  );

  const preview = previewNormalizedInput({ "ticket-file": ticketPath });
  assert.deepEqual(preview.acceptance_criteria, []);
  assert.equal(preview.metadata.acceptance_criteria_count, 0);
  assert.equal(preview.clarification_questions.some((question) => /concrete outcomes or checks/i.test(question.prompt)), true);
});

test("normalizeInput derives a concise business goal for prompt input", () => {
  const runPath = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-input-business-goal-"));
  const normalized = normalizeInput(runPath, {
    prompt: [
      "Add audit logging for successful student updates.",
      "- Keep the public API unchanged.",
      "- Add automated tests."
    ].join("\n")
  });

  const businessGoal = normalized.canonical_content.match(/## Business Goal\s+([\s\S]*?)\n## /)?.[1]?.trim();
  assert.equal(businessGoal, "Add audit logging for successful student updates.");
});

test("normalizeInput summary warns when acceptance criteria are truncated", () => {
  const runPath = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-input-truncated-summary-"));
  const ticketPath = path.join(runPath, "ticket.md");
  fs.writeFileSync(
    ticketPath,
    [
      "# Ticket Definition",
      "",
      "## Title",
      "Large ticket",
      "",
      "## Summary",
      "Need a plan.",
      "",
      "## Acceptance Criteria",
      "- Criterion 1",
      "- Criterion 2",
      "- Criterion 3",
      "- Criterion 4",
      "- Criterion 5",
      "- Criterion 6",
      "- Criterion 7",
      "- Criterion 8"
    ].join("\n"),
    "utf8"
  );

  normalizeInput(runPath, { "ticket-file": ticketPath });
  const summaryText = fs.readFileSync(path.join(runPath, "input", "ticket-summary.md"), "utf8");
  assert.match(summaryText, /Criterion 6/);
  assert.doesNotMatch(summaryText, /Criterion 7/);
  assert.match(summaryText, /more acceptance criteria omitted/i);
});
