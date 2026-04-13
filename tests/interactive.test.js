import assert from "node:assert/strict";
import test from "node:test";

import { promptClarificationAnswers } from "../src/cli/interactive.js";

function createMockReadline(responses) {
  let index = 0;
  const prompts = [];

  return {
    prompts,
    async question(prompt) {
      prompts.push(prompt);
      const response = responses[index];
      index += 1;
      return response ?? "";
    },
    close() {}
  };
}

test("promptClarificationAnswers lets users select a suggested answer by number", async () => {
  const rl = createMockReadline(["3", ""]);
  const answers = await promptClarificationAnswers(rl, [
    {
      id: "CLARIFY-Q001",
      prompt: "Should the app target both iOS and Android, or only one platform?",
      answer_guidance: "List the target platforms: 'Android', 'iOS', or 'both'.",
      response_format: "text"
    }
  ]);

  assert.deepEqual(answers, [
    {
      id: "CLARIFY-Q001",
      prompt: "Should the app target both iOS and Android, or only one platform?",
      answer: "both"
    }
  ]);
  assert.deepEqual(rl.prompts, [
    "Answer number> ",
    "Enter a question number to revise, or press Enter to continue> "
  ]);
});

test("promptClarificationAnswers supports Other for a custom clarification answer", async () => {
  const rl = createMockReadline(["2", "sync through Supabase", ""]);
  const answers = await promptClarificationAnswers(rl, [
    {
      id: "CLARIFY-Q001",
      prompt: "How should profiles be stored?",
      answer_guidance: "Answer 'local only' or name the cloud provider/backend you'd like to use.",
      response_format: "text"
    }
  ]);

  assert.deepEqual(answers, [
    {
      id: "CLARIFY-Q001",
      prompt: "How should profiles be stored?",
      answer: "sync through Supabase"
    }
  ]);
  assert.deepEqual(rl.prompts, [
    "Answer number> ",
    "Other answer> ",
    "Enter a question number to revise, or press Enter to continue> "
  ]);
});
