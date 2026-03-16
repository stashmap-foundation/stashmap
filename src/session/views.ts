import { Map } from "immutable";
import { isSearchId } from "../connections";
import {
  getLast,
  isRoot,
  parseRowPath,
  RowPath,
  rowPathToString,
} from "./rowPaths";

function getDefaultView(id: ID, isRootNode: boolean): View {
  return {
    expanded: isRootNode || isSearchId(id),
  };
}

export function isExpanded(data: Data, viewKey: string): boolean {
  const rowPath = parseRowPath(viewKey);
  const view =
    data.views.get(viewKey) ||
    getDefaultView(getLast(rowPath), isRoot(rowPath));
  return view.expanded === true;
}

export function getParentKey(viewKey: string): string {
  return viewKey.split(":").slice(0, -1).join(":");
}

export function updateView(views: Views, path: RowPath, view: View): Views {
  const key = rowPathToString(path);
  const rowID = getLast(path);
  const defaultView = getDefaultView(rowID, isRoot(path));
  const isDefault = view.expanded === defaultView.expanded && !view.typeFilters;
  if (isDefault) {
    return views.delete(key);
  }
  return views.set(key, view);
}

export function copyViewsWithNewPrefix(
  views: Views,
  sourceKey: string,
  targetKey: string
): Views {
  const viewsToCopy = views.filter(
    (_, key) => key.startsWith(`${sourceKey}:`) || key === sourceKey
  );
  return viewsToCopy.reduce((acc, view, key) => {
    const newKey = targetKey + key.slice(sourceKey.length);
    return acc.set(newKey, view);
  }, views);
}

export function copyViewsWithNodesMapping(
  views: Views,
  sourceKey: string,
  targetKey: string,
  nodesIdMapping: Map<LongID, LongID>
): Views {
  const viewsToCopy = views.filter(
    (_, key) => key.startsWith(`${sourceKey}:`) || key === sourceKey
  );
  return viewsToCopy.reduce((acc, view, key) => {
    const suffix = key.slice(sourceKey.length);
    const mappedSuffix = nodesIdMapping.reduce(
      (mapped, newId, oldId) => mapped.split(oldId).join(newId),
      suffix
    );
    const newKey = targetKey + mappedSuffix;
    return acc.set(newKey, view);
  }, views);
}

type HasViews = {
  views: Views;
};

export function planUpdateViews<T extends HasViews>(plan: T, views: Views): T {
  return {
    ...plan,
    views,
  };
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

export function updateRowPathsAfterMoveNodes(data: Data): Views {
  return data.views;
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

export function updateRowPathsAfterPaneDelete(
  views: Views,
  removedPaneIndex: number
): Views {
  return views
    .filterNot((_, key) => key.startsWith(`p${removedPaneIndex}:`))
    .mapKeys((key) => {
      const match = key.match(/^p(\d+):/);
      if (!match) return key;
      const paneIndex = parseInt(match[1], 10);
      if (paneIndex > removedPaneIndex) {
        return key.replace(/^p\d+:/, `p${paneIndex - 1}:`);
      }
      return key;
    });
}

export function updateRowPathsAfterPaneInsert(
  views: Views,
  insertedPaneIndex: number
): Views {
  return views.mapKeys((key) => {
    const match = key.match(/^p(\d+):/);
    if (!match) return key;
    const paneIndex = parseInt(match[1], 10);
    if (paneIndex >= insertedPaneIndex) {
      return key.replace(/^p\d+:/, `p${paneIndex + 1}:`);
    }
    return key;
  });
}

export function bulkUpdateRowPathsAfterAddNode(data: Data): Views {
  return data.views;
}
