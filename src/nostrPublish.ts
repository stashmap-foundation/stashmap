import { Event, SimplePool } from "nostr-tools";
import { Map } from "immutable";

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

  const withTimeout = (promise: Promise<unknown>): Promise<unknown> =>
    new Promise((resolve, reject): void => {
      const timeoutId = setTimeout(
        () => reject(new Error("Timeout")),
        timeoutMs
      );
      promise.then(
        (value) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      );
    });
  const results = await Promise.allSettled(
    relayPool.publish(writeRelayUrls, event).map(withTimeout)
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
