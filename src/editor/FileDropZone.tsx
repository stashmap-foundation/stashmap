import { ViewPath } from "../ViewContext";
import {
  Plan,
  ParsedLine,
  parseClipboardText,
  planAddTargetsToNode,
  planUpdatePanes,
  planUpsertNodes,
} from "../planner";
import { MarkdownTreeNode, parseMarkdown } from "../core/markdownTree";
import { planInsertMarkdownTrees } from "../markdownPlan";
import { plainSpans } from "../core/nodeSpans";
import { newGraphNode } from "../core/nodeFactory";
import { createDocumentLinkTarget } from "../core/connections";
import { withDocumentRoot } from "../core/plan";
import {
  documentDisplayName,
  documentKeyOf,
  parseToDocument,
} from "../core/Document";
import type { Document } from "../core/Document";
import type { MarkdownImportFile } from "../core/markdownImport";

export type { MarkdownImportFile } from "../core/markdownImport";
export { parseMarkdownImportFiles } from "../core/markdownImport";
export {
  planCreateNodesFromMarkdown,
  planCreateNodesFromMarkdownFiles,
  planCreateNodesFromMarkdownTrees,
} from "../markdownPlan";

/* eslint-disable functional/immutable-data */
export function parsedLinesToTrees(children: ParsedLine[]): MarkdownTreeNode[] {
  if (children.length === 0) return [];
  const minDepth = Math.min(...children.map((i) => i.depth));
  const roots: MarkdownTreeNode[] = [];
  const stack: MarkdownTreeNode[] = [];
  children.forEach((item) => {
    const depth = item.depth - minDepth;
    const node: MarkdownTreeNode = {
      spans: plainSpans(item.text),
      children: [],
    };
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
    return parseMarkdown(text).tree;
  }
  return parsedLinesToTrees(parseClipboardText(text));
}

function titleFromFileName(fileName: string): string {
  const baseName = fileName.replace(/\.[^/.]+$/u, "").trim();
  return baseName || "Imported Markdown";
}

function setPaneToDocument(
  plan: Plan,
  paneIndex: number,
  document: Document
): Plan {
  const updatedPanes = plan.panes.map((paneState, idx) => {
    if (idx !== paneIndex) {
      return paneState;
    }
    return {
      ...paneState,
      author: document.author,
      documentId: document.docId,
      rootNodeId: undefined,
      searchQuery: undefined,
      searchResultIDs: undefined,
      scrollToId: undefined,
    };
  });
  return planUpdatePanes(plan, updatedPanes);
}

function upsertParsedDocument(
  plan: Plan,
  file: MarkdownImportFile
): { plan: Plan; document: Document } {
  const parsed = parseToDocument(plan.user.publicKey, file.markdown, {
    filePath: file.name,
    relativePath: file.name,
    fallbackTitle: titleFromFileName(file.name),
    context: {
      knowledgeDBs: plan.knowledgeDBs,
      publicKey: plan.user.publicKey,
      affectedDocuments: plan.affectedDocuments,
    },
  });
  const { document } = parsed;
  const key = documentKeyOf(document.author, document.docId);
  return {
    plan: {
      ...plan,
      knowledgeDBs: parsed.context.knowledgeDBs,
      documents: plan.documents.set(key, document),
      documentByFilePath: document.filePath
        ? plan.documentByFilePath.set(document.filePath, document)
        : plan.documentByFilePath,
      affectedDocuments: parsed.context.affectedDocuments.add(document.docId),
    },
    document,
  };
}

function planImportMarkdownFilesAsDocuments(
  plan: Plan,
  files: ReadonlyArray<MarkdownImportFile>
): { plan: Plan; documents: Document[] } {
  return files.reduce<{ plan: Plan; documents: Document[] }>(
    (acc, file) => {
      const imported = upsertParsedDocument(acc.plan, file);
      return {
        plan: imported.plan,
        documents: [...acc.documents, imported.document],
      };
    },
    { plan, documents: [] }
  );
}

function planCreateImportedFilesDocument(
  plan: Plan,
  importedDocuments: ReadonlyArray<Document>
): { plan: Plan; document: Document } {
  const root = withDocumentRoot(
    newGraphNode(plan.user.publicKey, plainSpans("Imported Files"))
  );
  const planWithRoot = planUpsertNodes(plan, root);
  const rootDocId = root.docId;
  if (!rootDocId) {
    throw new Error("Imported files document was not created");
  }
  const document = planWithRoot.documents.get(
    documentKeyOf(root.author, rootDocId)
  );
  if (!document) {
    throw new Error("Imported files document was not created");
  }
  const targets = importedDocuments.map((importedDocument) =>
    createDocumentLinkTarget(
      importedDocument.author,
      importedDocument.docId,
      importedDocument.docId,
      documentDisplayName(importedDocument)
    )
  );
  const [planWithLinks] = planAddTargetsToNode(planWithRoot, root, targets);
  const updatedDocument = planWithLinks.documents.get(
    documentKeyOf(document.author, document.docId)
  );
  return {
    plan: planWithLinks,
    document: updatedDocument ?? document,
  };
}

export function planImportMarkdownFilesAtEmptyRoot(
  plan: Plan,
  files: ReadonlyArray<MarkdownImportFile>,
  paneIndex: number
): Plan {
  if (files.length === 0) {
    return plan;
  }
  const imported = planImportMarkdownFilesAsDocuments(plan, files);
  if (imported.documents.length === 1) {
    return setPaneToDocument(imported.plan, paneIndex, imported.documents[0]);
  }
  const wrapper = planCreateImportedFilesDocument(
    imported.plan,
    imported.documents
  );
  return setPaneToDocument(wrapper.plan, paneIndex, wrapper.document);
}

export function planPasteMarkdownTrees(
  plan: Plan,
  trees: MarkdownTreeNode[],
  parentViewPath: ViewPath,
  insertAtIndex?: number
): Plan {
  return planInsertMarkdownTrees(plan, trees, parentViewPath, insertAtIndex)
    .plan;
}
