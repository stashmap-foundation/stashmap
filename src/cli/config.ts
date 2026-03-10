import fs from "fs";
import path from "path";
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
  const normalized = (value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(
      "profile.json must include a valid 64-character hex pubkey"
    );
  }
  return normalized as PublicKey;
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
  const knowstrHome = resolveKnowstrHome(cwd, env);
  const resolvedConfigPath = configPath
    ? resolveAbsolute(cwd, configPath)
    : path.join(knowstrHome, "profile.json");

  if (!fs.existsSync(resolvedConfigPath)) {
    throw new Error(`Missing Knowstr profile: ${resolvedConfigPath}`);
  }

  const raw = fs.readFileSync(resolvedConfigPath, "utf8");
  const profile = JSON.parse(raw) as RawProfile;
  const agentRoot = getAgentRoot(resolvedConfigPath);

  return {
    pubkey: parsePubkey(profile.pubkey),
    workspaceDir: resolveAbsolute(
      agentRoot,
      profile.workspace_dir || "./workspace"
    ),
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
