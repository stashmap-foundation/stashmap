import { type RowPath } from "../../../rows/rowPaths";
import type { Plan } from "../../../usecases/session/types";
import { getNodeForView } from "../../../rows/resolveRow";
import {
  ParsedLine,
  parseClipboardText,
} from "../../../usecases/session/editorActions";
import {
  MarkdownTreeNode,
  parseMarkdownHierarchy,
} from "../../../infra/markdownTree";
import { planInsertMarkdownTreesByParentId } from "../../../infra/markdownPlan";

export { parseMarkdownHierarchy } from "../../../infra/markdownTree";
export type { MarkdownImportFile } from "../../../infra/markdownImport";
export { parseMarkdownImportFiles } from "../../../infra/markdownImport";
export {
  planCreateNodesFromMarkdown,
  planCreateNodesFromMarkdownFiles,
  planCreateNodesFromMarkdownTrees,
} from "../../../infra/markdownPlan";

/* eslint-disable functional/immutable-data */
export function parsedLinesToTrees(children: ParsedLine[]): MarkdownTreeNode[] {
  if (children.length === 0) return [];
  const minDepth = Math.min(...children.map((i) => i.depth));
  const roots: MarkdownTreeNode[] = [];
  const stack: MarkdownTreeNode[] = [];
  children.forEach((item) => {
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
  parentRowPath: RowPath,
  stack: ID[],
  insertAtIndex?: number
): Plan {
  const parentNode = getNodeForView(plan, parentRowPath, stack);
  return parentNode
    ? planInsertMarkdownTreesByParentId(
        plan,
        trees,
        parentNode.id,
        insertAtIndex
      ).plan
    : plan;
}
