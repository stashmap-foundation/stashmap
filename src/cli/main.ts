import { pullHelp, runPullCommand } from "./syncPull";
import {
  writeCreateRootHelp,
  runWriteCreateRootCommand,
} from "./writeCreateRoot";
import { pushHelp, runPushCommand } from "./push";
import { runWriteMutationCommand, writeMutationsHelp } from "./writeMutations";

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
    "  pull   Export a local markdown workspace from relays",
    "  push   Publish queued local events to relays",
    "  write create-root   Queue a new standalone root locally",
    "  write <mutation>   Apply graph-aware local edits to a synced workspace",
    "",
    pullHelp(),
    "",
    pushHelp(),
    "",
    writeCreateRootHelp(),
    "",
    writeMutationsHelp(),
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

  if (command === "write" && subcommand === "create-root") {
    printResult(await runWriteCreateRootCommand(rest));
    return;
  }

  if (
    command === "write" &&
    [
      "set-text",
      "create-under",
      "link",
      "set-relevance",
      "set-argument",
      "delete-item",
      "move-item",
    ].includes(subcommand || "")
  ) {
    if (!subcommand) {
      throw new Error("Missing write subcommand");
    }
    printResult(await runWriteMutationCommand(subcommand, rest));
    return;
  }

  throw new Error(
    `Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`
  );
}
