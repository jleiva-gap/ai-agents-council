import path from "node:path";

import { listFilesRecursive, writeJson, writeText } from "../utils/fs.js";

export function buildReviewEvidence(runPath, repoPath) {
  const resolvedRepo = path.resolve(repoPath);
  const files = listFilesRecursive(resolvedRepo).map((filePath) => path.relative(resolvedRepo, filePath).replace(/\\/g, "/"));
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
