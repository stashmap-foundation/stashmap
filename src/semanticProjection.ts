import { List, Set as ImmutableSet } from "immutable";
import {
  isSearchId,
  getNodeContext,
  getNode,
  nodePathLabel,
} from "./core/connections";
import { getAllLinks, soleThingAddress } from "./core/nodeSpans";
import { isThingAddress } from "./core/linkPath";
import { LOG_ROOT_ROLE } from "./core/systemRoots";
import { findReciprocalLinkItem } from "./buildReferenceRow";
import {
  GraphLookup,
  ResolvedNode,
  getNodeInSource,
  graphLookupFromData,
  linkSpeaker,
  lookupNodes,
  resolveAuthoredFirst,
} from "./core/graphLookup";
import { nodeRefKey } from "./core/nodeRef";

type ReferencedByRef = {
  nodeID: ID;
  sourceId: SourceId;
  context: Context;
  updated: number;
};

function getContextKey(context: Context): string {
  return context.join(":");
}

function contextsMatch(leftContext: Context, rightContext: Context): boolean {
  return getContextKey(leftContext) === getContextKey(rightContext);
}

function getNodeCandidates(graph: GraphLookup, nodeID: ID): List<ResolvedNode> {
  return List(lookupNodes(graph, nodeID)).sortBy(
    (resolved) => -resolved.node.updated
  );
}

export function findRefsToNode(
  graph: GraphLookup,
  nodeID: ID,
  filterContext?: Context,
  targetAuthor?: SourceId,
  targetRoot?: ID
): List<ReferencedByRef> {
  const { knowledgeDBs } = graph;
  const resolvedRefs = getNodeCandidates(graph, nodeID)
    .filter(({ node }) => !isSearchId(node.id))
    .filter(({ node, ref }) =>
      getNodeContext(knowledgeDBs, node, ref.sourceId).every(
        (id) => !isSearchId(id)
      )
    )
    .map(({ node, ref }) => ({
      ref: {
        nodeID: node.id,
        sourceId: ref.sourceId,
        context: getNodeContext(knowledgeDBs, node, ref.sourceId),
        updated: node.updated,
      },
      author: ref.sourceId,
      root: node.root,
    }))
    .toList();

  const allRefs = filterContext
    ? resolvedRefs
        .filter(({ ref, author, root }) =>
          targetAuthor !== undefined &&
          targetRoot !== undefined &&
          author === targetAuthor &&
          root === targetRoot
            ? ref.context.equals(filterContext)
            : contextsMatch(ref.context, filterContext)
        )
        .map(({ ref }) => ref)
        .toList()
    : resolvedRefs.map(({ ref }) => ref).toList();

  return allRefs
    .groupBy((ref) => ref.nodeID)
    .map((grp) => grp.first()!)
    .valueSeq()
    .toList();
}

function isInSystemRoot(
  knowledgeDBs: KnowledgeDBs,
  node: GraphNode | undefined,
  sourceId: SourceId,
  systemRole: RootSystemRole
): boolean {
  if (!node) {
    return false;
  }
  const rootNode = getNode(knowledgeDBs, node.root, sourceId);
  return rootNode?.systemRole === systemRole;
}

function incomingFileLinkSourceRefs(
  graphIndex: GraphIndex,
  documentPath: string | undefined,
  author: SourceId
): NodeRef[] {
  if (!documentPath) return [];
  return (
    graphIndex.incomingCrefsByTarget.get(
      nodeRefKey({ sourceId: author, id: documentPath })
    ) ?? []
  );
}

function uniqueNodes(nodes: ResolvedNode[]): ResolvedNode[] {
  const seen = new globalThis.Set<string>();
  return nodes.filter((node) => {
    const key = nodeRefKey(node.ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueRefs(refs: NodeRef[]): NodeRef[] {
  const seen = new globalThis.Set<string>();
  return refs.filter((ref) => {
    const key = nodeRefKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function localChildLinksTo(
  graph: GraphLookup,
  target: ResolvedNode,
  sourceRoot: ResolvedNode
): boolean {
  return target.node.children.some((childID) => {
    const child = getNodeInSource(graph, {
      sourceId: target.ref.sourceId,
      id: childID,
    })?.node;
    const judged =
      child?.relevance !== undefined || child?.argument !== undefined;
    if (childID === sourceRoot.node.id) {
      return judged;
    }
    return child
      ? judged &&
          getAllLinks(child, target.ref.sourceId).some(
            (link) =>
              link.target.id === sourceRoot.node.id &&
              link.target.sourceId === sourceRoot.ref.sourceId
          )
      : false;
  });
}

function sourceRootCoveredByTarget(
  graph: GraphLookup,
  source: ResolvedNode,
  target: ResolvedNode | undefined
): boolean {
  if (!target) {
    return false;
  }
  const sourceRoot = getNodeInSource(graph, {
    sourceId: source.ref.sourceId,
    id: source.node.root,
  });
  return sourceRoot ? localChildLinksTo(graph, target, sourceRoot) : false;
}

function pulledSourceOrder(data: Data, sourceId: SourceId): number | undefined {
  const indexes = [...(data.pull?.matchedSourceIdsByPaneId.values() ?? [])]
    .map((sourceIds) => sourceIds.indexOf(sourceId))
    .filter((index) => index >= 0);
  return indexes.length === 0 ? undefined : Math.min(...indexes);
}

export function getIncomingCrefsForNode(
  data: Data,
  visibleAuthors: ImmutableSet<SourceId>,
  currentNodeID: ID | undefined,
  itemsSourceId: SourceId,
  expansionPath: readonly ID[],
  currentItems: List<GraphNode> | undefined,
  currentDocumentPath: string | undefined
): List<NodeRef> {
  const graph = graphLookupFromData(data);
  const { graphIndex, knowledgeDBs } = graph;
  const current = currentItems || List<GraphNode>();
  const firstCurrent = current.first();
  const target = (() => {
    if (currentNodeID) {
      return resolveAuthoredFirst(graph, currentNodeID, itemsSourceId);
    }
    return firstCurrent
      ? getNodeInSource(graph, { sourceId: itemsSourceId, id: firstCurrent.id })
      : undefined;
  })();

  const graphLinkRefs = (() => {
    if (!currentNodeID) {
      return [];
    }
    const sourceScopedRefs =
      graphIndex.incomingCrefsByTarget.get(
        nodeRefKey({ sourceId: itemsSourceId, id: currentNodeID })
      ) ?? [];
    const thing = isThingAddress(currentNodeID)
      ? currentNodeID
      : target && soleThingAddress(target.node);
    const thingRefs = thing ? graphIndex.incomingCrefs.get(thing) ?? [] : [];
    return uniqueRefs([...sourceScopedRefs, ...thingRefs]);
  })();
  const graphLinkSourceNodes = graphLinkRefs
    .map((ref) => getNodeInSource(graph, ref))
    .filter((node): node is ResolvedNode => node !== undefined);
  const fileLinkSourceNodes = incomingFileLinkSourceRefs(
    graphIndex,
    currentDocumentPath,
    itemsSourceId
  )
    .map((ref) => getNodeInSource(graph, ref))
    .filter((node): node is ResolvedNode => node !== undefined);
  const sourceNodes = uniqueNodes([
    ...graphLinkSourceNodes,
    ...fileLinkSourceNodes,
  ])
    // A reference the view is currently looking through — its carrying
    // row sits on the active expansion path — never queues under itself.
    .filter((source) => !expansionPath.includes(source.node.id))
    .filter(
      (source) =>
        target === undefined ||
        findReciprocalLinkItem(graph, data, source, target) === undefined
    )
    .map((source) => linkSpeaker(graph, source))
    .filter((source) => !sourceRootCoveredByTarget(graph, source, target));
  const visibleSourceNodes = uniqueNodes(sourceNodes)
    .filter(({ ref }) => visibleAuthors.has(ref.sourceId))
    .filter(
      ({ ref }) =>
        target === undefined ||
        ref.sourceId !== target.ref.sourceId ||
        ref.id !== target.ref.id
    )
    .filter(
      ({ ref, node }) =>
        node.systemRole !== LOG_ROOT_ROLE &&
        !isInSystemRoot(knowledgeDBs, node, ref.sourceId, LOG_ROOT_ROLE)
    )
    .sort((left, right) => {
      const leftPullOrder = pulledSourceOrder(data, left.ref.sourceId);
      const rightPullOrder = pulledSourceOrder(data, right.ref.sourceId);
      if (leftPullOrder !== undefined && rightPullOrder !== undefined) {
        return leftPullOrder - rightPullOrder;
      }
      if (leftPullOrder !== undefined) {
        return 1;
      }
      if (rightPullOrder !== undefined) {
        return -1;
      }
      return nodePathLabel(
        knowledgeDBs,
        left.node,
        left.ref.sourceId
      ).localeCompare(
        nodePathLabel(knowledgeDBs, right.node, right.ref.sourceId)
      );
    });

  return List(
    visibleSourceNodes.map(({ ref }) => ({
      sourceId: ref.sourceId,
      id: ref.id,
    }))
  );
}
