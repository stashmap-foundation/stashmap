import { nip19 } from "nostr-tools";
import {
  addressForSource,
  buildDocumentRouteUrl,
  buildNodeRouteUrl,
  parseDocumentRouteUrl,
  parseNodeRouteUrl,
  parseSourceFromSearch,
  resolveAddress,
} from "./navigationUrl";
import { LOCAL } from "./core/nodeRef";

const ALICE_SOURCE = "alice";

test("buildNodeRouteUrl creates source-scoped node route", () => {
  expect(buildNodeRouteUrl("some-node-id" as ID, ALICE_SOURCE)).toBe(
    "/r/some-node-id?source=alice"
  );
  expect(buildNodeRouteUrl("encoded/id" as ID, "source/id")).toBe(
    "/r/encoded%2Fid?source=source%2Fid"
  );
});

test("buildNodeRouteUrl includes scroll target as hash", () => {
  expect(
    buildNodeRouteUrl("some-node-id" as ID, ALICE_SOURCE, "child/id" as ID)
  ).toBe("/r/some-node-id?source=alice#child%2Fid");
});

test("buildDocumentRouteUrl creates document route", () => {
  expect(buildDocumentRouteUrl("alice" as PublicKey, "doc.md")).toBe(
    "/d/alice/doc.md"
  );
  expect(buildDocumentRouteUrl("alice/key" as PublicKey, "docs/file.md")).toBe(
    "/d/alice%2Fkey/docs%2Ffile.md"
  );
});

test("buildDocumentRouteUrl includes scroll target as hash", () => {
  expect(
    buildDocumentRouteUrl("alice" as PublicKey, "doc.md", "child/id" as ID)
  ).toBe("/d/alice/doc.md#child%2Fid");
});

test("parseNodeRouteUrl extracts node ID", () => {
  expect(parseNodeRouteUrl("/r/some-node-id")).toBe("some-node-id");
  expect(parseNodeRouteUrl("/r/encoded%2Fid")).toBe("encoded/id");
  expect(parseNodeRouteUrl("/n/something")).toBeUndefined();
  expect(parseNodeRouteUrl("/")).toBeUndefined();
});

test("parseDocumentRouteUrl extracts address and document ID", () => {
  expect(parseDocumentRouteUrl("/d/alice/doc.md")).toEqual({
    address: "alice",
    docId: "doc.md",
  });
  expect(parseDocumentRouteUrl("/d/alice%2Fkey/docs%2Ffile.md")).toEqual({
    address: "alice/key",
    docId: "docs/file.md",
  });
  expect(parseDocumentRouteUrl("/r/something")).toBeUndefined();
  expect(parseDocumentRouteUrl("/")).toBeUndefined();
});

test("parseSourceFromSearch extracts source", () => {
  expect(parseSourceFromSearch("?source=abc123")).toBe("abc123");
  expect(parseSourceFromSearch("?author=abc123")).toBeUndefined();
  expect(parseSourceFromSearch("?foo=bar")).toBeUndefined();
  expect(parseSourceFromSearch("")).toBeUndefined();
});

const OWN_PUBKEY =
  "f0289b28573a7c9bb169f43102b26259b7a4b758aca66ea3ac8cd0fe516a3758" as PublicKey;
const OTHER_PUBKEY =
  "f0010ab30d3bd17a4368f3bf3a26900c65d97c2b8db1f3d2c84931f1d54734f6" as PublicKey;

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
