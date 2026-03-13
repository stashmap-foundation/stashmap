import fs from "fs/promises";
import path from "path";
import { Map } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import {
  getConcreteRefTargetRelation,
  getRefTargetID,
  getRelationsNoReferencedBy,
  joinID,
  isRefNode,
  shortID,
} from "../connections";
import { newDB } from "../knowledge";
import { parseDocumentEvent } from "../markdownRelations";
import { KIND_KNOWLEDGE_DOCUMENT } from "../nostr";
import { SyncPullManifest } from "./syncPull";

type WorkspaceDocument = SyncPullManifest["documents"][number] & {
  root_relation_id: LongID;
};

export type WorkspaceGraph = {
  workspaceDir: string;
  manifest: SyncPullManifest;
  knowledgeDBs: KnowledgeDBs;
  documentsByRootRelationId: Map<LongID, WorkspaceDocument>;
  skippedDocuments: Array<SyncPullManifest["documents"][number]["path"]>;
};

function manifestPath(workspaceDir: string): string {
  return path.join(workspaceDir, "manifest.json");
}

function buildSyntheticDocumentEvent(
  document: SyncPullManifest["documents"][number],
  content: string
): UnsignedEvent {
  return {
    kind: KIND_KNOWLEDGE_DOCUMENT,
    pubkey: document.author,
    created_at: document.created_at,
    tags: [
      ["d", document.d_tag],
      ["ms", `${document.updated_ms}`],
    ],
    content,
  };
}

function getRootRelationId(relation: GraphNode): LongID {
  return relation.root.includes("_")
    ? (relation.root as LongID)
    : joinID(relation.author, relation.root);
}

function getRootRelation(nodes: Map<string, GraphNode>): GraphNode | undefined {
  return nodes.find(
    (relation) =>
      !relation.parent &&
      (relation.root === relation.id || relation.root === shortID(relation.id))
  );
}

function requireManifest(raw: string): SyncPullManifest {
  return JSON.parse(raw) as SyncPullManifest;
}

function resolveRelation(
  knowledgeDBs: KnowledgeDBs,
  relationId: LongID,
  viewer: PublicKey
): GraphNode {
  const relation = getRelationsNoReferencedBy(knowledgeDBs, relationId, viewer);
  if (!relation) {
    throw new Error(`Relation not found: ${relationId}`);
  }
  return relation;
}

export async function loadWorkspaceGraph(
  workspaceDir: string
): Promise<WorkspaceGraph> {
  const manifestRaw = await fs.readFile(manifestPath(workspaceDir), "utf8");
  const manifest = requireManifest(manifestRaw);
  const loadedEntries = await Promise.all(
    manifest.documents.map(async (document) => {
      const content = await fs.readFile(
        path.join(workspaceDir, document.path),
        "utf8"
      );
      const nodes = parseDocumentEvent(
        buildSyntheticDocumentEvent(document, content)
      );
      const rootRelation = getRootRelation(nodes);
      if (!rootRelation) {
        return {
          skippedDocumentPath: document.path,
        };
      }
      return {
        document: {
          ...document,
          root_relation_id: rootRelation.id,
        },
        nodes,
      };
    })
  );
  const entries = loadedEntries.filter(
    (
      entry
    ): entry is {
      document: WorkspaceDocument;
      nodes: Map<string, GraphNode>;
    } => "document" in entry
  );
  const skippedDocuments = loadedEntries.reduce(
    (acc, entry) =>
      "skippedDocumentPath" in entry && entry.skippedDocumentPath
        ? [...acc, entry.skippedDocumentPath]
        : acc,
    [] as string[]
  );

  const knowledgeDBs = entries.reduce((acc, { document, nodes }) => {
    const authorDB = acc.get(document.author, newDB());
    return acc.set(document.author, {
      ...authorDB,
      nodes: nodes.reduce(
        (relationAcc, relation) =>
          relationAcc.set(shortID(relation.id), relation),
        authorDB.nodes
      ),
    });
  }, Map<PublicKey, KnowledgeData>());

  return {
    workspaceDir,
    manifest,
    knowledgeDBs,
    documentsByRootRelationId: Map<LongID, WorkspaceDocument>(
      entries.map(({ document }) => [document.root_relation_id, document])
    ),
    skippedDocuments,
  };
}

export function inspectChildren(
  graph: WorkspaceGraph,
  viewer: PublicKey,
  parentRelationId: LongID
): {
  relation_id: LongID;
  root_relation_id: LongID;
  author: PublicKey;
  text: string;
  skipped_document_count: number;
  children: Array<{
    index: number;
    item_id: ID;
    kind: "relation" | "cref";
    relation_id?: LongID;
    target_relation_id?: LongID;
    text: string;
    relevance: "contains" | Exclude<Relevance, undefined>;
    argument: "none" | Exclude<Argument, undefined>;
  }>;
} {
  const parentRelation = resolveRelation(
    graph.knowledgeDBs,
    parentRelationId,
    viewer
  );
  return {
    relation_id: parentRelation.id,
    root_relation_id: getRootRelationId(parentRelation),
    author: parentRelation.author,
    text: parentRelation.text,
    skipped_document_count: graph.skippedDocuments.length,
    children: parentRelation.children.toArray().map((item, index) => {
      if (isRefNode(item)) {
        const targetRelation = getConcreteRefTargetRelation(
          graph.knowledgeDBs,
          item.id,
          viewer
        );
        const targetRelationId = getRefTargetID(item);
        return {
          index,
          item_id: item.id,
          kind: "cref" as const,
          target_relation_id: targetRelation?.id || targetRelationId,
          text:
            item.linkText ||
            (targetRelation ? targetRelation.text : "") ||
            shortID((targetRelation?.id || targetRelationId || item.id) as ID),
          relevance: (item.relevance || "contains") as
            | "contains"
            | Exclude<Relevance, undefined>,
          argument: (item.argument || "none") as
            | "none"
            | Exclude<Argument, undefined>,
        };
      }
      const childRelation = resolveRelation(
        graph.knowledgeDBs,
        item.id as LongID,
        viewer
      );
      return {
        index,
        item_id: item.id,
        kind: "relation" as const,
        relation_id: childRelation.id,
        text: childRelation.text,
        relevance: (item.relevance || "contains") as
          | "contains"
          | Exclude<Relevance, undefined>,
        argument: (item.argument || "none") as
          | "none"
          | Exclude<Argument, undefined>,
      };
    }),
  };
}
