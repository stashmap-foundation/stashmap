import { pullHelp, runPullCommand } from "./syncPull";
import { pushHelp, runPushCommand } from "./push";

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
    "  pull   Export a local editable markdown workspace from relays",
    "  push   Publish edited workspace documents to relays",
    "",
    pullHelp(),
    "",
    pushHelp(),
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

  if (command === "pull") {
    printResult(await runPullCommand([subcommand, ...rest].filter(Boolean)));
    return;
  }

  if (command === "push") {
    printResult(await runPushCommand([subcommand, ...rest].filter(Boolean)));
    return;
  }

  throw new Error(
    `Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`
  );
}
