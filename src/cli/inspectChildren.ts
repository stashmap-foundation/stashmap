import { loadCliProfile } from "./config";
import { requireValue } from "./args";
import { InspectChildrenCliArgs } from "./types";
import { inspectWorkspaceChildren } from "../core/writeWorkspace";

export function parseInspectChildrenArgs(
  args: string[]
): InspectChildrenCliArgs {
  const parse = (
    index: number,
    current: InspectChildrenCliArgs
  ): InspectChildrenCliArgs => {
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
      case "--parent":
        return parse(index + 2, {
          ...current,
          parentRelationId: requireValue(args, index, "--parent") as LongID,
        });
      default:
        throw new Error(`Unknown inspect children argument: ${arg}`);
    }
  };

  return parse(0, { help: false });
}

export function inspectChildrenHelp(): string {
  return [
    "Usage: knowstr inspect children --parent <relation-id> [--config <path>]",
    "",
    "Lists a relation's direct items with stable item IDs, child relation IDs, relevance, and argument metadata.",
  ].join("\n");
}

export async function runInspectChildrenCommand(
  args: string[]
): Promise<
  | { help: true; text: string }
  | Awaited<ReturnType<typeof inspectWorkspaceChildren>>
> {
  const parsed = parseInspectChildrenArgs(args);
  if (parsed.help) {
    return {
      help: true,
      text: inspectChildrenHelp(),
    };
  }
  if (!parsed.parentRelationId) {
    throw new Error("--parent is required");
  }
  const profile = loadCliProfile({ configPath: parsed.configPath });
  return inspectWorkspaceChildren(profile, parsed.parentRelationId);
}
