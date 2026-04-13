import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { copyFile, readJson } from "../src/utils/fs.js";

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

test("copyFile is a no-op when source and target are the same path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-council-copy-file-"));
  const filePath = path.join(root, "same.txt");
  fs.writeFileSync(filePath, "original", "utf8");

  try {
    const result = copyFile(filePath, filePath);
    assert.equal(result, filePath);
    assert.equal(fs.readFileSync(filePath, "utf8"), "original");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
