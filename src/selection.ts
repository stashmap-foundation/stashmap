import { OrderedSet } from "immutable";

export type MultiSelectionState = {
  baseSelection: OrderedSet<string>;
  shiftSelection: OrderedSet<string>;
  anchor: string;
};

export function selectSingle(
  _state: MultiSelectionState,
  viewKey: string
): MultiSelectionState {
  return {
    baseSelection: OrderedSet<string>([viewKey]),
    shiftSelection: OrderedSet<string>(),
    anchor: viewKey,
  };
}

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
