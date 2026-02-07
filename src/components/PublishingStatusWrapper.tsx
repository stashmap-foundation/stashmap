import React from "react";
import { Dropdown } from "react-bootstrap";
import { useMediaQuery } from "react-responsive";
import { useData } from "../DataContext";
import { IS_MOBILE } from "./responsive";
import { PublishingStatusContent } from "../commons/PublishingStatus";
import { getWriteRelays } from "../relays";
import { useUserRelayContext } from "../UserRelayContext";

function getRelayRatio(
  results: PublishResultsEventMap,
  writeRelayUrls: string[]
): { succeeded: number; total: number } | undefined {
  if (results.isEmpty() || writeRelayUrls.length === 0) {
    return undefined;
  }
  const succeeded = writeRelayUrls.filter(
    (url) => !results.some((r) => r.results.get(url)?.status === "rejected")
  ).length;
  return { succeeded, total: writeRelayUrls.length };
}

function getStatusInfo(
  publishEventsStatus: EventState,
  writeRelayUrls: string[]
): {
  text: string;
  segmentClass: string;
} {
  const { isLoading, results, queueStatus } = publishEventsStatus;
  const pendingCount = queueStatus?.pendingCount ?? 0;
  const isFlushing = queueStatus?.flushing ?? false;
  const ratio = getRelayRatio(results, writeRelayUrls);

  if (isFlushing || isLoading) {
    return {
      text: `syncing ${pendingCount > 0 ? pendingCount : ""}...`,
      segmentClass: "status-segment-warning",
    };
  }

  if (pendingCount > 0 && ratio && ratio.succeeded < ratio.total) {
    return {
      text: `${pendingCount} pending · ${ratio.succeeded}/${ratio.total} relays`,
      segmentClass: "status-segment-warning",
    };
  }

  if (pendingCount > 0) {
    return {
      text: `${pendingCount} pending`,
      segmentClass: "status-segment-warning",
    };
  }

  if (ratio && ratio.succeeded === 0) {
    return { text: "error", segmentClass: "status-segment-error" };
  }

  if (ratio && ratio.succeeded < ratio.total) {
    return {
      text: `${ratio.succeeded}/${ratio.total} relays`,
      segmentClass: "status-segment-warning",
    };
  }

  return { text: "synced", segmentClass: "status-segment-dark" };
}

export function PublishingStatusWrapper(): JSX.Element {
  const isMobile = useMediaQuery(IS_MOBILE);
  const { publishEventsStatus } = useData();
  const { userRelays } = useUserRelayContext();
  const writeRelayUrls = getWriteRelays(userRelays).map((r) => r.url);
  const { text, segmentClass } = getStatusInfo(
    publishEventsStatus,
    writeRelayUrls
  );

  return (
    <Dropdown className="status-dropdown">
      <Dropdown.Toggle
        as="div"
        className={`status-segment ${segmentClass}`}
        aria-label="publishing status"
        role="button"
      >
        {text}
      </Dropdown.Toggle>
      <Dropdown.Menu style={isMobile ? { width: "100vw" } : { width: "30rem" }}>
        <PublishingStatusContent
          publishEventsStatus={publishEventsStatus}
          writeRelayUrls={writeRelayUrls}
          queueStatus={publishEventsStatus.queueStatus}
        />
      </Dropdown.Menu>
    </Dropdown>
  );
}
