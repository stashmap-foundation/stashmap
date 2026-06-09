import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "react-responsive";
import { List } from "immutable";
import { TYPE_COLORS } from "../core/constants";
import { IS_MOBILE } from "./responsive";
import { useData } from "../DataContext";
import { useCurrentPane } from "../SplitPanesContext";
import { useTemporaryView } from "./TemporaryViewContext";
import { usePaneTreeResult } from "./TreeView";
import { usePlanner } from "../planner";
import { getRowKey } from "./keyboardNavigation";
import { planBatchRelevance, planBatchArgument } from "./batchOperations";
import {
  getActionTargetRows,
  SYMBOL_TO_RELEVANCE,
  refocusPaneAfterRowMutation,
} from "./Workspace";
import { preventEditorBlur } from "./AddNode";

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
  row: Row,
  isOtherUser: boolean,
  isInSearch: boolean
): boolean {
  if (row.depth === 1 || isInSearch) return true;
  if (!isOtherUser) return false;
  return (
    row.virtualType !== "suggestion" &&
    row.virtualType !== "incoming" &&
    row.virtualType !== "version"
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
  const { selection } = useTemporaryView();
  const { createPlan, executePlan } = usePlanner();
  const treeResult = usePaneTreeResult();
  const rows = treeResult?.rows || List<Row>();
  const isOtherUser = pane.author !== data.user.publicKey;
  const isInSearch = pane.searchQuery !== undefined;

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
  const currentRow = rows.find((row) => row.viewKey === getRowKey(activeRow));
  if (!currentRow) return null;
  if (isRowReadonly(currentRow, isOtherUser, isInSearch)) return null;
  if (isUserEntryRow(activeRow)) return null;
  const currentLevel = relevanceToLevel(currentRow.node.relevance);
  const currentArgument = currentRow.node.argument;

  const innerNode = activeRow.querySelector(".inner-node");
  if (!innerNode) return null;
  const isSuggestion = currentRow.virtualType === "suggestion";

  const handleRelevance = (level: number): void => {
    const root = wrapperRef.current;
    if (!root) return;
    const plan = createPlan();
    const targetRows = getActionTargetRows(selection, activeRow, rows);
    const targetRelevance =
      level === 0
        ? ("not_relevant" as Relevance)
        : SYMBOL_TO_RELEVANCE[LEVEL_SYMBOLS[level]];
    const relevance: Relevance =
      currentRow.node.relevance === targetRelevance
        ? undefined
        : targetRelevance;
    executePlan(planBatchRelevance(plan, targetRows, relevance));
    refocusPaneAfterRowMutation(root);
  };

  const handleEvidence = (target: "confirms" | "contra"): void => {
    const root = wrapperRef.current;
    if (!root) return;
    const plan = createPlan();
    const targetRows = getActionTargetRows(selection, activeRow, rows);
    const argument: Argument = currentArgument === target ? undefined : target;
    executePlan(planBatchArgument(plan, targetRows, argument));
    refocusPaneAfterRowMutation(root);
  };

  const bar = (
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

  return createPortal(bar, innerNode);
}
