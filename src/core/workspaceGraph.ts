import fs from "fs/promises";
import path from "path";
import { List, Map, Set as ImmutableSet } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import {
  createConcreteRefId,
  getConcreteRefTargetRelation,
  getRelationsNoReferencedBy,
  hashText,
  isConcreteRefId,
  joinID,
  parseConcreteRefId,
  shortID,
  updateItemArgument,
  updateItemRelevance,
  moveRelations,
  deleteRelations,
} from "../connections";
import { newDB } from "../knowledge";
import { parseDocumentEvent } from "../markdownRelations";
import { KIND_KNOWLEDGE_DOCUMENT } from "../nostr";
import { buildDocumentEventFromRelations } from "../relationsDocumentEvent";
import { withUsersEntryPublicKey } from "../userEntry";
import { SyncPullManifest } from "./syncPull";

type WorkspaceDocument = SyncPullManifest["documents"][number] & {
  root_relation_id: LongID;
};

export type WorkspaceGraph = {
  workspaceDir: string;
  manifest: SyncPullManifest;
  knowledgeDBs: KnowledgeDBs;
  documentsByRootRelationId: Map<LongID, WorkspaceDocument>;
};

type PositionOptions = {
  beforeItemId?: LongID | ID;
  afterItemId?: LongID | ID;
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

function getRootRelationId(relation: Relations): LongID {
  return joinID(relation.author, relation.root);
}

function getRootRelation(
  relations: Map<string, Relations>
): Relations | undefined {
  return relations.find((relation) => relation.root === shortID(relation.id));
}

function upsertRelation(
  knowledgeDBs: KnowledgeDBs,
  relation: Relations
): KnowledgeDBs {
  const authorDB = knowledgeDBs.get(relation.author, newDB());
  return knowledgeDBs.set(relation.author, {
    ...authorDB,
    relations: authorDB.relations.set(shortID(relation.id), relation),
  });
}

function removeRelation(
  knowledgeDBs: KnowledgeDBs,
  relation: Relations
): KnowledgeDBs {
  const authorDB = knowledgeDBs.get(relation.author, newDB());
  return knowledgeDBs.set(relation.author, {
    ...authorDB,
    relations: authorDB.relations.remove(shortID(relation.id)),
  });
}

function requireManifest(raw: string): SyncPullManifest {
  return JSON.parse(raw) as SyncPullManifest;
}

function resolveRelation(
  knowledgeDBs: KnowledgeDBs,
  relationId: LongID,
  viewer: PublicKey
): Relations {
  const relation = getRelationsNoReferencedBy(knowledgeDBs, relationId, viewer);
  if (!relation) {
    throw new Error(`Relation not found: ${relationId}`);
  }
  return relation;
}

function requireOwnedRelation(
  knowledgeDBs: KnowledgeDBs,
  relationId: LongID,
  viewer: PublicKey
): Relations {
  const relation = resolveRelation(knowledgeDBs, relationId, viewer);
  if (relation.author !== viewer) {
    throw new Error(`Relation is not writable: ${relationId}`);
  }
  return relation;
}

function findItemIndex(parentRelation: Relations, itemId: LongID | ID): number {
  return parentRelation.items.findIndex((item) => item.id === itemId);
}

function normalizeRelevance(value: "contains" | Relevance): Relevance {
  return value === "contains" ? undefined : value;
}

function normalizeArgument(value: "none" | Argument): Argument {
  return value === "none" ? undefined : value;
}

function resolveInsertIndex(
  parentRelation: Relations,
  position: PositionOptions
): number {
  if (position.beforeItemId && position.afterItemId) {
    throw new Error("Provide only one of --before or --after");
  }
  if (position.beforeItemId) {
    const index = findItemIndex(parentRelation, position.beforeItemId);
    if (index < 0) {
      throw new Error(`Sibling item not found: ${position.beforeItemId}`);
    }
    return index;
  }
  if (position.afterItemId) {
    const index = findItemIndex(parentRelation, position.afterItemId);
    if (index < 0) {
      throw new Error(`Sibling item not found: ${position.afterItemId}`);
    }
    return index + 1;
  }
  return parentRelation.items.size;
}

function collectOwnedSubtree(
  knowledgeDBs: KnowledgeDBs,
  relation: Relations,
  viewer: PublicKey
): Relations[] {
  return relation.items.reduce((acc, item) => {
    if (isConcreteRefId(item.id)) {
      return acc;
    }
    const childRelation = resolveRelation(
      knowledgeDBs,
      item.id as LongID,
      viewer
    );
    return [
      ...acc,
      childRelation,
      ...collectOwnedSubtree(knowledgeDBs, childRelation, viewer),
    ];
  }, [] as Relations[]);
}

function retargetSubtree(
  knowledgeDBs: KnowledgeDBs,
  relation: Relations,
  newRoot: ID,
  newParent: LongID | undefined,
  viewer: PublicKey
): KnowledgeDBs {
  const updatedRelation: Relations = {
    ...relation,
    parent: newParent,
    root: newRoot,
    ...(newParent ? { anchor: undefined, systemRole: undefined } : {}),
  };
  const withRelation = upsertRelation(knowledgeDBs, updatedRelation);
  return updatedRelation.items.reduce((acc, item) => {
    if (isConcreteRefId(item.id)) {
      return acc;
    }
    const childRelation = resolveRelation(acc, item.id as LongID, viewer);
    return retargetSubtree(
      acc,
      childRelation,
      newRoot,
      updatedRelation.id,
      viewer
    );
  }, withRelation);
}

function publishableRoots(
  knowledgeDBs: KnowledgeDBs,
  rootRelationIds: LongID[],
  viewer: PublicKey
): UnsignedEvent[] {
  return rootRelationIds.map((rootRelationId) => {
    const rootRelation = requireOwnedRelation(
      knowledgeDBs,
      rootRelationId,
      viewer
    );
    return buildDocumentEventFromRelations(knowledgeDBs, rootRelation);
  });
}

function parseInsertedRoot(
  viewer: PublicKey,
  markdownText: string
): { subtreeRelations: Map<string, Relations>; rootRelation: Relations } {
  const importedEvent = buildSyntheticDocumentEvent(
    {
      replaceable_key: "",
      author: viewer,
      event_id: "",
      d_tag: "stdin-root",
      path: "",
      created_at: 0,
      updated_ms: 0,
    },
    markdownText
  );
  const parsedRelations = parseDocumentEvent(importedEvent);
  const rootRelation = getRootRelation(parsedRelations);
  if (!rootRelation) {
    throw new Error(
      "stdin markdown must resolve to exactly one top-level root"
    );
  }
  const visibleRoots = parsedRelations.filter(
    (relation) => relation.root === shortID(relation.id)
  );
  if (visibleRoots.size !== 1) {
    throw new Error(
      "stdin markdown must resolve to exactly one top-level root"
    );
  }
  return {
    subtreeRelations: parsedRelations,
    rootRelation,
  };
}

export async function loadWorkspaceGraph(
  workspaceDir: string
): Promise<WorkspaceGraph> {
  const manifestRaw = await fs.readFile(manifestPath(workspaceDir), "utf8");
  const manifest = requireManifest(manifestRaw);
  const entries = await Promise.all(
    manifest.documents.map(async (document) => {
      const content = await fs.readFile(
        path.join(workspaceDir, document.path),
        "utf8"
      );
      const relations = parseDocumentEvent(
        buildSyntheticDocumentEvent(document, content)
      );
      const rootRelation = getRootRelation(relations);
      if (!rootRelation) {
        throw new Error(
          `Workspace document has no root relation: ${document.path}`
        );
      }
      return {
        document: {
          ...document,
          root_relation_id: rootRelation.id,
        },
        relations,
      };
    })
  );

  const knowledgeDBs = entries.reduce((acc, { document, relations }) => {
    const authorDB = acc.get(document.author, newDB());
    return acc.set(document.author, {
      ...authorDB,
      relations: relations.reduce(
        (relationAcc, relation) =>
          relationAcc.set(shortID(relation.id), relation),
        authorDB.relations
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
  items: Array<{
    index: number;
    item_id: LongID | ID;
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
    items: parentRelation.items.toArray().map((item, index) => {
      if (isConcreteRefId(item.id)) {
        const parsed = parseConcreteRefId(item.id);
        const targetRelation = getConcreteRefTargetRelation(
          graph.knowledgeDBs,
          item.id,
          viewer
        );
        return {
          index,
          item_id: item.id,
          kind: "cref" as const,
          target_relation_id: targetRelation?.id || parsed?.relationID,
          text:
            item.linkText ||
            (targetRelation ? targetRelation.text : "") ||
            shortID(
              (targetRelation?.id || parsed?.relationID || item.id) as ID
            ),
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

export function setRelationText(
  graph: WorkspaceGraph,
  viewer: PublicKey,
  relationId: LongID,
  text: string
): {
  knowledgeDBs: KnowledgeDBs;
  rootRelationIds: LongID[];
  relationId: LongID;
} {
  const relation = requireOwnedRelation(graph.knowledgeDBs, relationId, viewer);
  const updatedRelation = withUsersEntryPublicKey({
    ...relation,
    text,
    textHash: hashText(text),
    updated: Date.now(),
  });
  return {
    knowledgeDBs: upsertRelation(graph.knowledgeDBs, updatedRelation),
    rootRelationIds: [getRootRelationId(updatedRelation)],
    relationId: updatedRelation.id,
  };
}

export function createUnderParent(
  graph: WorkspaceGraph,
  viewer: PublicKey,
  parentRelationId: LongID,
  markdownText: string,
  position: PositionOptions,
  relevance: "contains" | Relevance = "contains",
  argument: "none" | Argument = "none"
): {
  knowledgeDBs: KnowledgeDBs;
  rootRelationIds: LongID[];
  relationId: LongID;
} {
  const parentRelation = requireOwnedRelation(
    graph.knowledgeDBs,
    parentRelationId,
    viewer
  );
  const { subtreeRelations, rootRelation } = parseInsertedRoot(
    viewer,
    markdownText
  );
  const reparentedKnowledge = subtreeRelations.reduce(
    (acc, relation) =>
      upsertRelation(acc, {
        ...relation,
        parent:
          relation.id === rootRelation.id ? parentRelation.id : relation.parent,
        root: parentRelation.root,
        ...(relation.id === rootRelation.id
          ? { anchor: undefined, systemRole: undefined }
          : {}),
      }),
    graph.knowledgeDBs
  );
  const insertionIndex = resolveInsertIndex(parentRelation, position);
  const updatedParent = {
    ...parentRelation,
    items: parentRelation.items.splice(insertionIndex, 0, {
      id: rootRelation.id,
      relevance: normalizeRelevance(relevance),
      argument: normalizeArgument(argument),
    }),
  };
  return {
    knowledgeDBs: upsertRelation(reparentedKnowledge, updatedParent),
    rootRelationIds: [getRootRelationId(updatedParent)],
    relationId: rootRelation.id,
  };
}

export function linkUnderParent(
  graph: WorkspaceGraph,
  viewer: PublicKey,
  parentRelationId: LongID,
  targetRelationId: LongID,
  position: PositionOptions,
  relevance: "contains" | Relevance = "contains",
  argument: "none" | Argument = "none"
): { knowledgeDBs: KnowledgeDBs; rootRelationIds: LongID[]; itemId: LongID } {
  const parentRelation = requireOwnedRelation(
    graph.knowledgeDBs,
    parentRelationId,
    viewer
  );
  const targetRelation = resolveRelation(
    graph.knowledgeDBs,
    targetRelationId,
    viewer
  );
  const insertionIndex = resolveInsertIndex(parentRelation, position);
  const itemId = createConcreteRefId(targetRelation.id);
  const updatedParent = {
    ...parentRelation,
    items: parentRelation.items.splice(insertionIndex, 0, {
      id: itemId,
      relevance: normalizeRelevance(relevance),
      argument: normalizeArgument(argument),
      linkText: targetRelation.text,
    }),
  };
  return {
    knowledgeDBs: upsertRelation(graph.knowledgeDBs, updatedParent),
    rootRelationIds: [getRootRelationId(updatedParent)],
    itemId,
  };
}

export function setItemRelevance(
  graph: WorkspaceGraph,
  viewer: PublicKey,
  parentRelationId: LongID,
  itemId: LongID | ID,
  relevance: "contains" | Relevance
): { knowledgeDBs: KnowledgeDBs; rootRelationIds: LongID[] } {
  const parentRelation = requireOwnedRelation(
    graph.knowledgeDBs,
    parentRelationId,
    viewer
  );
  const itemIndex = findItemIndex(parentRelation, itemId);
  if (itemIndex < 0) {
    throw new Error(`Item not found: ${itemId}`);
  }
  return {
    knowledgeDBs: upsertRelation(
      graph.knowledgeDBs,
      updateItemRelevance(
        parentRelation,
        itemIndex,
        normalizeRelevance(relevance)
      )
    ),
    rootRelationIds: [getRootRelationId(parentRelation)],
  };
}

export function setItemArgument(
  graph: WorkspaceGraph,
  viewer: PublicKey,
  parentRelationId: LongID,
  itemId: LongID | ID,
  argument: "none" | Argument
): { knowledgeDBs: KnowledgeDBs; rootRelationIds: LongID[] } {
  const parentRelation = requireOwnedRelation(
    graph.knowledgeDBs,
    parentRelationId,
    viewer
  );
  const itemIndex = findItemIndex(parentRelation, itemId);
  if (itemIndex < 0) {
    throw new Error(`Item not found: ${itemId}`);
  }
  return {
    knowledgeDBs: upsertRelation(
      graph.knowledgeDBs,
      updateItemArgument(parentRelation, itemIndex, normalizeArgument(argument))
    ),
    rootRelationIds: [getRootRelationId(parentRelation)],
  };
}

export function removeItem(
  graph: WorkspaceGraph,
  viewer: PublicKey,
  parentRelationId: LongID,
  itemId: LongID | ID
): { knowledgeDBs: KnowledgeDBs; rootRelationIds: LongID[] } {
  const parentRelation = requireOwnedRelation(
    graph.knowledgeDBs,
    parentRelationId,
    viewer
  );
  const itemIndex = findItemIndex(parentRelation, itemId);
  if (itemIndex < 0) {
    throw new Error(`Item not found: ${itemId}`);
  }
  const item = parentRelation.items.get(itemIndex);
  if (!item) {
    throw new Error(`Item not found: ${itemId}`);
  }
  const updatedParent = deleteRelations(
    parentRelation,
    ImmutableSet<number>([itemIndex])
  );
  const withUpdatedParent = upsertRelation(graph.knowledgeDBs, updatedParent);
  if (isConcreteRefId(item.id)) {
    return {
      knowledgeDBs: withUpdatedParent,
      rootRelationIds: [getRootRelationId(parentRelation)],
    };
  }
  const childRelation = resolveRelation(
    withUpdatedParent,
    item.id as LongID,
    viewer
  );
  const subtree = collectOwnedSubtree(withUpdatedParent, childRelation, viewer);
  const withoutSubtree = [childRelation, ...subtree].reduce(
    (acc, relation) => removeRelation(acc, relation),
    withUpdatedParent
  );
  return {
    knowledgeDBs: withoutSubtree,
    rootRelationIds: [getRootRelationId(parentRelation)],
  };
}

export function moveItem(
  graph: WorkspaceGraph,
  viewer: PublicKey,
  sourceParentRelationId: LongID,
  itemId: LongID | ID,
  targetParentRelationId: LongID,
  position: PositionOptions
): { knowledgeDBs: KnowledgeDBs; rootRelationIds: LongID[] } {
  const sourceParent = requireOwnedRelation(
    graph.knowledgeDBs,
    sourceParentRelationId,
    viewer
  );
  const targetParent = requireOwnedRelation(
    graph.knowledgeDBs,
    targetParentRelationId,
    viewer
  );
  const sourceIndex = findItemIndex(sourceParent, itemId);
  if (sourceIndex < 0) {
    throw new Error(`Item not found: ${itemId}`);
  }
  const sourceItem = sourceParent.items.get(sourceIndex);
  if (!sourceItem) {
    throw new Error(`Item not found: ${itemId}`);
  }

  if (sourceParent.id === targetParent.id) {
    const startPosition = resolveInsertIndex(sourceParent, position);
    return {
      knowledgeDBs: upsertRelation(
        graph.knowledgeDBs,
        moveRelations(sourceParent, [sourceIndex], startPosition)
      ),
      rootRelationIds: [getRootRelationId(sourceParent)],
    };
  }

  const updatedSourceParent = deleteRelations(
    sourceParent,
    ImmutableSet<number>([sourceIndex])
  );
  const intermediateKnowledge = upsertRelation(
    graph.knowledgeDBs,
    updatedSourceParent
  );
  const targetParentAfterSource = resolveRelation(
    intermediateKnowledge,
    targetParent.id,
    viewer
  );
  const insertionIndex = resolveInsertIndex(targetParentAfterSource, position);
  const updatedTargetParent = {
    ...targetParentAfterSource,
    items: targetParentAfterSource.items.splice(insertionIndex, 0, sourceItem),
  };
  const withParentsUpdated = upsertRelation(
    intermediateKnowledge,
    updatedTargetParent
  );
  const knowledgeDBs = isConcreteRefId(sourceItem.id)
    ? withParentsUpdated
    : retargetSubtree(
        withParentsUpdated,
        resolveRelation(withParentsUpdated, sourceItem.id as LongID, viewer),
        targetParent.root,
        targetParent.id,
        viewer
      );
  const rootRelationIds = List([
    getRootRelationId(sourceParent),
    getRootRelationId(targetParent),
  ])
    .toSet()
    .toArray();
  return {
    knowledgeDBs,
    rootRelationIds,
  };
}

export function buildWorkspaceDocumentEvents(
  knowledgeDBs: KnowledgeDBs,
  rootRelationIds: LongID[],
  viewer: PublicKey
): UnsignedEvent[] {
  return publishableRoots(
    knowledgeDBs,
    List(rootRelationIds).toSet().toArray(),
    viewer
  );
}
