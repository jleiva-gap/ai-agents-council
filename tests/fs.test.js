import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readJson } from "../src/utils/fs.js";

test("readJson returns the fallback and warns when JSON is malformed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-read-json-"));
  const filePath = path.join(root, "broken.json");
  fs.writeFileSync(filePath, "{ invalid json", "utf8");

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));

  try {
    const fallback = { ok: true };
    const value = readJson(filePath, fallback);
    assert.deepEqual(value, fallback);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /failed to parse json/i);
  } finally {
    console.warn = originalWarn;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
