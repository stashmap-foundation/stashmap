import {
  IcalEntry,
  icalEntryDisplayText,
  isCalendarEntryId,
} from "./core/ical";
import { getDesktopBridge } from "./runtimeEnvironment";

export type EntityPickerCandidate = {
  id: string;
  label: string;
  description: string;
  source: "local" | "wikidata";
};

export type WikidataSearchCandidate = {
  qid: string;
  label: string;
  description: string;
};

const WIKIDATA_ENTITY_RE = /^wd:(Q\d+)$/u;
const WIKIDATA_QID_RE = /^Q\d+$/u;
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIDATA_PROXY_PATH = "/.netlify/functions/wikidata-proxy";

function unique(values: readonly string[]): string[] {
  return values.reduce<string[]>(
    (acc, value) => (acc.includes(value) ? acc : [...acc, value]),
    []
  );
}

export function browserEntityLabelLanguages(): string[] {
  if (typeof navigator === "undefined") {
    return [];
  }
  return navigator.languages.length > 0
    ? [...navigator.languages]
    : [navigator.language].filter((language) => language !== "");
}

export function entityLabelLanguageOrder(
  languages: readonly string[]
): string[] {
  return unique(
    [...languages, "en"].flatMap((language) => {
      const trimmed = language.trim().toLocaleLowerCase();
      if (trimmed === "") {
        return [];
      }
      return trimmed.split("-").slice(0, 1).filter(Boolean);
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

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function responsePayload(response: Response): Promise<unknown> {
  if (typeof response.json === "function") {
    const payload: unknown = await response.json();
    return payload;
  }
  const payload: unknown = JSON.parse(
    typeof response.text === "function" ? await response.text() : ""
  );
  return payload;
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

export function wikidataSearchUrl(
  query: string,
  languages: readonly string[]
): string | undefined {
  const search = query.trim();
  if (search === "") {
    return undefined;
  }
  const language = languages[0] ?? "en";
  const params = new URLSearchParams();
  params.set("action", "wbsearchentities");
  params.set("format", "json");
  params.set("origin", "*");
  params.set("search", search);
  params.set("language", language);
  params.set("uselang", "en");
  params.set("type", "item");
  params.set("limit", "7");
  return `${WIKIDATA_API}?${params.toString()}`;
}

export function wikidataSearchCandidatesFromResponse(
  payload: unknown
): WikidataSearchCandidate[] {
  return arrayValue(objectValue(payload, "search")).flatMap((hit) => {
    const qid = stringValue(objectValue(hit, "id"));
    const label = stringValue(objectValue(hit, "label")).trim();
    const description = stringValue(objectValue(hit, "description")).trim();
    return WIKIDATA_QID_RE.test(qid) && label !== ""
      ? [{ qid, label, description }]
      : [];
  });
}

export function defaultEntityMetadataFetcher(): (
  url: string
) => Promise<Response> {
  const desktopFetch = getDesktopBridge()?.fetchText;
  if (desktopFetch) {
    return async (url: string): Promise<Response> =>
      new Response(await desktopFetch(url));
  }
  return async (url: string): Promise<Response> => {
    try {
      return await fetch(url);
    } catch {
      return fetch(`${WIKIDATA_PROXY_PATH}?url=${encodeURIComponent(url)}`);
    }
  };
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
