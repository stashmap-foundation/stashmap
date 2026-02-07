import { Map, List } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { parseViewPath } from "./ViewContext";
import { joinID, hashText } from "./connections";
import { findAllTags, findTag, getEventMs } from "./commons/useNostrQuery";

export type Serializable =
  | string
  | number
  | boolean
  | { [key: string]: Serializable }
  | Array<Serializable>
  | null
  // JSON doesn't have an undefined value, so fields with undefined will be omitted
  | undefined;

function toString(serializable: Serializable | undefined): string {
  return serializable === undefined || serializable === null
    ? "undefined"
    : serializable.toString(); // eslint-disable-line @typescript-eslint/no-base-to-string
}

function asObject(obj: Serializable | undefined): {
  [key: string]: Serializable;
} {
  if (typeof obj === "object" && !Array.isArray(obj) && obj !== null) {
    return obj;
  }
  throw new Error(`${toString(obj)} is not an object`);
}

function asString(obj: Serializable | undefined): string {
  if (typeof obj === "string") {
    return obj;
  }
  throw new Error(`${toString(obj)} is not a string`);
}

function asBoolean(obj: Serializable | undefined): boolean {
  if (typeof obj === "boolean") {
    return obj;
  }
  throw new Error(`${toString(obj)} is not a boolean`);
}

function asArray(obj: Serializable | undefined): Array<Serializable> {
  if (obj === undefined) {
    return [];
  }
  if (Array.isArray(obj)) {
    return obj;
  }
  throw new Error(`${toString(obj)} is not an array`);
}

// Valid values for Relevance and Argument types
const VALID_RELEVANCE: Relevance[] = [
  "relevant",
  "maybe_relevant",
  "little_relevant",
  "not_relevant",
  undefined,
];
const VALID_ARGUMENT: Argument[] = ["confirms", "contra", undefined];

function parseRelevance(value: string | undefined): Relevance {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (VALID_RELEVANCE.includes(value as Relevance)) {
    return value as Relevance;
  }
  return undefined;
}

function parseArgument(value: string | undefined): Argument {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (!VALID_ARGUMENT.includes(value as Argument)) {
    return undefined;
  }
  return value as Argument;
}

function parseTypeFilter(
  value: string
): Relevance | Argument | "suggestions" | "contains" | null {
  if (value === "contains") {
    return "contains";
  }
  if (value === "" || value === "undefined") {
    return "contains";
  }
  if (
    value === "relevant" ||
    value === "maybe_relevant" ||
    value === "little_relevant" ||
    value === "not_relevant"
  ) {
    return value as Relevance;
  }
  if (value === "confirms" || value === "contra") {
    return value as Argument;
  }
  if (value === "suggestions") {
    return "suggestions";
  }
  return null;
}

function parseTypeFilters(
  arr: Array<Serializable>
): Array<Relevance | Argument | "suggestions" | "contains"> {
  return arr
    .map((item) => parseTypeFilter(asString(item)))
    .filter(
      (parsed): parsed is Relevance | Argument | "suggestions" | "contains" =>
        parsed !== null
    );
}

function viewToJSON(attributes: View): Serializable {
  return {
    m: attributes.viewingMode,
    e: attributes.expanded !== undefined ? attributes.expanded : undefined,
    f: attributes.typeFilters,
  };
}

function jsonToView(view: Serializable): View | undefined {
  if (view === null || view === undefined) {
    return undefined;
  }
  const a = asObject(view);
  return {
    viewingMode: a.m === "REFERENCED_BY" ? "REFERENCED_BY" : undefined,
    expanded: a.e !== undefined ? asBoolean(a.e) : undefined,
    typeFilters: a.f !== undefined ? parseTypeFilters(asArray(a.f)) : undefined,
  };
}

export function jsonToViews(s: Serializable): Map<string, View> {
  const obj = asObject(s);
  if (obj.views === undefined) {
    return Map<string, View>();
  }
  return Map(asObject(obj.views))
    .map((v) => jsonToView(v))
    .filter((v, k) => {
      if (v === undefined) {
        return false;
      }
      try {
        parseViewPath(k);
        return true;
      } catch {
        return false;
      }
    }) as Map<string, View>;
}

function paneToJSON(pane: Pane): Serializable {
  return {
    i: pane.id,
    s: pane.stack,
    a: pane.author,
    r: pane.rootRelation,
    t: pane.typeFilters,
  };
}

function jsonToPane(s: Serializable): Pane | undefined {
  if (s === null || s === undefined) {
    return undefined;
  }
  const obj = asObject(s);
  return {
    id: asString(obj.i),
    stack: asArray(obj.s).map((id) => asString(id) as LongID | ID),
    author: asString(obj.a) as PublicKey,
    rootRelation: obj.r !== undefined ? (asString(obj.r) as LongID) : undefined,
    typeFilters:
      obj.t !== undefined
        ? (asArray(obj.t).map((f) => asString(f)) as Pane["typeFilters"])
        : undefined,
  };
}

export function jsonToPanes(s: Serializable): Pane[] {
  const obj = asObject(s);
  if (obj.panes === undefined) {
    return [];
  }
  return asArray(obj.panes)
    .map((p) => jsonToPane(p))
    .filter((p): p is Pane => p !== undefined);
}

export function viewDataToJSON(
  views: Map<string, View>,
  panes: Pane[]
): Serializable {
  return {
    views: views.map((v) => viewToJSON(v)).toJSON(),
    panes: panes.map((p) => paneToJSON(p)),
  };
}

export function eventToRelations(e: UnsignedEvent): Relations | undefined {
  const id = findTag(e, "d");
  const head = findTag(e, "k") as ID;
  const updated = getEventMs(e);
  if (id === undefined || head === undefined) {
    return undefined;
  }

  // Parse context from multiple "c" tags (each tag is ["c", ancestorID])
  const contextTags = findAllTags(e, "c") || [];
  const context = List(contextTags.map((tag) => tag[0] as ID));

  // Parse basedOn from "b" tag: ["b", relationID]
  const basedOn = findTag(e, "b") as LongID | undefined;

  // Parse items with relevance and optional argument: ["i", nodeID, relevance, argument?]
  // Invalid relevance/argument values are filtered to defaults
  const itemsAsTags = findAllTags(e, "i") || [];
  const items = List(
    itemsAsTags.map((tagValues) => ({
      nodeID: tagValues[0] as LongID,
      relevance: parseRelevance(tagValues[1]),
      argument: parseArgument(tagValues[2]),
    }))
  );

  return {
    id: joinID(e.pubkey, id),
    head,
    context,
    updated,
    items,
    author: e.pubkey as PublicKey,
    basedOn,
  };
}

export function eventToTextNode(
  e: UnsignedEvent
): [id: string, node: KnowNode] | [undefined] {
  const id = findTag(e, "d");
  if (id === undefined) {
    return [undefined];
  }
  const text = e.content;

  // Verify content-addressed ID matches the hash of the text
  const expectedHash = hashText(text);
  if (id !== expectedHash) {
    // eslint-disable-next-line no-console
    console.warn(`Node ID mismatch: expected ${expectedHash}, got ${id}`);
    return [undefined];
  }

  const textNode: TextNode = {
    id: id as ID,
    text,
    type: "text",
  };
  return [id, textNode];
}
