import { useEffect, useState, useRef } from "react";
import { Event, Filter, SimplePool } from "nostr-tools";
import { Map, OrderedMap } from "immutable";
import { sanitizeAuthorsFilter } from "../nostrEvents";

type EventQueryResult = {
  events: OrderedMap<string, Event>;
  eose: boolean;
};

type EventQueryProps = {
  enabled?: boolean;
  readFromRelays?: Array<Relay>;
  discardOld?: boolean;
  filter?: (event: Event) => boolean;
};

const DEFAULTS: EventQueryProps = {
  enabled: true,
  readFromRelays: [],
  discardOld: false,
};

function isValidWsUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return ["ws:", "wss:"].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

export function useEventQuery(
  relayPool: SimplePool,
  filters: Filter[],
  opts?: EventQueryProps
): EventQueryResult {
  const [events, setEvents] = useState<Map<string, Event>>(
    OrderedMap<string, Event>()
  );
  const [eose, setEose] = useState<boolean>(false);

  const componentIsMounted = useRef(true);
  useEffect(() => {
    return () => {
      // eslint-disable-next-line functional/immutable-data
      componentIsMounted.current = false;
    };
  }, []);
  const options = { ...DEFAULTS, ...opts } as {
    enabled: boolean;
    readFromRelays: Array<Relay>;
    discardOld: boolean;
    filter?: (event: Event) => boolean;
  };
  const { enabled } = options;

  // Find all duplicates and eliminate them, some urls contain a trailing slash and some not
  const relayUrls = [
    ...new Set(
      options.readFromRelays
        .map((r) => r.url)
        .map((url) => url.trim().replace(/\/$/, ""))
        .filter(isValidWsUrl)
    ),
  ];

  const sanitizedFilters = filters.map(sanitizeAuthorsFilter);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return () => {};
    }
    const sub = relayPool.subscribeMany(relayUrls, sanitizedFilters, {
      onevent(event: Event): void {
        if (!componentIsMounted.current) {
          return;
        }
        setEvents((existingEvents) => {
          if (
            existingEvents.has(event.id) ||
            (options.filter && !options.filter(event))
          ) {
            return existingEvents;
          }
          return existingEvents.set(event.id, event);
        });
      },
      oneose() {
        if (componentIsMounted.current && !eose) {
          setEose(true);
        }
      },
    });
    return () => {
      sub.close();
      if (options.discardOld) {
        setEose(false);
        setEvents(OrderedMap<string, Event>());
      }
    };
  }, [
    enabled,
    JSON.stringify(relayUrls),
    JSON.stringify(sanitizedFilters),
    componentIsMounted.current,
  ]);
  return {
    events,
    eose,
  };
}
