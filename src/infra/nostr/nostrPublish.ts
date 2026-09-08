import { Event } from "nostr-tools";
import { Map } from "immutable";
import { Backend } from "../../BackendContext";

export const PUBLISH_TIMEOUT = 5000;
export const TIMEOUT_REASON = "Timeout";

export type PublishBackend = Pick<Backend, "publish">;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function statusOf(result: PromiseSettledResult<unknown>): PublishStatus {
  return result.status === "fulfilled"
    ? { status: "fulfilled" }
    : { status: "rejected", reason: errorMessage(result.reason) };
}

export async function publishStatuses(
  backend: PublishBackend,
  event: Event,
  writeRelayUrls: ReadonlyArray<string>,
  timeoutMs: number
): Promise<Array<[string, PublishStatus]>> {
  if (writeRelayUrls.length === 0) {
    return [];
  }
  const withTimeout = (promise: Promise<unknown>): Promise<unknown> =>
    new Promise((resolve, reject): void => {
      const timeoutId = setTimeout(
        () => reject(new Error(TIMEOUT_REASON)),
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
    backend.publish([...writeRelayUrls], event).map(withTimeout)
  );
  return writeRelayUrls.map((url, index) => [url, statusOf(results[index])]);
}

export async function publishEventToRelays(
  backend: PublishBackend,
  event: Event,
  writeRelayUrls: string[],
  timeoutMs: number = PUBLISH_TIMEOUT
): Promise<PublishResultsOfEvent> {
  if (writeRelayUrls.length === 0) {
    throw new Error("No relays to publish on");
  }
  const statuses = await publishStatuses(
    backend,
    event,
    writeRelayUrls,
    timeoutMs
  );
  const rejected = statuses.filter(
    ([, status]) => status.status === "rejected"
  );
  if (rejected.length === writeRelayUrls.length) {
    throw new Error(
      `Failed to publish on: ${rejected
        .map(([url, status]) => `${url} (${status.reason})`)
        .join(", ")}`
    );
  }

  return { event, results: Map(statuses) };
}
