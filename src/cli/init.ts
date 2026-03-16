import fs from "fs";
import path from "path";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { decodePublicKeyInputSync } from "../nostrPublicKeys";
import { DEFAULT_RELAYS } from "../nostr";
import { requireValue } from "./args";

type InitCliArgs = {
  readonly: boolean;
  asUser?: PublicKey;
  doc?: string;
  relayUrls: string[];
  help: boolean;
};

type InitResult = {
  config_path: string;
  pubkey: string;
  npub: string;
  read_as?: string;
  readonly: boolean;
  relays: string[];
};

function parsePublicKeyArg(value: string, flagName: string): PublicKey {
  const decoded = decodePublicKeyInputSync(value);
  if (!decoded) {
    throw new Error(
      `${flagName} must be a valid pubkey (hex, npub, or nprofile)`
    );
  }
  return decoded;
}

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
      case "--readonly":
        return parse(index + 1, { ...current, readonly: true });
      case "--as-user":
        return parse(index + 2, {
          ...current,
          asUser: parsePublicKeyArg(
            requireValue(args, index, "--as-user"),
            "--as-user"
          ),
        });
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
    readonly: false,
    relayUrls: [],
    help: false,
  });
}

export function initHelp(): string {
  return [
    "Usage: knowstr init [--readonly] [--as-user <pubkey|npub>] [--doc <dir>] [--relay <url> ...]",
    "",
    "Initializes a new Knowstr workspace with .knowstr/profile.json.",
    "Generates a new keypair unless --readonly is set.",
  ].join("\n");
}

function buildRelays(parsed: InitCliArgs): Relays {
  if (parsed.relayUrls.length > 0) {
    return parsed.relayUrls.map((url) => ({
      url,
      read: true,
      write: !parsed.readonly,
    }));
  }
  return DEFAULT_RELAYS.map((r) => ({
    ...r,
    write: parsed.readonly ? false : r.write,
  }));
}

function buildReadonlyProfile(
  asUser: PublicKey,
  relays: Relays
): Record<string, unknown> {
  return {
    pubkey: nip19.npubEncode(asUser as string),
    relays,
  };
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
    ...(parsed.asUser
      ? { read_as: nip19.npubEncode(parsed.asUser as string) }
      : {}),
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

  if (parsed.readonly && !parsed.asUser) {
    throw new Error(
      "--readonly requires --as-user to specify whose data to read"
    );
  }

  const knowstrDir = path.join(cwd, ".knowstr");
  const configPath = path.join(knowstrDir, "profile.json");

  if (fs.existsSync(configPath)) {
    throw new Error(`${configPath} already exists`);
  }

  fs.mkdirSync(knowstrDir, { recursive: true });

  const relays = buildRelays(parsed);

  const profile = parsed.readonly
    ? buildReadonlyProfile(parsed.asUser as PublicKey, relays)
    : buildWriteProfile(knowstrDir, parsed, relays);

  fs.writeFileSync(configPath, `${JSON.stringify(profile, null, 2)}\n`);

  const writtenProfile = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    pubkey: string;
    read_as?: string;
  };
  const pubkey = decodePublicKeyInputSync(writtenProfile.pubkey) as PublicKey;

  return {
    config_path: configPath,
    pubkey,
    npub: nip19.npubEncode(pubkey),
    ...(writtenProfile.read_as
      ? {
          read_as: decodePublicKeyInputSync(writtenProfile.read_as) as string,
        }
      : {}),
    readonly: parsed.readonly,
    relays: relays.map((r) => r.url),
  };
}
