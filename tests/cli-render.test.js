import test from "node:test";
import assert from "node:assert/strict";

import { formatPanelLines, wrapText } from "../src/cli/render.js";

test("wrapText preserves the full clarification question across wrapped lines", () => {
  const question = "Reading \"Add audit trail\", what observable outcome proves the work is done before approval can continue?";
  const lines = wrapText(question, 32);

  assert.equal(lines.length > 1, true);
  assert.equal(lines.every((line) => line.length <= 32), true);
  assert.equal(lines.join(" ").replace(/\s+/g, " ").trim(), question);
});

test("formatPanelLines keeps long clarification rows complete", () => {
  const question = "What observable outcome proves the work is done before approval can continue?";
  const lines = formatPanelLines("Clarification 1/1", [question], 40);
  const bodyLines = lines.slice(3, -1).map((line) => line.text.replace(/^\| /, "").replace(/ \|$/, "").trimEnd());

  assert.equal(bodyLines.length > 1, true);
  assert.equal(bodyLines.join(" ").replace(/\s+/g, " ").trim(), question);
});
