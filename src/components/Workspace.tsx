import React, { useEffect } from "react";
import { TemporaryViewProvider } from "./TemporaryViewContext";

import {
  getNodeFromID,
  useViewPath,
  useIsViewingOtherUserContent,
} from "../ViewContext";
import { useData } from "../DataContext";
import {
  useSplitPanes,
  useCurrentPane,
  usePaneStack,
  usePaneIndex,
} from "../SplitPanesContext";
import { TreeView } from "./TreeView";
import {
  PaneSearchButton,
  PaneSettingsMenu,
  ClosePaneButton,
} from "./SplitPaneLayout";
import { InlineFilterDots } from "./TypeFilterButton";
import { NewPaneButton } from "./OpenInSplitPaneButton";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";
import { SignInMenuBtn } from "../SignIn";
import { usePlanner, planForkPane } from "../planner";
import { LOG_NODE_ID } from "../connections";

function BreadcrumbItem({
  nodeID,
  onClick,
  isLast,
}: {
  nodeID: LongID | ID;
  onClick: () => void;
  isLast: boolean;
}): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const node = getNodeFromID(knowledgeDBs, nodeID as string, user.publicKey);

  if (isLast) {
    return (
      <span className="breadcrumb-current">{node?.text || "Loading..."}</span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="breadcrumb-link"
        onClick={onClick}
        aria-label={`Navigate to ${node?.text || "parent"}`}
      >
        {node?.text || "Loading..."}
      </button>
      <span className="breadcrumb-separator">/</span>
    </>
  );
}

function Breadcrumbs(): JSX.Element {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const stack = usePaneStack();

  const popTo = (index: number): void => {
    setPane({ ...pane, stack: stack.slice(0, index + 1) });
  };

  return (
    <nav className="breadcrumbs" aria-label="Navigation breadcrumbs">
      {stack.map((nodeID, index) => (
        <BreadcrumbItem
          key={nodeID as string}
          nodeID={nodeID}
          onClick={() => popTo(index)}
          isLast={index === stack.length - 1}
        />
      ))}
    </nav>
  );
}

function ForkButton(): JSX.Element | null {
  const isViewingOtherUserContent = useIsViewingOtherUserContent();
  const viewPath = useViewPath();
  const stack = usePaneStack();
  const { createPlan, executePlan } = usePlanner();

  if (!isViewingOtherUserContent) {
    return null;
  }

  const handleFork = (): void => {
    const plan = planForkPane(createPlan(), viewPath, stack);
    executePlan(plan);
  };

  return (
    <button
      type="button"
      className="header-action-btn"
      onClick={handleFork}
      aria-label="fork to make your own copy"
    >
      fork
    </button>
  );
}

function HomeButton(): JSX.Element | null {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const { knowledgeDBs, user } = useData();

  const logNode = getNodeFromID(knowledgeDBs, LOG_NODE_ID, user.publicKey);
  if (!logNode) {
    return null;
  }

  const handleClick = (): void => {
    setPane({ ...pane, stack: [LOG_NODE_ID] });
  };

  return (
    <button
      type="button"
      className="btn btn-icon"
      onClick={handleClick}
      aria-label="Navigate to Log"
      title="Log"
    >
      <span aria-hidden="true">⌂</span>
    </button>
  );
}

function NewNoteButton(): JSX.Element {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();

  const handleClick = (): void => {
    setPane({ ...pane, stack: [] });
  };

  return (
    <button
      type="button"
      className="btn btn-icon"
      onClick={handleClick}
      aria-label="Create new note"
      title="New Note"
    >
      <span aria-hidden="true">+</span>
    </button>
  );
}

function useHomeShortcut(): void {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const { knowledgeDBs, user } = useData();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === "h") {
        const logNode = getNodeFromID(knowledgeDBs, LOG_NODE_ID, user.publicKey);
        if (logNode) {
          e.preventDefault();
          setPane({ ...pane, stack: [LOG_NODE_ID] });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setPane, pane, knowledgeDBs, user.publicKey]);
}

function PaneHeader(): JSX.Element {
  const paneIndex = usePaneIndex();
  const isFirstPane = paneIndex === 0;
  useHomeShortcut();

  return (
    <header className="pane-header">
      <div className="pane-header-left">
        <Breadcrumbs />
        <ForkButton />
        {isFirstPane && <SignInMenuBtn />}
      </div>
      <div className="pane-header-right">
        <HomeButton />
        <NewNoteButton />
        <InlineFilterDots />
        <PaneSearchButton />
        <NewPaneButton />
        <ClosePaneButton />
      </div>
    </header>
  );
}

function CurrentNodeName(): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const stack = usePaneStack();
  const currentNodeID = stack[stack.length - 1];

  if (!currentNodeID) {
    return <span>New Note</span>;
  }

  const node = getNodeFromID(
    knowledgeDBs,
    currentNodeID as string,
    user.publicKey
  );
  const displayName = node?.text || "...";
  const truncated =
    displayName.length > 20 ? `${displayName.slice(0, 20)}…` : displayName;

  return <span>{truncated}</span>;
}

function PaneStatusLine(): JSX.Element {
  const paneIndex = usePaneIndex();
  const isFirstPane = paneIndex === 0;
  const isViewingOtherUserContent = useIsViewingOtherUserContent();

  return (
    <footer className="pane-status-line">
      <div className="status-segment">
        <CurrentNodeName />
      </div>
      {isViewingOtherUserContent && (
        <div className="status-segment status-segment-other">other</div>
      )}
      <div className="status-spacer" />
      {isFirstPane && <PublishingStatusWrapper />}
      {isFirstPane && (
        <div className="status-segment">
          <PaneSettingsMenu />
        </div>
      )}
    </footer>
  );
}

export function PaneView(): JSX.Element | null {
  const pane = useCurrentPane();
  const { user } = useData();
  const isOtherUser = pane.author !== user.publicKey;

  return (
    <TemporaryViewProvider>
      <div className={`pane-wrapper ${isOtherUser ? "pane-other-user" : ""}`}>
        <PaneHeader />
        <div className="pane-content">
          <TreeView />
        </div>
        <PaneStatusLine />
      </div>
    </TemporaryViewProvider>
  );
}
