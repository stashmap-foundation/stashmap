/* eslint-disable functional/no-let, functional/immutable-data */
import { icalEntryId } from "./icalId";

const ICAL_URL_RE = /(webcal:\/\/\S+|https?:\/\/\S+\.ics(\?\S*)?)/iu;

// The calendar-feed recognizer: a node whose text carries an iCal URL
// (`.ics` or `webcal://`) is a calendar-feed node — recognized like
// entities, no node-type UI. Returns the feed URL, or undefined.
export function icalFeedUrlOf(text: string): string | undefined {
  const match = ICAL_URL_RE.exec(text);
  if (!match) {
    return undefined;
  }
  return match[0].replace(/[)\]}>,.]+$/u, "") || undefined;
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

// Interleaves untouched projections with the calendar node's actual
// children: your arrangement wins where you arranged (children keep
// document order), the feed owns what you left alone (each untouched
// projection rides after its nearest materialized feed predecessor;
// projections before any materialized entry lead the list). With nothing
// materialized this is pure feed order.
export function mergeProjectedEntries(
  childIds: readonly string[],
  entries: readonly IcalEntry[]
): CalendarMergeItem[] {
  const childIdSet = new Set(childIds);
  const leading: IcalEntry[] = [];
  const anchored = new Map<string, IcalEntry[]>();
  let anchor: string | undefined;
  entries.forEach((entry) => {
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
  childIds.forEach((childId) => {
    items.push({ kind: "child", childId });
    (anchored.get(childId) ?? []).forEach((entry) =>
      items.push({ kind: "projection", entry })
    );
  });
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

// Entries before today propose the ~ judgment (idea.md: projections may
// propose, exactly like incoming references propose ?). The proposal is
// projection-only — it is never written; the user's own judgment
// overrides and materializes.
export function isPastIcalEntry(entry: IcalEntry, nowMs: number): boolean {
  if (entry.startMs === undefined) {
    return false;
  }
  const now = new Date(nowMs);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  return entry.startMs < startOfToday;
}
