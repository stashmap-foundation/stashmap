#!/usr/bin/env node
import { runSyncPullCommand, syncPullHelp } from "./syncPull";

function generalHelp(): string {
  return [
    "Usage: knowstr <command>",
    "",
    "Commands:",
    "  sync pull   Export a local markdown workspace from relays",
    "",
    syncPullHelp(),
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
    if ("help" in result) {
      process.stdout.write(`${result.text}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  process.exitCode = 1;
});
