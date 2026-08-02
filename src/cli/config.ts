import fs from "fs";
import path from "path";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { convertInputToPrivateKey } from "../nostrKey";
import { decodePublicKeyInputSync } from "../infra/nostr/publicKeys";
import {
  WorkspaceConfig,
  filesystemProfileFromWorkspaceConfig,
  normalizeWorkspaceConfig,
  parseFilesystemProfile,
} from "../workspaceConfig";

export type LoadedCliProfile = {
  workspaceConfig: WorkspaceConfig;
  workspaceDir: string;
  pubkey: PublicKey | undefined;
  nsecFile: string | undefined;
  configPath: string;
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

function loadPubkey(nsecPath: string): PublicKey {
  if (!fs.existsSync(nsecPath)) {
    throw new Error(`Missing private key: ${nsecPath}`);
  }
  const privateKey = convertInputToPrivateKey(
    fs.readFileSync(nsecPath, "utf8")
  );
  if (!privateKey) {
    throw new Error(`Invalid private key in ${nsecPath}`);
  }
  const pubkey = decodePublicKeyInputSync(getPublicKey(hexToBytes(privateKey)));
  if (!pubkey) {
    throw new Error(`Invalid derived public key for ${nsecPath}`);
  }
  return pubkey;
}

export function writeCliWorkspaceConfig(
  workspaceDir: string,
  config: WorkspaceConfig
): void {
  const normalized = normalizeWorkspaceConfig(config);
  if (normalized.storageRelays.length > 0) {
    throw new Error("Filesystem workspaces cannot configure storage relays");
  }
  const knowstrDir = path.join(workspaceDir, ".knowstr");
  const profilePath = path.join(knowstrDir, "profile.json");
  if (normalized.roomRelays.length === 0) {
    if (fs.existsSync(profilePath)) {
      fs.unlinkSync(profilePath);
    }
    return;
  }

  const existing = fs.existsSync(profilePath)
    ? parseFilesystemProfile(JSON.parse(fs.readFileSync(profilePath, "utf8")))
        .profile
    : undefined;
  const relativeNsecFile = existing?.nsec_file ?? "./.knowstr/me.nsec";
  const nsecPath = resolveAbsolute(workspaceDir, relativeNsecFile);
  fs.mkdirSync(path.dirname(nsecPath), { recursive: true });
  if (!fs.existsSync(nsecPath)) {
    fs.writeFileSync(nsecPath, `${nip19.nsecEncode(generateSecretKey())}\n`, {
      mode: 0o600,
    });
  }
  loadPubkey(nsecPath);

  const profile = filesystemProfileFromWorkspaceConfig(
    normalized,
    relativeNsecFile
  );
  fs.mkdirSync(knowstrDir, { recursive: true });
  const temporaryPath = `${profilePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(profile, null, 2)}\n`);
  fs.renameSync(temporaryPath, profilePath);
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
  const workspaceDir = getAgentRoot(resolvedConfigPath);

  if (!fs.existsSync(resolvedConfigPath)) {
    return {
      workspaceConfig: { storageRelays: [], roomRelays: [] },
      workspaceDir,
      pubkey: undefined,
      nsecFile: undefined,
      configPath: resolvedConfigPath,
    };
  }

  const parsed = parseFilesystemProfile(
    JSON.parse(fs.readFileSync(resolvedConfigPath, "utf8"))
  );
  const resolvedNsecFile = resolveAbsolute(
    workspaceDir,
    parsed.profile.nsec_file
  );
  const pubkey = loadPubkey(resolvedNsecFile);

  return {
    workspaceConfig: parsed.config,
    workspaceDir,
    pubkey,
    nsecFile: resolvedNsecFile,
    configPath: resolvedConfigPath,
  };
}
