import crypto from "crypto";
import memoize from "memoizee";

const hashContent = memoize(function createContentHash(
  contentString: string
): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(contentString))
    .digest("hex");
});

function verifyContentHash(content: string, hash: string): boolean {
  const contentHash = hashContent(content);
  return contentHash === hash;
}

export { verifyContentHash, hashContent };
