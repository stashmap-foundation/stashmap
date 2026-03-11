#!/usr/bin/env node
import { runSyncPullCommand, syncPullHelp } from "./syncPull";
import {
  inspectChildrenHelp,
  runInspectChildrenCommand,
} from "./inspectChildren";
import {
  runWriteCreateRootCommand,
  writeCreateRootHelp,
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

async function main(): Promise<void> {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${generalHelp()}\n`);
    return;
  }

  if (command === "sync" && subcommand === "pull") {
    const result = await runSyncPullCommand(rest);
    if (isHelpResult(result)) {
      process.stdout.write(`${result.text}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "inspect" && subcommand === "children") {
    const result = await runInspectChildrenCommand(rest);
    if (isHelpResult(result)) {
      process.stdout.write(`${result.text}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "write" && subcommand === "create-root") {
    const result = await runWriteCreateRootCommand(rest);
    if (isHelpResult(result)) {
      process.stdout.write(`${result.text}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
      "remove-item",
      "move-item",
    ].includes(subcommand || "")
  ) {
    const writeSubcommand = subcommand;
    if (!writeSubcommand) {
      throw new Error("Missing write subcommand");
    }
    const result = await runWriteMutationCommand(writeSubcommand, rest);
    if (isHelpResult(result)) {
      process.stdout.write(`${result.text}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  throw new Error(
    `Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  process.exit(1);
});
