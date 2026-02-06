import React from "react";
import { Dropdown } from "react-bootstrap";
import { useMediaQuery } from "react-responsive";
import { useData } from "../DataContext";
import { IS_MOBILE } from "./responsive";
import { PublishingStatusContent } from "../commons/PublishingStatus";
import { getWriteRelays } from "../relays";
import { useUserRelayContext } from "../UserRelayContext";

function getStatusInfo(publishEventsStatus: EventState): {
  text: string;
  segmentClass: string;
} {
  const { isLoading, results, queueStatus } = publishEventsStatus;
  const pendingCount = queueStatus?.pendingCount ?? 0;
  const isFlushing = queueStatus?.flushing ?? false;

  const hasErrors = results.some((r) =>
    r.results.some((s) => s.status === "rejected")
  );

  const errorCount = hasErrors
    ? results.count((r) => r.results.some((s) => s.status === "rejected"))
    : 0;

  if (isFlushing || isLoading) {
    return {
      text: `syncing ${pendingCount > 0 ? pendingCount : ""}...`,
      segmentClass: "status-segment-warning",
    };
  }

  if (pendingCount > 0 && hasErrors) {
    return {
      text: `${pendingCount} pending · ${errorCount} error`,
      segmentClass: "status-segment-error",
    };
  }

  if (pendingCount > 0) {
    return {
      text: `${pendingCount} pending`,
      segmentClass: "status-segment-warning",
    };
  }

  if (hasErrors) {
    return { text: "error", segmentClass: "status-segment-error" };
  }

  return { text: "synced", segmentClass: "status-segment-dark" };
}

export function PublishingStatusWrapper(): JSX.Element {
  const isMobile = useMediaQuery(IS_MOBILE);
  const { publishEventsStatus } = useData();
  const { userRelays } = useUserRelayContext();
  const writeRelayUrls = getWriteRelays(userRelays).map((r) => r.url);
  const { text, segmentClass } = getStatusInfo(publishEventsStatus);

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
