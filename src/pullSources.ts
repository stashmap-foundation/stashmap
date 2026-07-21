import { Map as ImmutableMap } from "immutable";
import { Event } from "nostr-tools";
import {
  Document as KnowstrDocument,
  documentAudienceTags,
  getDocumentByIdOrFilePath,
  getDocumentForNode,
  nodeLinkContainerTags,
  parseToDocumentPreservingExplicitIds,
} from "./core/Document";
import { publishStateOf } from "./core/knowstrFrontmatter";
import { getNode } from "./core/connections";
import { isCanonicalId } from "./core/entityRecognition";
import { KIND_KNOWLEDGE_DEPOSIT, ASSET_ENTITY_RELAY } from "./nostr";
import { findTag } from "./nostrEvents";
import { snapshotIdForContent } from "./nodesDocumentEvent";
import { getReadRelays, sanitizeRelayUrl } from "./relayUtils";
import { routeCoordinateSourceId } from "./navigationUrl";
import { LOCAL } from "./core/nodeRef";

export type PullInterest =
  | {
      kind: "tag";
      purpose: "footer" | "related-source";
      paneId: string;
      interestKey: string;
      tags: string[];
      rankTags: string[];
      relays: string[];
    }
  | {
      kind: "coordinate";
      paneId: string;
      interestKey: string;
      coordinate: RouteCoordinate;
      relays: string[];
    };

export type PullSourceRecord =
  | {
      status: "available";
      sourceId: SourceId;
      coordinate: RouteCoordinate;
      latestEventId: string;
      createdAt: number;
      ms: number;
      sTags: string[];
      relays: string[];
      matchedInterestKeys: string[];
      document: KnowstrDocument;
      nodes: ImmutableMap<string, GraphNode>;
      content: string;
      snapshotId: string;
    }
  | {
      status: "unavailable";
      sourceId: SourceId;
      coordinate: RouteCoordinate;
      latestEventId: string;
      createdAt: number;
      ms: number;
      relays: string[];
      matchedInterestKeys: string[];
    };

export type PullRecordMap = ReadonlyMap<SourceId, PullSourceRecord>;

export const RELATED_SOURCE_QUERY_TAG_LIMIT = 100;
export const RELATED_SOURCE_MIN_OVERLAP = 2;

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function normalizedRelayUrls(urls: readonly string[]): string[] {
  return sortedUnique(
    urls
      .map((url) => sanitizeRelayUrl(url))
      .filter((url): url is string => url !== undefined)
  );
}

function readRelayUrls(relays: Relays): string[] {
  return getReadRelays(relays).map((relay) => relay.url);
}

function schemeRelays(tags: readonly string[]): string[] {
  return tags.some((tag) => tag.startsWith("asset:"))
    ? [ASSET_ENTITY_RELAY]
    : [];
}

export function localDocumentTags(document: KnowstrDocument): string[] {
  return documentAudienceTags(document);
}

function localGraphTags(data: Data): string[] {
  return sortedUnique(
    data.documents
      .valueSeq()
      .toArray()
      .flatMap((document) => localDocumentTags(document))
  );
}

export function nodeRelatedTags(
  data: Data,
  node: GraphNode,
  sourceId: SourceId,
  rootIds: ReadonlySet<ID>
): string[] {
  return sortedUnique([
    ...(rootIds.has(node.id) || isCanonicalId(node.id) ? [node.id] : []),
    ...nodeLinkContainerTags(
      data.knowledgeDBs,
      data.documents,
      data.documentByFilePath,
      node,
      sourceId
    ),
  ]);
}

function weightedTags(tags: readonly string[]): RelatedSourceTagWeight[] {
  const counts = tags.reduce(
    (acc, tag) => new Map(acc).set(tag, (acc.get(tag) ?? 0) + 1),
    new Map<string, number>()
  );
  return [...counts.entries()].map(([tag, count]) => ({
    tag,
    weight: Math.log1p(count),
  }));
}

function relatedQueryTags(
  weights: readonly RelatedSourceTagWeight[]
): string[] {
  return weights
    .slice()
    .sort(
      (left, right) =>
        right.weight - left.weight || left.tag.localeCompare(right.tag)
    )
    .slice(0, RELATED_SOURCE_QUERY_TAG_LIMIT)
    .map((weight) => weight.tag);
}

function countTags(
  counts: ReadonlyMap<string, number>,
  tags: readonly string[]
): ReadonlyMap<string, number> {
  return tags.reduce(
    (acc, tag) => new Map(acc).set(tag, (acc.get(tag) ?? 0) + 1),
    counts
  );
}

function subtreeTagCounts(
  data: Data,
  nodes: ImmutableMap<string, GraphNode>,
  rootIds: ReadonlySet<ID>,
  nodeId: ID,
  counts: ReadonlyMap<string, number>
): ReadonlyMap<string, number> {
  const node = nodes.get(nodeId);
  if (!node) {
    return counts;
  }
  const withNode = countTags(
    counts,
    nodeRelatedTags(data, node, LOCAL, rootIds)
  );
  return node.children.reduce(
    (acc, childId) => subtreeTagCounts(data, nodes, rootIds, childId, acc),
    withNode
  );
}

function countsToWeights(
  counts: ReadonlyMap<string, number>
): RelatedSourceTagWeight[] {
  return [...counts.entries()].map(([tag, count]) => ({
    tag,
    weight: Math.log1p(count),
  }));
}

function documentRelatedTags(data: Data, document: KnowstrDocument): string[] {
  const nodes = data.knowledgeDBs.get(LOCAL)?.nodes;
  if (!nodes) {
    return [];
  }
  const rootIds = new Set<ID>(document.topNodeShortIds);
  const counts = document.topNodeShortIds.reduce<ReadonlyMap<string, number>>(
    (acc, id) => subtreeTagCounts(data, nodes, rootIds, id, acc),
    new Map<string, number>()
  );
  return relatedQueryTags(countsToWeights(counts));
}

function pathToRoot(
  nodes: ImmutableMap<string, GraphNode>,
  node: GraphNode
): GraphNode[] {
  const parent = node.parent ? nodes.get(node.parent) : undefined;
  return parent ? [...pathToRoot(nodes, parent), node] : [node];
}

function nodeContextRelatedTags(data: Data, node: GraphNode): string[] {
  const nodes = data.knowledgeDBs.get(LOCAL)?.nodes;
  if (!nodes) {
    return [];
  }
  const path = pathToRoot(nodes, node);
  const rootId = path[0]?.id;
  const rootIds = new Set<ID>(rootId ? [rootId] : []);
  const pathCounts = path.reduce<ReadonlyMap<string, number>>(
    (acc, pathNode) =>
      countTags(acc, nodeRelatedTags(data, pathNode, LOCAL, rootIds)),
    new Map<string, number>()
  );
  return relatedQueryTags(
    countsToWeights(subtreeTagCounts(data, nodes, rootIds, node.id, pathCounts))
  );
}

function paneRelatedTags(
  data: Data,
  pane: Pane,
  paneTags: readonly string[]
): string[] {
  if (pane.documentId) {
    const document = getDocumentByIdOrFilePath(
      data.documents,
      data.documentByFilePath,
      LOCAL,
      pane.documentId
    );
    return document
      ? documentRelatedTags(data, document)
      : relatedQueryTags(weightedTags(paneTags));
  }
  if (!pane.rootNodeId) {
    return [];
  }
  const node = getNode(data.knowledgeDBs, pane.rootNodeId, LOCAL);
  if (!node) {
    return relatedQueryTags(weightedTags(paneTags));
  }
  if (node.parent) {
    return nodeContextRelatedTags(data, node);
  }
  const document = getDocumentForNode(
    data.knowledgeDBs,
    data.documents,
    node,
    LOCAL
  );
  return document
    ? documentRelatedTags(data, document)
    : nodeContextRelatedTags(data, node);
}

function relaysForTags(
  tags: readonly string[],
  defaultRelays: Relays,
  userRelays: Relays,
  document: KnowstrDocument | undefined
): string[] {
  const declared = publishStateOf(document?.frontMatter)?.relays ?? [];
  return normalizedRelayUrls([
    ...readRelayUrls(defaultRelays),
    ...readRelayUrls(userRelays),
    ...schemeRelays(tags),
    ...declared,
  ]);
}

function interestKey(
  paneId: string,
  kind: string,
  parts: readonly string[],
  relays: readonly string[]
): string {
  return [
    paneId,
    kind,
    sortedUnique(parts).join(","),
    sortedUnique(relays).join(","),
  ].join("|");
}

export function derivePullInterests(
  data: Data,
  defaultRelays: Relays,
  userRelays: Relays
): PullInterest[] {
  const graphTags = localGraphTags(data);
  return data.panes.flatMap((pane): PullInterest[] => {
    if (pane.sourceId !== LOCAL) {
      const coordinate = pane.routeCoordinate;
      if (!coordinate || coordinate.eventKind !== KIND_KNOWLEDGE_DEPOSIT) {
        return [];
      }
      const relays = normalizedRelayUrls([
        ...coordinate.relays,
        ...readRelayUrls(defaultRelays),
        ...readRelayUrls(userRelays),
      ]);
      if (relays.length === 0) {
        return [];
      }
      return [
        {
          kind: "coordinate",
          paneId: pane.id,
          coordinate,
          relays,
          interestKey: interestKey(
            pane.id,
            "coordinate",
            [routeCoordinateSourceId(coordinate)],
            relays
          ),
        },
      ];
    }

    const tags = (() => {
      if (pane.documentId) {
        const document = getDocumentByIdOrFilePath(
          data.documents,
          data.documentByFilePath,
          LOCAL,
          pane.documentId
        );
        return document ? localDocumentTags(document) : [];
      }
      if (!pane.rootNodeId) {
        return [];
      }
      if (isCanonicalId(pane.rootNodeId)) {
        return [pane.rootNodeId];
      }
      const node = getNode(data.knowledgeDBs, pane.rootNodeId, LOCAL);
      const document = node
        ? getDocumentForNode(data.knowledgeDBs, data.documents, node, LOCAL)
        : undefined;
      return document ? localDocumentTags(document) : [pane.rootNodeId];
    })();

    const normalizedTags = sortedUnique(tags.filter((tag) => tag !== ""));
    if (normalizedTags.length === 0) {
      return [];
    }
    const document = pane.documentId
      ? getDocumentByIdOrFilePath(
          data.documents,
          data.documentByFilePath,
          LOCAL,
          pane.documentId
        )
      : undefined;
    const relays = relaysForTags(
      normalizedTags,
      defaultRelays,
      userRelays,
      document
    );
    if (relays.length === 0) {
      return [];
    }
    const footerInterest: PullInterest = {
      kind: "tag",
      purpose: "footer",
      paneId: pane.id,
      tags: normalizedTags,
      rankTags: sortedUnique([...normalizedTags, ...graphTags]),
      relays,
      interestKey: interestKey(pane.id, "tag", normalizedTags, relays),
    };
    const relatedTags = sortedUnique(
      paneRelatedTags(data, pane, normalizedTags).filter((tag) => tag !== "")
    );
    if (relatedTags.length < RELATED_SOURCE_MIN_OVERLAP) {
      return [footerInterest];
    }
    const relatedRelays = relaysForTags(
      relatedTags,
      defaultRelays,
      userRelays,
      document
    );
    if (relatedRelays.length === 0) {
      return [footerInterest];
    }
    return [
      footerInterest,
      {
        kind: "tag",
        purpose: "related-source",
        paneId: pane.id,
        tags: relatedTags,
        rankTags: sortedUnique([...relatedTags, ...graphTags]),
        relays: relatedRelays,
        interestKey: interestKey(
          pane.id,
          "related",
          relatedTags,
          relatedRelays
        ),
      },
    ];
  });
}

function firstNonEmptyTag(event: Event, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name && tag[1])?.[1];
}

function eventMs(event: Event): number {
  const ms = Number(findTag(event, "ms"));
  return Number.isFinite(ms) ? ms : event.created_at * 1000;
}

function replacementTuple(record: PullSourceRecord): [number, number, string] {
  return [record.createdAt, record.ms, record.latestEventId];
}

function eventTuple(event: Event): [number, number, string] {
  return [event.created_at, eventMs(event), event.id];
}

function compareTuple(
  left: [number, number, string],
  right: [number, number, string]
): number {
  return (
    left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2])
  );
}

export function matchedInterestKeys(
  record: PullSourceRecord,
  interests: readonly PullInterest[]
): string[] {
  return interests
    .filter((interest) => {
      if (interest.kind === "coordinate") {
        return routeCoordinateSourceId(interest.coordinate) === record.sourceId;
      }
      if (record.status !== "available") {
        return false;
      }
      return interest.tags.some((tag) => record.sTags.includes(tag));
    })
    .map((interest) => interest.interestKey);
}

function recordRelays(
  coordinate: RouteCoordinate,
  eventRelays: readonly string[],
  interests: readonly PullInterest[]
): string[] {
  const matchingInterestRelays = interests
    .filter((interest) => {
      if (interest.kind === "coordinate") {
        return (
          routeCoordinateSourceId(interest.coordinate) ===
          routeCoordinateSourceId(coordinate)
        );
      }
      return true;
    })
    .flatMap((interest) => interest.relays);
  return normalizedRelayUrls([
    ...coordinate.relays,
    ...eventRelays,
    ...matchingInterestRelays,
  ]);
}

export function recordFromDepositEvent(
  event: Event,
  interests: readonly PullInterest[],
  eventRelays: readonly string[],
  matchedKeysOverride?: readonly string[]
): PullSourceRecord | undefined {
  if (event.kind !== KIND_KNOWLEDGE_DEPOSIT) {
    return undefined;
  }
  const dTag = firstNonEmptyTag(event, "d");
  if (!dTag) {
    return undefined;
  }
  const coordinate: RouteCoordinate = {
    eventKind: KIND_KNOWLEDGE_DEPOSIT,
    pubkey: event.pubkey as PublicKey,
    dTag,
    relays: normalizedRelayUrls(eventRelays),
  };
  const sourceId = routeCoordinateSourceId(coordinate);
  const ms = eventMs(event);
  const createdAt = event.created_at;
  const relays = recordRelays(coordinate, eventRelays, interests);
  const unavailable = (): PullSourceRecord => ({
    status: "unavailable",
    sourceId,
    coordinate,
    latestEventId: event.id,
    createdAt,
    ms,
    relays,
    matchedInterestKeys: [...(matchedKeysOverride ?? [])],
  });
  const sTags = sortedUnique(
    event.tags.filter((tag) => tag[0] === "S" && tag[1]).map((tag) => tag[1])
  );
  if (event.content.trim() === "" || sTags.length === 0) {
    return unavailable();
  }
  try {
    const parsed = parseToDocumentPreservingExplicitIds(
      sourceId,
      event.content,
      {
        docIdFallback: dTag,
        updatedMsOverride: ms,
      }
    );
    if (
      parsed.document.docId !== dTag ||
      parsed.document.topNodeShortIds.length === 0
    ) {
      return unavailable();
    }
    const record: PullSourceRecord = {
      status: "available",
      sourceId,
      coordinate,
      latestEventId: event.id,
      createdAt,
      ms,
      sTags,
      relays,
      matchedInterestKeys: [],
      document: parsed.document,
      nodes: parsed.nodes,
      content: event.content,
      snapshotId: snapshotIdForContent(event.content),
    };
    return {
      ...record,
      matchedInterestKeys: [
        ...(matchedKeysOverride ?? matchedInterestKeys(record, interests)),
      ],
    };
  } catch {
    return unavailable();
  }
}

export function applyDepositEventToRecords(
  records: PullRecordMap,
  event: Event,
  interests: readonly PullInterest[],
  eventRelays: readonly string[],
  options: {
    ignoreLocalPubkey?: PublicKey;
    matchedKeysOverride?: readonly string[];
  } = {}
): Map<SourceId, PullSourceRecord> {
  if (options.ignoreLocalPubkey && event.pubkey === options.ignoreLocalPubkey) {
    return new Map(records);
  }
  const nextRecord = recordFromDepositEvent(
    event,
    interests,
    eventRelays,
    options.matchedKeysOverride
  );
  if (!nextRecord) {
    return new Map(records);
  }
  const existing = records.get(nextRecord.sourceId);
  if (
    existing &&
    compareTuple(eventTuple(event), replacementTuple(existing)) <= 0
  ) {
    return new Map(records);
  }
  const rematched = {
    ...nextRecord,
    matchedInterestKeys: matchedInterestKeys(nextRecord, interests),
  } as PullSourceRecord;
  const next = new Map(records);
  next.set(rematched.sourceId, rematched);
  return next;
}

export function rematchRecords(
  records: PullRecordMap,
  interests: readonly PullInterest[]
): Map<SourceId, PullSourceRecord> {
  const activePaneIds = new Set(interests.map((interest) => interest.paneId));
  const next = new Map<SourceId, PullSourceRecord>();
  records.forEach((record) => {
    const matchedInterestKeysForRecord = matchedInterestKeys(record, interests);
    const keepUnavailable =
      record.status === "unavailable" && activePaneIds.size > 0;
    if (matchedInterestKeysForRecord.length === 0 && !keepUnavailable) {
      return;
    }
    next.set(record.sourceId, {
      ...record,
      matchedInterestKeys: matchedInterestKeysForRecord,
    } as PullSourceRecord);
  });
  return next;
}
