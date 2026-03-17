import type { EventTemplate, VerifiedEvent } from "nostr-tools";

export type FinalizeEvent = (
  t: EventTemplate,
  secretKey: Uint8Array
) => VerifiedEvent;
