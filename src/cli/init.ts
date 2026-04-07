import fs from "fs";
import path from "path";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { decodePublicKeyInputSync } from "../nostrPublicKeys";
import { requireValue } from "./args";

type InitCliArgs = {
  doc?: string;
  relayUrls: string[];
  help: boolean;
};

type InitResult = {
  config_path: string;
  pubkey: string;
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

function buildWriteProfile(
  knowstrDir: string,
  parsed: InitCliArgs,
  relays: Relays
): Record<string, unknown> {
  const secretKey = generateSecretKey();
  const nsec = nip19.nsecEncode(secretKey);
  const pubkey = getPublicKey(secretKey) as PublicKey;

  const nsecPath = path.join(knowstrDir, "me.nsec");
  fs.writeFileSync(nsecPath, `${nsec}\n`, { mode: 0o600 });

  return {
    pubkey: nip19.npubEncode(pubkey),
    nsec_file: "./.knowstr/me.nsec",
    relays,
    ...(parsed.doc ? { workspace_dir: parsed.doc } : {}),
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

  const knowstrDir = path.join(cwd, ".knowstr");
  const configPath = path.join(knowstrDir, "profile.json");

  if (fs.existsSync(configPath)) {
    throw new Error(`${configPath} already exists`);
  }

  fs.mkdirSync(knowstrDir, { recursive: true });

  const relays = buildRelays(parsed);
  const profile = buildWriteProfile(knowstrDir, parsed, relays);

  fs.writeFileSync(configPath, `${JSON.stringify(profile, null, 2)}\n`);
  const writtenProfile = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    pubkey: string;
  };
  const pubkey = decodePublicKeyInputSync(writtenProfile.pubkey) as PublicKey;

  return {
    config_path: configPath,
    pubkey,
    npub: nip19.npubEncode(pubkey),
    relays: relays.map((r) => r.url),
  };
}
