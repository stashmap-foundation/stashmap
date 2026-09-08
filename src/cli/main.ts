import { SimplePool } from "nostr-tools";
import { initHelp, runInitCommand } from "./init";
import { saveHelp, runSaveCommand } from "./save";
import { publishHelp, runPublishCommand } from "./publish";

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
    "  init     Initialize a new Knowstr workspace",
    "  save     Run local integrity checks and assign IDs without publishing",
    "  publish  Save, then publish changed documents to the room relays",
    "",
    "Use a .knowstrignore file to exclude files/directories from save and publish.",
    "",
    initHelp(),
    "",
    saveHelp(),
    "",
    publishHelp(),
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

  if (command === "publish") {
    const result = await runPublishCommand(
      [subcommand, ...rest].filter(Boolean),
      new SimplePool()
    );
    printResult(result);
    if (!("help" in result) && result.unaccepted_paths.length > 0) {
      throw new Error(
        `No relay accepted: ${result.unaccepted_paths.join(", ")}`
      );
    }
    return;
  }

  throw new Error(
    `Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`
  );
}
