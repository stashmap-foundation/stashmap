import {
  inspectChildrenHelp,
  runInspectChildrenCommand,
} from "./inspectChildren";
import { syncPullHelp, runSyncPullCommand } from "./syncPull";
import {
  writeCreateRootHelp,
  runWriteCreateRootCommand,
} from "./writeCreateRoot";
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
    "  sync pull   Export a local markdown workspace from relays",
    "  inspect children   List a relation's direct items with stable IDs",
    "  write create-root   Publish a new standalone root",
    "  write <mutation>   Apply graph-aware edits to a synced workspace",
    "",
    syncPullHelp(),
    "",
    inspectChildrenHelp(),
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

  if (command === "sync" && subcommand === "pull") {
    printResult(await runSyncPullCommand(rest));
    return;
  }

  if (command === "inspect" && subcommand === "children") {
    printResult(await runInspectChildrenCommand(rest));
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
