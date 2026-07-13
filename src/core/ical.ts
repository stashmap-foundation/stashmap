/* eslint-disable functional/no-let, functional/immutable-data */
import { icalEntryId } from "./icalId";
import { spansText } from "./nodeSpans";

// Write-time recognition only: a pasted or typed bare feed URL gets
// wrapped into the typed feed link. Read paths never sniff URLs.
const ICAL_URL_RE =
  /(webcal:\/\/[^\s\]()]+|https?:\/\/[^\s\]()]+\.ics(\?[^\s\]()]*)?)/iu;

const ICAL_FEED_LINK_RE = /^\[([^\]]*)\]\(feed:([^\s()]+)\)$/u;

export function isCalendarEntryId(id: string): boolean {
  return id.startsWith("ical:");
}

// The feed-as-link form: `[any name](feed:<url>)`. The scheme declares the
// row a calendar-feed node; readers dispatch on it, never on the URL shape.
export function icalFeedLinkPartsOf(
  text: string
): { label: string; url: string } | undefined {
  const match = ICAL_FEED_LINK_RE.exec(text.trim());
  if (!match) {
    return undefined;
  }
  return { label: match[1], url: match[2] };
}

export function icalFeedUrlOf(text: string): string | undefined {
  return icalFeedLinkPartsOf(text)?.url;
}

export function calendarFeedUrl(node: GraphNode): string | undefined {
  if (node.spans.length !== 1) return undefined;
  const span = node.spans[0];
  return span.kind === "link" && span.href.startsWith("feed:")
    ? span.href.slice("feed:".length)
    : undefined;
}

export function calendarEntryTarget(
  node: GraphNode | undefined
): ID | undefined {
  if (!node || node.spans.length !== 1) return undefined;
  const span = node.spans[0];
  if (span.kind !== "link" || !span.href.startsWith("#")) return undefined;
  const target = span.href.slice(1);
  return isCalendarEntryId(target) ? target : undefined;
}

export function isCalendarEntryPlacement(
  node: GraphNode,
  parent: GraphNode | undefined
): boolean {
  return (
    calendarEntryTarget(node) !== undefined &&
    !!parent &&
    !!calendarFeedUrl(parent)
  );
}

export function calendarEntryEditedSpans(
  node: GraphNode,
  editedID: ID,
  spans: InlineSpan[]
): InlineSpan[] {
  const target = calendarEntryTarget(node);
  return target && isCalendarEntryId(editedID) && node.id !== editedID
    ? [{ kind: "link", href: `#${target}`, text: spansText(spans) }]
    : spans;
}

export function isBareIcalFeedUrl(text: string): boolean {
  const match = ICAL_URL_RE.exec(text);
  if (!match) {
    return false;
  }
  const url = match[0].replace(/[}>,.]+$/u, "");
  return text.trim() === url;
}

export function icalFeedLinkText(url: string, label?: string): string {
  return `[${label ?? url}](feed:${url})`;
}

// The one display-text rule for the feed-link form, shared by every
// renderer — editor display, suggestion and reference labels — and
// mirroring the Dart side's nodeDisplayText: feed links read by their
// label everywhere; the URL belongs to edit mode.
export function displayTextOf(text: string): string {
  return icalFeedLinkPartsOf(text)?.label ?? text;
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
    } else if (name === "RRULE" || name === "RDATE") {
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

export type CalendarMergeItem =
  | { kind: "child"; childId: string }
  | { kind: "projection"; entry: IcalEntry };

function startOfDay(nowMs: number): number {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

// Pastness is a fact about the node's type, never a judgment: calendar
// entries render date-aware because of what they ARE (like entities render
// violet), and the user's judgments stay human-only.
export function isPastIcalEntry(entry: IcalEntry, nowMs: number): boolean {
  if (entry.startMs === undefined) {
    return false;
  }
  return entry.startMs < startOfDay(nowMs);
}

// Interleaves untouched projections with the calendar node's actual
// children: your arrangement wins where you arranged (children keep
// document order), the feed owns what you left alone (each untouched
// projection rides after its nearest materialized feed predecessor;
// projections before any materialized entry lead the list). With nothing
// materialized this is pure feed order.
// hidePastBefore: bare past entries (past AND not materialized) don't
// project — the past stays in the feed; the file, when touched, stays
// visible. Materialized entries always pass; they are file truth and they
// anchor the projections that follow them.
export function mergeProjectedEntries(
  childIds: readonly string[],
  entries: readonly IcalEntry[],
  hidePastBefore?: number
): CalendarMergeItem[] {
  const childIdSet = new Set(childIds);
  const projectable =
    hidePastBefore === undefined
      ? entries
      : entries.filter(
          (entry) =>
            childIdSet.has(entry.id) || !isPastIcalEntry(entry, hidePastBefore)
        );
  const leading: IcalEntry[] = [];
  const anchored = new Map<string, IcalEntry[]>();
  let anchor: string | undefined;
  projectable.forEach((entry) => {
    if (childIdSet.has(entry.id)) {
      anchor = entry.id;
      return;
    }
    if (anchor === undefined) {
      leading.push(entry);
    } else {
      anchored.set(anchor, [...(anchored.get(anchor) ?? []), entry]);
    }
  });
  const items: CalendarMergeItem[] = leading.map((entry) => ({
    kind: "projection",
    entry,
  }));
  const entryIds = new Set(entries.map((entry) => entry.id));
  // Anchored projections emit after the anchor's SEGMENT — the anchor
  // child plus its consecutive non-entry children (notes dropped right
  // after an entry stay right after it; the next projection follows the
  // segment, still after its feed predecessor).
  let pending: IcalEntry[] = [];
  childIds.forEach((childId) => {
    if (entryIds.has(childId) && pending.length > 0) {
      pending.forEach((entry) => items.push({ kind: "projection", entry }));
      pending = [];
    }
    items.push({ kind: "child", childId });
    if (anchored.has(childId)) {
      pending = [...pending, ...(anchored.get(childId) ?? [])];
    }
  });
  pending.forEach((entry) => items.push({ kind: "projection", entry }));
  return items;
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

const ICAL_ROW_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})/u;

export function isPastCalendarRowText(text: string, nowMs: number): boolean {
  const match = text.match(ICAL_ROW_DATE_RE);
  if (!match) {
    return false;
  }
  const dateMs = new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1])
  ).getTime();
  return dateMs < startOfDay(nowMs);
}

// The count behind the feed row's past chip: bare past entries currently
// hidden from projection.
export function hiddenPastEntryCount(
  childIds: readonly string[],
  entries: readonly IcalEntry[],
  nowMs: number
): number {
  const childIdSet = new Set(childIds);
  return entries.filter(
    (entry) => !childIdSet.has(entry.id) && isPastIcalEntry(entry, nowMs)
  ).length;
}
