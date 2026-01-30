import React from "react";
import { Dropdown } from "react-bootstrap";
import { useMediaQuery } from "react-responsive";
import { useData } from "../DataContext";
import { IS_MOBILE } from "./responsive";
import { usePlanner } from "../planner";
import { PublishingStatusContent } from "../commons/PublishingStatus";

function getStatusInfo(publishEventsStatus: PublishEvents<unknown>): {
  text: string;
  segmentClass: string;
} {
  const { isLoading, results } = publishEventsStatus;

  if (isLoading) {
    return { text: "syncing...", segmentClass: "status-segment-warning" };
  }

  const hasErrors = results.some((r) =>
    r.results.some((s) => s.status === "rejected")
  );

  if (hasErrors) {
    return { text: "error", segmentClass: "status-segment-error" };
  }

  return { text: "synced", segmentClass: "" };
}

export function PublishingStatusWrapper(): JSX.Element {
  const isMobile = useMediaQuery(IS_MOBILE);
  const { publishEventsStatus } = useData();
  const { republishEvents } = usePlanner();
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
          republishEvents={republishEvents}
        />
      </Dropdown.Menu>
    </Dropdown>
  );
}
