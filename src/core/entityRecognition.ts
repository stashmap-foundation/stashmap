// Recognizers turn self-identifying text into canonical entity ids — the
// automatic half of identify (idea.md, Entity nodes: mint or link). One row
// per scheme; v0 ships the two unambiguous ones. Free-text lookup ("type
// Barcelona, get offered wd:Q1492") is a later feature, and ISBN/DOI wait
// on the per-scheme normalization questions the model leaves open.

import { isCalendarEntryId } from "./ical";
import { isEntityId } from "./linkPath";
// Real ids look like rgb:cdtFZh2Q-YTY1rYW-… (deedsats wallet config).
export const RGB_CONTRACT_ID_RE = /^rgb:[A-Za-z0-9_~-]{20,}$/u;

const WIKIDATA_URL_RE =
  /^https?:\/\/(?:www\.)?wikidata\.org\/wiki\/(Q\d+)(?:[#?].*)?$/u;

export function isCanonicalId(id: string): boolean {
  return isEntityId(id) || isCalendarEntryId(id);
}

export function entityIdForText(text: string): string | undefined {
  const marker = text.trim();
  if (RGB_CONTRACT_ID_RE.test(marker)) {
    return `asset:${marker}`;
  }
  const wikidata = marker.match(WIKIDATA_URL_RE);
  if (wikidata) {
    return `wd:${wikidata[1]}`;
  }
  return undefined;
}
