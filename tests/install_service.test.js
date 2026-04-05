import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { installFramework, uninstallFramework } from "../src/orchestrator/install_service.js";

function makeTempDir(prefix = "ai-council-install-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("install-framework reports PATH readiness when the bin dir is not on PATH", (t) => {
  const root = makeTempDir();
  const installRoot = path.join(root, "install");
  const binDir = path.join(root, "bin");

  t.after(() => {
    uninstallFramework({ "install-root": installRoot, "bin-dir": binDir });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const result = installFramework({
    "install-root": installRoot,
    "bin-dir": binDir,
    force: true
  });

  assert.equal(result.bin_dir_on_path, false);
  assert.match(result.path_hint, /run 'ai-council' from any terminal/i);
  assert.equal(fs.existsSync(path.join(binDir, "ai-council.ps1")), true);
  assert.equal(fs.existsSync(path.join(binDir, "ai-council.cmd")), true);
  assert.equal(fs.existsSync(path.join(installRoot, "bin", "ai-council")), true);
});

test("install-framework detects when the target bin dir is already on PATH", (t) => {
  const root = makeTempDir();
  const installRoot = path.join(root, "install");
  const binDir = path.join(root, "bin");
  const originalPath = process.env.PATH;

  t.after(() => {
    process.env.PATH = originalPath;
    uninstallFramework({ "install-root": installRoot, "bin-dir": binDir });
    fs.rmSync(root, { recursive: true, force: true });
  });

  process.env.PATH = originalPath ? `${originalPath}${path.delimiter}${binDir}` : binDir;

  const result = installFramework({
    "install-root": installRoot,
    "bin-dir": binDir,
    force: true
  });

  assert.equal(result.bin_dir_on_path, true);
});
