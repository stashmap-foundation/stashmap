import { verifyContentHash, hashContent } from "./encryption";

test("test hash verification", () => {
  const payloadHash = hashContent("foo");
  expect(verifyContentHash("foo", payloadHash)).toBeTruthy();
  expect(verifyContentHash("foo", `${payloadHash}000`)).toBeFalsy();
});
