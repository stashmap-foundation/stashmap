import React from "react";
import { useMediaQuery } from "react-responsive";
import {
  useViewPath,
  useDisplayText,
  buildPaneTarget,
  useCurrentEdge,
} from "../ViewContext";
import { useNavigatePane } from "../SplitPanesContext";
import { useData } from "../DataContext";
import { buildDocumentRouteUrl, buildNodeRouteUrl } from "../navigationUrl";
import { IS_MOBILE } from "./responsive";

export function FullscreenButton(): JSX.Element | null {
  const isMobile = useMediaQuery(IS_MOBILE);
  const viewPath = useViewPath();
  const data = useData();
  const displayText = useDisplayText();
  const navigatePane = useNavigatePane();
  const currentRow = useCurrentEdge();
  const isFullscreenNode = viewPath.length === 2;
  if (isFullscreenNode || isMobile) {
    return null;
  }

  const target = buildPaneTarget(data, viewPath, currentRow);

  const href = (() => {
    if (target.documentId) {
      return buildDocumentRouteUrl(
        target.author,
        target.documentId,
        target.scrollToId
      );
    }
    if (target.rootNodeId) {
      return buildNodeRouteUrl(target.rootNodeId, target.scrollToId);
    }
    return undefined;
  })();

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
