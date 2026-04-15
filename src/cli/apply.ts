import { loadCliProfile } from "./config";
import { requireValue } from "./args";
import { applyWorkspaceInbox } from "../core/workspaceApply";

type ApplyCliArgs = {
  configPath?: string;
  dryRun: boolean;
  help: boolean;
};

function parseApplyArgs(args: string[]): ApplyCliArgs {
  const parse = (index: number, current: ApplyCliArgs): ApplyCliArgs => {
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
      case "--dry-run":
        return parse(index + 1, {
          ...current,
          dryRun: true,
        });
      default:
        throw new Error(`Unknown apply argument: ${arg}`);
    }
  };

  return parse(0, {
    dryRun: false,
    help: false,
  });
}

export function applyHelp(): string {
  return [
    "Usage: knowstr apply [--config <path>] [--dry-run]",
    "",
    "Applies markdown files from ./inbox into the local graph or ./maybe_relevant.",
  ].join("\n");
}

export async function runApplyCommand(
  args: string[]
): Promise<
  { help: true; text: string } | Awaited<ReturnType<typeof applyWorkspaceInbox>>
> {
  const parsed = parseApplyArgs(args);
  if (parsed.help) {
    return {
      help: true,
      text: applyHelp(),
    };
  }

  const profile = loadCliProfile({ configPath: parsed.configPath });
  return applyWorkspaceInbox(profile, {
    dryRun: parsed.dryRun,
  });
}
