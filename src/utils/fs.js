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

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

  const locator = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(locator, [commandName], { encoding: "utf8" });
  return result.status === 0;
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
