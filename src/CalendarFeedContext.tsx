import React, { useCallback, useMemo, useRef, useState } from "react";
import { Map as ImmutableMap } from "immutable";
import { IcalEntry } from "./core/ical";
import { fetchCalendarEntries } from "./calendarFeed";
import { useApis } from "./Apis";

type CalendarFeedContextValue = {
  feeds: ImmutableMap<string, IcalEntry[]>;
  requestFeed: (url: string) => void;
};

const CalendarFeedContext = React.createContext<CalendarFeedContextValue>({
  feeds: ImmutableMap<string, IcalEntry[]>(),
  requestFeed: () => undefined,
});

// Holds every fetched calendar feed for the session, keyed by URL. Rows
// request feeds as calendar nodes render; a URL is fetched once (last-good
// caching lives in calendarFeed.ts). Failures stay unlisted — the row
// simply has no projections until a fetch succeeds.
export function CalendarFeedProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [feeds, setFeeds] = useState(ImmutableMap<string, IcalEntry[]>());
  const pending = useRef(new Set<string>());
  const { fetchCalendarFeed } = useApis();

  const requestFeed = useCallback(
    (url: string): void => {
      if (pending.current.has(url)) {
        return;
      }
      pending.current.add(url);
      fetchCalendarEntries(url, fetchCalendarFeed)
        .then((entries) => {
          setFeeds((previous) => previous.set(url, entries));
        })
        .catch(() => {
          // No projection to show; the node stays an ordinary row. The
          // URL stays pending so a broken feed isn't hammered.
        });
    },
    [fetchCalendarFeed]
  );

  const value = useMemo(() => ({ feeds, requestFeed }), [feeds, requestFeed]);

  return (
    <CalendarFeedContext.Provider value={value}>
      {children}
    </CalendarFeedContext.Provider>
  );
}

export function useCalendarFeeds(): CalendarFeedContextValue {
  return React.useContext(CalendarFeedContext);
}
