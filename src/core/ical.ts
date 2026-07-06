/* eslint-disable functional/no-let, functional/immutable-data */
import { icalEntryId } from "./icalId";

// URL charset excludes ] and parentheses so a URL inside the link form
// stops at its own closing delimiter.
const ICAL_URL_RE =
  /(webcal:\/\/[^\s\]()]+|https?:\/\/[^\s\]()]+\.ics(\?[^\s\]()]*)?)/iu;

const ICAL_FEED_LINK_RE =
  /^\[([^\]]*)\]\((webcal:\/\/[^\s()]+|https?:\/\/[^\s()]+\.ics(\?[^\s()]*)?)\)$/iu;

// The feed-as-link form: `[any name](https://…/feed.ics)` — text is yours,
// identity lives in the parentheses, mirroring entity links. Returns the
// renameable label and the feed URL.
export function icalFeedLinkPartsOf(
  text: string
): { label: string; url: string } | undefined {
  const match = ICAL_FEED_LINK_RE.exec(text.trim());
  if (!match) {
    return undefined;
  }
  return { label: match[1], url: match[2] };
}

// The calendar-feed recognizer: a node whose text carries an iCal URL
// (`.ics` or `webcal://`) is a calendar-feed node — recognized like
// entities, no node-type UI. Returns the feed URL, or undefined.
export function icalFeedUrlOf(text: string): string | undefined {
  const linkForm = icalFeedLinkPartsOf(text);
  if (linkForm) {
    return linkForm.url;
  }
  const match = ICAL_URL_RE.exec(text);
  if (!match) {
    return undefined;
  }
  return match[0].replace(/[}>,.]+$/u, "") || undefined;
}

// A row whose whole text is a feed URL — the paste/typing form that gets
// wrapped into the link form so the name is free from the start.
export function isBareIcalFeedUrl(text: string): boolean {
  const url = icalFeedUrlOf(text);
  return url !== undefined && text.trim() === url;
}

export function icalFeedLinkText(url: string, label?: string): string {
  return `[${label ?? url}](${url})`;
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

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/u;
const DATE_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/u;

function parseIcalDateTime(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = DATE_RE.exec(value);
  if (date) {
    return new Date(
      Number(date[1]),
      Number(date[2]) - 1,
      Number(date[3])
    ).getTime();
  }
  const dateTime = DATE_TIME_RE.exec(value);
  if (!dateTime) {
    return undefined;
  }
  const [year, month, day, hour, minute, second] = dateTime
    .slice(1, 7)
    .map(Number);
  return dateTime[7] === "Z"
    ? Date.UTC(year, month - 1, day, hour, minute, second)
    : new Date(year, month - 1, day, hour, minute, second).getTime();
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

// A calendar entry node is recognizable from file content alone: the
// ical: id (canonical-id law) plus the date in the row text. Readers need
// no feed fetch to render pastness — the wallet applies the same rule.
export function isCalendarEntryId(id: string): boolean {
  return id.startsWith("ical:");
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
