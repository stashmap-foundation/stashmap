import { Map, List } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { parseViewPath } from "./ViewContext";
import { joinID } from "./connections";
import { KIND_PROJECT } from "./nostr";
import { findAllRelays, findAllTags, findTag } from "./commons/useNostrQuery";

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

function asNumber(obj: Serializable | undefined): number {
  if (typeof obj === "number") {
    return obj;
  }
  throw new Error(`${toString(obj)} is not a number`);
}

function parseNumber(obj: Serializable | undefined): number {
  if (typeof obj === "string") {
    return parseFloat(obj);
  }
  return asNumber(obj);
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

function viewToJSON(attributes: View): Serializable {
  return {
    v: attributes.virtualLists,
    o: attributes.relations,
    w: attributes.width,
    e: attributes.expanded !== undefined ? attributes.expanded : undefined,
  };
}

function jsonToView(view: Serializable): View | undefined {
  if (view === null || view === undefined) {
    return undefined;
  }
  const a = asObject(view);
  return {
    virtualLists:
      a.v !== undefined
        ? asArray(a.v).map((list) => asString(list) as LongID)
        : undefined,
    relations: a.o !== undefined ? (asString(a.o) as LongID) : undefined,
    width: a.w !== undefined ? asNumber(a.w) : 1,
    expanded: a.e !== undefined ? asBoolean(a.e) : undefined,
  };
}

export function jsonToViews(s: Serializable): Map<string, View> {
  return Map(asObject(s))
    .map((v) => jsonToView(v))
    .filter((v, k) => {
      if (v === undefined) {
        return false;
      }
      try {
        // Test if view path is valid
        parseViewPath(k);
        return true;
      } catch {
        return false;
      }
    }) as Map<string, View>;
}

export function viewsToJSON(views: Map<string, View>): Serializable {
  return views.map((v) => viewToJSON(v)).toJSON();
}

export function eventToRelations(e: UnsignedEvent): Relations | undefined {
  const id = findTag(e, "d");
  const head = findTag(e, "k") as ID;
  const type = findTag(e, "rel_type");
  const updated = e.created_at;
  if (id === undefined || head === undefined || type === undefined) {
    return undefined;
  }
  const itemsAsTags = findAllTags(e, "i") || [];
  const items = List(itemsAsTags.map((i) => i[0] as LongID));
  return {
    id: joinID(e.pubkey, id),
    head,
    type,
    updated,
    items,
    author: e.pubkey as PublicKey,
  };
}

function parseImageUrl(e: UnsignedEvent): string | undefined {
  const imageUrl = findTag(e, "imeta");
  return !!imageUrl && imageUrl.startsWith("url ")
    ? imageUrl.slice(4)
    : undefined;
}

function parseProject(
  e: UnsignedEvent
): Omit<ProjectNode, "id" | "text"> | undefined {
  const address = findTag(e, "address");
  const perpetualVotes = findTag(e, "perpetualVotes") as LongID | undefined;
  const quarterlyVotes = findTag(e, "quarterlyVotes") as LongID | undefined;
  const dashboardInternal = findTag(e, "c") as LongID | undefined;
  const dashboardPublic = findTag(e, "dashboardPublic") as LongID | undefined;
  const tokenSupplyTag = findTag(e, "tokenSupply");
  const tokenSupply = tokenSupplyTag ? parseNumber(tokenSupplyTag) : undefined;
  const memberListProvider = findTag(e, "memberListProvider") as
    | PublicKey
    | undefined;
  if (!memberListProvider) {
    // eslint-disable-next-line no-console
    console.error("Can't parse project, memberListProvider is missing");
    return undefined;
  }
  return {
    address,
    relays: findAllRelays(e),
    imageUrl: parseImageUrl(e),
    perpetualVotes,
    quarterlyVotes,
    dashboardInternal,
    dashboardPublic,
    tokenSupply,
    createdAt: new Date(e.created_at * 1000),
    memberListProvider,
    type: "project",
  };
}

export function eventToTextOrProjectNode(
  e: UnsignedEvent
): [id: string, node: KnowNode] | [undefined] {
  const id = findTag(e, "d");
  if (id === undefined) {
    return [undefined];
  }
  const base = {
    id: joinID(e.pubkey, id),
    text: e.content,
    // ts doesn't recognise this as a valid type
    type: "text" as "text" | "project",
  };

  if (e.kind === KIND_PROJECT) {
    try {
      const project = parseProject(e);
      return project ? [id, { ...base, ...project }] : [undefined];
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      return [undefined];
    }
  }
  return [id, { ...base, imageUrl: parseImageUrl(e) }];
}
