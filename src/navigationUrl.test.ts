import {
  buildDocumentRouteUrl,
  buildNodeRouteUrl,
  parseDocumentRouteUrl,
  parseNodeRouteUrl,
  parseSourceFromSearch,
} from "./navigationUrl";

const ALICE_SOURCE = "alice";

test("buildNodeRouteUrl creates source-scoped node route", () => {
  expect(buildNodeRouteUrl("some-node-id" as LongID, ALICE_SOURCE)).toBe(
    "/r/some-node-id?source=alice"
  );
  expect(buildNodeRouteUrl("encoded/id" as LongID, "source/id")).toBe(
    "/r/encoded%2Fid?source=source%2Fid"
  );
});

test("buildNodeRouteUrl includes scroll target as hash", () => {
  expect(
    buildNodeRouteUrl("some-node-id" as LongID, ALICE_SOURCE, "child/id" as ID)
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

test("parseDocumentRouteUrl extracts author and document ID", () => {
  expect(parseDocumentRouteUrl("/d/alice/doc.md")).toEqual({
    author: "alice",
    docId: "doc.md",
  });
  expect(parseDocumentRouteUrl("/d/alice%2Fkey/docs%2Ffile.md")).toEqual({
    author: "alice/key",
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
