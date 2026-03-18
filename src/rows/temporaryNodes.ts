import type { Map } from "immutable";
import type { PublicKey } from "../graph/identity";
import {
  EMPTY_SEMANTIC_ID,
  type GraphNode,
  type ID,
  type KnowledgeDBs,
  type LongID,
} from "../graph/types";
import { shortID, splitID } from "../graph/context";

type EmptyNodeMetadataEntry = {
  index: number;
  emptyNode: GraphNode;
  paneIndex: number;
};

export function injectEmptyNodesIntoKnowledgeDBs<
  T extends EmptyNodeMetadataEntry
>(
  knowledgeDBs: KnowledgeDBs,
  emptyNodeMetadata: Map<LongID, T>,
  myself: PublicKey
): KnowledgeDBs {
  if (emptyNodeMetadata.size === 0) {
    return knowledgeDBs;
  }

  const myDB = knowledgeDBs.get(myself);
  if (!myDB) {
    return knowledgeDBs;
  }

  const updatedNodes = emptyNodeMetadata.reduce((nodes, data, nodeID) => {
    const shortNodeID = splitID(nodeID)[1];
    const existingNode = nodes.get(shortNodeID);
    if (!existingNode) {
      return nodes;
    }

    const alreadyHasEmpty = existingNode.children.some(
      (childID) => childID === EMPTY_SEMANTIC_ID
    );
    if (alreadyHasEmpty) {
      return nodes;
    }

    return nodes.set(shortNodeID, {
      ...existingNode,
      children: existingNode.children.insert(data.index, EMPTY_SEMANTIC_ID),
    });
  }, myDB.nodes);

  const emptyNodes = emptyNodeMetadata.reduce((nodes, { emptyNode }) => {
    return nodes.set(shortID(emptyNode.id as ID), emptyNode);
  }, updatedNodes);

  return knowledgeDBs.set(myself, {
    ...myDB,
    nodes: emptyNodes,
  });
}
