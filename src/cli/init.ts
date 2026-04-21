import fs from "fs";
import path from "path";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { requireValue } from "./args";

type InitCliArgs = {
  doc?: string;
  relayUrls: string[];
  help: boolean;
};

type InitResult = {
  config_path: string;
  pubkey: PublicKey;
  npub: string;
  relays: string[];
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
      default:
        throw new Error(`Unknown init argument: ${arg}`);
    }
  };

  return parse(0, {
    relayUrls: [],
    help: false,
  });
}

export function initHelp(): string {
  return [
    "Usage: knowstr init [--doc <dir>] [--relay <url> ...]",
    "",
    "Initializes a new Knowstr workspace with .knowstr/profile.json and a new keypair.",
    "Relays are optional. With no relays configured, use 'knowstr save' for local-only work.",
  ].join("\n");
}

type CreateWorkspaceProfileArgs = {
  workspaceDir: string;
  secretKey?: Uint8Array;
  relays?: Relays;
  documentDir?: string;
};

type CreatedWorkspaceProfile = {
  profilePath: string;
  nsecPath: string;
  pubkey: PublicKey;
  npub: string;
};

export function createWorkspaceProfile({
  workspaceDir,
  secretKey,
  relays = [],
  documentDir,
}: CreateWorkspaceProfileArgs): CreatedWorkspaceProfile {
  const knowstrDir = path.join(workspaceDir, ".knowstr");
  const profilePath = path.join(knowstrDir, "profile.json");

  if (fs.existsSync(profilePath)) {
    throw new Error(`${profilePath} already exists`);
  }

  fs.mkdirSync(knowstrDir, { recursive: true });

  const sk = secretKey ?? generateSecretKey();
  const nsec = nip19.nsecEncode(sk);
  const pubkey = getPublicKey(sk) as PublicKey;
  const npub = nip19.npubEncode(pubkey);

  const nsecPath = path.join(knowstrDir, "me.nsec");
  fs.writeFileSync(nsecPath, `${nsec}\n`, { mode: 0o600 });

  const profile = {
    pubkey: npub,
    nsec_file: "./.knowstr/me.nsec",
    relays,
    ...(documentDir ? { workspace_dir: documentDir } : {}),
  };
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);

  return { profilePath, nsecPath, pubkey, npub };
}

function buildRelays(parsed: InitCliArgs): Relays {
  if (parsed.relayUrls.length > 0) {
    return parsed.relayUrls.map((url) => ({
      url,
      read: true,
      write: true,
    }));
  }
  return [];
}

export function runInitCommand(
  args: string[],
  cwd: string = process.cwd()
): { help: true; text: string } | InitResult {
  const parsed = parseInitArgs(args);
  if (parsed.help) {
    return { help: true, text: initHelp() };
  }

  const relays = buildRelays(parsed);
  const { profilePath, pubkey, npub } = createWorkspaceProfile({
    workspaceDir: cwd,
    relays,
    documentDir: parsed.doc,
  });

  return {
    config_path: profilePath,
    pubkey,
    npub,
    relays: relays.map((r) => r.url),
  };
}
