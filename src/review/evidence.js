import fs from "node:fs";
import path from "node:path";

import { listFilesRecursive, pathExists, writeJson, writeText } from "../utils/fs.js";

function reviewAccessError(message, repoPath) {
  return new Error(`Unable to access required source materials for comprehensive architectural review. ${message}: ${repoPath}`);
}

export function buildReviewEvidence(runPath, repoPath) {
  const resolvedRepo = path.resolve(repoPath);
  if (!pathExists(resolvedRepo)) {
    throw reviewAccessError("Review target does not exist", resolvedRepo);
  }

  let repoStats;
  try {
    repoStats = fs.statSync(resolvedRepo);
  } catch {
    throw reviewAccessError("Review target could not be inspected", resolvedRepo);
  }

  if (!repoStats.isDirectory()) {
    throw reviewAccessError("Review target is not a directory", resolvedRepo);
  }

  let files;
  try {
    files = listFilesRecursive(resolvedRepo)
      .map((filePath) => path.relative(resolvedRepo, filePath).replace(/\\/g, "/"))
      .filter((filePath) => !/(^|\/)\.ai-council(\/|$)/.test(filePath) && !/(^|\/)\.runs(\/|$)/.test(filePath));
  } catch {
    throw reviewAccessError("Review target could not be indexed", resolvedRepo);
  }

  if (files.length === 0) {
    throw reviewAccessError("No readable files were found under the review target", resolvedRepo);
  }

  const docs = files.filter((filePath) => /(^|\/)(readme|docs?)/i.test(filePath));
  const tests = files.filter((filePath) => /(test|spec)\./i.test(filePath) || /(^|\/)(tests?|specs?)(\/|$)/i.test(filePath));
  const evidence = {
    repo_path: resolvedRepo,
    file_count: files.length,
    doc_count: docs.length,
    test_count: tests.length,
    files: files.slice(0, 500),
    focus_areas: [
      "core implementation paths",
      "tests and verification coverage",
      "docs and architecture clues"
    ]
  };

  writeJson(path.join(runPath, "repo", "scope.json"), { repo_path: resolvedRepo });
  writeJson(path.join(runPath, "repo", "file-index.json"), { files: evidence.files });
  writeJson(path.join(runPath, "repo", "evidence-map.json"), evidence);
  writeText(
    path.join(runPath, "input", "review-target.md"),
    `# Review Target

- Repo path: ${resolvedRepo}
- Indexed files: ${files.length}
- Docs found: ${docs.length}
- Tests found: ${tests.length}
`
  );

  return evidence;
}
