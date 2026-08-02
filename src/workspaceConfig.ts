import { bytesToHex } from "@noble/hashes/utils";
import { Event, nip44, UnsignedEvent, verifyEvent } from "nostr-tools";
import { isUserLoggedInWithSeed } from "./NostrAuthContext";
import {
  CONFIG_RELAYS,
  DEFAULT_STORAGE_RELAYS,
  KIND_SETTINGS,
  newTimestamp,
} from "./nostr";

export type WorkspaceConfig = {
  storageRelays: string[];
  roomRelays: string[];
};

export function defaultWebWorkspaceConfig(): WorkspaceConfig {
  return { storageRelays: [...DEFAULT_STORAGE_RELAYS], roomRelays: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

export function normalizeWorkspaceRelayUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "ws:" || parsed.protocol === "wss:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeRelayHintUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const candidate = value.includes("://") ? value : `wss://${value}`;
  return normalizeWorkspaceRelayUrl(candidate);
}

function relayUrl(value: unknown, source: string): string {
  const normalized = normalizeWorkspaceRelayUrl(value);
  if (!normalized) {
    throw new Error(`${source} must be a valid ws or wss relay URL`);
  }
  return normalized;
}

function relayUrls(
  value: unknown,
  source: string,
  allowEmpty: boolean
): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(
      `${source} must be a ${
        allowEmpty ? "relay URL" : "non-empty relay URL"
      } array`
    );
  }
  return value.map((url, index) => relayUrl(url, `${source}[${index}]`));
}

function nsecFile(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("profile.json nsec_file must be a relative workspace path");
  }
  return value;
}

function sharedRelays(value: unknown): string[] {
  if (!isRecord(value) || !hasExactKeys(value, ["relays"])) {
    throw new Error("profile.json shared must contain only relays");
  }
  return relayUrls(value.relays, "profile.json shared.relays", false);
}

export function normalizeWorkspaceConfig(
  config: WorkspaceConfig
): WorkspaceConfig {
  return {
    storageRelays: relayUrls(
      config.storageRelays,
      "workspace storage relays",
      true
    ),
    roomRelays: relayUrls(config.roomRelays, "workspace room relays", true),
  };
}

export function normalizeWebWorkspaceConfig(
  config: WorkspaceConfig
): WorkspaceConfig {
  const normalized = normalizeWorkspaceConfig(config);
  if (normalized.storageRelays.length === 0) {
    throw new Error("Web workspaces require storage relays");
  }
  return normalized;
}

export function parseFilesystemProfile(value: unknown): {
  profile: { nsec_file: string; shared: { relays: string[] } };
  config: WorkspaceConfig;
} {
  if (!isRecord(value)) {
    throw new Error("profile.json must contain an object");
  }
  if (!hasExactKeys(value, ["nsec_file", "shared"])) {
    throw new Error("profile.json has unsupported fields");
  }
  const file = nsecFile(value.nsec_file);
  const roomRelays = sharedRelays(value.shared);
  return {
    profile: { nsec_file: file, shared: { relays: roomRelays } },
    config: { storageRelays: [], roomRelays },
  };
}

export function filesystemProfileFromWorkspaceConfig(
  config: WorkspaceConfig,
  file: string
): { nsec_file: string; shared: { relays: string[] } } {
  const normalized = normalizeWorkspaceConfig(config);
  if (normalized.storageRelays.length > 0) {
    throw new Error("Filesystem workspaces cannot configure storage relays");
  }
  if (normalized.roomRelays.length === 0) {
    throw new Error("Filesystem profiles require room relays");
  }
  return parseFilesystemProfile({
    nsec_file: nsecFile(file),
    shared: { relays: normalized.roomRelays },
  }).profile;
}

function conversationKey(user: KeyPair): Uint8Array {
  return nip44.v2.utils.getConversationKey(
    bytesToHex(user.privateKey),
    user.publicKey
  );
}

async function encryptToSelf(user: User, content: string): Promise<string> {
  if (isUserLoggedInWithSeed(user)) {
    return nip44.v2.encrypt(content, conversationKey(user));
  }
  if (!window.nostr?.nip44?.encrypt) {
    throw new Error("NIP-44 encryption permission unavailable");
  }
  return window.nostr.nip44.encrypt(user.publicKey, content);
}

async function decryptFromSelf(user: User, content: string): Promise<string> {
  if (isUserLoggedInWithSeed(user)) {
    return nip44.v2.decrypt(content, conversationKey(user));
  }
  if (!window.nostr?.nip44?.decrypt) {
    throw new Error("NIP-44 decryption permission unavailable");
  }
  return window.nostr.nip44.decrypt(user.publicKey, content);
}

function workspaceConfigPayload(config: WorkspaceConfig): string {
  return JSON.stringify({
    storage_relays: config.storageRelays,
    ...(config.roomRelays.length > 0
      ? { shared: { relays: config.roomRelays } }
      : {}),
  });
}

function parseWorkspaceConfigPayload(
  content: string
): WorkspaceConfig | undefined {
  try {
    const value: unknown = JSON.parse(content);
    if (
      !isRecord(value) ||
      (!hasExactKeys(value, ["storage_relays"]) &&
        !hasExactKeys(value, ["storage_relays", "shared"]))
    ) {
      return undefined;
    }
    const { shared } = value;
    if (
      shared !== undefined &&
      (!isRecord(shared) || !hasExactKeys(shared, ["relays"]))
    ) {
      return undefined;
    }
    return {
      storageRelays: relayUrls(
        value.storage_relays,
        "workspace storage relays",
        false
      ),
      roomRelays:
        shared === undefined
          ? []
          : relayUrls(shared.relays, "workspace room relays", false),
    };
  } catch {
    return undefined;
  }
}

export async function buildWorkspaceConfigEvent(
  user: User,
  config: WorkspaceConfig
): Promise<UnsignedEvent & EventAttachment> {
  const normalized = normalizeWebWorkspaceConfig(config);
  return {
    kind: KIND_SETTINGS,
    pubkey: user.publicKey,
    created_at: newTimestamp(),
    tags: [],
    content: await encryptToSelf(user, workspaceConfigPayload(normalized)),
    route: { kind: "configuration", relays: [...CONFIG_RELAYS] },
  };
}

export async function decryptWorkspaceConfigEvent(
  user: User,
  event: Event
): Promise<WorkspaceConfig | undefined> {
  if (
    event.kind !== KIND_SETTINGS ||
    event.pubkey !== user.publicKey ||
    event.tags.length !== 0 ||
    !verifyEvent(event)
  ) {
    return undefined;
  }
  try {
    return parseWorkspaceConfigPayload(
      await decryptFromSelf(user, event.content)
    );
  } catch {
    return undefined;
  }
}

export function selectLatestWorkspaceConfigEvent(
  events: readonly Event[]
): Event | undefined {
  return events.reduce<Event | undefined>((winner, event) => {
    if (!winner) {
      return event;
    }
    if (event.created_at !== winner.created_at) {
      return event.created_at > winner.created_at ? event : winner;
    }
    return event.id < winner.id ? event : winner;
  }, undefined);
}
