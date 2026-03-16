import { OrderedSet } from "immutable";
import type { TemporaryViewState } from "./types";

export type MultiSelectionState = {
  baseSelection: OrderedSet<string>;
  shiftSelection: OrderedSet<string>;
  anchor: string;
};

export function toggleSelect(
  state: MultiSelectionState,
  viewKey: string
): MultiSelectionState {
  const committed = state.baseSelection.union(state.shiftSelection);
  const withAnchor =
    committed.size === 0 && state.anchor && state.anchor !== viewKey
      ? committed.add(state.anchor)
      : committed;
  return {
    baseSelection: withAnchor.contains(viewKey)
      ? withAnchor.remove(viewKey)
      : withAnchor.add(viewKey),
    shiftSelection: OrderedSet<string>(),
    anchor: viewKey,
  };
}

export function shiftSelect(
  state: MultiSelectionState,
  orderedKeys: string[],
  target: string
): MultiSelectionState {
  const anchorIdx = orderedKeys.indexOf(state.anchor);
  const targetIdx = orderedKeys.indexOf(target);
  if (anchorIdx === -1 || targetIdx === -1) {
    return state;
  }
  const start = Math.min(anchorIdx, targetIdx);
  const end = Math.max(anchorIdx, targetIdx);
  const rangeKeys = orderedKeys.slice(start, end + 1);
  return {
    baseSelection: state.baseSelection,
    shiftSelection: OrderedSet<string>(rangeKeys),
    anchor: state.anchor,
  };
}

export function clearSelection(
  state: MultiSelectionState
): MultiSelectionState {
  return {
    baseSelection: OrderedSet<string>(),
    shiftSelection: OrderedSet<string>(),
    anchor: state.anchor,
  };
}

export function deselectAllChildren(
  selection: OrderedSet<string>,
  viewKey: string
): OrderedSet<string> {
  return selection.filterNot((sel) => sel.startsWith(viewKey));
}

type HasTemporarySelectionState = {
  temporaryView: Pick<
    TemporaryViewState,
    "baseSelection" | "shiftSelection" | "anchor"
  >;
};

function getTemporarySelectionState<T extends HasTemporarySelectionState>(
  plan: T
): MultiSelectionState {
  return {
    baseSelection: plan.temporaryView.baseSelection,
    shiftSelection: plan.temporaryView.shiftSelection,
    anchor: plan.temporaryView.anchor,
  };
}

export function planSetTemporarySelectionState<
  T extends HasTemporarySelectionState
>(plan: T, state: MultiSelectionState): T {
  return {
    ...plan,
    temporaryView: {
      ...plan.temporaryView,
      baseSelection: state.baseSelection,
      shiftSelection: state.shiftSelection,
      anchor: state.anchor,
    },
  };
}

export function planToggleTemporarySelection<
  T extends HasTemporarySelectionState
>(plan: T, viewKey: string): T {
  return planSetTemporarySelectionState(
    plan,
    toggleSelect(getTemporarySelectionState(plan), viewKey)
  );
}

export function planShiftTemporarySelection<
  T extends HasTemporarySelectionState
>(
  plan: T,
  orderedKeys: string[],
  targetViewKey: string,
  fallbackAnchor?: string
): T {
  const current = getTemporarySelectionState(plan);
  const effectiveAnchor = current.anchor || fallbackAnchor;
  if (!effectiveAnchor) {
    return plan;
  }
  return planSetTemporarySelectionState(
    plan,
    shiftSelect(
      {
        ...current,
        anchor: effectiveAnchor,
      },
      orderedKeys,
      targetViewKey
    )
  );
}

export function planClearTemporarySelection<
  T extends HasTemporarySelectionState
>(plan: T, anchor?: string): T {
  return planSetTemporarySelectionState(
    plan,
    clearSelection({
      ...getTemporarySelectionState(plan),
      anchor: anchor ?? plan.temporaryView.anchor,
    })
  );
}

export function planSelectAllTemporaryRows<
  T extends HasTemporarySelectionState
>(plan: T, orderedKeys: string[], anchor?: string): T {
  return planSetTemporarySelectionState(plan, {
    baseSelection: OrderedSet<string>(orderedKeys),
    shiftSelection: OrderedSet<string>(),
    anchor: anchor ?? plan.temporaryView.anchor,
  });
}
