import path from "node:path";
import { fileURLToPath } from "node:url";

import { startShell } from "./interactive.js";
import { installFramework, uninstallFramework, upgradeFramework } from "../orchestrator/install_service.js";
import { decideLatest, exportLatestToAwf, getStatus, resumeLatest, runCouncil, toolingStatus } from "../core/workflow.js";
import { loadRepoSettings } from "../core/config.js";
import { getBooleanOption, getOption, parseCliArgs, printHelp } from "../utils/cli.js";
import { resolveRepoRoot } from "../utils/fs.js";

const currentFile = fileURLToPath(import.meta.url);
const defaultFrameworkRoot = path.resolve(path.dirname(currentFile), "..", "..");

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export async function main(argv) {
  const { command, options } = parseCliArgs(argv);
  const frameworkRoot = path.resolve(getOption(options, "root") ?? defaultFrameworkRoot);
  const repoPath = resolveRepoRoot(getOption(options, "repo") ?? getOption(options, "path") ?? process.cwd());
  const repoSettings = loadRepoSettings(repoPath);
  const resolvedLaunch = Object.hasOwn(options, "launch")
    ? getBooleanOption(options, "launch")
    : repoSettings.auto_launch !== false;

  try {
    if (options.help || command === "help") {
      printHelp();
      return;
    }

    switch (command) {
      case "install-framework":
        printJson(installFramework({
          "install-root": getOption(options, "install-root"),
          "bin-dir": getOption(options, "bin-dir"),
          force: getBooleanOption(options, "force")
        }));
        return;
      case "uninstall-framework":
        printJson(uninstallFramework({
          "install-root": getOption(options, "install-root"),
          "bin-dir": getOption(options, "bin-dir")
        }));
        return;
      case "upgrade-framework":
        printJson(upgradeFramework({
          "install-root": getOption(options, "install-root"),
          "bin-dir": getOption(options, "bin-dir")
        }));
        return;
      case "tooling-status":
        printJson(toolingStatus(frameworkRoot, repoPath));
        return;
      case "status":
        printJson(getStatus(frameworkRoot, repoPath));
        return;
      case "resume":
        printJson(resumeLatest(frameworkRoot, repoPath));
        return;
      case "decide":
        printJson(await decideLatest(frameworkRoot, repoPath, {
          decision: getOption(options, "decision"),
          prompt: getOption(options, "prompt"),
          reason: getOption(options, "reason"),
          notes: getOption(options, "notes"),
          create_awf: getBooleanOption(options, "create-awf"),
          story_export_mode: getOption(options, "story-export-mode")
        }));
        return;
      case "export-awf":
        printJson(exportLatestToAwf(frameworkRoot, repoPath, {
          output_root: getOption(options, "output-root")
        }));
        return;
      case "shell":
        printJson(await startShell(frameworkRoot, repoPath));
        return;
      case "run":
        printJson(await runCouncil(frameworkRoot, repoPath, {
          mode: getOption(options, "mode"),
          title: getOption(options, "title"),
          output_root: getOption(options, "output-root"),
          prompt: getOption(options, "prompt"),
          "prompt-file": getOption(options, "prompt-file"),
          "ticket-file": getOption(options, "ticket-file"),
          "ticket-source": getOption(options, "ticket-source"),
          "jira-url": getOption(options, "jira-url"),
          repo: getOption(options, "repo"),
          provider: getOption(options, "provider"),
          launch: resolvedLaunch,
          "extra-context": getOption(options, "extra-context"),
          "extra-context-file": getOption(options, "extra-context-file"),
          "constraints-file": getOption(options, "constraints-file"),
          "acceptance-file": getOption(options, "acceptance-file"),
          "review-target-file": getOption(options, "review-target-file"),
          "debate-topic-file": getOption(options, "debate-topic-file")
        }));
        return;
      default:
        printHelp();
        process.exitCode = 1;
    }
  } catch (error) {
    printJson({ ok: false, error: { command, message: error.message ?? String(error) } });
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await main(process.argv.slice(2));
}
