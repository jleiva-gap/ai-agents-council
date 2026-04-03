import path from "node:path";

import {
  chmodExecutable,
  copyDir,
  frameworkRoot,
  homeDir,
  pathExists,
  removeDir,
  writeText
} from "../utils/fs.js";

function defaultInstallRoot() {
  return path.join(homeDir(), ".ai-council", "framework");
}

function defaultBinDir() {
  return path.join(homeDir(), ".ai-council", "bin");
}

function normalizePathEntry(value) {
  if (!value) {
    return "";
  }

  return path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}

function isBinDirOnPath(binDir, envPath = process.env.PATH ?? "") {
  const expected = normalizePathEntry(binDir);
  return envPath
    .split(path.delimiter)
    .map((entry) => normalizePathEntry(entry))
    .includes(expected);
}

function renderShellWrapper(installRoot) {
  const normalizedRoot = installRoot.split(path.sep).join("/");
  return `#!/usr/bin/env bash
node "${normalizedRoot}/bin/ai-council" "$@"
`;
}

function renderPowerShellWrapper(installRoot) {
  return `$InstallRoot = "${installRoot}"
node (Join-Path $InstallRoot "bin\\ai-council") @Args
exit $LASTEXITCODE
`;
}

function renderCmdWrapper(installRoot) {
  return `@echo off
node "${path.join(installRoot, "bin", "ai-council")}" %*
`;
}

export function installFramework(options = {}) {
  const sourceRoot = frameworkRoot(import.meta.url);
  const installRoot = path.resolve(options["install-root"] ?? defaultInstallRoot());
  const binDir = path.resolve(options["bin-dir"] ?? defaultBinDir());
  const force = options.force === true;

  if (sourceRoot === installRoot) {
    throw new Error("install target cannot be the current framework source directory");
  }

  if (pathExists(installRoot)) {
    if (!force) {
      throw new Error(`install target already exists: ${installRoot}. Re-run with --force to overwrite.`);
    }

    removeDir(installRoot);
  }

  copyDir(sourceRoot, installRoot);

  const shellWrapperPath = path.join(binDir, "ai-council");
  const powerShellWrapperPath = path.join(binDir, "ai-council.ps1");
  const cmdWrapperPath = path.join(binDir, "ai-council.cmd");

  writeText(shellWrapperPath, renderShellWrapper(installRoot));
  writeText(powerShellWrapperPath, renderPowerShellWrapper(installRoot));
  writeText(cmdWrapperPath, renderCmdWrapper(installRoot));
  chmodExecutable(shellWrapperPath);

  return {
    install_root: installRoot,
    bin_dir: binDir,
    wrappers: [shellWrapperPath, powerShellWrapperPath, cmdWrapperPath],
    bin_dir_on_path: isBinDirOnPath(binDir),
    path_hint: `Add ${binDir} to PATH if you want to run 'ai-council' from any terminal.`
  };
}

export function uninstallFramework(options = {}) {
  const installRoot = path.resolve(options["install-root"] ?? defaultInstallRoot());
  const binDir = path.resolve(options["bin-dir"] ?? defaultBinDir());

  removeDir(installRoot);
  removeDir(path.join(binDir, "ai-council"));
  removeDir(path.join(binDir, "ai-council.ps1"));
  removeDir(path.join(binDir, "ai-council.cmd"));

  return {
    install_root: installRoot,
    bin_dir: binDir
  };
}

export function upgradeFramework(options = {}) {
  return installFramework({ ...options, force: true });
}
