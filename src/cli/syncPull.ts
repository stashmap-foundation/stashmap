import { SimplePool } from "nostr-tools";
import { decodePublicKeyInputSync } from "../nostrPublicKeys";
import { loadCliProfile } from "./config";
import { requireValue } from "./args";
import { SyncPullCliArgs } from "./types";
import { pullSyncWorkspace, PullResult } from "../core/syncPull";

function parsePublicKeyArg(value: string, flagName: string): PublicKey {
  const decoded = decodePublicKeyInputSync(value);
  if (!decoded) {
    throw new Error(
      `${flagName} must be a valid pubkey (hex, npub, or nprofile)`
    );
  }
  return decoded;
}

function parsePullArgs(args: string[]): SyncPullCliArgs {
  const parse = (index: number, current: SyncPullCliArgs): SyncPullCliArgs => {
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
      case "--as-user":
        return parse(index + 2, {
          ...current,
          asUser: parsePublicKeyArg(
            requireValue(args, index, "--as-user"),
            "--as-user"
          ),
        });
      case "--out":
        return parse(index + 2, {
          ...current,
          outDir: requireValue(args, index, "--out"),
        });
      case "--relay":
        return parse(index + 2, {
          ...current,
          relayUrls: [
            ...current.relayUrls,
            requireValue(args, index, "--relay"),
          ],
        });
      case "--max-wait": {
        const value = requireValue(args, index, "--max-wait");
        const parsedValue = Number(value);
        if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
          throw new Error("--max-wait must be a positive number");
        }
        return parse(index + 2, {
          ...current,
          maxWaitMs: parsedValue,
        });
      }
      default:
        throw new Error(`Unknown pull argument: ${arg}`);
    }
  };

  return parse(0, {
    relayUrls: [],
    help: false,
  });
}

export function pullHelp(): string {
  return [
    "Usage: knowstr pull [--config <path>] [--as-user <pubkey|npub>] [--out <path>] [--relay <url> ...]",
    "",
    "Reads the Knowstr graph from configured relays, writes editable markdown documents, and refreshes hidden baselines.",
  ].join("\n");
}

export async function runPullCommand(
  args: string[]
): Promise<{ help: true; text: string } | PullResult> {
  const parsed = parsePullArgs(args);
  if (parsed.help) {
    return {
      help: true,
      text: pullHelp(),
    };
  }

  const profile = loadCliProfile({ configPath: parsed.configPath });
  const pullProfile = parsed.asUser
    ? {
        ...profile,
        readAs: parsed.asUser,
      }
    : profile;
  const pool = new SimplePool();

  return pullSyncWorkspace(
    {
      subscribeMany: (relayUrls, filters, params) =>
        pool.subscribeMany(relayUrls, filters, params),
      querySync: (relayUrls, filter, params) =>
        pool.querySync(relayUrls, filter, params),
      close: (relayUrls) => pool.close(relayUrls),
    },
    pullProfile,
    {
      outDir: parsed.outDir,
      relayUrls: parsed.relayUrls,
      maxWaitMs: parsed.maxWaitMs,
    }
  );
}
