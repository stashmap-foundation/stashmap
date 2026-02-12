import React from "react";
import { List } from "immutable";
import { useDropzone } from "react-dropzone";
import MarkdownIt from "markdown-it";
import { newNode, bulkAddRelations } from "../connections";
import { newRelations } from "../ViewContext";
import {
  Plan,
  ParsedLine,
  planUpsertNode,
  planUpsertRelations,
  usePlanner,
} from "../planner";

/* eslint-disable functional/immutable-data */
function convertToPlainText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent as string;
}
/* eslint-enable functional/immutable-data */

const markdown = new MarkdownIt();

function stripLeadingListMarkers(text: string): string {
  return text
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .trim();
}

function normalizeMarkdownText(markdownText: string): string {
  const plainText = convertToPlainText(
    markdown.renderInline(markdownText)
  ).replace(/\s+/g, " ");
  return stripLeadingListMarkers(plainText);
}

export type MarkdownTreeNode = {
  text: string;
  children: MarkdownTreeNode[];
};

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

/* eslint-disable functional/immutable-data, functional/no-let, no-continue */
function appendNode(
  roots: MarkdownTreeNode[],
  parent: MarkdownTreeNode | undefined,
  node: MarkdownTreeNode
): void {
  if (parent) {
    parent.children.push(node);
    return;
  }
  roots.push(node);
}

function getLastDefinedListItem(
  listItemStack: Array<MarkdownTreeNode | undefined>
): MarkdownTreeNode | undefined {
  for (let i = listItemStack.length - 1; i >= 0; i -= 1) {
    const listItem = listItemStack[i];
    if (listItem) {
      return listItem;
    }
  }
  return undefined;
}

export function parseMarkdownHierarchy(
  markdownText: string
): MarkdownTreeNode[] {
  const tokens = markdown.parse(markdownText, {});
  const roots: MarkdownTreeNode[] = [];
  const headingStack: Array<{ level: number; node: MarkdownTreeNode }> = [];
  const listItemStack: Array<MarkdownTreeNode | undefined> = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "heading_open") {
      const headingLevel = Number(token.tag.replace("h", ""));
      const inline = tokens[i + 1];
      if (!inline || inline.type !== "inline") {
        continue;
      }
      const text = normalizeMarkdownText(inline.content);
      if (!text) {
        continue;
      }
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= headingLevel
      ) {
        headingStack.pop();
      }
      const parent =
        getLastDefinedListItem(listItemStack) ||
        headingStack[headingStack.length - 1]?.node;
      const node: MarkdownTreeNode = { text, children: [] };
      appendNode(roots, parent, node);
      headingStack.push({ level: headingLevel, node });
      continue;
    }

    if (token.type === "list_item_open") {
      listItemStack.push(undefined);
      continue;
    }

    if (token.type === "list_item_close") {
      listItemStack.pop();
      continue;
    }

    if (token.type !== "paragraph_open") {
      continue;
    }

    const inline = tokens[i + 1];
    if (!inline || inline.type !== "inline") {
      continue;
    }
    const text = normalizeMarkdownText(inline.content);
    if (!text) {
      continue;
    }

    if (listItemStack.length > 0) {
      const currentItemIndex = listItemStack.length - 1;
      const currentListNode = listItemStack[currentItemIndex];
      if (!currentListNode) {
        const parent =
          getLastDefinedListItem(listItemStack.slice(0, -1)) ||
          headingStack[headingStack.length - 1]?.node;
        const node: MarkdownTreeNode = { text, children: [] };
        appendNode(roots, parent, node);
        listItemStack[currentItemIndex] = node;
        continue;
      }
      currentListNode.children.push({ text, children: [] });
      continue;
    }

    const paragraphNode: MarkdownTreeNode = { text, children: [] };
    appendNode(
      roots,
      headingStack[headingStack.length - 1]?.node,
      paragraphNode
    );
  }
  return roots;
}
/* eslint-enable functional/immutable-data, functional/no-let, no-continue */

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
  context: List<ID>
): [Plan, ID] {
  const node = newNode(treeNode.text);
  const withNode = planUpsertNode(plan, node);

  if (treeNode.children.length === 0) {
    return [withNode, node.id];
  }

  const childContext = context.push(node.id);
  const [withChildren, childIDs] = treeNode.children.reduce(
    ([accPlan, accChildIDs], childNode) => {
      const [nextPlan, childID] = materializeTreeNode(
        accPlan,
        childNode,
        childContext
      );
      return [nextPlan, [...accChildIDs, childID]];
    },
    [withNode, [] as ID[]] as [Plan, ID[]]
  );

  const relation = bulkAddRelations(
    newRelations(node.id, context, withChildren.user.publicKey),
    childIDs
  );
  return [planUpsertRelations(withChildren, relation), node.id];
}

export function planCreateNodesFromMarkdownTrees(
  plan: Plan,
  trees: MarkdownTreeNode[],
  context: List<ID> = List()
): [Plan, topNodeIDs: ID[]] {
  const materializeTrees = (
    sourcePlan: Plan,
    sourceContext: List<ID>
  ): [Plan, ID[]] =>
    trees.reduce(
      ([accPlan, accTopNodeIDs], treeNode) => {
        const [nextPlan, topNodeID] = materializeTreeNode(
          accPlan,
          treeNode,
          sourceContext
        );
        return [nextPlan, [...accTopNodeIDs, topNodeID]];
      },
      [sourcePlan, [] as ID[]] as [Plan, ID[]]
    );

  const [planWithContext, topNodeIDs] = materializeTrees(plan, context);
  if (context.size === 0) {
    return [planWithContext, topNodeIDs];
  }

  const [planWithStandaloneContext] = materializeTrees(
    planWithContext,
    List<ID>()
  );
  return [planWithStandaloneContext, topNodeIDs];
}

export function planCreateNodesFromMarkdownFiles(
  plan: Plan,
  files: MarkdownImportFile[],
  context: List<ID> = List()
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
  context: List<ID> = List()
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
