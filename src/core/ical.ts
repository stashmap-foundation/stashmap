/* eslint-disable functional/no-let, functional/immutable-data */
import { icalEntryId } from "./icalId";
import { spansText } from "./nodeSpans";
import { classifyLinkHref } from "./linkPath";

const ICAL_URL_RE =
  /(webcal:\/\/[^\s\]()]+|https?:\/\/[^\s\]()]+\.ics(\?[^\s\]()]*)?)/iu;

const ICAL_FEED_LINK_RE = /^\[([^\]]*)\]\(feed:([^\s()]+)\)$/u;

export function isCalendarEntryId(id: string): boolean {
  return id.startsWith("ical:");
}

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
  return span.kind === "link" && classifyLinkHref(span.href) === "feed"
    ? span.href.slice("feed:".length)
    : undefined;
}

export function calendarFeedTargetUrl(
  target: ID | undefined
): string | undefined {
  return target !== undefined && classifyLinkHref(target) === "feed"
    ? target.slice("feed:".length)
    : undefined;
}

export function calendarEntryTarget(
  node: GraphNode | undefined
): ID | undefined {
  if (!node || node.spans.length !== 1) return undefined;
  const span = node.spans[0];
  return span.kind === "link" && classifyLinkHref(span.href) === "calendar"
    ? span.href.slice(1)
    : undefined;
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

export function calendarFeedHref(url: string): string {
  return `feed:${url.trim().replace(/^webcal:\/\//iu, "https://")}`;
}

export function icalFeedLinkText(url: string, label?: string): string {
  return `[${label ?? url}](${calendarFeedHref(url)})`;
}

export function displayTextOf(text: string): string {
  return icalFeedLinkPartsOf(text)?.label ?? text;
}

export type IcalEntry = {
  readonly id: string;
  readonly uid: string;
  readonly summary: string;
  readonly startMs?: number;
  readonly allDay: boolean;
};

function unfold(content: string): string[] {
  return content.split(/\r?\n/u).reduce<string[]>((lines, line) => {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      return [...lines.slice(0, -1), lines[lines.length - 1] + line.slice(1)];
    }
    return line === "" ? lines : [...lines, line];
  }, []);
}

function unescapeText(value: string): string {
  return value.replace(/\\(.)/gu, (_, next: string) =>
    next === "n" || next === "N" ? "\n" : next
  );
}

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

function startOfDay(nowMs: number): number {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function isPastIcalEntry(entry: IcalEntry, nowMs: number): boolean {
  if (entry.startMs === undefined) {
    return false;
  }
  return entry.startMs < startOfDay(nowMs);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

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
