import * as YAML from "yaml";

export function parseFrontMatter(inner: string): FrontMatter {
  const parsed: unknown = YAML.parse(inner);
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== "knowstr_publish")
  );
}

export function serializeFrontMatter(fm: FrontMatter): string {
  const body = YAML.stringify(fm, { blockQuote: "literal", lineWidth: 0 });
  return `---\n${body}---\n`;
}
