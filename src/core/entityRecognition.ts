// Real ids look like rgb:cdtFZh2Q-YTY1rYW-… (deedsats wallet config).
export const RGB_CONTRACT_ID_RE = /^rgb:[A-Za-z0-9_~-]{20,}$/u;

const WIKIDATA_URL_RE =
  /^https?:\/\/(?:www\.)?wikidata\.org\/wiki\/(Q\d+)(?:[#?].*)?$/u;

export function entityIdForText(text: string): string | undefined {
  const marker = text.trim();
  if (RGB_CONTRACT_ID_RE.test(marker)) {
    return marker;
  }
  const wikidata = marker.match(WIKIDATA_URL_RE);
  if (wikidata) {
    return `wikidata:${wikidata[1]}`;
  }
  return undefined;
}
