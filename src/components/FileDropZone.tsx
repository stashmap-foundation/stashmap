import React from "react";
import { useDropzone } from "react-dropzone";
import { ViewPath } from "../ViewContext";
import { Plan, ParsedLine, parseClipboardText, usePlanner } from "../planner";
import { MarkdownTreeNode, parseMarkdownHierarchy } from "../markdownDocument";
import {
  planCreateNodesFromMarkdownFiles,
  planInsertMarkdownTrees,
} from "../markdownPlan";

export type { MarkdownTreeNode } from "../markdownDocument";
export { parseMarkdownHierarchy } from "../markdownDocument";
export type { MarkdownImportFile } from "../markdownImport";
export { parseMarkdownImportFiles } from "../markdownImport";
export {
  planCreateNodesFromMarkdown,
  planCreateNodesFromMarkdownFiles,
  planCreateNodesFromMarkdownTrees,
} from "../markdownPlan";

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

export function planPasteMarkdownTrees(
  plan: Plan,
  trees: MarkdownTreeNode[],
  parentViewPath: ViewPath,
  stack: ID[],
  insertAtIndex?: number
): Plan {
  return planInsertMarkdownTrees(
    plan,
    trees,
    parentViewPath,
    stack,
    insertAtIndex
  ).plan;
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

      const [planWithMarkdown, topItemIDs] = planCreateNodesFromMarkdownFiles(
        createPlan(),
        markdownFiles
      );
      onDrop(planWithMarkdown, topItemIDs);
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
