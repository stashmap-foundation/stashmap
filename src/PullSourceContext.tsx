import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Map as ImmutableMap } from "immutable";
import { Event, Filter } from "nostr-tools";
import { useBackend } from "./BackendContext";
import { DataContextProvider, useData } from "./DataContext";
import { useUserRelayContext } from "./UserRelayContext";
import {
  addNodesToGraphIndex,
  createEmptyGraphIndex,
  mergeGraphIndexes,
} from "./graphIndex";
import {
  Document as KnowstrDocument,
  documentKeyOf,
  parseToDocument,
} from "./core/Document";
import { KIND_KNOWLEDGE_DEPOSIT } from "./nostr";
import {
  PullInterest,
  PullRecordMap,
  PullSourceRecord,
  applyDepositEventToRecords,
  derivePullInterests,
  normalizedRelayUrls,
  rematchRecords,
} from "./pullSources";
import { snapshotIdForContent } from "./nodesDocumentEvent";
import { LOCAL } from "./core/nodeRef";

function interestFilter(interest: PullInterest): Filter {
  if (interest.kind === "tag") {
    return { kinds: [KIND_KNOWLEDGE_DEPOSIT], "#S": interest.tags };
  }
  return {
    kinds: [KIND_KNOWLEDGE_DEPOSIT],
    authors: [interest.coordinate.pubkey],
    "#d": [interest.coordinate.dTag],
  };
}

function recordsSignature(records: PullRecordMap): string {
  return [...records.values()]
    .map((record) =>
      [
        record.sourceId,
        record.latestEventId,
        record.matchedInterestKeys.join(","),
        record.status,
      ].join(":")
    )
    .sort()
    .join("|");
}

function interestsSignature(interests: readonly PullInterest[]): string {
  return interests
    .map((interest) => interest.interestKey)
    .sort()
    .join("|");
}

function rankSignature(interests: readonly PullInterest[]): string {
  return interests
    .map((interest) =>
      interest.kind === "tag"
        ? [interest.interestKey, interest.rankTags.join(",")].join(":")
        : interest.interestKey
    )
    .sort()
    .join("|");
}

function sourceRecordMetadata(
  record: PullSourceRecord
): PullSourceMetadata | undefined {
  if (record.status !== "available") {
    return undefined;
  }
  return {
    sourceId: record.sourceId,
    coordinate: record.coordinate,
    latestEventId: record.latestEventId,
    ms: record.ms,
    sTags: record.sTags,
    relays: record.relays,
    snapshotId: record.snapshotId,
    title: record.document.title,
    rootIds: record.document.topNodeShortIds,
  };
}

function buildOverlayGraphIndex(records: PullRecordMap): GraphIndex {
  return [...records.values()].reduce((acc, record) => {
    if (record.status !== "available") {
      return acc;
    }
    return addNodesToGraphIndex(acc, record.nodes, undefined, record.sourceId);
  }, createEmptyGraphIndex());
}

function buildOverlayKnowledgeDBs(records: PullRecordMap): KnowledgeDBs {
  return ImmutableMap<SourceId, KnowledgeData>(
    [...records.values()]
      .filter(
        (
          record
        ): record is Extract<PullSourceRecord, { status: "available" }> =>
          record.status === "available"
      )
      .map((record) => [record.sourceId, { nodes: record.nodes }])
  );
}

function buildOverlayDocuments(
  records: PullRecordMap
): ImmutableMap<string, KnowstrDocument> {
  return ImmutableMap<string, KnowstrDocument>(
    [...records.values()]
      .filter(
        (
          record
        ): record is Extract<PullSourceRecord, { status: "available" }> =>
          record.status === "available"
      )
      .map((record) => [
        documentKeyOf(record.sourceId, record.document.docId),
        record.document,
      ])
  );
}

function buildOverlaySnapshots(records: PullRecordMap): SnapshotNodes {
  return ImmutableMap(
    [...records.values()]
      .filter(
        (
          record
        ): record is Extract<PullSourceRecord, { status: "available" }> =>
          record.status === "available"
      )
      .map((record) => [
        snapshotIdForContent(record.content),
        parseToDocument(LOCAL, record.content, {
          docIdFallback: record.snapshotId,
        }).nodes,
      ])
  );
}

function overlapCount(
  record: Extract<PullSourceRecord, { status: "available" }>,
  tags: readonly string[]
): number {
  return tags.filter((tag) => record.sTags.includes(tag)).length;
}

function sourceRank(
  record: Extract<PullSourceRecord, { status: "available" }>,
  localTags: readonly string[],
  rankTags: readonly string[]
): [number, number, number, number, string] {
  const localOverlap = overlapCount(record, localTags);
  const rankOverlap = overlapCount(record, rankTags);
  const normalized =
    record.sTags.length === 0 ? 0 : rankOverlap / record.sTags.length;
  return [
    localOverlap,
    rankOverlap,
    normalized,
    record.ms,
    record.document.title,
  ];
}

function compareRank(
  left: Extract<PullSourceRecord, { status: "available" }>,
  right: Extract<PullSourceRecord, { status: "available" }>,
  localTags: readonly string[],
  rankTags: readonly string[]
): number {
  const leftRank = sourceRank(left, localTags, rankTags);
  const rightRank = sourceRank(right, localTags, rankTags);
  return (
    rightRank[0] - leftRank[0] ||
    rightRank[1] - leftRank[1] ||
    rightRank[2] - leftRank[2] ||
    rightRank[3] - leftRank[3] ||
    leftRank[4].localeCompare(rightRank[4]) ||
    left.sourceId.localeCompare(right.sourceId)
  );
}

function matchedPaneMap(
  records: PullRecordMap,
  interests: readonly PullInterest[],
  purpose: "footer" | "related-source"
): ReadonlyMap<string, readonly SourceId[]> {
  const paneIds = new Set(interests.map((interest) => interest.paneId));
  const entries = [...paneIds].map((paneId): [string, readonly SourceId[]] => {
    const paneInterests = interests.filter((interest) => {
      if (interest.paneId !== paneId) {
        return false;
      }
      if (purpose === "related-source") {
        return interest.kind === "tag" && interest.purpose === purpose;
      }
      return interest.kind === "coordinate" || interest.purpose === purpose;
    });
    const keys = new Set(paneInterests.map((interest) => interest.interestKey));
    const localTags = [
      ...new Set(
        paneInterests.flatMap((interest) =>
          interest.kind === "tag" ? interest.tags : []
        )
      ),
    ];
    const rankTags = [
      ...new Set(
        paneInterests.flatMap((interest) =>
          interest.kind === "tag" ? interest.rankTags : []
        )
      ),
    ];
    const sourceIds = [...records.values()]
      .filter(
        (
          record
        ): record is Extract<PullSourceRecord, { status: "available" }> =>
          record.status === "available" &&
          record.matchedInterestKeys.some((key) => keys.has(key))
      )
      .sort((left, right) => compareRank(left, right, localTags, rankTags))
      .map((record) => record.sourceId);
    return [paneId, sourceIds];
  });
  return new Map(entries);
}

function overlayData(
  records: PullRecordMap,
  interests: readonly PullInterest[]
): PullOverlayData {
  const availableRecords = [...records.values()].filter(
    (record): record is Extract<PullSourceRecord, { status: "available" }> =>
      record.status === "available" && record.matchedInterestKeys.length > 0
  );
  return {
    sourceIds: new Set(availableRecords.map((record) => record.sourceId)),
    matchedSourceIdsByPaneId: matchedPaneMap(records, interests, "footer"),
    relatedSourceIdsByPaneId: matchedPaneMap(
      records,
      interests,
      "related-source"
    ),
    metadataBySourceId: new Map(
      availableRecords.flatMap((record): [SourceId, PullSourceMetadata][] => {
        const metadata = sourceRecordMetadata(record);
        return metadata ? [[record.sourceId, metadata]] : [];
      })
    ),
  };
}

function followInterests(records: PullRecordMap): PullInterest[] {
  return [...records.values()]
    .filter(
      (record): record is Extract<PullSourceRecord, { status: "available" }> =>
        record.status === "available" && record.matchedInterestKeys.length > 0
    )
    .map((record) => {
      const relays = normalizedRelayUrls(record.relays);
      return {
        kind: "coordinate" as const,
        paneId: `follow:${record.sourceId}`,
        coordinate: record.coordinate,
        relays,
        interestKey: ["follow", record.sourceId, relays.join(",")].join("|"),
      };
    })
    .filter((interest) => interest.relays.length > 0);
}

export function PullSourceProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const data = useData();
  const backend = useBackend();
  const { userRelays } = useUserRelayContext();
  const [records, setRecords] = useState<Map<SourceId, PullSourceRecord>>(
    () => new Map()
  );
  const interests = useMemo(
    () => derivePullInterests(data, backend.defaultRelays, userRelays),
    [data, backend.defaultRelays, userRelays]
  );
  const interestSig = interestsSignature(interests);
  const rankSig = rankSignature(interests);
  useEffect(() => {
    setRecords((current) => rematchRecords(current, interests));
  }, [interestSig]);

  const onEvent = useCallback(
    (event: Event, interest: PullInterest, ignoreLocal: boolean): void => {
      setRecords((current) =>
        applyDepositEventToRecords(
          current,
          event,
          interests,
          interest.relays,
          ignoreLocal ? { ignoreLocalPubkey: data.user?.publicKey } : {}
        )
      );
    },
    [data.user?.publicKey, interestSig]
  );

  useEffect(() => {
    const closers = interests.map((interest) =>
      backend.subscribe(interest.relays, [interestFilter(interest)], {
        onevent: (event) => onEvent(event, interest, interest.kind === "tag"),
      })
    );
    return () => {
      closers.forEach((closer) => closer.close());
    };
  }, [backend, interestSig, onEvent]);

  const follow = useMemo(
    () => followInterests(records),
    [recordsSignature(records)]
  );
  const followSig = interestsSignature(follow);
  useEffect(() => {
    const closers = follow.map((interest) =>
      backend.subscribe(interest.relays, [interestFilter(interest)], {
        onevent: (event) => onEvent(event, interest, false),
      })
    );
    return () => {
      closers.forEach((closer) => closer.close());
    };
  }, [backend, followSig, onEvent]);

  const visibleRecords = useMemo(() => {
    return new Map(
      [...records.entries()].filter(
        ([, record]) =>
          record.status === "available" && record.matchedInterestKeys.length > 0
      )
    );
  }, [recordsSignature(records)]);
  const pull = useMemo(
    () => overlayData(records, interests),
    [recordsSignature(records), interestSig, rankSig]
  );
  const overlayKnowledgeDBs = buildOverlayKnowledgeDBs(visibleRecords);
  const mergedKnowledgeDBs = data.knowledgeDBs.mergeWith(
    (left, right) => ({ nodes: left.nodes.merge(right.nodes) }),
    overlayKnowledgeDBs
  );
  const overlayGraphIndex = buildOverlayGraphIndex(visibleRecords);
  const overlayDocuments = buildOverlayDocuments(visibleRecords);

  return (
    <DataContextProvider
      user={data.user}
      knowledgeDBs={mergedKnowledgeDBs}
      graphIndex={mergeGraphIndexes(data.graphIndex, overlayGraphIndex)}
      documents={data.documents.merge(overlayDocuments)}
      documentByFilePath={data.documentByFilePath}
      relaysInfos={data.relaysInfos}
      publishEventsStatus={data.publishEventsStatus}
      snapshotNodes={data.snapshotNodes.merge(
        buildOverlaySnapshots(visibleRecords)
      )}
      calendarFeeds={data.calendarFeeds}
      pull={pull}
      views={data.views}
      panes={data.panes}
    >
      {children}
    </DataContextProvider>
  );
}
