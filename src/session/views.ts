import { Map } from "immutable";
import type { Views } from "./types";

type HasViews = {
  views: Views;
};

export function getParentKey(viewKey: string): string {
  return viewKey.split(":").slice(0, -1).join(":");
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

export function planUpdateViews<T extends HasViews>(plan: T, views: Views): T {
  return {
    ...plan,
    views,
  };
}

export function updateRowPathsAfterMoveNodes(data: HasViews): Views {
  return data.views;
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

export function bulkUpdateRowPathsAfterAddNode(data: HasViews): Views {
  return data.views;
}
