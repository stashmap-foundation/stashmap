import { Map } from "immutable";
import { isSearchId } from "../connections";
import {
  getLast,
  isRoot,
  parseViewPath,
  ViewPath,
  viewPathToString,
} from "./viewPaths";

function getDefaultView(id: ID, isRootNode: boolean): View {
  return {
    expanded: isRootNode || isSearchId(id),
  };
}

export function isExpanded(data: Data, viewKey: string): boolean {
  const viewPath = parseViewPath(viewKey);
  const view =
    data.views.get(viewKey) ||
    getDefaultView(getLast(viewPath), isRoot(viewPath));
  return view.expanded === true;
}

export function getParentKey(viewKey: string): string {
  return viewKey.split(":").slice(0, -1).join(":");
}

export function updateView(views: Views, path: ViewPath, view: View): Views {
  const key = viewPathToString(path);
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
