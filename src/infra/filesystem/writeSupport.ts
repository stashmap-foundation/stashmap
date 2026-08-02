import fs from "fs/promises";
import { hexToBytes } from "@noble/hashes/utils";
import { Event, UnsignedEvent, finalizeEvent, getPublicKey } from "nostr-tools";
import { convertInputToPrivateKey } from "../../nostrKey";
import { decodePublicKeyInputSync } from "../nostr/publicKeys";

export type WriteProfile = {
  pubkey: PublicKey;
  nsecFile: string;
};

export type WritePublisher = {
  publishEvent: (
    relayUrls: string[],
    event: Event
  ) => Promise<PublishResultsOfEvent>;
};

export async function loadWriteSecretKey(
  profile: WriteProfile
): Promise<Uint8Array> {
  const raw = await fs.readFile(profile.nsecFile, "utf8");
  const privateKey = convertInputToPrivateKey(raw);
  if (!privateKey) {
    throw new Error(`Invalid private key in ${profile.nsecFile}`);
  }

  const secretKey = hexToBytes(privateKey);
  const derivedPubkey = decodePublicKeyInputSync(getPublicKey(secretKey));
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
