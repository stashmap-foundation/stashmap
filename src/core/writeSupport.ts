import fs from "fs/promises";
import { hexToBytes } from "@noble/hashes/utils";
import { Event, UnsignedEvent, finalizeEvent, getPublicKey } from "nostr-tools";
import { convertInputToPrivateKey } from "../nostrKey";
import { getWriteRelays, relaysFromUrls, uniqueRelayUrls } from "../relayUtils";

export type WriteProfile = {
  pubkey: PublicKey;
  relays: Relays;
  nsecFile?: string;
};

export type WritePublisher = {
  publishEvent: (
    relayUrls: string[],
    event: Event
  ) => Promise<PublishResultsOfEvent>;
};

export function resolveWriteRelayUrls(
  profile: WriteProfile,
  relayUrls: string[] | undefined
): string[] {
  const explicitRelays = relaysFromUrls(relayUrls || []);
  if (explicitRelays.length > 0) {
    return uniqueRelayUrls(explicitRelays);
  }

  const configuredRelayUrls = uniqueRelayUrls(getWriteRelays(profile.relays));
  if (configuredRelayUrls.length === 0) {
    throw new Error(
      "No write relays configured. Provide --relay or write-enabled relays in .knowstr/profile.json"
    );
  }
  return configuredRelayUrls;
}

export async function loadWriteSecretKey(
  profile: WriteProfile
): Promise<Uint8Array> {
  if (!profile.nsecFile) {
    throw new Error("profile.json must include nsec_file for write commands");
  }

  const raw = await fs.readFile(profile.nsecFile, "utf8");
  const privateKey = convertInputToPrivateKey(raw);
  if (!privateKey) {
    throw new Error(`Invalid private key in ${profile.nsecFile}`);
  }

  const secretKey = hexToBytes(privateKey);
  const derivedPubkey = getPublicKey(secretKey) as PublicKey;
  if (derivedPubkey !== profile.pubkey) {
    throw new Error("nsec_file does not match profile pubkey");
  }
  return secretKey;
}

export function signUnsignedEvents(
  secretKey: Uint8Array,
  unsignedEvents: UnsignedEvent[]
): Event[] {
  return unsignedEvents.map((unsignedEvent) =>
    finalizeEvent(unsignedEvent, secretKey)
  );
}

export async function publishSignedEvents(
  publisher: WritePublisher,
  relayUrls: string[],
  events: Event[]
): Promise<{
  relay_urls: string[];
  event_ids: string[];
  publish_results: Record<string, Record<string, PublishStatus>>;
}> {
  const results = await events.reduce(
    async (previous, event) => {
      const settled = await previous;
      const publishResult = await publisher.publishEvent(relayUrls, event);
      return [
        ...settled,
        {
          event,
          publishResult,
        },
      ];
    },
    Promise.resolve(
      [] as Array<{
        event: Event;
        publishResult: PublishResultsOfEvent;
      }>
    )
  );

  return {
    relay_urls: relayUrls,
    event_ids: results.map(({ event }) => event.id),
    publish_results: results.reduce(
      (acc, { event, publishResult }) => ({
        ...acc,
        [event.id]: publishResult.results.toObject(),
      }),
      {} as Record<string, Record<string, PublishStatus>>
    ),
  };
}

export async function publishUnsignedEvents(
  publisher: WritePublisher,
  secretKey: Uint8Array,
  relayUrls: string[],
  unsignedEvents: UnsignedEvent[]
): Promise<{
  relay_urls: string[];
  event_ids: string[];
  publish_results: Record<string, Record<string, PublishStatus>>;
}> {
  return publishSignedEvents(
    publisher,
    relayUrls,
    signUnsignedEvents(secretKey, unsignedEvents)
  );
}
