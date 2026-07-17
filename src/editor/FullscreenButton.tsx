import React from "react";
import { useMediaQuery } from "react-responsive";
import { useDisplayText, buildPaneTarget, useRow } from "../rowModel";
import { useCurrentPane, useNavigatePane } from "../SplitPanesContext";
import { useData } from "../DataContext";
import { buildDocumentRouteUrl, buildNodeRouteUrl } from "../navigationUrl";
import { IS_MOBILE } from "./responsive";

export function FullscreenButton(): JSX.Element | null {
  const isMobile = useMediaQuery(IS_MOBILE);
  const data = useData();
  const displayText = useDisplayText();
  const navigatePane = useNavigatePane();
  const pane = useCurrentPane();
  const row = useRow();
  const isFullscreenNode = row.depth === 1;
  if (isFullscreenNode || isMobile) {
    return null;
  }

  const target = buildPaneTarget(data, row);

  const hrefWithoutCapability = (() => {
    if (target.documentId) {
      return buildDocumentRouteUrl(
        target.sourceId,
        target.documentId,
        target.scrollToId
      );
    }
    if (target.rootNodeId) {
      return buildNodeRouteUrl(target.rootNodeId, target.sourceId, {
        scrollToId: target.scrollToId,
        fallbackLabel: target.fallbackLabel,
      });
    }
    return undefined;
  })();
  const href =
    hrefWithoutCapability &&
    pane.storageKey !== undefined &&
    target.sourceId === pane.sourceId &&
    hrefWithoutCapability.startsWith("/storage/")
      ? `${hrefWithoutCapability}#key=${encodeURIComponent(pane.storageKey)}`
      : hrefWithoutCapability;

  if (!href) {
    return null;
  }

  const ariaLabel = displayText
    ? `open ${displayText} in fullscreen`
    : "open fullscreen";

  return (
    <a
      href={href}
      data-node-action="open-fullscreen"
      aria-label={ariaLabel}
      className="btn btn-icon"
      onClick={(e) => {
        e.preventDefault();
        navigatePane(href);
      }}
      title="Open in fullscreen"
    >
      <span aria-hidden="true">↖</span>
    </a>
  );
}
