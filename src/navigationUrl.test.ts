import {
  buildNodeRouteUrl,
  parseNodeRouteUrl,
  parseAuthorFromSearch,
} from "./navigationUrl";

test("buildNodeRouteUrl creates node route", () => {
  expect(buildNodeRouteUrl("some-node-id" as LongID)).toBe("/r/some-node-id");
  expect(buildNodeRouteUrl("encoded/id" as LongID)).toBe("/r/encoded%2Fid");
});

test("buildNodeRouteUrl includes scroll target as hash", () => {
  expect(buildNodeRouteUrl("some-node-id" as LongID, "child/id" as ID)).toBe(
    "/r/some-node-id#child%2Fid"
  );
});

test("parseNodeRouteUrl extracts node ID", () => {
  expect(parseNodeRouteUrl("/r/some-node-id")).toBe("some-node-id");
  expect(parseNodeRouteUrl("/r/encoded%2Fid")).toBe("encoded/id");
  expect(parseNodeRouteUrl("/n/something")).toBeUndefined();
  expect(parseNodeRouteUrl("/")).toBeUndefined();
});

test("parseAuthorFromSearch extracts author", () => {
  expect(parseAuthorFromSearch("?author=abc123")).toBe("abc123");
  expect(parseAuthorFromSearch("?foo=bar")).toBeUndefined();
  expect(parseAuthorFromSearch("")).toBeUndefined();
});
