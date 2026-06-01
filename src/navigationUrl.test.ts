import {
  buildDocumentRouteUrl,
  buildNodeRouteUrl,
  parseDocumentRouteUrl,
  parseNodeRouteUrl,
  parseSourceFromSearch,
} from "./navigationUrl";

test("buildNodeRouteUrl creates node route", () => {
  expect(buildNodeRouteUrl("some-node-id" as LongID)).toBe("/r/some-node-id");
  expect(buildNodeRouteUrl("encoded/id" as LongID)).toBe("/r/encoded%2Fid");
});

test("buildNodeRouteUrl includes source query", () => {
  expect(buildNodeRouteUrl("some-node-id" as LongID, undefined, "abc123")).toBe(
    "/r/some-node-id?source=abc123"
  );
});

test("buildNodeRouteUrl includes scroll target as hash", () => {
  expect(buildNodeRouteUrl("some-node-id" as LongID, "child/id" as ID)).toBe(
    "/r/some-node-id#child%2Fid"
  );
  expect(
    buildNodeRouteUrl("some-node-id" as LongID, "child/id" as ID, "abc123")
  ).toBe("/r/some-node-id?source=abc123#child%2Fid");
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
