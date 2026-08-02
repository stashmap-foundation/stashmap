import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Map as ImmutableMap } from "immutable";
import { Event, Filter } from "nostr-tools";
import { useBackend } from "./BackendContext";
import { DataContextProvider, useData } from "./DataContext";
import {
  addNodesToGraphIndex,
  createEmptyGraphIndex,
  mergeGraphIndexes,
} from "./graphIndex";
import { Document as KnowstrDocument, documentKeyOf } from "./core/Document";
import { KIND_KNOWLEDGE_DEPOSIT } from "./nostr";
import {
  PullInterest,
  PullRecordMap,
  PullSourceRecord,
  applyDepositEventToRecords,
  derivePullInterests,
  rematchRecords,
} from "./pullSources";

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

function matchedPaneMap(
  records: PullRecordMap,
  interests: readonly PullInterest[]
): ReadonlyMap<string, readonly SourceId[]> {
  const paneIds = new Set(interests.map((interest) => interest.paneId));
  const entries = [...paneIds].map((paneId): [string, readonly SourceId[]] => {
    const paneInterests = interests.filter(
      (interest) => interest.paneId === paneId
    );
    const keys = new Set(paneInterests.map((interest) => interest.interestKey));
    const sourceIds = [...records.values()]
      .filter(
        (
          record
        ): record is Extract<PullSourceRecord, { status: "available" }> =>
          record.status === "available" &&
          record.matchedInterestKeys.some((key) => keys.has(key))
      )
      .map((record) => record.sourceId)
      .sort();
    return [paneId, sourceIds];
  });
  return new Map(entries);
}

function overlayData(
  records: PullRecordMap,
  interests: readonly PullInterest[]
): PullOverlayData {
  return {
    matchedSourceIdsByPaneId: matchedPaneMap(records, interests),
    coordinatesBySourceId: new Map(
      [...records.values()].map((record) => [
        record.sourceId,
        { ...record.coordinate, relays: record.relays },
      ])
    ),
  };
}

export function PullSourceProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const data = useData();
  const backend = useBackend();
  const [records, setRecords] = useState<Map<SourceId, PullSourceRecord>>(
    () => new Map()
  );
  const interests = useMemo(
    () => derivePullInterests(data, backend.workspaceConfig.roomRelays),
    [data, backend.workspaceConfig.roomRelays]
  );
  const interestSig = interestsSignature(interests);
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
    [recordsSignature(records), interestSig]
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
      publishEventsStatus={data.publishEventsStatus}
      calendarFeeds={data.calendarFeeds}
      pull={pull}
      views={data.views}
      panes={data.panes}
    >
      {children}
    </DataContextProvider>
  );
}
