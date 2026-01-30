import React from "react";
import { Dropdown } from "react-bootstrap";
import { useMediaQuery } from "react-responsive";
import { useData } from "../DataContext";
import { IS_MOBILE } from "./responsive";
import { usePlanner } from "../planner";
import { PublishingStatusContent } from "../commons/PublishingStatus";

function getStatusText(publishEventsStatus: PublishEvents<unknown>): {
  text: string;
  className: string;
} {
  const { isLoading, results } = publishEventsStatus;

  if (isLoading) {
    return { text: "syncing...", className: "text-warning" };
  }

  if (results.size === 0) {
    return { text: "synced", className: "text-muted" };
  }

  const hasErrors = results.some((r) =>
    r.results.some((s) => s.status === "rejected")
  );

  if (hasErrors) {
    return { text: "error", className: "text-danger" };
  }

  return { text: "synced", className: "text-success" };
}

export function PublishingStatusWrapper(): JSX.Element {
  const isMobile = useMediaQuery(IS_MOBILE);
  const { publishEventsStatus } = useData();
  const { republishEvents } = usePlanner();
  const { text, className } = getStatusText(publishEventsStatus);

  return (
    <Dropdown className="status-dropdown">
      <Dropdown.Toggle
        as="button"
        className={`status-btn ${className}`}
        aria-label="publishing status"
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
