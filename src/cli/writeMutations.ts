import { text as readStreamText } from "stream/consumers";
import { loadCliProfile } from "./config";
import { requireValue } from "./args";
import {
  WriteCopyRootCliArgs,
  WriteCreateUnderCliArgs,
  WriteDeleteItemCliArgs,
  WriteLinkCliArgs,
  WriteMoveItemCliArgs,
  WriteSetArgumentCliArgs,
  WriteSetRelevanceCliArgs,
  WriteSetTextCliArgs,
} from "./types";
import {
  writeCopyRoot,
  writeCreateUnder,
  writeDeleteItem,
  writeLink,
  writeMoveItem,
  writeSetArgument,
  writeSetRelevance,
  writeSetText,
} from "../core/writeWorkspace";

async function readStdin(): Promise<string> {
  return readStreamText(process.stdin);
}

function parseRelevance(value: string, flag: string): "contains" | Relevance {
  if (
    value === "contains" ||
    value === "relevant" ||
    value === "maybe_relevant" ||
    value === "little_relevant" ||
    value === "not_relevant"
  ) {
    return value;
  }
  throw new Error(`Invalid ${flag} value: ${value}`);
}

function parseArgument(value: string, flag: string): "none" | Argument {
  if (value === "none" || value === "confirms" || value === "contra") {
    return value;
  }
  throw new Error(`Invalid ${flag} value: ${value}`);
}

function parsePositionArgs<T extends { beforeItemId?: ID; afterItemId?: ID }>(
  args: string[],
  index: number,
  current: T
): [number, T] {
  const arg = args[index];
  if (arg === "--before") {
    return [
      index + 2,
      {
        ...current,
        beforeItemId: requireValue(args, index, "--before") as ID,
      },
    ];
  }
  if (arg === "--after") {
    return [
      index + 2,
      {
        ...current,
        afterItemId: requireValue(args, index, "--after") as ID,
      },
    ];
  }
  return [index, current];
}

function parseRelayArgs<T extends { relayUrls: string[] }>(
  args: string[],
  index: number,
  current: T
): [number, T] {
  const arg = args[index];
  if (arg !== "--relay") {
    return [index, current];
  }
  return [
    index + 2,
    {
      ...current,
      relayUrls: [...current.relayUrls, requireValue(args, index, "--relay")],
    },
  ];
}

export function writeMutationsHelp(): string {
  return [
    "Usage:",
    "  knowstr write copy-root --relation <relation-id> [--config <path>] [--relay <url> ...]",
    "  knowstr write set-text --relation <relation-id> --text <text> [--config <path>] [--relay <url> ...]",
    "  knowstr write create-under --parent <relation-id> --stdin [--before <item-id>|--after <item-id>] [--relevance <contains|relevant|maybe_relevant|little_relevant|not_relevant>] [--argument <none|confirms|contra>] [--config <path>] [--relay <url> ...]",
    "  knowstr write link --parent <relation-id> --target <relation-id> [--before <item-id>|--after <item-id>] [--relevance <contains|relevant|maybe_relevant|little_relevant|not_relevant>] [--argument <none|confirms|contra>] [--config <path>] [--relay <url> ...]",
    "  knowstr write set-relevance --parent <relation-id> --item <item-id> --value <contains|relevant|maybe_relevant|little_relevant|not_relevant> [--config <path>] [--relay <url> ...]",
    "  knowstr write set-argument --parent <relation-id> --item <item-id> --value <none|confirms|contra> [--config <path>] [--relay <url> ...]",
    "  knowstr write delete-item --parent <relation-id> --item <item-id> [--config <path>] [--relay <url> ...]",
    "  knowstr write move-item --from-parent <relation-id> --item <item-id> --to-parent <relation-id> [--before <item-id>|--after <item-id>] [--config <path>] [--relay <url> ...]",
    "",
    "Applies edge-aware relation edits locally, updates the workspace immediately, and queues signed events for `knowstr push`.",
    "Bare UUID operands are treated as your own `<pubkey>_<uuid>` IDs.",
  ].join("\n");
}

export function parseWriteCopyRootArgs(args: string[]): WriteCopyRootCliArgs {
  const parse = (
    index: number,
    current: WriteCopyRootCliArgs
  ): WriteCopyRootCliArgs => {
    const [afterRelayIndex, withRelay] = parseRelayArgs(args, index, current);
    if (afterRelayIndex !== index) {
      return parse(afterRelayIndex, withRelay);
    }
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
      case "--relation":
        return parse(index + 2, {
          ...current,
          relationId: requireValue(args, index, "--relation") as LongID,
        });
      default:
        throw new Error(`Unknown write copy-root argument: ${arg}`);
    }
  };
  return parse(0, { relayUrls: [], help: false });
}

export function parseWriteSetTextArgs(args: string[]): WriteSetTextCliArgs {
  const parse = (
    index: number,
    current: WriteSetTextCliArgs
  ): WriteSetTextCliArgs => {
    const [afterRelayIndex, withRelay] = parseRelayArgs(args, index, current);
    if (afterRelayIndex !== index) {
      return parse(afterRelayIndex, withRelay);
    }
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
      case "--relation":
        return parse(index + 2, {
          ...current,
          relationId: requireValue(args, index, "--relation") as LongID,
        });
      case "--text":
        return parse(index + 2, {
          ...current,
          text: requireValue(args, index, "--text"),
        });
      default:
        throw new Error(`Unknown write set-text argument: ${arg}`);
    }
  };
  return parse(0, { relayUrls: [], help: false });
}

export function parseWriteCreateUnderArgs(
  args: string[]
): WriteCreateUnderCliArgs {
  const parse = (
    index: number,
    current: WriteCreateUnderCliArgs
  ): WriteCreateUnderCliArgs => {
    const [afterRelayIndex, withRelay] = parseRelayArgs(args, index, current);
    if (afterRelayIndex !== index) {
      return parse(afterRelayIndex, withRelay);
    }
    const [afterPositionIndex, withPosition] = parsePositionArgs(
      args,
      index,
      current
    );
    if (afterPositionIndex !== index) {
      return parse(afterPositionIndex, withPosition);
    }
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
      case "--stdin":
        return parse(index + 1, {
          ...current,
          stdin: true,
        });
      case "--relevance":
        return parse(index + 2, {
          ...current,
          relevance: parseRelevance(
            requireValue(args, index, "--relevance"),
            "--relevance"
          ),
        });
      case "--argument":
        return parse(index + 2, {
          ...current,
          argument: parseArgument(
            requireValue(args, index, "--argument"),
            "--argument"
          ),
        });
      default:
        throw new Error(`Unknown write create-under argument: ${arg}`);
    }
  };
  return parse(0, { relayUrls: [], help: false });
}

export function parseWriteLinkArgs(args: string[]): WriteLinkCliArgs {
  const parse = (
    index: number,
    current: WriteLinkCliArgs
  ): WriteLinkCliArgs => {
    const [afterRelayIndex, withRelay] = parseRelayArgs(args, index, current);
    if (afterRelayIndex !== index) {
      return parse(afterRelayIndex, withRelay);
    }
    const [afterPositionIndex, withPosition] = parsePositionArgs(
      args,
      index,
      current
    );
    if (afterPositionIndex !== index) {
      return parse(afterPositionIndex, withPosition);
    }
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
      case "--target":
        return parse(index + 2, {
          ...current,
          targetRelationId: requireValue(args, index, "--target") as LongID,
        });
      case "--relevance":
        return parse(index + 2, {
          ...current,
          relevance: parseRelevance(
            requireValue(args, index, "--relevance"),
            "--relevance"
          ),
        });
      case "--argument":
        return parse(index + 2, {
          ...current,
          argument: parseArgument(
            requireValue(args, index, "--argument"),
            "--argument"
          ),
        });
      default:
        throw new Error(`Unknown write link argument: ${arg}`);
    }
  };
  return parse(0, { relayUrls: [], help: false });
}

export function parseWriteSetRelevanceArgs(
  args: string[]
): WriteSetRelevanceCliArgs {
  const parse = (
    index: number,
    current: WriteSetRelevanceCliArgs
  ): WriteSetRelevanceCliArgs => {
    const [afterRelayIndex, withRelay] = parseRelayArgs(args, index, current);
    if (afterRelayIndex !== index) {
      return parse(afterRelayIndex, withRelay);
    }
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
      case "--item":
        return parse(index + 2, {
          ...current,
          itemId: requireValue(args, index, "--item") as ID,
        });
      case "--value":
        return parse(index + 2, {
          ...current,
          relevance: parseRelevance(
            requireValue(args, index, "--value"),
            "--value"
          ),
        });
      default:
        throw new Error(`Unknown write set-relevance argument: ${arg}`);
    }
  };
  return parse(0, { relayUrls: [], help: false });
}

export function parseWriteSetArgumentArgs(
  args: string[]
): WriteSetArgumentCliArgs {
  const parse = (
    index: number,
    current: WriteSetArgumentCliArgs
  ): WriteSetArgumentCliArgs => {
    const [afterRelayIndex, withRelay] = parseRelayArgs(args, index, current);
    if (afterRelayIndex !== index) {
      return parse(afterRelayIndex, withRelay);
    }
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
      case "--item":
        return parse(index + 2, {
          ...current,
          itemId: requireValue(args, index, "--item") as ID,
        });
      case "--value":
        return parse(index + 2, {
          ...current,
          argument: parseArgument(
            requireValue(args, index, "--value"),
            "--value"
          ),
        });
      default:
        throw new Error(`Unknown write set-argument argument: ${arg}`);
    }
  };
  return parse(0, { relayUrls: [], help: false });
}

export function parseWriteDeleteItemArgs(
  args: string[]
): WriteDeleteItemCliArgs {
  const parse = (
    index: number,
    current: WriteDeleteItemCliArgs
  ): WriteDeleteItemCliArgs => {
    const [afterRelayIndex, withRelay] = parseRelayArgs(args, index, current);
    if (afterRelayIndex !== index) {
      return parse(afterRelayIndex, withRelay);
    }
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
      case "--item":
        return parse(index + 2, {
          ...current,
          itemId: requireValue(args, index, "--item") as ID,
        });
      default:
        throw new Error(`Unknown write delete-item argument: ${arg}`);
    }
  };
  return parse(0, { relayUrls: [], help: false });
}

export function parseWriteMoveItemArgs(args: string[]): WriteMoveItemCliArgs {
  const parse = (
    index: number,
    current: WriteMoveItemCliArgs
  ): WriteMoveItemCliArgs => {
    const [afterRelayIndex, withRelay] = parseRelayArgs(args, index, current);
    if (afterRelayIndex !== index) {
      return parse(afterRelayIndex, withRelay);
    }
    const [afterPositionIndex, withPosition] = parsePositionArgs(
      args,
      index,
      current
    );
    if (afterPositionIndex !== index) {
      return parse(afterPositionIndex, withPosition);
    }
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
      case "--from-parent":
        return parse(index + 2, {
          ...current,
          sourceParentRelationId: requireValue(
            args,
            index,
            "--from-parent"
          ) as LongID,
        });
      case "--item":
        return parse(index + 2, {
          ...current,
          itemId: requireValue(args, index, "--item") as ID,
        });
      case "--to-parent":
        return parse(index + 2, {
          ...current,
          targetParentRelationId: requireValue(
            args,
            index,
            "--to-parent"
          ) as LongID,
        });
      default:
        throw new Error(`Unknown write move-item argument: ${arg}`);
    }
  };
  return parse(0, { relayUrls: [], help: false });
}

export async function runWriteMutationCommand(
  subcommand: string,
  args: string[]
): Promise<{ help: true; text: string } | Record<string, unknown>> {
  if (args.includes("--help") || args.includes("-h")) {
    return {
      help: true,
      text: writeMutationsHelp(),
    };
  }

  if (subcommand === "copy-root") {
    const parsed = parseWriteCopyRootArgs(args);
    if (!parsed.relationId) {
      throw new Error("--relation is required");
    }
    const profile = loadCliProfile({ configPath: parsed.configPath });
    return writeCopyRoot(profile, {
      relationId: parsed.relationId,
      relayUrls: parsed.relayUrls,
    });
  }

  if (subcommand === "set-text") {
    const parsed = parseWriteSetTextArgs(args);
    if (!parsed.relationId || parsed.text === undefined) {
      throw new Error("--relation and --text are required");
    }
    const profile = loadCliProfile({ configPath: parsed.configPath });
    return writeSetText(profile, {
      relationId: parsed.relationId,
      text: parsed.text,
      relayUrls: parsed.relayUrls,
    });
  }

  if (subcommand === "create-under") {
    const parsed = parseWriteCreateUnderArgs(args);
    if (!parsed.parentRelationId || !parsed.stdin) {
      throw new Error("--parent and --stdin are required");
    }
    const profile = loadCliProfile({ configPath: parsed.configPath });
    return writeCreateUnder(profile, {
      parentRelationId: parsed.parentRelationId,
      markdownText: await readStdin(),
      ...(parsed.beforeItemId ? { beforeItemId: parsed.beforeItemId } : {}),
      ...(parsed.afterItemId ? { afterItemId: parsed.afterItemId } : {}),
      ...(parsed.relevance ? { relevance: parsed.relevance } : {}),
      ...(parsed.argument ? { argument: parsed.argument } : {}),
      relayUrls: parsed.relayUrls,
    });
  }

  if (subcommand === "link") {
    const parsed = parseWriteLinkArgs(args);
    if (!parsed.parentRelationId || !parsed.targetRelationId) {
      throw new Error("--parent and --target are required");
    }
    const profile = loadCliProfile({ configPath: parsed.configPath });
    return writeLink(profile, {
      parentRelationId: parsed.parentRelationId,
      targetRelationId: parsed.targetRelationId,
      ...(parsed.beforeItemId ? { beforeItemId: parsed.beforeItemId } : {}),
      ...(parsed.afterItemId ? { afterItemId: parsed.afterItemId } : {}),
      ...(parsed.relevance ? { relevance: parsed.relevance } : {}),
      ...(parsed.argument ? { argument: parsed.argument } : {}),
      relayUrls: parsed.relayUrls,
    });
  }

  if (subcommand === "set-relevance") {
    const parsed = parseWriteSetRelevanceArgs(args);
    if (!parsed.parentRelationId || !parsed.itemId || !parsed.relevance) {
      throw new Error("--parent, --item, and --value are required");
    }
    const profile = loadCliProfile({ configPath: parsed.configPath });
    return writeSetRelevance(profile, {
      parentRelationId: parsed.parentRelationId,
      itemId: parsed.itemId,
      relevance: parsed.relevance,
      relayUrls: parsed.relayUrls,
    });
  }

  if (subcommand === "set-argument") {
    const parsed = parseWriteSetArgumentArgs(args);
    if (!parsed.parentRelationId || !parsed.itemId || !parsed.argument) {
      throw new Error("--parent, --item, and --value are required");
    }
    const profile = loadCliProfile({ configPath: parsed.configPath });
    return writeSetArgument(profile, {
      parentRelationId: parsed.parentRelationId,
      itemId: parsed.itemId,
      argument: parsed.argument,
      relayUrls: parsed.relayUrls,
    });
  }

  if (subcommand === "delete-item") {
    const parsed = parseWriteDeleteItemArgs(args);
    if (!parsed.parentRelationId || !parsed.itemId) {
      throw new Error("--parent and --item are required");
    }
    const profile = loadCliProfile({ configPath: parsed.configPath });
    return writeDeleteItem(profile, {
      parentRelationId: parsed.parentRelationId,
      itemId: parsed.itemId,
      relayUrls: parsed.relayUrls,
    });
  }

  if (subcommand === "move-item") {
    const parsed = parseWriteMoveItemArgs(args);
    if (
      !parsed.sourceParentRelationId ||
      !parsed.itemId ||
      !parsed.targetParentRelationId
    ) {
      throw new Error("--from-parent, --item, and --to-parent are required");
    }
    const profile = loadCliProfile({ configPath: parsed.configPath });
    return writeMoveItem(profile, {
      sourceParentRelationId: parsed.sourceParentRelationId,
      itemId: parsed.itemId,
      targetParentRelationId: parsed.targetParentRelationId,
      ...(parsed.beforeItemId ? { beforeItemId: parsed.beforeItemId } : {}),
      ...(parsed.afterItemId ? { afterItemId: parsed.afterItemId } : {}),
      relayUrls: parsed.relayUrls,
    });
  }

  throw new Error(`Unknown write command: ${subcommand}`);
}
