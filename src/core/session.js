import path from "node:path";

import { appendText, ensureDir, slugify, timestampForRun, writeJson } from "../utils/fs.js";

export function createRunWorkspace(rootPath, outputRoot, mode, title) {
  const runId = `${timestampForRun()}-${slugify(title || mode)}`;
  const runPath = path.resolve(rootPath, outputRoot, runId);
  for (const relative of ["work/input", "work/repo", "work/session", "work/rounds", "work/synth", "work/logs", "result"]) {
    ensureDir(path.join(runPath, relative));
  }

  return {
    runId,
    runPath,
    workPath: path.join(runPath, "work"),
    resultPath: path.join(runPath, "result")
  };
}

export function writeTimeline(runPath, event, payload = {}) {
  appendText(
    path.join(runPath, "session", "timeline.ndjson"),
    `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...payload })}\n`
  );
}

export function writeCouncilLog(runPath, line) {
  appendText(path.join(runPath, "logs", "session.log"), `${line}\n`);
}

export function writeSessionManifest(runPath, manifest) {
  writeJson(path.join(runPath, "session", "session.json"), manifest);
  writeJson(path.join(runPath, "session", "effective-config.json"), manifest.effective_config ?? {});
}
