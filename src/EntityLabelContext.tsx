import React, { useCallback, useMemo, useRef, useState } from "react";
import { useApis } from "./Apis";
import { useCalendarFeeds } from "./CalendarFeedContext";
import { useData } from "./DataContext";
import { isEntityId } from "./core/linkPath";
import { LOCAL } from "./core/nodeRef";
import { spansText } from "./core/nodeSpans";
import {
  EntityPickerCandidate,
  browserEntityLabelLanguages,
  calendarEntryLabel,
  defaultEntityMetadataFetcher,
  entityLabelLanguageOrder,
  responsePayload,
  retryAfterUntilMs,
  wikidataLabelFromResponse,
  wikidataMetadataUrl,
} from "./entityLabels";

const EntityLabelContext = React.createContext<{
  labelFor: (id: string) => string | undefined;
  requestLabel: (id: string) => void;
  localEntityCandidates: (query: string) => EntityPickerCandidate[];
}>({
  labelFor: () => undefined,
  requestLabel: () => undefined,
  localEntityCandidates: () => [],
});

function entityIdFromHref(href: string): string | undefined {
  return href.startsWith("#") && isEntityId(href.slice(1))
    ? href.slice(1)
    : undefined;
}

function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

type LocalEntityPickerCandidate = EntityPickerCandidate & {
  searchText: string;
};

function localEntitySearchText(candidate: EntityPickerCandidate): string {
  return [candidate.label, candidate.id, candidate.description]
    .map(normalizedSearch)
    .join("\u0000");
}

function addLocalEntityCandidate(
  candidatesById: Map<string, LocalEntityPickerCandidate>,
  candidate: EntityPickerCandidate
): void {
  if (candidatesById.has(candidate.id)) {
    return;
  }
  candidatesById.set(candidate.id, {
    ...candidate,
    searchText: localEntitySearchText(candidate),
  });
}

function localEntityCandidateList(
  knowledgeDBs: KnowledgeDBs
): LocalEntityPickerCandidate[] {
  const local = knowledgeDBs.get(LOCAL);
  if (!local) {
    return [];
  }
  const candidatesById = new Map<string, LocalEntityPickerCandidate>();
  local.nodes.forEach((node) => {
    if (isEntityId(node.id)) {
      addLocalEntityCandidate(candidatesById, {
        id: node.id,
        label: spansText(node.spans) || node.id,
        description: "local entity",
        source: "local",
      });
    }
    node.spans.forEach((span) => {
      if (span.kind !== "link") {
        return;
      }
      const id = entityIdFromHref(span.href);
      if (!id) {
        return;
      }
      addLocalEntityCandidate(candidatesById, {
        id,
        label: span.text,
        description: "local link",
        source: "local",
      });
    });
  });
  return [...candidatesById.values()];
}

function* matchingLocalEntityCandidateSequence(
  candidates: readonly LocalEntityPickerCandidate[],
  query: string
): Generator<EntityPickerCandidate> {
  for (const candidate of candidates) {
    if (candidate.searchText.includes(query)) {
      yield candidate;
    }
  }
}

function matchingLocalEntityCandidates(
  candidates: readonly LocalEntityPickerCandidate[],
  query: string
): EntityPickerCandidate[] {
  const normalized = normalizedSearch(query);
  if (normalized === "") {
    return candidates.slice(0, 7);
  }
  const iterator = matchingLocalEntityCandidateSequence(candidates, normalized);
  return Array.from({ length: 7 }, () => {
    const next = iterator.next();
    return next.done ? undefined : next.value;
  }).filter(
    (candidate): candidate is EntityPickerCandidate => candidate !== undefined
  );
}

export function EntityLabelProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { fetchEntityMetadata } = useApis();
  const { feeds } = useCalendarFeeds();
  const data = useData();
  const [labels, setLabels] = useState(() => new Map<string, string>());
  const attempted = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const cooldown = useRef(new Map<string, number>());
  const languages = useMemo(
    () => entityLabelLanguageOrder(browserEntityLabelLanguages()),
    []
  );
  const calendarFeeds = useMemo(() => feeds.valueSeq().toArray(), [feeds]);
  const localEntityBase = useMemo(
    () => localEntityCandidateList(data.knowledgeDBs),
    [data.knowledgeDBs]
  );

  const labelFor = useCallback(
    (id: string): string | undefined =>
      calendarEntryLabel(id, calendarFeeds) ?? labels.get(id),
    [calendarFeeds, labels]
  );

  const requestLabel = useCallback(
    (id: string): void => {
      const url = wikidataMetadataUrl(id, languages);
      if (!url) {
        return;
      }
      if (
        attempted.current.has(id) ||
        inFlight.current.has(id) ||
        cooldown.current.has("closed") ||
        (cooldown.current.get("until") ?? 0) > Date.now()
      ) {
        return;
      }
      attempted.current.add(id);
      inFlight.current.add(id);
      const fetcher = fetchEntityMetadata ?? defaultEntityMetadataFetcher();
      Promise.resolve()
        .then(() => fetcher(url))
        .then(async (response) => {
          if (response.status === 429) {
            const until = retryAfterUntilMs(
              response.headers?.get("Retry-After") ?? null,
              Date.now()
            );
            if (until === undefined) {
              cooldown.current.set("closed", 1);
            } else {
              cooldown.current.set("until", until);
            }
            return undefined;
          }
          if (
            response.status !== undefined &&
            (response.status < 200 || response.status >= 300)
          ) {
            return undefined;
          }
          try {
            return wikidataLabelFromResponse(
              id,
              await responsePayload(response),
              languages
            );
          } catch {
            return undefined;
          }
        })
        .then((label) => {
          if (label !== undefined) {
            setLabels((current) => new Map([...current, [id, label]]));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight.current.delete(id);
        });
    },
    [fetchEntityMetadata, languages]
  );

  const localEntityCandidates = useCallback(
    (query: string): EntityPickerCandidate[] =>
      matchingLocalEntityCandidates(localEntityBase, query),
    [localEntityBase]
  );

  const value = useMemo(
    () => ({ labelFor, requestLabel, localEntityCandidates }),
    [labelFor, localEntityCandidates, requestLabel]
  );

  return (
    <EntityLabelContext.Provider value={value}>
      {children}
    </EntityLabelContext.Provider>
  );
}

export function useEntityLabels(): {
  labelFor: (id: string) => string | undefined;
  requestLabel: (id: string) => void;
  localEntityCandidates: (query: string) => EntityPickerCandidate[];
} {
  return React.useContext(EntityLabelContext);
}
