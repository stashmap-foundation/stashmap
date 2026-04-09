import { loadCliProfile } from "./config";
import { requireValue } from "./args";
import { saveEditedWorkspaceDocuments } from "../core/workspaceSave";

type SaveCliArgs = {
  configPath?: string;
  help: boolean;
};

function parseSaveArgs(args: string[]): SaveCliArgs {
  const parse = (index: number, current: SaveCliArgs): SaveCliArgs => {
    const arg = args[index];
    if (!arg) {
      return current;
    }

    switch (arg) {
      case "--help":
      case "-h":
        return parse(index + 1, {
          ...current,
          help: true,
        });
      case "--config":
        return parse(index + 2, {
          ...current,
          configPath: requireValue(args, index, "--config"),
        });
      default:
        throw new Error(`Unknown save argument: ${arg}`);
    }
  };

  return parse(0, { help: false });
}

export function saveHelp(): string {
  return [
    "Usage: knowstr save [--config <path>]",
    "",
    "Runs local integrity checks and assigns IDs without publishing.",
  ].join("\n");
}

export async function runSaveCommand(
  args: string[]
): Promise<
  | { help: true; text: string }
  | Awaited<ReturnType<typeof saveEditedWorkspaceDocuments>>
> {
  const parsed = parseSaveArgs(args);
  if (parsed.help) {
    return {
      help: true,
      text: saveHelp(),
    };
  }

  const profile = loadCliProfile({ configPath: parsed.configPath });
  return saveEditedWorkspaceDocuments(profile);
}
