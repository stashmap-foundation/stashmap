import fs from "fs";
import path from "path";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { DEFAULT_ROOM_RELAYS } from "../nostr";
import {
  WorkspaceConfig,
  filesystemProfileFromWorkspaceConfig,
  parseFilesystemProfile,
} from "../workspaceConfig";
import { decodePublicKeyInputSync } from "../infra/nostr/publicKeys";
import { requireValue } from "./args";

type InitCliArgs = {
  doc?: string;
  relayUrls: string[];
  shared: boolean;
  help: boolean;
};

type InitResult =
  | { configured: false; message: string; workspace_dir: string }
  | {
      configured: true;
      config_path: string;
      pubkey: PublicKey;
      npub: string;
      workspace_config: WorkspaceConfig;
    };

function parseInitArgs(args: string[]): InitCliArgs {
  const parse = (index: number, current: InitCliArgs): InitCliArgs => {
    const arg = args[index];
    if (!arg) {
      return current;
    }

    switch (arg) {
      case "--help":
      case "-h":
        return parse(index + 1, { ...current, help: true });
      case "--doc":
        return parse(index + 2, {
          ...current,
          doc: requireValue(args, index, "--doc"),
        });
      case "--relay":
        return parse(index + 2, {
          ...current,
          relayUrls: [
            ...current.relayUrls,
            requireValue(args, index, "--relay"),
          ],
        });
      case "--shared":
        return parse(index + 1, { ...current, shared: true });
      default:
        throw new Error(`Unknown init argument: ${arg}`);
    }
  };

  return parse(0, {
    relayUrls: [],
    shared: false,
    help: false,
  });
}

export function initHelp(): string {
  return [
    "Usage: knowstr init [--shared] [--relay <url> ...] [--doc <dir>]",
    "",
    "Local work needs no configuration.",
    "Use --shared to bind the workspace to a room.",
  ].join("\n");
}

export function createWorkspaceProfile({
  workspaceDir,
  workspaceConfig,
  secretKey,
}: {
  workspaceDir: string;
  workspaceConfig: WorkspaceConfig;
  secretKey?: Uint8Array;
}): {
  profilePath: string;
  nsecPath: string;
  pubkey: PublicKey;
  npub: string;
} {
  const knowstrDir = path.join(workspaceDir, ".knowstr");
  const profilePath = path.join(knowstrDir, "profile.json");

  if (fs.existsSync(profilePath)) {
    throw new Error(`${profilePath} already exists`);
  }

  const { profile } = parseFilesystemProfile(
    filesystemProfileFromWorkspaceConfig(workspaceConfig, "./.knowstr/me.nsec")
  );
  fs.mkdirSync(knowstrDir, { recursive: true });

  const sk = secretKey ?? generateSecretKey();
  const nsec = nip19.nsecEncode(sk);
  const decodedPubkey = decodePublicKeyInputSync(getPublicKey(sk));
  if (!decodedPubkey) {
    throw new Error("Could not derive workspace public key");
  }
  const npub = nip19.npubEncode(decodedPubkey);
  const nsecPath = path.join(knowstrDir, "me.nsec");
  fs.writeFileSync(nsecPath, `${nsec}\n`, { mode: 0o600 });

  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);

  return { profilePath, nsecPath, pubkey: decodedPubkey, npub };
}

function normalizedConfig(parsed: InitCliArgs): WorkspaceConfig | undefined {
  if (!parsed.shared) {
    if (parsed.relayUrls.length > 0) {
      throw new Error("--relay requires --shared");
    }
    return undefined;
  }

  return {
    storageRelays: [],
    roomRelays:
      parsed.relayUrls.length > 0
        ? parsed.relayUrls
        : DEFAULT_ROOM_RELAYS.map((relay) => relay.url),
  };
}

export function runInitCommand(
  args: string[],
  cwd: string = process.cwd()
): { help: true; text: string } | InitResult {
  const parsed = parseInitArgs(args);
  if (parsed.help) {
    return { help: true, text: initHelp() };
  }

  const workspaceDir = parsed.doc
    ? path.resolve(cwd, parsed.doc)
    : path.resolve(cwd);
  const workspaceConfig = normalizedConfig(parsed);
  if (!workspaceConfig) {
    return {
      configured: false,
      message: "Local work needs no configuration.",
      workspace_dir: workspaceDir,
    };
  }

  const { profilePath, pubkey, npub } = createWorkspaceProfile({
    workspaceDir,
    workspaceConfig,
  });

  return {
    configured: true,
    config_path: profilePath,
    pubkey,
    npub,
    workspace_config: parseFilesystemProfile(
      JSON.parse(fs.readFileSync(profilePath, "utf8"))
    ).config,
  };
}
