import {
  IcalEntry,
  icalEntryDisplayText,
  isCalendarEntryId,
} from "./core/ical";

const WIKIDATA_ENTITY_RE = /^wd:(Q\d+)$/u;

function unique(values: readonly string[]): string[] {
  return values.reduce<string[]>(
    (acc, value) => (acc.includes(value) ? acc : [...acc, value]),
    []
  );
}

export function entityLabelLanguageOrder(
  languages: readonly string[]
): string[] {
  return unique(
    [...languages, "en"].flatMap((language) => {
      const trimmed = language.trim();
      if (trimmed === "") {
        return [];
      }
      const base = trimmed.split("-")[0];
      return base && base !== trimmed ? [trimmed, base] : [trimmed];
    })
  );
}

export function wikidataEntityQid(id: string): string | undefined {
  return WIKIDATA_ENTITY_RE.exec(id)?.[1];
}

export function wikidataMetadataUrl(
  id: string,
  languages: readonly string[]
): string | undefined {
  const qid = wikidataEntityQid(id);
  if (!qid) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("action", "wbgetentities");
  params.set("format", "json");
  params.set("origin", "*");
  params.set("props", "labels");
  params.set("ids", qid);
  params.set("languages", languages.join("|"));
  params.set("languagefallback", "1");
  return `https://www.wikidata.org/w/api.php?${params.toString()}`;
}

function objectValue(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return Reflect.get(value, key);
}

export function wikidataLabelFromResponse(
  id: string,
  payload: unknown,
  languages: readonly string[]
): string | undefined {
  const qid = wikidataEntityQid(id);
  if (!qid) {
    return undefined;
  }
  const labels = objectValue(
    objectValue(objectValue(payload, "entities"), qid),
    "labels"
  );
  return languages
    .map((language) => objectValue(objectValue(labels, language), "value"))
    .find(
      (label): label is string =>
        typeof label === "string" && label.trim() !== ""
    );
}

export function retryAfterUntilMs(
  value: string | null,
  nowMs: number
): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return nowMs + seconds * 1000;
  }
  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? undefined : Math.max(nowMs, dateMs);
}

export function defaultEntitySurfaceTitle(id: string): string {
  return isCalendarEntryId(id) ? `Date ${id}` : `Entity ${id}`;
}

export function calendarEntryLabel(
  id: string,
  feeds: readonly (readonly IcalEntry[])[]
): string | undefined {
  const labels = unique(
    feeds.flatMap((entries) =>
      entries
        .filter((entry) => entry.id === id)
        .map((entry) => icalEntryDisplayText(entry))
    )
  );
  return labels.length === 1 ? labels[0] : undefined;
}
