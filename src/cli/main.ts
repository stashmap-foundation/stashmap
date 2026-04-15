import { applyHelp, runApplyCommand } from "./apply";
import { initHelp, runInitCommand } from "./init";
import { saveHelp, runSaveCommand } from "./save";

function isHelpResult(value: unknown): value is { help: true; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "help" in value &&
    "text" in value &&
    (value as { help?: unknown }).help === true &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function generalHelp(): string {
  return [
    "Usage: knowstr <command>",
    "",
    "Commands:",
    "  init   Initialize a new Knowstr workspace",
    "  save   Run local integrity checks and assign IDs without publishing",
    "  apply  Apply markdown files from ./inbox into the local graph",
    "",
    "Use a .knowstrignore file to exclude files/directories from save.",
    "",
    initHelp(),
    "",
    saveHelp(),
    "",
    applyHelp(),
  ].join("\n");
}

function printResult(result: unknown): void {
  if (isHelpResult(result)) {
    process.stdout.write(`${result.text}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function runCli(argv: string[]): Promise<void> {
  const [command, subcommand, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${generalHelp()}\n`);
    return;
  }

  if (command === "init") {
    printResult(runInitCommand([subcommand, ...rest].filter(Boolean)));
    return;
  }

  if (command === "save") {
    printResult(await runSaveCommand([subcommand, ...rest].filter(Boolean)));
    return;
  }

  if (command === "apply") {
    printResult(await runApplyCommand([subcommand, ...rest].filter(Boolean)));
    return;
  }

  throw new Error(
    `Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`
  );
}
