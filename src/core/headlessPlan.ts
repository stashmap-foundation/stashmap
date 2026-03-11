import { List, Map, OrderedSet, Set } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { KIND_DELETE, KIND_KNOWLEDGE_DOCUMENT } from "../nostr";
import { createPlan, buildDocumentEvents, Plan } from "../planner";

const EMPTY_TEMPORARY_VIEW: TemporaryViewState = {
  rowFocusIntents: Map<number, RowFocusIntent>(),
  baseSelection: OrderedSet<string>(),
  shiftSelection: OrderedSet<string>(),
  anchor: "",
  editingViews: Set<string>(),
  editorOpenViews: Set<string>(),
  draftTexts: Map<string, string>(),
};

const EMPTY_EVENT_STATE: EventState = {
  unsignedEvents: List(),
  results: Map(),
  isLoading: false,
  preLoginEvents: List(),
  temporaryView: EMPTY_TEMPORARY_VIEW,
  temporaryEvents: List(),
};

const EMPTY_RELAYS: AllRelays = {
  defaultRelays: [],
  userRelays: [],
  contactsRelays: [],
};

export function createHeadlessPlan(
  viewer: PublicKey,
  knowledgeDBs: KnowledgeDBs = Map<PublicKey, KnowledgeData>()
): Plan {
  return createPlan({
    contacts: Map<PublicKey, Contact>(),
    user: { publicKey: viewer },
    contactsRelays: Map<PublicKey, Relays>(),
    knowledgeDBs,
    relaysInfos: Map(),
    publishEventsStatus: EMPTY_EVENT_STATE,
    projectMembers: Map<PublicKey, Member>(),
    views: Map(),
    panes: [
      {
        id: "headless",
        stack: [],
        author: viewer,
      },
    ],
    relays: EMPTY_RELAYS,
  });
}

export function buildKnowledgeDocumentEvents(plan: Plan): UnsignedEvent[] {
  return buildDocumentEvents(plan)
    .filter(
      (event) =>
        event.kind === KIND_KNOWLEDGE_DOCUMENT || event.kind === KIND_DELETE
    )
    .toArray();
}
