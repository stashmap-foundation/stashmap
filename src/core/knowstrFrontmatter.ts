import { v4 } from "uuid";
import * as YAML from "yaml";

const EDITING_BLOCK = `${[
  "Edit text freely. Never modify <!-- id:... --> comments.",
  "Never add <!-- id:... --> to new items. knowstr save will reject invented IDs.",
  "Markers: (!) relevant (?) maybe (~) little relevant (x) not relevant (+) confirms (-) contra. Combine: (-!) contra+relevant (-~) contra+little relevant",
  "Save changes with: knowstr save",
].join("\n")}\n`;

export function parseFrontMatter(inner: string): FrontMatter {
  const parsed = YAML.parse(inner);
  return parsed && typeof parsed === "object" ? (parsed as FrontMatter) : {};
}

export function serializeFrontMatter(fm: FrontMatter): string {
  const body = YAML.stringify(fm, { blockQuote: "literal", lineWidth: 0 });
  return `---\n${body}---\n`;
}

export function ensureKnowstrDocId(
  fm: FrontMatter | undefined,
  fallback?: string
): {
  docId: string;
  frontMatter: FrontMatter;
} {
  const existing = fm?.knowstr_doc_id;
  const docId = typeof existing === "string" ? existing : fallback ?? v4();
  return {
    docId,
    frontMatter: {
      ...(fm ?? {}),
      knowstr_doc_id: docId,
      editing: EDITING_BLOCK,
    },
  };
}
