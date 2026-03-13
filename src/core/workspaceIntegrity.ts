import {
  MarkdownTreeNode,
  parseEditableMarkdownDocument,
} from "../markdownTree";

type MarkerSets = {
  all: string[];
  deleted: string[];
};

function getDocumentRoots(
  content: string,
  label: "baseline" | "edited"
): {
  mainRoot: MarkdownTreeNode;
  deleteRoot?: MarkdownTreeNode;
} {
  const { roots, mainRoot, deleteRoot, hasNestedDeleteSection } =
    parseEditableMarkdownDocument(content);

  if (!mainRoot || roots.length === 0) {
    throw new Error(`${label} document must contain exactly one main root`);
  }
  if (roots.length > 2) {
    throw new Error(
      `${label} document may contain only one main root plus an optional "# Delete" root`
    );
  }
  if (!deleteRoot) {
    if (hasNestedDeleteSection) {
      throw new Error(
        'Delete section must be a separate "# Delete" root at the end of the file'
      );
    }
    return { mainRoot };
  }
  if (
    deleteRoot.text !== "Delete" ||
    deleteRoot.blockKind !== "heading" ||
    deleteRoot.headingLevel !== 1
  ) {
    throw new Error(
      `${label} document may contain only one main root plus an optional "# Delete" root`
    );
  }
  if (hasNestedDeleteSection) {
    throw new Error(
      'Delete section must be a separate "# Delete" root at the end of the file'
    );
  }
  return { mainRoot, deleteRoot };
}

function collectMarkers(
  node: MarkdownTreeNode,
  inDeleteSection = false
): MarkerSets {
  const own = node.uuid ? [node.uuid] : [];
  const childSets = node.children.reduce(
    (acc, child) => {
      const childMarkers = collectMarkers(child, inDeleteSection);
      return {
        all: [...acc.all, ...childMarkers.all],
        deleted: [...acc.deleted, ...childMarkers.deleted],
      };
    },
    { all: [] as string[], deleted: [] as string[] }
  );
  return {
    all: [...own, ...childSets.all],
    deleted: inDeleteSection
      ? [...own, ...childSets.deleted]
      : childSets.deleted,
  };
}

function findDuplicates(values: string[]): string[] {
  return Object.entries(
    values.reduce(
      (acc, value) => ({
        ...acc,
        [value]: (acc[value] || 0) + 1,
      }),
      {} as Record<string, number>
    )
  )
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

function difference(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => !rightSet.has(value)).sort();
}

export function validateEditedDocumentIntegrity(
  baselineContent: string,
  editedContent: string
): {
  sanitizedRoot: MarkdownTreeNode;
  deletedMarkers: string[];
} {
  const { mainRoot: baselineRoot } = getDocumentRoots(
    baselineContent,
    "baseline"
  );
  const { mainRoot, deleteRoot } = getDocumentRoots(editedContent, "edited");
  const baselineMarkers = collectMarkers(baselineRoot);
  const editedMarkers = {
    all: [
      ...collectMarkers(mainRoot).all,
      ...(deleteRoot ? collectMarkers(deleteRoot, true).all : []),
    ],
    deleted: deleteRoot ? collectMarkers(deleteRoot, true).deleted : [],
  };
  const deleteMarkers = deleteRoot
    ? collectMarkers(deleteRoot, true)
    : {
        all: [],
        deleted: [],
      };
  const duplicateMarkers = findDuplicates(editedMarkers.all);
  const inventedMarkers = difference(editedMarkers.all, baselineMarkers.all);
  const lostMarkers = difference(baselineMarkers.all, editedMarkers.all);

  if (duplicateMarkers.length > 0) {
    throw new Error(
      `Edited document contains duplicate markers: ${duplicateMarkers.join(
        ", "
      )}`
    );
  }
  if (inventedMarkers.length > 0) {
    throw new Error(
      `Edited document invents new markers: ${inventedMarkers.join(", ")}`
    );
  }
  if (lostMarkers.length > 0) {
    throw new Error(`Edited document loses markers: ${lostMarkers.join(", ")}`);
  }

  return {
    sanitizedRoot: mainRoot,
    deletedMarkers: deleteMarkers.deleted,
  };
}
