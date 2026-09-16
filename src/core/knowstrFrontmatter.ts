import { v4 } from "uuid";
import * as YAML from "yaml";

const EDITING_RULES = [
  "Never add <!-- id:... --> to new items. knowstr save will reject invented IDs.",
  "Markers: (!) relevant (?) maybe (~) little relevant (x) not relevant (+) confirms (-) contra. Combine: (-!) contra+relevant (-~) contra+little relevant",
  "Save changes with: knowstr save",
];

function editingBlock(generatedFrom: unknown): string {
  const opening =
    typeof generatedFrom === "string"
      ? `Generated view from ${generatedFrom}; edit the source there and regenerate.`
      : "Edit text freely.";
  return `${[
    `${opening} Never modify <!-- id:... --> comments.`,
    ...EDITING_RULES,
  ].join("\n")}\n`;
}

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
      editing: editingBlock(fm?.generated_from),
    },
  };
}
