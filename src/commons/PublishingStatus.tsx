import React from "react";
import { Map } from "immutable";
import { Event } from "nostr-tools";
import { QueueStatus } from "../PublishQueue";

export function mergePublishResultsOfEvents(
  existing: PublishResultsEventMap,
  newResults: PublishResultsEventMap
): PublishResultsEventMap {
  return newResults.reduce((rdx, results, eventID) => {
    const existingResults = rdx.get(eventID);
    if (!existingResults) {
      return rdx.set(eventID, results);
    }
    return rdx.set(eventID, {
      ...existingResults,
      results: existingResults.results.merge(results.results),
    });
  }, existing);
}

function transformPublishResults(
  results: PublishResultsEventMap
): PublishResultsRelayMap {
  return results.reduce((reducer, resultsOfEvents, eventId) => {
    return resultsOfEvents.results.reduce((rdx, publishStatus, relayUrl) => {
      return rdx.set(
        relayUrl,
        (rdx.get(relayUrl) || Map<string, Event & PublishStatus>()).set(
          eventId,
          { ...resultsOfEvents.event, ...publishStatus }
        )
      );
    }, reducer);
  }, Map<string, Map<string, Event & PublishStatus>>());
}

function getStatusCount(status: PublishResultsOfRelay, type: string): number {
  return status.filter((s) => s.status === type).size;
}

function getLastRejectedReason(
  status: PublishResultsOfRelay
): string | undefined {
  const lastRejected = status
    .valueSeq()
    .reverse()
    .find((s) => s.status === "rejected");
  return lastRejected ? lastRejected.reason : undefined;
}

function RelayRow({
  relayUrl,
  status,
  pendingCount,
  backoffSeconds,
}: {
  relayUrl: string;
  status?: PublishResultsOfRelay;
  pendingCount: number;
  backoffSeconds?: number;
}): JSX.Element {
  const relayName = relayUrl.replace("wss://", "").replace("ws://", "");
  const numberFulfilled = status ? getStatusCount(status, "fulfilled") : 0;
  const numberRejected = status ? getStatusCount(status, "rejected") : 0;
  const synced = numberFulfilled + numberRejected;
  const total = synced + pendingCount;
  const lastError = status ? getLastRejectedReason(status) : undefined;

  return (
    <div className="publish-relay-row">
      <div className="publish-relay-info">
        <span className="publish-relay-name">{relayName}</span>
        {total > 0 && (
          <span className="publish-relay-stats">
            {numberRejected > 0 ? (
              <span className="text-danger">
                {`${numberFulfilled}/${total}`}
              </span>
            ) : pendingCount > 0 ? (
              <span className="text-warning">
                {`${numberFulfilled}/${total}`}
              </span>
            ) : (
              <span className="text-success">
                {`${numberFulfilled}/${total}`}
              </span>
            )}
          </span>
        )}
        {lastError && (
          <span className="publish-relay-error">{String(lastError)}</span>
        )}
        {backoffSeconds !== undefined && backoffSeconds > 0 && (
          <span className="publish-relay-backoff">
            backed off, retry in {backoffSeconds}s
          </span>
        )}
      </div>
    </div>
  );
}

type PublishingStatusContentProps = {
  publishEventsStatus: { readonly results: PublishResultsEventMap };
  writeRelayUrls: ReadonlyArray<string>;
  queueStatus?: QueueStatus;
};

const getBackoffSeconds = (
  queueStatus: QueueStatus | undefined,
  relayUrl: string
): number | undefined => {
  if (!queueStatus) return undefined;
  const entry = queueStatus.backedOffRelays.find((r) => r.url === relayUrl);
  if (!entry) return undefined;
  const secs = Math.ceil((entry.retryAfter - Date.now()) / 1000);
  return secs > 0 ? secs : undefined;
};

export function PublishingStatusContent({
  publishEventsStatus,
  writeRelayUrls,
  queueStatus,
}: PublishingStatusContentProps): JSX.Element {
  const pendingCount = queueStatus?.pendingCount ?? 0;
  const publishResultsRelayMap = transformPublishResults(
    publishEventsStatus.results
  );

  return (
    <div className="publish-status-content">
      {pendingCount > 0 && (
        <div className="publish-pending-info">
          {pendingCount} event{pendingCount !== 1 ? "s" : ""} pending
        </div>
      )}
      {writeRelayUrls.map((relayUrl) => (
        <RelayRow
          key={relayUrl}
          relayUrl={relayUrl}
          status={publishResultsRelayMap.get(relayUrl)}
          pendingCount={pendingCount}
          backoffSeconds={getBackoffSeconds(queueStatus, relayUrl)}
        />
      ))}
    </div>
  );
}
