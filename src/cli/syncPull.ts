import { SimplePool } from "nostr-tools";
import { loadCliProfile } from "./config";
import { SyncPullCliArgs } from "./types";
import { pullSyncWorkspace } from "../core/syncPull";

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseSyncPullArgs(args: string[]): SyncPullCliArgs {
  const parsed: SyncPullCliArgs = {
    relayUrls: [],
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--config":
        parsed.configPath = requireValue(args, i, "--config");
        i += 1;
        break;
      case "--out":
        parsed.outDir = requireValue(args, i, "--out");
        i += 1;
        break;
      case "--relay":
        parsed.relayUrls.push(requireValue(args, i, "--relay"));
        i += 1;
        break;
      case "--max-wait": {
        const value = requireValue(args, i, "--max-wait");
        const parsedValue = Number(value);
        if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
          throw new Error("--max-wait must be a positive number");
        }
        parsed.maxWaitMs = parsedValue;
        i += 1;
        break;
      }
      default:
        throw new Error(`Unknown sync pull argument: ${arg}`);
    }
  }

  return parsed;
}

export function syncPullHelp(): string {
  return [
    "Usage: knowstr sync pull [--config <path>] [--out <path>] [--relay <url> ...]",
    "",
    "Reads the Knowstr graph from configured relays and exports a local workspace.",
  ].join("\n");
}

export async function runSyncPullCommand(args: string[]) {
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
