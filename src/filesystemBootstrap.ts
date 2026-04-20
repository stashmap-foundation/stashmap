import { UnsignedEvent } from "nostr-tools";
import { getDesktopBridge } from "./runtimeEnvironment";

// eslint-disable-next-line functional/no-let
let stashedEvents: UnsignedEvent[] = [];
// eslint-disable-next-line functional/no-let
let filesystemModeActive = false;

export async function loadFilesystemWorkspaceBeforeReact(): Promise<void> {
  const desktop = getDesktopBridge();
  if (!desktop?.workspace) {
    return;
  }
  try {
    const result = await desktop.workspace.load();
    window.localStorage.setItem("publicKey", result.pubkey);
    // eslint-disable-next-line functional/immutable-data
    stashedEvents = result.events;
    // eslint-disable-next-line functional/immutable-data
    filesystemModeActive = true;
    // eslint-disable-next-line no-console
    console.log(
      `[filesystem] loaded ${result.events.length} events from ${result.workspaceDir} (pubkey: ${result.pubkey})`
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to load filesystem workspace", error);
  }
}

export function isFilesystemModeActive(): boolean {
  return filesystemModeActive;
}

export function consumeInitialWorkspaceEvents(): UnsignedEvent[] {
  const result = stashedEvents;
  // eslint-disable-next-line functional/immutable-data
  stashedEvents = [];
  return result;
}
