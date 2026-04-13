import assert from "node:assert/strict";
import test from "node:test";

import { normalizeClarificationResult } from "../src/clarification/stage.js";

test("normalizeClarificationResult preserves explicit answer options and infers quoted guidance options", () => {
  const normalized = normalizeClarificationResult({
    status: "needs_clarification",
    questions: [
      {
        id: "CLARIFY-Q001",
        prompt: "Should the app target both iOS and Android, or only one platform?",
        answer_guidance: "List the target platforms: 'Android', 'iOS', or 'both'."
      },
      {
        id: "CLARIFY-Q002",
        prompt: "How should profiles be stored?",
        answer_guidance: "Choose the storage strategy.",
        answer_options: ["local only", "sync through Firebase", "sync through Azure"]
      }
    ]
  });

  assert.deepEqual(normalized.questions[0].answer_options, ["Android", "iOS", "both"]);
  assert.deepEqual(normalized.questions[1].answer_options, [
    "local only",
    "sync through Firebase",
    "sync through Azure"
  ]);
});
