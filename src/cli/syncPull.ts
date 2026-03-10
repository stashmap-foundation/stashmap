import { SimplePool } from "nostr-tools";
import { loadCliProfile } from "./config";
import { SyncPullCliArgs } from "./types";
import { pullSyncWorkspace, SyncPullManifest } from "../core/syncPull";

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseSyncPullArgs(args: string[]): SyncPullCliArgs {
  const initial: SyncPullCliArgs = {
    relayUrls: [],
    help: false,
  };

  const parseAt = (index: number, parsed: SyncPullCliArgs): SyncPullCliArgs => {
    if (index >= args.length) {
      return parsed;
    }

    const arg = args[index];
    switch (arg) {
      case "--help":
      case "-h":
        return parseAt(index + 1, { ...parsed, help: true });
      case "--config":
        return parseAt(index + 2, {
          ...parsed,
          configPath: requireValue(args, index, "--config"),
        });
      case "--out":
        return parseAt(index + 2, {
          ...parsed,
          outDir: requireValue(args, index, "--out"),
        });
      case "--relay":
        return parseAt(index + 2, {
          ...parsed,
          relayUrls: parsed.relayUrls.concat(
            requireValue(args, index, "--relay")
          ),
        });
      case "--max-wait": {
        const value = requireValue(args, index, "--max-wait");
        const parsedValue = Number(value);
        if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
          throw new Error("--max-wait must be a positive number");
        }
        return parseAt(index + 2, {
          ...parsed,
          maxWaitMs: parsedValue,
        });
      }
      default:
        throw new Error(`Unknown sync pull argument: ${arg}`);
    }
  };

  return parseAt(0, initial);
}

export function syncPullHelp(): string {
  return [
    "Usage: knowstr sync pull [--config <path>] [--out <path>] [--relay <url> ...]",
    "",
    "Reads the Knowstr graph from configured relays and exports a local workspace.",
  ].join("\n");
}

export async function runSyncPullCommand(
  args: string[]
): Promise<SyncPullManifest | { help: true; text: string }> {
  const parsed = parseSyncPullArgs(args);
  if (parsed.help) {
    return {
      help: true,
      text: syncPullHelp(),
    };
  }

  const profile = loadCliProfile({ configPath: parsed.configPath });
  const pool = new SimplePool();

  return pullSyncWorkspace(
    {
      querySync: (relayUrls, filter, params) =>
        pool.querySync(relayUrls, filter, params),
      close: (relayUrls) => pool.close(relayUrls),
    },
    profile,
    {
      outDir: parsed.outDir,
      relayUrls: parsed.relayUrls,
      maxWaitMs: parsed.maxWaitMs,
    }
  );
}
