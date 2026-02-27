import React from "react";
import { List } from "immutable";
import { useDropzone } from "react-dropzone";
import { v4 } from "uuid";
import { newNode, hashText, joinID } from "../connections";
import { newRelations, ViewPath } from "../ViewContext";
import {
  Plan,
  ParsedLine,
  planUpsertNode,
  planUpsertRelations,
  planAddToParent,
  planMoveTreeDescendantsToContext,
  planCreateVersion,
  findUniqueText,
  parseClipboardText,
  usePlanner,
} from "../planner";
import {
  MarkdownTreeNode,
  parseMarkdownHierarchy,
} from "../markdownDocument";

export type { MarkdownTreeNode } from "../markdownDocument";
export { parseMarkdownHierarchy } from "../markdownDocument";

export type MarkdownImportFile = {
  name: string;
  markdown: string;
};

function titleFromFileName(fileName: string): string {
  const baseName = fileName.replace(/\.[^/.]+$/u, "").trim();
  if (baseName) {
    return baseName;
  }
  return "Imported Markdown";
}

/* eslint-disable functional/immutable-data */
export function parsedLinesToTrees(items: ParsedLine[]): MarkdownTreeNode[] {
  if (items.length === 0) return [];
  const minDepth = Math.min(...items.map((i) => i.depth));
  const roots: MarkdownTreeNode[] = [];
  const stack: MarkdownTreeNode[] = [];
  items.forEach((item) => {
    const depth = item.depth - minDepth;
    const node: MarkdownTreeNode = { text: item.text, children: [] };
    stack.length = Math.min(depth, stack.length);
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  });
  return roots;
}
/* eslint-enable functional/immutable-data */

export function parseTextToTrees(text: string): MarkdownTreeNode[] {
  const hasHeaders = text.split("\n").some((line) => /^#{1,6}\s/.test(line));
  if (hasHeaders) {
    return parseMarkdownHierarchy(text);
  }
  return parsedLinesToTrees(parseClipboardText(text));
}

function normalizeRootsForSingleFile(
  roots: MarkdownTreeNode[],
  fileName: string
): MarkdownTreeNode[] {
  if (roots.length <= 1) {
    return roots;
  }
  return [{ text: titleFromFileName(fileName), children: roots }];
}

export function parseMarkdownImportFiles(
  files: MarkdownImportFile[]
): MarkdownTreeNode[] {
  return files.reduce((acc: MarkdownTreeNode[], file: MarkdownImportFile) => {
    const roots = parseMarkdownHierarchy(file.markdown);
    const normalizedRoots = normalizeRootsForSingleFile(roots, file.name);
    return [...acc, ...normalizedRoots];
  }, []);
}

export function buildRootTreeForEmptyRootDrop(
  importedTrees: MarkdownTreeNode[]
): MarkdownTreeNode | undefined {
  if (importedTrees.length === 0) {
    return undefined;
  }
  if (importedTrees.length === 1) {
    return importedTrees[0];
  }
  return {
    text: "Imported Markdown Files",
    children: importedTrees,
  };
}

function materializeTreeNode(
  plan: Plan,
  treeNode: MarkdownTreeNode,
  context: List<ID>,
  root: ID
): [Plan, ID] {
  const node = newNode(treeNode.text);
  const withNode = planUpsertNode(plan, node);

  const childContext = context.push(node.id);
  const [withChildren, childItems] = treeNode.children.reduce(
    ([accPlan, accItems], childNode) => {
      const childID = hashText(childNode.text);
      const isDuplicate = accItems.some((item) => item.nodeID === childID);
      const effectiveChild = isDuplicate
        ? {
            ...childNode,
            text: findUniqueText(
              childNode.text,
              accItems.map((item) => item.nodeID)
            ),
          }
        : childNode;
      const [afterChild, materializedID] = materializeTreeNode(
        accPlan,
        effectiveChild,
        childContext,
        root
      );
      const afterVersion = isDuplicate
        ? planCreateVersion(
            afterChild,
            materializedID,
            childNode.text,
            childContext
          )
        : afterChild;
      const item: RelationItem = {
        nodeID: materializedID,
        relevance: childNode.relevance,
        argument: childNode.argument,
      };
      return [afterVersion, [...accItems, item]];
    },
    [withNode, [] as RelationItem[]] as [Plan, RelationItem[]]
  );

  const baseRelation = treeNode.uuid
    ? {
        ...newRelations(node.id, context, withChildren.user.publicKey, root),
        id: joinID(withChildren.user.publicKey, treeNode.uuid),
      }
    : newRelations(node.id, context, withChildren.user.publicKey, root);
  const relation: Relations = {
    ...baseRelation,
    items: List(childItems),
  };
  return [planUpsertRelations(withChildren, relation), node.id];
}

export function planCreateNodesFromMarkdownTrees(
  plan: Plan,
  trees: MarkdownTreeNode[],
  context: List<ID> = List<ID>()
): [Plan, topNodeIDs: ID[]] {
  return trees.reduce(
    ([accPlan, accTopNodeIDs], treeNode) => {
      const rootUuid = treeNode.uuid ?? v4();
      const treeWithUuid = treeNode.uuid
        ? treeNode
        : { ...treeNode, uuid: rootUuid };
      const [nextPlan, topNodeID] = materializeTreeNode(
        accPlan,
        treeWithUuid,
        context,
        rootUuid as ID
      );
      return [nextPlan, [...accTopNodeIDs, topNodeID]];
    },
    [plan, [] as ID[]] as [Plan, ID[]]
  );
}

export function planCreateNodesFromMarkdownFiles(
  plan: Plan,
  files: MarkdownImportFile[],
  context: List<ID> = List<ID>()
): [Plan, topNodeIDs: ID[]] {
  const trees = parseMarkdownImportFiles(files);
  return planCreateNodesFromMarkdownTrees(plan, trees, context);
}

function flattenTreeNodes(treeNodes: MarkdownTreeNode[]): MarkdownTreeNode[] {
  return treeNodes.reduce((acc: MarkdownTreeNode[], treeNode) => {
    return [...acc, treeNode, ...flattenTreeNodes(treeNode.children)];
  }, []);
}

export function createNodesFromMarkdown(markdownText: string): KnowNode[] {
  const trees = parseMarkdownHierarchy(markdownText);
  return flattenTreeNodes(trees).map((treeNode) => newNode(treeNode.text));
}

export function planCreateNodesFromMarkdown(
  plan: Plan,
  markdownText: string,
  context: List<ID> = List<ID>()
): [Plan, topNodeID: ID] {
  const [nextPlan, topNodeIDs] = planCreateNodesFromMarkdownFiles(
    plan,
    [{ name: "Imported Markdown", markdown: markdownText }],
    context
  );

  if (topNodeIDs.length > 0) {
    return [nextPlan, topNodeIDs[0]];
  }

  const fallbackNode = newNode("Imported Markdown");
  return [planUpsertNode(nextPlan, fallbackNode), fallbackNode.id];
}

export function planPasteMarkdownTrees(
  plan: Plan,
  trees: MarkdownTreeNode[],
  parentViewPath: ViewPath,
  stack: ID[],
  insertAtIndex?: number
): Plan {
  return trees.reduce((accPlan, tree, idx) => {
    const insertAt =
      insertAtIndex !== undefined ? insertAtIndex + idx : undefined;
    const [planWithNode, topNodeIDs] = planCreateNodesFromMarkdownTrees(
      accPlan,
      [tree]
    );
    const [planWithAdded, actualIDs] = planAddToParent(
      planWithNode,
      topNodeIDs,
      parentViewPath,
      stack,
      insertAt
    );
    return planMoveTreeDescendantsToContext(
      planWithAdded,
      topNodeIDs,
      actualIDs,
      parentViewPath,
      stack
    );
  }, plan);
}

type FileDropZoneProps = {
  children: React.ReactNode;
  onDrop: (plan: Plan, topNodes: Array<ID>) => void;
};

/* eslint-disable react/jsx-props-no-spreading */
export function FileDropZone({
  children,
  onDrop,
}: FileDropZoneProps): JSX.Element {
  const { createPlan } = usePlanner();
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    noClick: true,
    noKeyboard: true,
    accept: [".md", ".markdown"],
    onDrop: async (acceptedFiles: Array<File>) => {
      const markdownFiles = await Promise.all(
        acceptedFiles.map(async (file) => {
          return {
            name: file.name,
            markdown: await file.text(),
          };
        })
      );

      const [planWithMarkdown, topNodeIDs] = planCreateNodesFromMarkdownFiles(
        createPlan(),
        markdownFiles
      );
      onDrop(planWithMarkdown, topNodeIDs);
    },
  });
  const className = isDragActive ? "dimmed flex-col-100" : "flex-col-100";
  return (
    <div {...getRootProps({ className })}>
      {children}
      <input {...getInputProps()} />
    </div>
  );
}
/* eslint-enable react/jsx-props-no-spreading */
