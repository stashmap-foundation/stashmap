import { Event, EventTemplate, SimplePool, VerifiedEvent } from "nostr-tools";
import { List, Map } from "immutable";
import { Plan } from "./planner";
import { FinalizeEvent } from "./Apis";
import {
  isUserLoggedIn,
  isUserLoggedInWithExtension,
} from "./NostrAuthContext";
import { applyWriteRelayConfig } from "./relays";

// Timeout in ms for pulish() on a relay
export const PUBLISH_TIMEOUT = 5000;

async function publishEvent(
  relayPool: SimplePool,
  event: Event,
  writeRelayUrls: Array<string>
): Promise<PublishResultsOfEvent> {
  if (writeRelayUrls.length === 0) {
    throw new Error("No relays to publish on");
  }
  const timeout = (ms: number): Promise<unknown> =>
    new Promise((_, reject): void => {
      setTimeout(() => reject(new Error("Timeout")), ms);
    });
  const results = await Promise.allSettled(
    relayPool.publish(writeRelayUrls, event).map((promise) => {
      return Promise.race([promise, timeout(PUBLISH_TIMEOUT)]);
    })
  );
  // If one message can be sent publish is a success,
  // otherwise it's a failure
  const failures = results.filter((res) => res.status === "rejected");
  if (failures.length === writeRelayUrls.length) {
    // Reject only when all have failed
    // eslint-disable-next-line no-console
    failures.map((failure) => console.error(failure, event));
    throw new Error(
      `Failed to publish on: ${writeRelayUrls.map((url) => url).join(",")}`
    );
  }
  return {
    event,
    results: writeRelayUrls.reduce((rdx, url, index) => {
      const res = results[index];
      return rdx.set(url, {
        status: res.status,
        reason: res.status === "rejected" ? (res.reason as string) : undefined,
      });
    }, Map<string, PublishStatus>()),
  };
}

export async function execute({
  plan,
  relayPool,
  finalizeEvent,
}: {
  plan: Plan;
  relayPool: SimplePool;
  finalizeEvent: FinalizeEvent;
}): Promise<PublishResultsEventMap> {
  if (plan.publishEvents.size === 0) {
    // eslint-disable-next-line no-console
    // TODO: reenable this
    // console.warn("Won't execute Noop plan");
    return Map();
  }
  const { user } = plan;

  if (!isUserLoggedIn(user)) {
    return Map();
  }

  const signEventWithExtension = async (
    event: EventTemplate
  ): Promise<Event> => {
    try {
      return window.nostr.signEvent(event);
      // eslint-disable-next-line no-empty
    } catch {
      throw new Error("Failed to sign event with extension");
    }
  };
  const finalizedEvents = isUserLoggedInWithExtension(user)
    ? List<{ event: VerifiedEvent; writeRelayConf?: WriteRelayConf }>(
        await Promise.all(
          plan.publishEvents.map(async (e) => {
            const { writeRelayConf } = e;
            // eslint-disable-next-line functional/immutable-data
            delete e.writeRelayConf;
            const signedEvent = await signEventWithExtension(e);
            return { event: signedEvent as VerifiedEvent, writeRelayConf };
          })
        )
      )
    : plan.publishEvents.map((e) => {
        const { writeRelayConf } = e;
        // eslint-disable-next-line functional/immutable-data
        delete e.writeRelayConf;
        const event = finalizeEvent(
          e,
          (user as KeyPair).privateKey
        ) as VerifiedEvent;
        return { event, writeRelayConf };
      });

  const results = await Promise.all(
    finalizedEvents.toArray().map(({ event, writeRelayConf }) => {
      const writeRelayUrls = applyWriteRelayConfig(
        plan.relays.defaultRelays,
        plan.relays.userRelays,
        plan.relays.contactsRelays,
        writeRelayConf
      );
      return publishEvent(
        relayPool,
        event,
        Array.from(new Set(writeRelayUrls.map((r: Relay) => r.url)))
      );
    })
  );

  return results.reduce((rdx, result, index) => {
    const eventId = finalizedEvents.get(index)?.event.id;
    return eventId ? rdx.set(eventId, result) : rdx;
  }, Map<string, PublishResultsOfEvent>());
}

export async function republishEvents({
  events,
  relayPool,
  writeRelayUrl,
}: {
  events: List<Event>;
  relayPool: SimplePool;
  writeRelayUrl: string;
}): Promise<PublishResultsEventMap> {
  if (events.size === 0) {
    // eslint-disable-next-line no-console
    console.warn("Won't republish noop events");
    return Map();
  }

  const results = await Promise.all(
    events
      .toArray()
      .map((event) => publishEvent(relayPool, event, [writeRelayUrl]))
  );

  return results.reduce((rdx, result, index) => {
    const eventId = events.get(index)?.id;
    return eventId ? rdx.set(eventId, result) : rdx;
  }, Map<string, PublishResultsOfEvent>());
}
