import { v4 } from "uuid";

const DOC_ID_RE = /^knowstr_doc_id:\s*(.+)$/mu;

const EDITING_BLOCK = [
  "editing: |",
  "  Edit text freely. Never modify <!-- id:... --> comments.",
  "  Never add <!-- id:... --> to new items. knowstr save will reject invented IDs.",
  "  Markers: (!) relevant (?) maybe (~) little relevant (x) not relevant (+) confirms (-) contra. Combine: (-!) contra+relevant (-~) contra+little relevant",
  "  Save changes with: knowstr save",
].join("\n");

function stripEditingBlock(innerContent: string): string {
  const lines = innerContent.split("\n");
  const editingIdx = lines.findIndex((line) => /^editing:\s*\|/u.test(line));
  if (editingIdx === -1) {
    return innerContent;
  }
  const endIdx = lines.findIndex(
    (line, index) => index > editingIdx && line.length > 0 && !/^\s/u.test(line)
  );
  const before = lines.slice(0, editingIdx);
  const after = endIdx === -1 ? [] : lines.slice(endIdx);
  return [...before, ...after].join("\n").replace(/\n+$/u, "");
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function ensureKnowstrDocIdFrontMatter(
  frontMatterRaw: string | undefined
): {
  docId: string;
  frontMatter: string;
} {
  const rawInner = frontMatterRaw
    ? frontMatterRaw
        .replace(/^---\r?\n/u, "")
        .replace(/\r?\n---(?:\r?\n)?$/u, "")
    : "";
  const innerWithoutEditing = stripEditingBlock(rawInner);

  const docIdMatch = innerWithoutEditing.match(DOC_ID_RE);
  const docId = docIdMatch?.[1] ? stripWrappingQuotes(docIdMatch[1]) : v4();

  const innerWithDocId = docIdMatch
    ? innerWithoutEditing
    : `${innerWithoutEditing}${
        innerWithoutEditing ? "\n" : ""
      }knowstr_doc_id: ${docId}`;

  return {
    docId,
    frontMatter: `---\n${innerWithDocId}\n${EDITING_BLOCK}\n---\n`,
  };
}
