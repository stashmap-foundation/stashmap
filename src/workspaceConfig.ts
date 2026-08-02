export type WorkspaceConfig = {
  storageRelays: string[];
  roomRelays: string[];
};

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

function relayUrl(value: unknown, source: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${source} must be a non-empty relay URL`);
  }
  const parsed = (() => {
    try {
      return new URL(value);
    } catch {
      throw new Error(`${source} must be a valid relay URL`);
    }
  })();
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error(`${source} must use ws or wss`);
  }
  return parsed.toString();
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
