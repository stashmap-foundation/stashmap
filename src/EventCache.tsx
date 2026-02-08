import React, { useCallback } from "react";
import { List, Map } from "immutable";
import { Event, UnsignedEvent } from "nostr-tools";
import { processEvents } from "./Data";

type EventCacheState = {
  knowledgeDBs: KnowledgeDBs;
  addEvents: (events: Map<string, Event | UnsignedEvent>) => void;
};

const EventCacheContext = React.createContext<EventCacheState | undefined>(
  undefined
);

export function EventCacheProvider({
  children,
  unpublishedEvents,
  initialCachedEvents,
  onEventsAdded,
}: {
  children: React.ReactNode;
  unpublishedEvents: List<UnsignedEvent>;
  initialCachedEvents?: Map<string, Event | UnsignedEvent>;
  onEventsAdded?: (events: Map<string, Event | UnsignedEvent>) => void;
}): JSX.Element {
  const [events, setEvents] = React.useState<
    Map<string, Event | UnsignedEvent>
  >(initialCachedEvents ?? Map());

  React.useEffect(() => {
    if (initialCachedEvents && initialCachedEvents.size > 0) {
      setEvents((prev) => {
        const newKeys = initialCachedEvents
          .keySeq()
          .filter((k) => !prev.has(k));
        if (newKeys.isEmpty()) return prev;
        return prev.merge(
          initialCachedEvents.filter((_, k) => newKeys.includes(k))
        );
      });
    }
  }, [initialCachedEvents]);

  const addEvents = useCallback(
    (newEvents: Map<string, Event | UnsignedEvent>) => {
      setEvents((prev) => {
        const newKeys = newEvents.keySeq().filter((k) => !prev.has(k));
        if (newKeys.isEmpty()) {
          return prev;
        }
        const added = newEvents.filter((_, k) => newKeys.includes(k));
        if (onEventsAdded) {
          onEventsAdded(added);
        }
        return prev.merge(added);
      });
    },
    [onEventsAdded]
  );

  const knowledgeDBs = React.useMemo(() => {
    const allEvents = events.valueSeq().toList().concat(unpublishedEvents);
    const processed = processEvents(allEvents);
    return processed.map((data) => data.knowledgeDB);
  }, [events, unpublishedEvents]);

  const contextValue = React.useMemo(
    () => ({
      knowledgeDBs,
      addEvents,
    }),
    [knowledgeDBs, addEvents]
  );

  return (
    <EventCacheContext.Provider value={contextValue}>
      {children}
    </EventCacheContext.Provider>
  );
}

export function useEventCache(): EventCacheState | undefined {
  return React.useContext(EventCacheContext);
}

export function useCachedKnowledgeDBs(): KnowledgeDBs {
  const context = React.useContext(EventCacheContext);
  return context?.knowledgeDBs || Map();
}
