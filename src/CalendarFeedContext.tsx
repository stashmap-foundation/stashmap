import React, { useCallback, useMemo, useRef, useState } from "react";
import { Map as ImmutableMap } from "immutable";
import { IcalEntry, computedNodesFromFeeds } from "./core/ical";
import { fetchCalendarEntries } from "./calendarFeed";
import { useApis } from "./Apis";
import { useBackend } from "./BackendContext";

type CalendarFeedContextValue = {
  computedNodes: ImmutableMap<ID, GraphNode>;
  requestFeed: (url: string) => void;
};

const CalendarFeedContext = React.createContext<
  CalendarFeedContextValue | undefined
>(undefined);

const MAX_CONCURRENT_FEED_FETCHES = 4;

function CalendarFeedStore({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [feeds, setFeeds] = useState(ImmutableMap<string, IcalEntry[]>());
  const requested = useRef(new Set<string>());
  const waiting = useRef(new Set<string>());
  const active = useRef(new Set<string>());
  const { fetchCalendarFeed } = useApis();

  const requestFeed = useCallback(
    (url: string): void => {
      if (requested.current.has(url)) {
        return;
      }
      requested.current.add(url);
      waiting.current.add(url);
      const drain = (): void => {
        if (active.current.size >= MAX_CONCURRENT_FEED_FETCHES) {
          return;
        }
        const next = waiting.current.values().next();
        if (next.done) {
          return;
        }
        const nextUrl = next.value;
        waiting.current.delete(nextUrl);
        active.current.add(nextUrl);
        fetchCalendarEntries(nextUrl, fetchCalendarFeed)
          .then((entries) => {
            setFeeds((previous) => previous.set(nextUrl, entries));
          })
          .catch(() => {
            // No projection to show; the node stays an ordinary row. The
            // URL stays requested so a broken feed isn't hammered.
          })
          .finally(() => {
            active.current.delete(nextUrl);
            drain();
          });
        drain();
      };
      drain();
    },
    [fetchCalendarFeed]
  );

  const value = useMemo(
    () => ({
      computedNodes: computedNodesFromFeeds(feeds),
      requestFeed,
    }),
    [feeds, requestFeed]
  );

  return (
    <CalendarFeedContext.Provider value={value}>
      {children}
    </CalendarFeedContext.Provider>
  );
}

export function CalendarFeedProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const { user, workspace } = useBackend();
  const scope = `${workspace?.profile?.workspaceDir ?? ""}:${
    user?.publicKey ?? ""
  }`;
  return <CalendarFeedStore key={scope}>{children}</CalendarFeedStore>;
}

export function useCalendarFeeds(): CalendarFeedContextValue {
  const context = React.useContext(CalendarFeedContext);
  if (context === undefined) {
    throw new Error("CalendarFeedContext not provided");
  }
  return context;
}
