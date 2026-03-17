import { Map } from "immutable";
import { parseRowPath } from "../rows/rowPaths";

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

function parseTypeFilter(
  value: string
):
  | Relevance
  | Argument
  | "suggestions"
  | "versions"
  | "incoming"
  | "contains"
  | null {
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
  if (value === "versions") {
    return "versions";
  }
  if (value === "incoming") {
    return "incoming";
  }
  return null;
}

function parseTypeFilters(
  arr: Array<Serializable>
): Array<
  Relevance | Argument | "suggestions" | "versions" | "incoming" | "contains"
> {
  return arr
    .map((item) => parseTypeFilter(asString(item)))
    .filter(
      (
        parsed
      ): parsed is
        | Relevance
        | Argument
        | "suggestions"
        | "versions"
        | "incoming"
        | "contains" => parsed !== null
    );
}

function viewToJSON(attributes: View): Serializable {
  return {
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
        parseRowPath(k);
        return true;
      } catch {
        return false;
      }
    }) as Map<string, View>;
}

export function paneToJSON(pane: Pane): Serializable {
  return {
    i: pane.id,
    s: pane.stack,
    a: pane.author,
    r: pane.rootNodeId,
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
    stack: asArray(obj.s).map((id) => asString(id) as ID),
    author: asString(obj.a) as PublicKey,
    rootNodeId: obj.r !== undefined ? (asString(obj.r) as LongID) : undefined,
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
