import fs from "fs";
import path from "path";
import { decodePublicKeyInputSync } from "../nostrPublicKeys";
import { sanitizeRelays } from "../relayUtils";
import { SyncPullProfile } from "../core/syncPull";

type RawRelay =
  | string
  | {
      url: string;
      read?: boolean;
      write?: boolean;
    };

type RawProfile = {
  pubkey?: string;
  read_as?: string;
  workspace_dir?: string;
  nsec_file?: string;
  bootstrap_relays?: string[];
  relays?: RawRelay[];
};

export type LoadedCliProfile = SyncPullProfile & {
  configPath: string;
  knowstrHome: string;
  agentRoot: string;
};

function resolveAbsolute(baseDir: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function resolveKnowstrHome(cwd: string, env: NodeJS.ProcessEnv): string {
  const envPath = env.KNOWSTR_HOME;
  return envPath ? resolveAbsolute(cwd, envPath) : path.join(cwd, ".knowstr");
}

function getAgentRoot(profilePath: string): string {
  const profileDir = path.dirname(profilePath);
  return path.basename(profileDir) === ".knowstr"
    ? path.dirname(profileDir)
    : profileDir;
}

function parseRelayList(
  relays: RawRelay[] | undefined,
  source: string
): Relays {
  const normalized = (relays || []).map((relay) =>
    typeof relay === "string"
      ? { url: relay, read: true, write: true }
      : {
          url: relay.url,
          read: relay.read ?? true,
          write: relay.write ?? true,
        }
  );
  const sanitized = sanitizeRelays(normalized);
  if (sanitized.length !== normalized.length) {
    throw new Error(`Invalid relay URL in ${source}`);
  }
  return sanitized;
}

function parseBootstrapRelays(
  relays: string[] | undefined,
  source: string
): Relays {
  const normalized = (relays || []).map((url) => ({
    url,
    read: true,
    write: true,
  }));
  const sanitized = sanitizeRelays(normalized);
  if (sanitized.length !== normalized.length) {
    throw new Error(`Invalid relay URL in ${source}`);
  }
  return sanitized;
}

function parsePubkey(value: string | undefined): PublicKey {
  const decoded = decodePublicKeyInputSync(value);
  if (!decoded) {
    throw new Error(
      "profile.json must include a valid pubkey (hex, npub, or nprofile)"
    );
  }
  return decoded;
}

export function loadCliProfile({
  cwd = process.cwd(),
  env = process.env,
  configPath,
}: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
} = {}): LoadedCliProfile {
  const resolvedConfigPath = configPath
    ? resolveAbsolute(cwd, configPath)
    : path.join(resolveKnowstrHome(cwd, env), "profile.json");
  const agentRoot = getAgentRoot(resolvedConfigPath);
  const knowstrHome = env.KNOWSTR_HOME
    ? resolveKnowstrHome(cwd, env)
    : path.join(agentRoot, ".knowstr");

  if (!fs.existsSync(resolvedConfigPath)) {
    throw new Error(`Missing Knowstr profile: ${resolvedConfigPath}`);
  }

  const raw = fs.readFileSync(resolvedConfigPath, "utf8");
  const profile = JSON.parse(raw) as RawProfile;

  return {
    pubkey: parsePubkey(profile.pubkey),
    readAs: parsePubkey(profile.read_as || profile.pubkey),
    workspaceDir: resolveAbsolute(agentRoot, profile.workspace_dir || "."),
    bootstrapRelays: parseBootstrapRelays(
      profile.bootstrap_relays,
      `${resolvedConfigPath}#bootstrap_relays`
    ),
    relays: parseRelayList(profile.relays, `${resolvedConfigPath}#relays`),
    ...(profile.nsec_file
      ? {
          nsecFile: resolveAbsolute(agentRoot, profile.nsec_file),
        }
      : {}),
    configPath: resolvedConfigPath,
    knowstrHome,
    agentRoot,
  };
}
