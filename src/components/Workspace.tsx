import React from "react";
import { TemporaryViewProvider } from "./TemporaryViewContext";

import { getNodeFromID, useViewPath } from "../ViewContext";
import { DND } from "../dnd";
import { useData } from "../DataContext";
import {
  useSplitPanes,
  useCurrentPane,
  usePaneStack,
  usePaneIndex,
  useIsViewingOtherUserContent,
} from "../SplitPanesContext";
import { TreeView } from "./TreeView";
import {
  PaneSearchButton,
  PaneSettingsMenu,
  ClosePaneButton,
} from "./SplitPaneLayout";
import { PublishingStatusWrapper } from "./PublishingStatusWrapper";
import { SignInMenuBtn } from "../SignIn";
import { usePlanner, planForkPane } from "../planner";

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

function Breadcrumbs(): JSX.Element | null {
  const { setPane } = useSplitPanes();
  const pane = useCurrentPane();
  const stack = usePaneStack();

  const popTo = (index: number): void => {
    setPane({ ...pane, stack: stack.slice(0, index + 1) });
  };

  if (stack.length <= 1) {
    return null;
  }

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
      className="btn btn-borderless"
      onClick={handleFork}
      aria-label="fork to make your own copy"
      title="Fork to make your own copy"
    >
      Fork
    </button>
  );
}

function PaneHeader(): JSX.Element {
  const paneIndex = usePaneIndex();
  const isFirstPane = paneIndex === 0;

  return (
    <header className="pane-header">
      <div className="pane-header-left">
        {isFirstPane && (
          <>
            <PaneSettingsMenu />
            <PublishingStatusWrapper />
            <SignInMenuBtn />
          </>
        )}
        <Breadcrumbs />
      </div>
      <div className="pane-header-right">
        <ForkButton />
        <PaneSearchButton />
        <ClosePaneButton />
      </div>
    </header>
  );
}

export function WorkspaceView(): JSX.Element | null {
  const pane = useCurrentPane();
  const { user } = useData();
  const isOtherUser = pane.author !== user.publicKey;

  return (
    <TemporaryViewProvider>
      <div className={`pane-wrapper ${isOtherUser ? "pane-other-user" : ""}`}>
        <PaneHeader />
        <div className="pane-content">
          <DND>
            <TreeView />
          </DND>
        </div>
      </div>
    </TemporaryViewProvider>
  );
}
