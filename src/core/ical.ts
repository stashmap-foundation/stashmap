/* eslint-disable functional/no-let, functional/immutable-data */
import { List, Map } from "immutable";
import { allKnownNodes } from "./graphLookup";
import { icalEntryId } from "./icalId";
import { classifyLinkHref } from "./linkPath";
import { plainSpans, spansText } from "./nodeSpans";

// Write-time recognition only: a pasted or typed bare feed URL gets
// wrapped into the typed feed link. Read paths never sniff URLs.
const ICAL_URL_RE =
  /(webcal:\/\/[^\s\]()]+|https:\/\/[^\s\]()]+\.ics(\?[^\s\]()]*)?)/iu;

export function isCalendarEntryId(id: string): boolean {
  return id.startsWith("ical:");
}

export function feedUrlInSpans(spans: InlineSpan[]): string | undefined {
  if (spans.length !== 1) return undefined;
  const span = spans[0];
  return span.kind === "link" && classifyLinkHref(span.href) === "feed"
    ? span.href.slice("feed:".length)
    : undefined;
}

// The projecting form: only a feed link carrying the explicit embed attr
// is a machine embed. A plain feed link keeps its calendar dress but
// projects nothing.
export function embeddedFeedUrl(node: GraphNode): string | undefined {
  return node.extraAttrs?.embed === "true"
    ? feedUrlInSpans(node.spans)
    : undefined;
}

export function isBareIcalFeedUrl(text: string): boolean {
  const match = ICAL_URL_RE.exec(text);
  if (!match) {
    return false;
  }
  const url = match[0].replace(/[}>,.]+$/u, "");
  return text.trim() === url;
}

export function bareFeedUrlIn(spans: InlineSpan[]): string | undefined {
  if (spans.some((span) => span.kind !== "text")) {
    return undefined;
  }
  const text = spansText(spans).trim();
  return isBareIcalFeedUrl(text) ? text : undefined;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0"
  ) {
    return true;
  }
  if (host.includes(":")) {
    return host === "::1" || host.startsWith("fe80:") || /^f[cd]/u.test(host);
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/u);
  if (!v4) {
    return false;
  }
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

export function assertFetchableFeedUrl(url: string): void {
  const parsed = new URL(url.replace(/^webcal:\/\//u, "https://"));
  if (parsed.protocol !== "https:") {
    throw new Error(`refusing non-https feed: ${url}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`refusing feed url with credentials: ${url}`);
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(`refusing private feed host: ${url}`);
  }
}

export function calendarFeedHref(url: string): string {
  return `feed:${url
    .trim()
    .replace(/^webcal:\/\//iu, "https://")
    .replace(/^https?:\/\//iu, (scheme) => scheme.toLowerCase())}`;
}

export function feedLinkSpans(url: string): InlineSpan[] {
  const text = url.trim();
  return [{ kind: "link", href: calendarFeedHref(text), text }];
}

// A projected calendar entry: the literal-VEVENT subset of the machine-feeds
// spec (UID, DTSTART, SUMMARY). Recurring events are skipped in v1 —
// expansion is committed later work; the id scheme reserves @<RECURRENCE-ID>.
export type IcalEntry = {
  readonly id: string;
  readonly uid: string;
  readonly summary: string;
  // Milliseconds since epoch; undefined when DTSTART is missing or
  // unparseable. Z values are UTC instants; naive local values are
  // interpreted in the client's local time, matching the Dart side.
  readonly startMs?: number;
  readonly allDay: boolean;
};

// Unfolds RFC 5545 folded lines: CRLF (or LF) followed by a space or tab
// continues the previous line.
function unfold(content: string): string[] {
  return content.split(/\r?\n/u).reduce<string[]>((lines, line) => {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      return [...lines.slice(0, -1), lines[lines.length - 1] + line.slice(1)];
    }
    return line === "" ? lines : [...lines, line];
  }, []);
}

// RFC 5545 TEXT unescaping: \n and \N become newlines, any other escaped
// character becomes itself.
function unescapeText(value: string): string {
  return value.replace(/\\(.)/gu, (_, next: string) =>
    next === "n" || next === "N" ? "\n" : next
  );
}

// RFC 5545 DATE/DATE-TIME is ISO 8601 basic format; reshape to the
// extended form and let the platform parse — Z as UTC, naive as local,
// date-only as local midnight (bare dates would parse as UTC).
function parseIcalDateTime(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const v = value.trim();
  if (!/^\d{8}(T\d{6}Z?)?$/u.test(v)) {
    return undefined;
  }
  const date = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  const time =
    v.length > 8
      ? `T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}${
          v.endsWith("Z") ? "Z" : ""
        }`
      : "T00:00:00";
  const ms = new Date(`${date}${time}`).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

type RawVevent = {
  uid?: string;
  summary?: string;
  dtstart?: string;
  allDay: boolean;
  recurring: boolean;
};

function buildEntry(raw: RawVevent): IcalEntry | undefined {
  if (!raw.uid || raw.recurring) {
    return undefined;
  }
  const startMs = parseIcalDateTime(raw.dtstart);
  return {
    id: icalEntryId(raw.uid),
    uid: raw.uid,
    summary: raw.summary ?? "",
    ...(startMs !== undefined && { startMs }),
    allDay: raw.allDay,
  };
}

// Hand-rolled on purpose (library trial verdict, Dart side): the Dart
// candidates die on bad events or corrupt TEXT escapes, and both mirrors
// must match byte-for-byte against the shared fixtures — a library on one
// side only makes them less alike.
//
// Parses an iCalendar feed into projected entries, in calendar order
// (entries without a parseable start sort last, original order kept).
// Content without a BEGIN:VCALENDAR container throws — a server error page
// must never read as an empty calendar.
export function parseIcalFeed(content: string): IcalEntry[] {
  const lines = unfold(content);
  if (!lines.some((line) => line.startsWith("BEGIN:VCALENDAR"))) {
    throw new Error("not an iCalendar feed");
  }
  const entries: IcalEntry[] = [];
  let current: RawVevent | undefined;
  let nestedBlockDepth = 0;

  lines.forEach((line) => {
    if (line.startsWith("BEGIN:")) {
      const block = line.slice("BEGIN:".length).trim();
      if (current === undefined) {
        if (block === "VEVENT") {
          current = { allDay: false, recurring: false };
        }
      } else {
        nestedBlockDepth += 1;
      }
      return;
    }
    if (line.startsWith("END:")) {
      if (nestedBlockDepth > 0) {
        nestedBlockDepth -= 1;
        return;
      }
      if (line.slice("END:".length).trim() === "VEVENT" && current) {
        const entry = buildEntry(current);
        if (entry) {
          entries.push(entry);
        }
        current = undefined;
      }
      return;
    }
    if (!current || nestedBlockDepth > 0) {
      return;
    }
    const colon = line.indexOf(":");
    if (colon < 0) {
      return;
    }
    const nameAndParams = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = nameAndParams.split(";")[0].toUpperCase();
    if (name === "UID") {
      current.uid = value.trim();
    } else if (name === "SUMMARY") {
      current.summary = unescapeText(value);
    } else if (name === "DTSTART") {
      current.dtstart = value.trim();
      current.allDay = nameAndParams.toUpperCase().includes("VALUE=DATE");
    } else if (
      name === "RRULE" ||
      name === "RDATE" ||
      name === "RECURRENCE-ID"
    ) {
      current.recurring = true;
    }
  });

  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aStart = a.entry.startMs;
      const bStart = b.entry.startMs;
      if (aStart === undefined && bStart === undefined) {
        return a.index - b.index;
      }
      if (aStart === undefined) {
        return 1;
      }
      if (bStart === undefined) {
        return -1;
      }
      return aStart - bStart || a.index - b.index;
    })
    .map(({ entry }) => entry);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

// The projected row text: the date is text, not decoration — exactly how
// people hand-write calendars in outlines. Times render in local wall
// time; all-day entries carry no time; undated entries are bare summary.
export function icalEntryDisplayText(entry: IcalEntry): string {
  if (entry.startMs === undefined) {
    return entry.summary;
  }
  const date = new Date(entry.startMs);
  const day = `${pad2(date.getDate())}.${pad2(
    date.getMonth() + 1
  )}.${date.getFullYear()}`;
  const time = entry.allDay
    ? ""
    : ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `${day}${time} ${entry.summary}`.trim();
}

export function calendarIdOf(url: string): ID {
  return `feed:${url}`;
}

function calendarNode(url: string, entries: IcalEntry[]): GraphNode {
  const id = calendarIdOf(url);
  return {
    children: List<ID>(entries.map((entry) => entry.id)),
    id,
    spans: [{ kind: "link", href: id, text: url }],
    updated: 0,
    root: id,
    relevance: undefined,
  };
}

function eventNode(calendarId: ID, entry: IcalEntry): GraphNode {
  return {
    children: List<ID>(),
    id: entry.id,
    spans: plainSpans(icalEntryDisplayText(entry)),
    parent: calendarId,
    updated: 0,
    root: calendarId,
    relevance: undefined,
  };
}

export function computedNodesFromFeeds(
  feeds: Map<string, IcalEntry[]>
): Map<ID, GraphNode> {
  return Map<ID, GraphNode>(
    feeds
      .entrySeq()
      .toArray()
      .flatMap(([url, entries]): [ID, GraphNode][] => [
        [calendarIdOf(url), calendarNode(url, entries)],
        ...entries.map((entry): [ID, GraphNode] => [
          entry.id,
          eventNode(calendarIdOf(url), entry),
        ]),
      ])
  );
}

export function loadedFeedUrls(
  data: Pick<Data, "knowledgeDBs" | "graphIndex">
): string[] {
  return [
    ...new Set(
      allKnownNodes(data).flatMap((node) => {
        const url = embeddedFeedUrl(node);
        return url ? [url] : [];
      })
    ),
  ];
}
