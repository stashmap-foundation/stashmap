import React, { useCallback, useMemo, useRef, useState } from "react";
import { useApis } from "./Apis";
import { useCalendarFeeds } from "./CalendarFeedContext";
import {
  calendarEntryLabel,
  entityLabelLanguageOrder,
  retryAfterUntilMs,
  wikidataLabelFromResponse,
  wikidataMetadataUrl,
} from "./entityLabels";

const EntityLabelContext = React.createContext<{
  labelFor: (id: string) => string | undefined;
  requestLabel: (id: string) => void;
}>({
  labelFor: () => undefined,
  requestLabel: () => undefined,
});

function browserLanguages(): string[] {
  if (typeof navigator === "undefined") {
    return [];
  }
  return navigator.languages.length > 0
    ? [...navigator.languages]
    : [navigator.language].filter((language) => language !== "");
}

async function responsePayload(response: Response): Promise<unknown> {
  if (typeof response.json === "function") {
    const payload: unknown = await response.json();
    return payload;
  }
  const payload: unknown = JSON.parse(
    typeof response.text === "function" ? await response.text() : ""
  );
  return payload;
}

export function EntityLabelProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { fetchEntityMetadata } = useApis();
  const { feeds } = useCalendarFeeds();
  const [labels, setLabels] = useState(() => new Map<string, string>());
  const attempted = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const cooldown = useRef(new Map<string, number>());
  const languages = useMemo(
    () => entityLabelLanguageOrder(browserLanguages()),
    []
  );
  const calendarFeeds = useMemo(() => feeds.valueSeq().toArray(), [feeds]);

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
      const fetcher =
        fetchEntityMetadata ?? ((metadataUrl: string) => fetch(metadataUrl));
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

  const value = useMemo(
    () => ({ labelFor, requestLabel }),
    [labelFor, requestLabel]
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
} {
  return React.useContext(EntityLabelContext);
}
