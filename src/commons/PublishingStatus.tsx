import React from "react";
import { List, Map } from "immutable";
import { Event } from "nostr-tools";
import { LoadingSpinnerButton } from "./LoadingSpinnerButton";

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
  status,
  relayUrl,
  republishEvents,
}: {
  status: PublishResultsOfRelay;
  relayUrl: string;
  republishEvents: RepublishEvents;
}): JSX.Element {
  const numberFulfilled = getStatusCount(status, "fulfilled");
  const numberRejected = getStatusCount(status, "rejected");
  const total = numberFulfilled + numberRejected;
  const rejectedEvents = status
    .filter((s) => s.status === "rejected")
    .valueSeq()
    .toList() as List<Event>;
  const lastError = getLastRejectedReason(status);

  const relayName = relayUrl.replace("wss://", "").replace("ws://", "");

  return (
    <div className="publish-relay-row">
      <div className="publish-relay-info">
        <span className="publish-relay-name">{relayName}</span>
        <span className="publish-relay-stats">
          {numberRejected > 0 ? (
            <span className="text-danger">{numberFulfilled}/{total}</span>
          ) : (
            <span className="text-success">{numberFulfilled}/{total}</span>
          )}
        </span>
        {lastError && <span className="publish-relay-error">{String(lastError)}</span>}
      </div>
      {numberRejected > 0 && (
        <LoadingSpinnerButton
          className="publish-resend-btn"
          ariaLabel={`resend to ${relayName}`}
          onClick={() => republishEvents(rejectedEvents, relayUrl)}
        >
          resend
        </LoadingSpinnerButton>
      )}
    </div>
  );
}

type PublishingStatusProps<T = void> = {
  isMobile: boolean;
  publishEventsStatus: PublishEvents<T>;
  republishEvents: RepublishEvents;
};

export function PublishingStatusContent<T = void>({
  publishEventsStatus,
  republishEvents,
}: Omit<PublishingStatusProps<T>, "isMobile">): JSX.Element {
  if (publishEventsStatus.results.size === 0) {
    return (
      <div className="publish-status-content">
        <div className="publish-status-empty">All changes synced</div>
      </div>
    );
  }

  const publishResultsRelayMap = transformPublishResults(
    publishEventsStatus.results
  );

  return (
    <div className="publish-status-content">
      {publishResultsRelayMap
        .map((status, relayUrl) => (
          <RelayRow
            key={relayUrl}
            status={status}
            relayUrl={relayUrl}
            republishEvents={republishEvents}
          />
        ))
        .valueSeq()}
    </div>
  );
}

export function PublishingStatus<T = void>({
  publishEventsStatus,
  republishEvents,
}: Omit<PublishingStatusProps<T>, "isMobile">): JSX.Element | null {
  if (publishEventsStatus.results.size === 0) {
    return null;
  }

  return (
    <PublishingStatusContent
      publishEventsStatus={publishEventsStatus}
      republishEvents={republishEvents}
    />
  );
}
