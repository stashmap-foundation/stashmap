import { v4 } from "uuid";
import * as YAML from "yaml";

const EDITING_BLOCK = `${[
  "Edit text freely. Never modify <!-- id:... --> comments.",
  "Never add <!-- id:... --> to new items. knowstr save will reject invented IDs.",
  "Markers: (!) relevant (?) maybe (~) little relevant (x) not relevant (+) confirms (-) contra. Combine: (-!) contra+relevant (-~) contra+little relevant",
  "Save changes with: knowstr save",
].join("\n")}\n`;

export function parseFrontMatter(inner: string): FrontMatter {
  const parsed: unknown = YAML.parse(inner);
  return parsed && typeof parsed === "object" ? (parsed as FrontMatter) : {};
}

export function serializeFrontMatter(fm: FrontMatter): string {
  const body = YAML.stringify(fm, { blockQuote: "literal", lineWidth: 0 });
  return `---\n${body}---\n`;
}

export type PublishState = {
  relays?: string[];
  paused: boolean;
};

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

export function publishStateOf(
  fm: FrontMatter | undefined
): PublishState | undefined {
  if (!fm || !("knowstr_publish" in fm)) {
    return undefined;
  }
  const raw = fm.knowstr_publish;
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return { paused: false };
  }
  const record = raw as Record<string, unknown>;
  return {
    relays: stringList(record.relays),
    paused: record.paused === true,
  };
}

// relays semantics: undefined = the user's configured set; a present list
// REPLACES it — including the explicitly empty list, which means "nowhere"
// and must survive the round-trip rather than snapping back to defaults.
export function withPublishState(
  fm: FrontMatter | undefined,
  state: PublishState
): FrontMatter {
  const value = {
    ...(state.relays !== undefined ? { relays: state.relays } : {}),
    ...(state.paused ? { paused: true } : {}),
  };
  return {
    ...(fm ?? {}),
    knowstr_publish: Object.keys(value).length > 0 ? value : null,
  };
}

export function withoutPublishEntities(fm: FrontMatter): FrontMatter {
  const raw = fm.knowstr_publish;
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return fm;
  }
  const entries = Object.entries(raw).filter(([key]) => key !== "entities");
  return {
    ...fm,
    knowstr_publish: entries.length > 0 ? Object.fromEntries(entries) : null,
  };
}

export function withoutPublishState(fm: FrontMatter | undefined): FrontMatter {
  return Object.fromEntries(
    Object.entries(fm ?? {}).filter(([key]) => key !== "knowstr_publish")
  );
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
