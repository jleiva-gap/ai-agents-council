import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function pathExists(targetPath) {
  return fs.existsSync(targetPath);
}

export function readJson(filePath, fallback = {}) {
  if (!pathExists(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`[ai-agents-council] Failed to parse JSON at ${filePath}. Using fallback. ${error.message ?? String(error)}`);
    return fallback;
  }
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

export function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, "utf8");
  return filePath;
}

export function appendText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, value, "utf8");
  return filePath;
}

export function copyFile(sourcePath, targetPath) {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedSource === resolvedTarget) {
    return targetPath;
  }

  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

export function readText(filePath, fallback = "") {
  if (!pathExists(filePath)) {
    return fallback;
  }

  return fs.readFileSync(filePath, "utf8");
}

export function listFilesRecursive(rootPath) {
  if (!pathExists(rootPath)) {
    return [];
  }

  const results = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath));
      continue;
    }

    results.push(fullPath);
  }

  return results;
}

export function commandExists(commandName) {
  if (!commandName) {
    return false;
  }

  const normalizedCommand = String(commandName).trim();
  if (!normalizedCommand) {
    return false;
  }

  const candidatePaths = [];
  const hasExplicitPath = normalizedCommand.includes(path.sep) || (process.platform === "win32" && normalizedCommand.includes("/"));
  const knownExtensions = process.platform === "win32"
    ? String(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean)
    : [""];

  if (path.isAbsolute(normalizedCommand) || hasExplicitPath) {
    candidatePaths.push(normalizedCommand);
    if (process.platform === "win32" && !path.extname(normalizedCommand)) {
      for (const extension of knownExtensions) {
        candidatePaths.push(`${normalizedCommand}${extension}`);
      }
    }
  } else {
    for (const entry of String(process.env.PATH ?? "").split(path.delimiter)) {
      const trimmedEntry = entry.trim().replace(/^"+|"+$/g, "");
      if (!trimmedEntry) {
        continue;
      }

      candidatePaths.push(path.join(trimmedEntry, normalizedCommand));
      if (process.platform === "win32" && !path.extname(normalizedCommand)) {
        for (const extension of knownExtensions) {
          candidatePaths.push(path.join(trimmedEntry, `${normalizedCommand}${extension}`));
        }
      }
    }
  }

  return candidatePaths.some((candidatePath) => pathExists(candidatePath));
}

function normalizeRepoCandidate(targetPath = process.cwd()) {
  const resolvedPath = path.resolve(targetPath);
  if (!pathExists(resolvedPath)) {
    return resolvedPath;
  }

  const stats = fs.statSync(resolvedPath);
  return stats.isDirectory() ? resolvedPath : path.dirname(resolvedPath);
}

function findAncestorWithMarker(startPath, markerName) {
  let current = normalizeRepoCandidate(startPath);

  while (true) {
    if (pathExists(path.join(current, markerName))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

export function resolveRepoRoot(targetPath = process.cwd()) {
  const candidate = normalizeRepoCandidate(targetPath);

  if (commandExists("git")) {
    const result = spawnSync("git", ["-C", candidate, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
    const gitRoot = String(result.stdout ?? "").trim();
    if (result.status === 0 && gitRoot) {
      return path.resolve(gitRoot);
    }
  }

  return findAncestorWithMarker(candidate, ".git") ?? candidate;
}

export function slugify(value) {
  return String(value ?? "run")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "run";
}

export function timestampForRun(date = new Date()) {
  return new Date(date).toISOString().replace(/[:.]/g, "-");
}

export function homeDir() {
  return os.homedir();
}

export function frameworkRoot(importMetaUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..", "..");
}

export function chmodExecutable(targetPath) {
  if (process.platform !== "win32" && pathExists(targetPath)) {
    fs.chmodSync(targetPath, 0o755);
  }
}

export function removeDir(targetPath) {
  if (!pathExists(targetPath)) {
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}

export function copyDir(sourcePath, targetPath) {
  ensureDir(targetPath);
  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === ".runs" || entry.name === "temp-results") {
      continue;
    }

    const sourceEntry = path.join(sourcePath, entry.name);
    const targetEntry = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourceEntry, targetEntry);
    } else {
      ensureDir(path.dirname(targetEntry));
      fs.copyFileSync(sourceEntry, targetEntry);
    }
  }
}
