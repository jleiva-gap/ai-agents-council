import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildReviewEvidence } from "../src/review/evidence.js";

test("buildReviewEvidence warns when the file index is truncated", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-evidence-"));
  const runPath = path.join(root, "run");
  const repoPath = path.join(root, "repo");
  fs.mkdirSync(runPath, { recursive: true });
  fs.mkdirSync(repoPath, { recursive: true });

  for (let index = 0; index < 505; index += 1) {
    fs.writeFileSync(path.join(repoPath, `file-${String(index).padStart(3, "0")}.js`), "export const ok = true;\n", "utf8");
  }

  const evidence = buildReviewEvidence(runPath, repoPath);
  assert.equal(evidence.file_index_truncated, true);
  assert.equal(evidence.files.length, 500);
  assert.match(evidence.file_index_warning ?? "", /truncated/i);
});
