const UNSAFE_MARKDOWN_ID_RE = /[\s"'<>]/u;

export function isSafeMarkdownId(value: string): boolean {
  return (
    value.length > 0 &&
    !UNSAFE_MARKDOWN_ID_RE.test(value) &&
    !value.includes("--")
  );
}

export function assertSafeMarkdownId(value: string, label: string): void {
  if (!isSafeMarkdownId(value)) {
    throw new Error(
      `${label} must be a non-empty markdown-safe string without whitespace, quotes, angle brackets, or "--": ${JSON.stringify(
        value
      )}`
    );
  }
}
