import type { View, Views } from "../session/types";
import { planUpdateViews } from "../session/views";
import {
  getLast,
  isRoot,
  parseRowPath,
  type RowPath,
  rowPathToString,
} from "../rows/rowPaths";

const SEARCH_PREFIX = "~Search:";

type HasViews = {
  views: Views;
};

function getDefaultView(id: ID, isRootNode: boolean): View {
  return {
    expanded: isRootNode || id.startsWith(SEARCH_PREFIX),
  };
}

export function isExpanded(data: HasViews, viewKey: string): boolean {
  const rowPath = parseRowPath(viewKey);
  const view =
    data.views.get(viewKey) ||
    getDefaultView(getLast(rowPath), isRoot(rowPath));
  return view.expanded === true;
}

export function updateView(views: Views, rowPath: RowPath, view: View): Views {
  const key = rowPathToString(rowPath);
  const rowID = getLast(rowPath);
  const defaultView = getDefaultView(rowID, isRoot(rowPath));
  const isDefault = view.expanded === defaultView.expanded && !view.typeFilters;
  if (isDefault) {
    return views.delete(key);
  }
  return views.set(key, view);
}

export function planExpandNode<T extends HasViews>(
  plan: T,
  view: View,
  rowPath: RowPath
): T {
  if (view.expanded) {
    return plan;
  }
  return planUpdateViews(
    plan,
    updateView(plan.views, rowPath, {
      ...view,
      expanded: true,
    })
  );
}

function pathContainsSubpath(path: RowPath, subpath: ID[]): boolean {
  if (subpath.length === 0 || path.length - 1 < subpath.length) {
    return false;
  }
  const segments = path.slice(1) as ID[];
  return segments.some((_, index) =>
    subpath.every((segment, offset) => segments[index + offset] === segment)
  );
}

export function updateRowPathsAfterDisconnect(
  views: Views,
  disconnectNode: ID,
  fromNode: LongID
): Views {
  return views.filterNot((_, key) => {
    try {
      return pathContainsSubpath(parseRowPath(key), [fromNode, disconnectNode]);
    } catch {
      return false;
    }
  });
}
