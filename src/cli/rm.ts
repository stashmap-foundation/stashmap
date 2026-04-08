import { loadCliProfile } from "./config";
import { requireValue } from "./args";
import { runWorkspaceRm, WorkspaceRmResult } from "../core/workspaceRm";

type RmCliArgs = {
  configPath?: string;
  targets: string[];
  help: boolean;
};

function parseRmArgs(args: string[]): RmCliArgs {
  const parse = (index: number, current: RmCliArgs): RmCliArgs => {
    const arg = args[index];
    if (!arg) {
      return current;
    }

    switch (arg) {
      case "--help":
      case "-h":
        return parse(index + 1, { ...current, help: true });
      case "--config":
        return parse(index + 2, {
          ...current,
          configPath: requireValue(args, index, "--config"),
        });
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown rm argument: ${arg}`);
        }
        return parse(index + 1, {
          ...current,
          targets: [...current.targets, arg],
        });
    }
  };

  return parse(0, { targets: [], help: false });
}

export function rmHelp(): string {
  return [
    "Usage: knowstr rm <target> [<target> ...] [--config <path>]",
    "",
    "Removes a workspace file, an entire doc by docId, or an individual lost node id.",
    "",
    "Targets accept any mix of:",
    "  - a path to an existing workspace markdown file",
    "  - a docId UUID (for files already removed from disk)",
    "  - a node id UUID (for accepting accidental losses)",
    "",
    "All targets are validated together; nothing is applied unless every target",
    "resolves cleanly and the resulting workspace still passes the integrity check.",
  ].join("\n");
}

export async function runRmCommand(
  args: string[]
): Promise<{ help: true; text: string } | WorkspaceRmResult> {
  const parsed = parseRmArgs(args);
  if (parsed.help) {
    return { help: true, text: rmHelp() };
  }

  const profile = loadCliProfile({ configPath: parsed.configPath });
  return runWorkspaceRm(profile, parsed.targets);
}
