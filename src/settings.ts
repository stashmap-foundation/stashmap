import { UnsignedEvent } from "nostr-tools";
import { List } from "immutable";
import { getMostRecentReplacableEvent } from "./commons/useNostrQuery";
import { KIND_SETTINGS } from "./nostr";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function settingsFromEvent(event: UnsignedEvent): Settings {
  return {};
}

export const DEFAULT_SETTINGS: Settings = {};

export function findSettings(events: List<UnsignedEvent>): Settings {
  const settingsEvent = getMostRecentReplacableEvent(
    events.filter((e) => e.kind === KIND_SETTINGS)
  );
  if (!settingsEvent) {
    return DEFAULT_SETTINGS;
  }
  return settingsFromEvent(settingsEvent);
}
