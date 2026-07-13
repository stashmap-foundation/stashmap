import { LOCAL } from "../core/nodeRef";
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
import { linkSpan, nodeText, plainSpans, spansText } from "../core/nodeSpans";
import { icalFeedLinkText, isBareIcalFeedUrl } from "../core/ical";
import { entityIdForText } from "../core/entityRecognition";
import { getWorkspaceNode } from "../core/knowledge";
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
      author: document.sourceId,
      sourceId: document.sourceId,
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
  const parsed = parseToDocument(LOCAL, file.markdown, {
    filePath: file.name,
    relativePath: file.name,
    fallbackTitle: titleFromFileName(file.name),
    context: {
      knowledgeDBs: plan.knowledgeDBs,
      sourceId: LOCAL,
      affectedDocuments: plan.affectedDocuments,
    },
  });
  const { document } = parsed;
  const key = documentKeyOf(document.sourceId, document.docId);
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
  const root = withDocumentRoot(newGraphNode(plainSpans("Imported Files")));
  const planWithRoot = planUpsertNodes(plan, root);
  const rootDocId = root.docId;
  if (!rootDocId) {
    throw new Error("Imported files document was not created");
  }
  const document = planWithRoot.documents.get(documentKeyOf(LOCAL, rootDocId));
  if (!document) {
    throw new Error("Imported files document was not created");
  }
  const targets = importedDocuments.map((importedDocument) =>
    createDocumentLinkTarget(
      importedDocument.sourceId,
      importedDocument.docId,
      undefined,
      documentDisplayName(importedDocument)
    )
  );
  const [planWithLinks] = planAddTargetsToNode(planWithRoot, root.id, targets);
  const updatedDocument = planWithLinks.documents.get(
    documentKeyOf(document.sourceId, document.docId)
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

// Mint or link, paste case: pasting always lands under a parent, so
// recognized entity text becomes a link row targeting the entity —
// dangling allowed, no page created. The entity's home, if any, lends
// its text. Explicit uuids (real markdown with id comments) are never
// touched.
function entityLinkedTrees(
  plan: Plan,
  trees: MarkdownTreeNode[]
): MarkdownTreeNode[] {
  return trees.map((tree) => {
    const text = spansText(tree.spans);
    const entityId = tree.uuid ? undefined : entityIdForText(text);
    const home = entityId
      ? getWorkspaceNode(plan.knowledgeDBs, entityId as ID)
      : undefined;
    // A bare feed URL wraps into the link form so the name is free from
    // the start — text is yours, identity lives in the parentheses.
    const feedWrap =
      !tree.uuid && !entityId && isBareIcalFeedUrl(text)
        ? { spans: plainSpans(icalFeedLinkText(text.trim())) }
        : {};
    return {
      ...tree,
      ...(entityId
        ? {
            spans: [linkSpan(entityId, home ? nodeText(home) : text.trim())],
          }
        : feedWrap),
      children: entityLinkedTrees(plan, tree.children),
    };
  });
}

export function planPasteMarkdownTrees(
  plan: Plan,
  trees: MarkdownTreeNode[],
  parentNode: GraphNode,
  insertAtIndex?: number
): Plan {
  return planInsertMarkdownTrees(
    plan,
    entityLinkedTrees(plan, trees),
    parentNode,
    insertAtIndex
  ).plan;
}
