import React from "react";
import { Map } from "immutable";
import { Event } from "nostr-tools";
import { QueueStatus } from "../infra/nostr/cache/PublishQueue";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_DEPOSIT,
  KIND_KNOWLEDGE_DOCUMENT,
  KIND_SETTINGS,
} from "../nostr";

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
  results: PublishResultsEventMap,
  kinds: ReadonlyArray<number>
): PublishResultsRelayMap {
  return results
    .filter(({ event }) => kinds.includes(event.kind))
    .reduce((reducer, resultsOfEvents, eventId) => {
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

function StatsDisplay({
  numberFulfilled,
  total,
  numberRejected,
  pendingCount,
}: {
  numberFulfilled: number;
  total: number;
  numberRejected: number;
  pendingCount: number;
}): JSX.Element {
  const text = `${numberFulfilled}/${total}`;
  if (numberRejected > 0) {
    return <span className="text-danger">{text}</span>;
  }
  if (pendingCount > 0) {
    return <span className="text-warning">{text}</span>;
  }
  return <span className="text-success">{text}</span>;
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
  const total = numberFulfilled + pendingCount;
  const lastError = status ? getLastRejectedReason(status) : undefined;

  return (
    <div className="publish-relay-row">
      <div className="publish-relay-info">
        <span className="publish-relay-name">{relayName}</span>
        {total > 0 && (
          <span className="publish-relay-stats">
            <StatsDisplay
              numberFulfilled={numberFulfilled}
              total={total}
              numberRejected={numberRejected}
              pendingCount={pendingCount}
            />
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

const getPendingForRelay = (
  queueStatus: QueueStatus | undefined,
  relayUrl: string
): number => {
  if (!queueStatus || queueStatus.pendingCount === 0) return 0;
  return (
    queueStatus.pendingPerRelay.find((entry) => entry.url === relayUrl)
      ?.count ?? 0
  );
};

function RelaySection({
  title,
  relayUrls,
  publishEventsStatus,
  eventKinds,
  queueStatus,
}: {
  title: string;
  relayUrls: ReadonlyArray<string>;
  publishEventsStatus: { readonly results: PublishResultsEventMap };
  eventKinds: ReadonlyArray<number>;
  queueStatus: QueueStatus | undefined;
}): JSX.Element | null {
  if (relayUrls.length === 0) return null;
  const publishResultsRelayMap = transformPublishResults(
    publishEventsStatus.results,
    eventKinds
  );
  return (
    <section aria-label={title}>
      <div className="relay-section-header">{title}</div>
      {relayUrls.map((relayUrl) => (
        <RelayRow
          key={relayUrl}
          relayUrl={relayUrl}
          status={publishResultsRelayMap.get(relayUrl)}
          pendingCount={getPendingForRelay(queueStatus, relayUrl)}
          backoffSeconds={getBackoffSeconds(queueStatus, relayUrl)}
        />
      ))}
    </section>
  );
}

export function PublishingStatusContent({
  publishEventsStatus,
  storageRelayUrls,
  roomRelayUrls,
  configurationRelayUrls,
  queueStatus,
}: {
  publishEventsStatus: { readonly results: PublishResultsEventMap };
  storageRelayUrls: ReadonlyArray<string>;
  roomRelayUrls: ReadonlyArray<string>;
  configurationRelayUrls: ReadonlyArray<string>;
  queueStatus: QueueStatus | undefined;
}): JSX.Element {
  const pendingCount = queueStatus?.pendingCount ?? 0;

  return (
    <div className="publish-status-content">
      {pendingCount > 0 && (
        <div className="publish-pending-info">
          {pendingCount} event{pendingCount !== 1 ? "s" : ""} pending
        </div>
      )}
      <RelaySection
        title="Storage relays"
        relayUrls={storageRelayUrls}
        publishEventsStatus={publishEventsStatus}
        eventKinds={[KIND_KNOWLEDGE_DOCUMENT, KIND_DELETE]}
        queueStatus={queueStatus}
      />
      <RelaySection
        title="Room relays"
        relayUrls={roomRelayUrls}
        publishEventsStatus={publishEventsStatus}
        eventKinds={[KIND_KNOWLEDGE_DEPOSIT]}
        queueStatus={queueStatus}
      />
      <RelaySection
        title="Configuration relays"
        relayUrls={configurationRelayUrls}
        publishEventsStatus={publishEventsStatus}
        eventKinds={[KIND_SETTINGS]}
        queueStatus={queueStatus}
      />
    </div>
  );
}
