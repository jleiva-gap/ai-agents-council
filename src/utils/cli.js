export function parseCliArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};
  const positionals = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    if (token === "-h" || token === "--help") {
      options.help = true;
      continue;
    }

    const normalized = token.replace(/^-+/, "");
    const nextToken = rest[index + 1];
    const hasValue = nextToken && !nextToken.startsWith("-");
    const value = hasValue ? nextToken : true;

    if (hasValue) {
      index += 1;
    }

    if (Object.hasOwn(options, normalized)) {
      const current = options[normalized];
      options[normalized] = Array.isArray(current) ? [...current, value] : [current, value];
      continue;
    }

    options[normalized] = value;
  }

  return { command, options, positionals };
}

export function getOption(options, name, fallback = undefined) {
  return Object.hasOwn(options, name) ? options[name] : fallback;
}

export function getBooleanOption(options, name) {
  return getOption(options, name, false) === true;
}

export function printHelp() {
  console.log(`ai-council <command> [options]

Commands:
  install-framework      Install the framework into a shared location
  uninstall-framework    Remove the shared framework install
  upgrade-framework      Reinstall the framework in-place
  tooling-status        Show detected AI CLIs and MCP readiness
  status                Show the latest council run summary
  run                   Create a new council run and generate artifacts
  resume                Show the latest run and recommended next actions
  decide                Approve, request changes, or reject the latest run
  export-awf           Convert the latest approved result into .wi AWF artifacts
  shell                 Launch the guided council shell
  help                  Show this help text

Common options:
  --mode <plan|design|spike|debate|review>
  --ticket-file <path>  Markdown ticket definition input
  --prompt <text>       Freeform prompt input
  --prompt-file <path>  Freeform prompt file input
  --jira-url <url>      Jira URL to normalize into a local ticket artifact
  --repo <path>         Target repository path, or any path inside that repo
  --install-root <path> Shared framework install location
  --bin-dir <path>      Wrapper output directory for global commands
  --output-root <path>  Root folder for generated run results
  --title <text>        Optional title override
  --provider <name>     Preferred default provider
  --launch              Preview or launch provider commands when configured
  --decision <name>     approve | request_changes | reject
  --create-awf          Export .wi AWF artifacts immediately after approval
  --story-export-mode   none | single | split
  --story-agent <id>    Council AI agent that should create exported stories/tickets
`);
}
