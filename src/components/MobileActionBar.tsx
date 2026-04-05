import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useMediaQuery } from "react-responsive";
import { List, Map } from "immutable";
import { TYPE_COLORS } from "../constants";
import { IS_MOBILE } from "./responsive";
import { useData } from "../DataContext";
import { useCurrentPane, usePaneStack } from "../SplitPanesContext";
import { useTemporaryView } from "./TemporaryViewContext";
import { usePaneTreeResult } from "./TreeView";
import { usePlanner } from "../planner";
import {
  parseViewPath,
  ViewPath,
  VirtualRowsMap,
  viewPathToString,
  useViewPath,
} from "../ViewContext";
import { getRowKey } from "./keyboardNavigation";
import {
  planBatchRelevance,
  planBatchArgument,
  getCurrentRow,
} from "./batchOperations";
import {
  getActionTargetKeys,
  SYMBOL_TO_RELEVANCE,
  refocusPaneAfterRowMutation,
} from "./Workspace";
import { preventEditorBlur } from "./AddNode";
import { isSearchId } from "../connections";

const LEVEL_SYMBOLS: Record<number, string> = {
  0: "x",
  1: "~",
  2: "?",
  3: "!",
};

const LEVEL_COLORS: Record<number, string> = {
  0: TYPE_COLORS.not_relevant,
  1: TYPE_COLORS.little_relevant,
  2: TYPE_COLORS.maybe_relevant,
  3: TYPE_COLORS.relevant,
};

const RELEVANCE_TO_LEVEL: Record<string, number> = {
  not_relevant: 0,
  little_relevant: 1,
  maybe_relevant: 2,
  relevant: 3,
};

function relevanceToLevel(r: Relevance): number {
  if (r === undefined) return -1;
  return RELEVANCE_TO_LEVEL[r] ?? -1;
}

type MobileActionBarProps = {
  wrapperRef: React.RefObject<HTMLDivElement>;
};

function isRowReadonly(
  row: HTMLElement,
  isOtherUser: boolean,
  isInSearch: boolean
): boolean {
  const viewKey = getRowKey(row);
  const viewPath = parseViewPath(viewKey);
  const isRoot = viewPath.length <= 2;
  if (isRoot || isInSearch) return true;
  if (!isOtherUser) return false;
  const innerNode = row.querySelector(".inner-node");
  const virtualType = innerNode?.getAttribute("data-virtual-type");
  return (
    virtualType !== "suggestion" &&
    virtualType !== "incoming" &&
    virtualType !== "version"
  );
}

function isUserEntryRow(row: HTMLElement): boolean {
  const innerNode = row.querySelector(".inner-node");
  return innerNode?.getAttribute("data-user-entry") === "true";
}

export function MobileActionBar({
  wrapperRef,
}: MobileActionBarProps): JSX.Element | null {
  const isMobile = useMediaQuery(IS_MOBILE);
  const [activeRow, setActiveRow] = useState<HTMLElement | null>(null);
  const data = useData();
  const pane = useCurrentPane();
  const stack = usePaneStack();
  const { selection } = useTemporaryView();
  const { createPlan, executePlan } = usePlanner();
  const treeResult = usePaneTreeResult();
  const rootViewPath = useViewPath();
  const orderedViewKeys = useMemo(
    () =>
      List<ViewPath>([rootViewPath])
        .concat(treeResult?.paths || List<ViewPath>())
        .map((path) => viewPathToString(path))
        .toArray(),
    [rootViewPath, treeResult]
  );
  const virtualRowsMap: VirtualRowsMap =
    treeResult?.virtualRows || Map<string, GraphNode>();

  const isOtherUser = pane.author !== data.user.publicKey;
  const lastStackId = pane.stack[pane.stack.length - 1];
  const isInSearch = lastStackId ? isSearchId(lastStackId) : false;

  const handleFocusIn = useCallback((e: FocusEvent) => {
    const { target } = e;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest('[data-row-focusable="true"]');
    if (row instanceof HTMLElement) {
      setActiveRow(row);
    }
  }, []);

  const handleFocusOut = useCallback(
    (e: FocusEvent) => {
      const root = wrapperRef.current;
      if (!root) return;
      const related = e.relatedTarget;
      if (related instanceof HTMLElement && root.contains(related)) return;
      setActiveRow(null);
    },
    [wrapperRef]
  );

  useEffect(() => {
    const root = wrapperRef.current;
    if (!root || !isMobile) return () => {};
    root.addEventListener("focusin", handleFocusIn);
    root.addEventListener("focusout", handleFocusOut);
    return () => {
      root.removeEventListener("focusin", handleFocusIn);
      root.removeEventListener("focusout", handleFocusOut);
    };
  }, [wrapperRef, isMobile, handleFocusIn, handleFocusOut]);

  if (!isMobile || !activeRow) return null;
  if (isRowReadonly(activeRow, isOtherUser, isInSearch)) return null;
  if (isUserEntryRow(activeRow)) return null;

  const activeViewPath = parseViewPath(getRowKey(activeRow));
  const currentRowData = getCurrentRow(data, activeViewPath, virtualRowsMap);
  const currentLevel = relevanceToLevel(currentRowData?.relevance);
  const currentArgument = currentRowData?.argument;

  const innerNode = activeRow.querySelector(".inner-node");
  const virtualType = innerNode?.getAttribute("data-virtual-type");
  const isSuggestion = virtualType === "suggestion";

  const handleRelevance = (level: number): void => {
    const root = wrapperRef.current;
    if (!root) return;
    const plan = createPlan();
    const keys = getActionTargetKeys(selection, activeRow, orderedViewKeys);
    const paths = keys.map(parseViewPath);
    const targetRelevance =
      level === 0
        ? ("not_relevant" as Relevance)
        : SYMBOL_TO_RELEVANCE[LEVEL_SYMBOLS[level]];
    const relevance: Relevance =
      currentRowData?.relevance === targetRelevance
        ? undefined
        : targetRelevance;
    executePlan(
      planBatchRelevance(plan, paths, stack, relevance, virtualRowsMap)
    );
    refocusPaneAfterRowMutation(root);
  };

  const handleEvidence = (target: "confirms" | "contra"): void => {
    const root = wrapperRef.current;
    if (!root) return;
    const plan = createPlan();
    const keys = getActionTargetKeys(selection, activeRow, orderedViewKeys);
    const paths = keys.map(parseViewPath);
    const argument: Argument = currentArgument === target ? undefined : target;
    executePlan(
      planBatchArgument(plan, paths, stack, argument, virtualRowsMap)
    );
    refocusPaneAfterRowMutation(root);
  };

  return (
    <div className="mobile-action-bar">
      <div className="pill relevance-selector">
        {[0, 1, 2, 3].map((level) => (
          <span
            key={level}
            className="relevance-symbol"
            role="button"
            tabIndex={0}
            onMouseDown={preventEditorBlur}
            onClick={() => handleRelevance(level)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleRelevance(level);
              }
            }}
            style={{
              color:
                currentLevel === level
                  ? LEVEL_COLORS[level]
                  : TYPE_COLORS.inactive,
            }}
          >
            {LEVEL_SYMBOLS[level]}
          </span>
        ))}
      </div>
      {!isSuggestion && (
        <>
          <span
            className="pill evidence-selector"
            role="button"
            tabIndex={0}
            onMouseDown={preventEditorBlur}
            onClick={() => handleEvidence("confirms")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleEvidence("confirms");
              }
            }}
            style={{
              color:
                currentArgument === "confirms"
                  ? TYPE_COLORS.confirms
                  : TYPE_COLORS.inactive,
            }}
          >
            +
          </span>
          <span
            className="pill evidence-selector"
            role="button"
            tabIndex={0}
            onMouseDown={preventEditorBlur}
            onClick={() => handleEvidence("contra")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleEvidence("contra");
              }
            }}
            style={{
              color:
                currentArgument === "contra"
                  ? TYPE_COLORS.contra
                  : TYPE_COLORS.inactive,
            }}
          >
            -
          </span>
        </>
      )}
    </div>
  );
}
