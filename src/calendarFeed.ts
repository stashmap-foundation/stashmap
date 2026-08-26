import { IcalEntry, assertFetchableFeedUrl, parseIcalFeed } from "./core/ical";
import { getDesktopBridge } from "./runtimeEnvironment";

export type CalendarFeedFetcher = (url: string) => Promise<string>;

const ICAL_PROXY_PATH = "/.netlify/functions/ical-proxy";

function toHttpUrl(url: string): string {
  return url.replace(/^webcal:\/\//u, "https://");
}

// Fetch order on the web: direct first (feeds with permissive CORS need no
// proxy), the Netlify function second. Desktop fetches in the main process
// — no CORS in Node. CLI passes its own fetcher.
export function defaultCalendarFeedFetcher(): CalendarFeedFetcher {
  const desktopFetch = getDesktopBridge()?.fetchText;
  if (desktopFetch) {
    return desktopFetch;
  }
  return async (url: string): Promise<string> => {
    const target = toHttpUrl(url);
    try {
      const direct = await fetch(target);
      if (direct.ok) {
        return await direct.text();
      }
    } catch {
      // CORS or network — fall through to the proxy.
    }
    const proxied = await fetch(
      `${ICAL_PROXY_PATH}?url=${encodeURIComponent(target)}`
    );
    if (!proxied.ok) {
      throw new Error(`calendar feed fetch failed: ${proxied.status}`);
    }
    return proxied.text();
  };
}

export async function fetchCalendarEntries(
  url: string,
  fetcher: CalendarFeedFetcher = defaultCalendarFeedFetcher()
): Promise<IcalEntry[]> {
  assertFetchableFeedUrl(url);
  return parseIcalFeed(await fetcher(url));
}
