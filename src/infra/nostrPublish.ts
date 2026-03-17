import { Event, SimplePool } from "nostr-tools";
import { Map } from "immutable";
import type { PublishResultsOfEvent, PublishStatus } from "./publishTypes";

export const PUBLISH_TIMEOUT = 5000;

type PublishPool = Pick<SimplePool, "publish">;

export async function publishEventToRelays(
  relayPool: PublishPool,
  event: Event,
  writeRelayUrls: string[],
  timeoutMs: number = PUBLISH_TIMEOUT
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
      return Promise.race([promise, timeout(timeoutMs)]);
    })
  );

  const failures = results.filter((res) => res.status === "rejected");
  if (failures.length === writeRelayUrls.length) {
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
