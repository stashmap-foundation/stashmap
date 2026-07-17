import { nip19 } from "nostr-tools";
import {
  addressForSource,
  buildCoordinateRouteUrl,
  buildDocumentRouteUrl,
  buildNodeRouteUrl,
  buildShareRouteUrl,
  MAX_ROUTE_RELAY_HINTS,
  parseAtFromSearch,
  parseCoordinateRouteUrl,
  parseDocumentRouteUrl,
  parseFallbackLabelFromSearch,
  parseNodeRouteUrl,
  parseSourceFromSearch,
  parseStorageKeyFromHash,
  resolveAddress,
  routeCoordinateSourceId,
} from "./navigationUrl";
import { LOCAL } from "./core/nodeRef";
import { KIND_KNOWLEDGE_DEPOSIT, KIND_KNOWLEDGE_DOCUMENT } from "./nostr";

const OWN_PUBKEY =
  "f0289b28573a7c9bb169f43102b26259b7a4b758aca66ea3ac8cd0fe516a3758" as PublicKey;
const OTHER_PUBKEY =
  "f0010ab30d3bd17a4368f3bf3a26900c65d97c2b8db1f3d2c84931f1d54734f6" as PublicKey;

function coordinate(
  eventKind: 34774 | 34775,
  dTag: string,
  relays: string[] = []
): RouteCoordinate {
  return { eventKind, pubkey: OTHER_PUBKEY, dTag, relays };
}

test("buildNodeRouteUrl creates local node route", () => {
  expect(
    buildNodeRouteUrl("some-node-id" as ID, LOCAL, {
      scrollToId: undefined,
      fallbackLabel: undefined,
    })
  ).toBe("/local/n/some-node-id");
  expect(
    buildNodeRouteUrl("encoded/id" as ID, LOCAL, {
      scrollToId: undefined,
      fallbackLabel: undefined,
    })
  ).toBe("/local/n/encoded%2Fid");
});

test("buildNodeRouteUrl includes focus and label queries", () => {
  expect(
    buildNodeRouteUrl("wd:Q1492" as ID, LOCAL, {
      scrollToId: "child/id" as ID,
      fallbackLabel: "Barcelona / Barna",
    })
  ).toBe("/local/n/wd%3AQ1492?at=child%2Fid&label=Barcelona+%2F+Barna");
});

test("buildDocumentRouteUrl creates local document route", () => {
  expect(buildDocumentRouteUrl(LOCAL, "doc.md")).toBe("/local/d/doc.md");
  expect(buildDocumentRouteUrl(LOCAL, "docs/file.md")).toBe(
    "/local/d/docs%2Ffile.md"
  );
});

test("buildDocumentRouteUrl includes focus query", () => {
  expect(buildDocumentRouteUrl(LOCAL, "doc.md", "child/id" as ID)).toBe(
    "/local/d/doc.md?at=child%2Fid"
  );
});

test("coordinate routes round-trip and cap relay hints", () => {
  const route = buildCoordinateRouteUrl(
    "deposit",
    coordinate(KIND_KNOWLEDGE_DEPOSIT, "doc-1", [
      "relay.one",
      "wss://relay.two/",
      "wss://relay.two",
      "wss://relay.three",
      "wss://relay.four",
    ]),
    "node-1" as ID,
    undefined
  );
  const parsed = parseCoordinateRouteUrl(
    new URL(route, "https://x").pathname,
    "deposit"
  );
  expect(parsed).toEqual({
    eventKind: KIND_KNOWLEDGE_DEPOSIT,
    pubkey: OTHER_PUBKEY,
    dTag: "doc-1",
    relays: ["wss://relay.one/", "wss://relay.two/", "wss://relay.three/"],
  });
  expect(parsed?.relays).toHaveLength(MAX_ROUTE_RELAY_HINTS);
  expect(parseAtFromSearch(new URL(route, "https://x").search)).toBe("node-1");
});

test("storage share route carries the key fragment", () => {
  const route = buildShareRouteUrl(OTHER_PUBKEY, "doc-1", "secret key");
  const url = new URL(route, "https://x");
  expect(parseCoordinateRouteUrl(url.pathname, "storage")?.dTag).toBe("doc-1");
  expect(parseStorageKeyFromHash(url.hash)).toBe("secret key");
});

test("route parsers reject retired and mismatched routes", () => {
  const storage = buildCoordinateRouteUrl(
    "storage",
    coordinate(KIND_KNOWLEDGE_DOCUMENT, "doc-1"),
    undefined,
    undefined
  );
  expect(parseNodeRouteUrl("/local/n/some-node-id")).toBe("some-node-id");
  expect(parseNodeRouteUrl("/r/some-node-id")).toBeUndefined();
  expect(parseDocumentRouteUrl("/local/d/doc.md")).toEqual({
    address: LOCAL,
    docId: "doc.md",
  });
  expect(parseDocumentRouteUrl("/d/alice/doc.md")).toBeUndefined();
  expect(
    parseCoordinateRouteUrl(new URL(storage, "https://x").pathname, "deposit")
  ).toBeUndefined();
});

test("label and source query parsing follows typed routes", () => {
  expect(parseFallbackLabelFromSearch("?label=Barcelona+%2F+Barna")).toBe(
    "Barcelona / Barna"
  );
  expect(parseFallbackLabelFromSearch("?label=&label=Other")).toBeUndefined();
  expect(parseSourceFromSearch("?source=abc123")).toBeUndefined();
});

test("coordinate source ids are stable", () => {
  expect(
    routeCoordinateSourceId(coordinate(KIND_KNOWLEDGE_DEPOSIT, "doc-1"))
  ).toBe(`${KIND_KNOWLEDGE_DEPOSIT}:${OTHER_PUBKEY}:doc-1`);
});

test("resolveAddress and addressForSource round-trip own and foreign addresses", () => {
  const ownNpub = nip19.npubEncode(OWN_PUBKEY);

  expect(resolveAddress(ownNpub, OWN_PUBKEY)).toBe(LOCAL);
  expect(resolveAddress(OWN_PUBKEY, OWN_PUBKEY)).toBe(LOCAL);
  expect(resolveAddress(undefined, OWN_PUBKEY)).toBe(LOCAL);
  expect(
    addressForSource(resolveAddress(ownNpub, OWN_PUBKEY), OWN_PUBKEY)
  ).toBe(ownNpub);

  const foreignNpub = nip19.npubEncode(OTHER_PUBKEY);
  expect(resolveAddress(foreignNpub, OWN_PUBKEY)).toBe(OTHER_PUBKEY);
  expect(
    addressForSource(resolveAddress(foreignNpub, OWN_PUBKEY), OWN_PUBKEY)
  ).toBe(OTHER_PUBKEY);
  expect(
    addressForSource(resolveAddress(OTHER_PUBKEY, OWN_PUBKEY), OWN_PUBKEY)
  ).toBe(OTHER_PUBKEY);
});

test("resolveAddress without a session never yields LOCAL for real addresses", () => {
  expect(resolveAddress(OWN_PUBKEY, undefined)).toBe(OWN_PUBKEY);
  expect(addressForSource(LOCAL, undefined)).toBeUndefined();
});
