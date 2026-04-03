import path from "node:path";
import { fileURLToPath } from "node:url";

import { startShell } from "./interactive.js";
import { installFramework, uninstallFramework, upgradeFramework } from "../orchestrator/install_service.js";
import { getStatus, resumeLatest, runCouncil, toolingStatus } from "../core/workflow.js";
import { getBooleanOption, getOption, parseCliArgs, printHelp } from "../utils/cli.js";

const currentFile = fileURLToPath(import.meta.url);
const defaultFrameworkRoot = path.resolve(path.dirname(currentFile), "..", "..");

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export async function main(argv) {
  const { command, options } = parseCliArgs(argv);
  const frameworkRoot = path.resolve(getOption(options, "root") ?? defaultFrameworkRoot);
  const repoPath = path.resolve(getOption(options, "repo") ?? getOption(options, "path") ?? process.cwd());

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
          launch: getBooleanOption(options, "launch"),
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
