import React, { Dispatch, SetStateAction } from "react";
import { List } from "immutable";
import { UnsignedEvent, Event } from "nostr-tools";
import {
  KIND_DELETE,
  KIND_KNOWLEDGE_LIST,
  KIND_KNOWLEDGE_NODE,
  KIND_CONTACTLIST,
  KIND_VIEWS,
  KIND_MEMBERLIST,
  KIND_RELAY_METADATA_EVENT,
  newTimestamp,
} from "./nostr";
import { useData } from "./DataContext";
import { execute, republishEvents } from "./executor";
import { useApis } from "./Apis";
import { viewsToJSON } from "./serializer";
import { newDB } from "./knowledge";
import {
  shortID,
  newNode,
  addRelationToRelations,
  moveRelations,
  VERSIONS_NODE_ID,
  EMPTY_NODE_ID,
  isEmptyNodeID,
  getRelationsNoReferencedBy,
} from "./connections";
import {
  newRelations,
  getVersionsContext,
  getVersionsRelations,
  upsertRelations,
  ViewPath,
  getNodeIDFromView,
  updateView,
  contextsMatch,
  getAvailableRelationsForNode,
} from "./ViewContext";
import { UNAUTHENTICATED_USER_PK } from "./AppState";
import { useWorkspaceContext } from "./WorkspaceContext";
import { useRelaysToCreatePlan } from "./relays";
import { mergePublishResultsOfEvents } from "./commons/PublishingStatus";
import { ROOT } from "./types";

export type Plan = Data & {
  publishEvents: List<UnsignedEvent & EventAttachment>;
  activeWorkspace: ID;
  relays: AllRelays;
  temporaryView: TemporaryViewState;
  temporaryEvents: List<TemporaryEvent>;
};

function newContactListEvent(contacts: Contacts, user: User): UnsignedEvent {
  const tags = contacts
    .valueSeq()
    .toArray()
    .map((c) => {
      if (c.mainRelay && c.userName) {
        return ["p", c.publicKey, c.mainRelay, c.userName];
      }
      if (c.mainRelay) {
        return ["p", c.publicKey, c.mainRelay];
      }
      if (c.userName) {
        return ["p", c.publicKey, c.userName];
      }
      return ["p", c.publicKey];
    });
  return {
    kind: KIND_CONTACTLIST,
    pubkey: user.publicKey,
    created_at: newTimestamp(),
    tags,
    content: "",
  };
}

function setRelayConf(
  event: UnsignedEvent,
  conf: WriteRelayConf
): UnsignedEvent & EventAttachment {
  return {
    ...event,
    writeRelayConf: conf,
  };
}

export function planAddContact(plan: Plan, publicKey: PublicKey): Plan {
  if (plan.contacts.has(publicKey)) {
    return plan;
  }
  const newContact: Contact = {
    publicKey,
  };
  const newContacts = plan.contacts.set(publicKey, newContact);
  const contactListEvent = newContactListEvent(newContacts, plan.user);
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(
      setRelayConf(contactListEvent, {
        defaultRelays: false,
        user: true,

        contacts: false,
      })
    ),
  };
}

export function planUpsertMemberlist(plan: Plan, members: Members): Plan {
  const votesTags = members
    .valueSeq()
    .toArray()
    .map((v) => ["votes", v.publicKey, `${v.votes}`]);
  const contactListEvent = newContactListEvent(members, plan.user);
  const memberListEvent = {
    ...contactListEvent,
    kind: KIND_MEMBERLIST,
    tags: [...contactListEvent.tags, ...votesTags],
  };
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(
      setRelayConf(memberListEvent, {
        defaultRelays: false,
        user: false,

        contacts: false,
      })
    ),
  };
}

export function planAddContacts(plan: Plan, publicKeys: List<PublicKey>): Plan {
  const newContacts = publicKeys.reduce((rdx, publicKey) => {
    if (rdx.has(publicKey)) {
      return rdx;
    }
    const newContact: Contact = {
      publicKey,
    };
    return rdx.set(publicKey, newContact);
  }, plan.contacts);

  const contactListEvent = newContactListEvent(newContacts, plan.user);
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(contactListEvent),
  };
}

export function planRemoveContact(plan: Plan, publicKey: PublicKey): Plan {
  const contactToRemove = plan.contacts.get(publicKey);
  if (!contactToRemove) {
    return plan;
  }
  const newContacts = plan.contacts.remove(publicKey);
  const contactListEvent = newContactListEvent(newContacts, plan.user);
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(contactListEvent),
  };
}

export function planUpsertRelations(plan: Plan, relations: Relations): Plan {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const updatedRelations = userDB.relations.set(
    shortID(relations.id),
    relations
  );
  const updatedDB = {
    ...userDB,
    relations: updatedRelations,
  };
  // Items with relevance and optional argument: ["i", nodeID, relevance, argument?]
  const itemsAsTags = relations.items
    .toArray()
    .map((item) =>
      item.argument
        ? ["i", item.nodeID, item.relevance, item.argument]
        : ["i", item.nodeID, item.relevance]
    );
  // Context tag: ["ctx", ancestorID1, ancestorID2, ...]
  const contextTag = ["ctx", ...relations.context.toArray()];
  const updateRelationsEvent = {
    kind: KIND_KNOWLEDGE_LIST,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [
      ["d", shortID(relations.id)],
      // Cannot use fullID here because we need to query for short IDs
      ["k", shortID(relations.head)],
      // Full ID Head
      ["head", relations.head],
      contextTag,
      ...itemsAsTags,
    ],
    content: "",
  };
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    publishEvents: plan.publishEvents.push(updateRelationsEvent),
  };
}

export function planUpsertNode(plan: Plan, node: KnowNode): Plan {
  const userDB = plan.knowledgeDBs.get(plan.user.publicKey, newDB());
  const updatedNodes = userDB.nodes.set(shortID(node.id), node);
  const updatedDB = {
    ...userDB,
    nodes: updatedNodes,
  };
  const updateNodeEvent = {
    kind: KIND_KNOWLEDGE_NODE,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [["d", shortID(node.id)]],
    content: node.text,
  };
  return {
    ...plan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
    publishEvents: plan.publishEvents.push(updateNodeEvent),
  };
}

export function planBulkUpsertNodes(plan: Plan, nodes: KnowNode[]): Plan {
  return nodes.reduce((p, node) => planUpsertNode(p, node), plan);
}

/**
 * Create a version for a node instead of modifying it directly.
 * Adds the new version to ~Versions in context [...context, originalNodeID].
 * If the version already exists in ~Versions, moves it to the top instead of adding a duplicate.
 * Also ensures the original node ID is in ~Versions (for complete version history).
 *
 * Nested version handling: If editing a node that's inside a ~Versions list,
 * adds the new version as a sibling instead of creating recursive ~Versions.
 *
 * Example: Editing BCN inside Barcelona's ~Versions:
 *   Tree: ROOT → Barcelona → ~Versions → BCN
 *   editContext = [ROOT, Barcelona, VERSIONS_NODE_ID]
 *   - originalNodeID = Barcelona (context.get(-2), the node that owns ~Versions)
 *   - context = [ROOT] (slice(0, -2), Barcelona's context without Barcelona or ~Versions)
 *   - versionsContext = [ROOT, Barcelona] (used to look up the ~Versions relation)
 */
export function planCreateVersion(
  plan: Plan,
  editedNodeID: ID,
  newText: string,
  editContext: List<ID>
): Plan {
  // Handle nested versions: if editing a node inside ~Versions list,
  // add the new version as a sibling instead of creating recursive ~Versions
  const isInsideVersions = editContext.last() === VERSIONS_NODE_ID;

  const [originalNodeID, context]: [ID, List<ID>] =
    isInsideVersions && editContext.size >= 2
      ? [
        editContext.get(editContext.size - 2) as ID, // The node that owns ~Versions
        editContext.slice(0, -2).toList(), // Context to that node
      ]
      : [editedNodeID, editContext];

  // 1. Create new version node
  const versionNode = newNode(newText);
  const planWithVersionNode = planUpsertNode(plan, versionNode);

  // 2. Ensure ~Versions node exists
  const versionsNode = newNode("~Versions");
  const updatedPlan = planUpsertNode(planWithVersionNode, versionsNode);

  // 3. Get or create ~Versions relations
  const versionsContext = getVersionsContext(originalNodeID, context);
  const baseVersionsRelations =
    getVersionsRelations(
      updatedPlan.knowledgeDBs,
      updatedPlan.user.publicKey,
      originalNodeID,
      context
    ) ||
    newRelations(VERSIONS_NODE_ID, versionsContext, updatedPlan.user.publicKey);

  // 4. Ensure original node ID is in ~Versions (add at end if not present)
  const originalIndex = baseVersionsRelations.items.findIndex(
    (item) => item.nodeID === originalNodeID
  );
  const versionsWithOriginal =
    originalIndex < 0
      ? addRelationToRelations(
        baseVersionsRelations,
        originalNodeID,
        "",
        undefined,
        baseVersionsRelations.items.size
      )
      : baseVersionsRelations;

  // 5. Determine insert position
  // If editing inside ~Versions, insert at the same position as the edited node
  // Otherwise, insert at position 0 (top)
  const editedNodePosition = isInsideVersions
    ? versionsWithOriginal.items.findIndex(
      (item) => item.nodeID === editedNodeID
    )
    : -1;
  const insertPosition = editedNodePosition >= 0 ? editedNodePosition : 0;

  // 6. Check if new version already exists in ~Versions
  const existingIndex = versionsWithOriginal.items.findIndex(
    (item) => item.nodeID === versionNode.id
  );

  const withVersion =
    existingIndex >= 0
      ? moveRelations(versionsWithOriginal, [existingIndex], insertPosition)
      : addRelationToRelations(
        versionsWithOriginal,
        versionNode.id,
        "",
        undefined,
        insertPosition
      );

  return planUpsertRelations(updatedPlan, withVersion);
}

/**
 * When adding a node that already has ~Versions in this context,
 * ensure the node's own text is at the top of versions.
 * This handles the case where a node was previously versioned,
 * and we're now adding it again with its original text.
 */
function planEnsureVersionForNode(
  plan: Plan,
  node: KnowNode,
  context: List<ID>
): Plan {
  // Check if this node has existing ~Versions in this context
  const versionsRelations = getVersionsRelations(
    plan.knowledgeDBs,
    plan.user.publicKey,
    node.id,
    context
  );

  if (!versionsRelations || versionsRelations.items.size === 0) {
    // No existing versions, nothing to do
    return plan;
  }

  // Node has versions - ensure the node's text is the active version
  return planCreateVersion(plan, node.id, node.text, context);
}

/**
 * Create a new node and add it to the plan, handling version awareness.
 * If the node (by content-addressed ID) already has ~Versions in this context,
 * ensures the typed text becomes the active version.
 *
 * @param plan - The current plan
 * @param text - The text for the new node
 * @param context - The context where the node will be added (should include parent's ID)
 * @returns [updatedPlan, newNode] - The updated plan and the created node
 */
export function planCreateNode(plan: Plan, text: string): [Plan, KnowNode] {
  const node = newNode(text);
  const planWithNode = planUpsertNode(plan, node);
  return [planWithNode, node];
}

function planDelete(plan: Plan, id: LongID | ID, kind: number): Plan {
  const deleteEvent = {
    kind: KIND_DELETE,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [
      ["a", `${kind}:${plan.user.publicKey}:${shortID(id)}`],
      ["k", `${kind}`],
    ],
    content: "",
  };
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(deleteEvent),
  };
}

export function planDeleteNode(plan: Plan, nodeID: LongID | ID): Plan {
  // Prevent deletion of ROOT node
  if (nodeID === ROOT) {
    return plan;
  }

  const deletePlan = planDelete(plan, nodeID, KIND_KNOWLEDGE_NODE);
  const userDB = plan.knowledgeDBs.get(deletePlan.user.publicKey, newDB());
  const updatedNodes = userDB.nodes.remove(shortID(nodeID));
  const updatedDB = {
    ...userDB,
    nodes: updatedNodes,
  };
  return {
    ...deletePlan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
  };
}

export function planDeleteRelations(plan: Plan, relationsID: LongID): Plan {
  const deletePlan = planDelete(plan, relationsID, KIND_KNOWLEDGE_LIST);
  const userDB = plan.knowledgeDBs.get(deletePlan.user.publicKey, newDB());
  const updatedRelations = userDB.relations.remove(shortID(relationsID));
  const updatedDB = {
    ...userDB,
    relations: updatedRelations,
  };
  return {
    ...deletePlan,
    knowledgeDBs: plan.knowledgeDBs.set(plan.user.publicKey, updatedDB),
  };
}

export function planUpdateViews(plan: Plan, views: Views): Plan {
  // filter previous events for views
  const publishEvents = plan.publishEvents.filterNot(
    (event) => event.kind === KIND_VIEWS
  );
  const writeViewEvent = {
    kind: KIND_VIEWS,
    pubkey: plan.user.publicKey,
    created_at: newTimestamp(),
    tags: [],
    content: JSON.stringify(viewsToJSON(views)),
  };
  return {
    ...plan,
    views,
    publishEvents: publishEvents.push(
      setRelayConf(writeViewEvent, {
        defaultRelays: false,
        user: true,

        contacts: false,
      })
    ),
  };
}

export function replaceUnauthenticatedUser<T extends string>(
  from: T,
  publicKey: string
): T {
  // TODO: This feels quite dangerous
  return from.replaceAll(UNAUTHENTICATED_USER_PK, publicKey) as T;
}

function rewriteIDs(event: UnsignedEvent): UnsignedEvent {
  const replacedTags = event.tags.map((tag) =>
    tag.map((t) => replaceUnauthenticatedUser(t, event.pubkey))
  );
  return {
    ...event,
    content: replaceUnauthenticatedUser(event.content, event.pubkey),
    tags: replacedTags,
  };
}

export function planRewriteUnpublishedEvents(
  plan: Plan,
  events: List<UnsignedEvent>
): Plan {
  const allEvents = plan.publishEvents.concat(events);
  const rewrittenEvents = allEvents.map((event) =>
    rewriteIDs({
      ...event,
      pubkey: plan.user.publicKey,
    })
  );
  return {
    ...plan,
    publishEvents: rewrittenEvents,
  };
}

export function relayTags(relays: Relays): string[][] {
  return relays
    .map((r) => {
      if (r.read && r.write) {
        return ["r", r.url];
      }
      if (r.read) {
        return ["r", r.url, "read"];
      }
      if (r.write) {
        return ["r", r.url, "write"];
      }
      return [];
    })
    .filter((tag) => tag.length > 0);
}

export function planPublishRelayMetadata(plan: Plan, relays: Relays): Plan {
  const tags = relayTags(relays);
  const publishRelayMetadataEvent = {
    kind: KIND_RELAY_METADATA_EVENT,
    pubkey: plan.user.publicKey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
    writeRelayConf: {
      defaultRelays: true,
      user: true,
      extraRelays: relays,
    },
  };
  return {
    ...plan,
    publishEvents: plan.publishEvents.push(publishRelayMetadataEvent),
  };
}

type ExecutePlan = (plan: Plan) => Promise<void>;

type Planner = {
  createPlan: () => Plan;
  executePlan: ExecutePlan;
  republishEvents: RepublishEvents;
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
};

type PlanningContextValue = Pick<
  Planner,
  "executePlan" | "republishEvents" | "setPublishEvents"
>;

const PlanningContext = React.createContext<PlanningContextValue | undefined>(undefined);

// Filter out empty placeholder nodes from events before publishing
// Empty nodes are injected at read time via injectEmptyNodesIntoKnowledgeDBs,
// so any relations modification will include them - we need to filter before publishing
function filterEmptyNodesFromEvents(
  events: List<UnsignedEvent & EventAttachment>
): List<UnsignedEvent & EventAttachment> {
  return events
    .map((event) => {
      if (event.kind === KIND_KNOWLEDGE_LIST) {
        // Check if head is empty node - skip entire event (shouldn't happen)
        const headTag = event.tags.find((t) => t[0] === "head");
        if (headTag && isEmptyNodeID(headTag[1])) {
          return null;
        }

        // Filter empty node items from relations
        const filteredTags = event.tags.filter((tag) => {
          if (tag[0] === "i") {
            return !isEmptyNodeID(tag[1]);
          }
          return true;
        });

        return { ...event, tags: filteredTags };
      }

      if (event.kind === KIND_KNOWLEDGE_NODE) {
        // Skip empty node events (shouldn't happen)
        if (event.content === "") {
          return null;
        }
      }

      return event;
    })
    .filter(
      (event): event is UnsignedEvent & EventAttachment => event !== null
    );
}

export function PlanningContextProvider({
  children,
  setPublishEvents,
}: {
  children: React.ReactNode;
  setPublishEvents: Dispatch<SetStateAction<EventState>>;
}): JSX.Element {
  const { relayPool, finalizeEvent } = useApis();

  const executePlan = async (plan: Plan): Promise<void> => {
    // Filter empty nodes from events before publishing
    // (empty nodes are injected at read time, so modifications include them)
    const filteredEvents = filterEmptyNodesFromEvents(plan.publishEvents);

    console.log("executePlan called", {
      publishEventsCount: filteredEvents.size,
      planTemporaryEvents: plan.temporaryEvents.toJS(),
    });

    // If no events to publish, just update temporaryView/temporaryEvents in a single call
    // This avoids rapid isLoading true→false transitions that cause race conditions
    if (filteredEvents.size === 0) {
      setPublishEvents((prevStatus) => {
        const newTemporaryEvents = prevStatus.temporaryEvents.concat(plan.temporaryEvents);
        console.log("setPublishEvents (no events)", {
          prevTemporaryEvents: prevStatus.temporaryEvents.toJS(),
          newTemporaryEvents: newTemporaryEvents.toJS(),
        });
        return {
          ...prevStatus,
          temporaryView: plan.temporaryView,
          temporaryEvents: newTemporaryEvents,
        };
      });
      return;
    }

    // Normal flow for when we have events to publish
    setPublishEvents((prevStatus) => {
      const newTemporaryEvents = prevStatus.temporaryEvents.concat(plan.temporaryEvents);
      console.log("setPublishEvents (with events, isLoading=true)", {
        prevTemporaryEvents: prevStatus.temporaryEvents.toJS(),
        newTemporaryEvents: newTemporaryEvents.toJS(),
      });
      return {
        unsignedEvents: prevStatus.unsignedEvents.merge(filteredEvents),
        results: prevStatus.results,
        isLoading: true,
        preLoginEvents: prevStatus.preLoginEvents,
        temporaryView: plan.temporaryView,
        temporaryEvents: newTemporaryEvents,
      };
    });

    // FILTERED events → relay publishing
    const filteredPlan = {
      ...plan,
      publishEvents: filteredEvents,
    };

    const results = await execute({
      plan: filteredPlan,
      relayPool,
      finalizeEvent,
    });

    setPublishEvents((prevStatus) => {
      return {
        ...prevStatus,
        results: mergePublishResultsOfEvents(prevStatus.results, results),
        isLoading: false,
      };
    });
  };

  const republishEventsOnRelay = async (
    events: List<Event>,
    relayUrl: string
  ): Promise<void> => {
    console.log(">>>> REPUBLISH EVENTS ON RELAY:", relayUrl, events.size);
    const results = await republishEvents({
      events,
      relayPool,
      writeRelayUrl: relayUrl,
    });
    setPublishEvents((prevStatus) => {
      return {
        ...prevStatus,
        results: mergePublishResultsOfEvents(prevStatus.results, results),
        isLoading: false,
      };
    });
  };

  return (
    <PlanningContext.Provider
      value={{
        executePlan,
        republishEvents: republishEventsOnRelay,
        setPublishEvents,
      }}
    >
      {children}
    </PlanningContext.Provider>
  );
}

export function createPlan(
  props: Data & {
    activeWorkspace: ID;
    publishEvents?: List<UnsignedEvent & EventAttachment>;
    relays: AllRelays;
  }
): Plan {
  return {
    ...props,
    publishEvents:
      props.publishEvents || List<UnsignedEvent & EventAttachment>([]),
    // temporaryView comes from publishEventsStatus
    temporaryView: props.publishEventsStatus.temporaryView,
    // Each plan starts with empty temporaryEvents - they get concatenated in executePlan
    temporaryEvents: List<TemporaryEvent>(),
  };
}

export function usePlanner(): Planner {
  const data = useData();
  const { activeWorkspace } = useWorkspaceContext();
  const relays = useRelaysToCreatePlan();
  const createPlanningContext = (): Plan => {
    return createPlan({
      ...data,
      activeWorkspace,
      relays,
    });
  };
  const planningContext = React.useContext(PlanningContext);
  if (planningContext === undefined) {
    throw new Error("PlanningContext not provided");
  }

  return {
    createPlan: createPlanningContext,
    executePlan: planningContext.executePlan,
    republishEvents: planningContext.republishEvents,
    setPublishEvents: planningContext.setPublishEvents,
  };
}

// Helper to remove empty node items from relations in local knowledgeDBs
function removeEmptyNodeFromKnowledgeDBs(
  knowledgeDBs: KnowledgeDBs,
  publicKey: PublicKey,
  relationsID: LongID
): KnowledgeDBs {
  const myDB = knowledgeDBs.get(publicKey);
  if (!myDB) {
    return knowledgeDBs;
  }

  const shortRelationsID = relationsID.includes("_")
    ? relationsID.split("_")[1]
    : relationsID;
  const existingRelations = myDB.relations.get(shortRelationsID);
  if (!existingRelations) {
    return knowledgeDBs;
  }

  // Filter out empty node items
  const filteredItems = existingRelations.items.filter(
    (item) => !isEmptyNodeID(item.nodeID)
  );
  if (filteredItems.size === existingRelations.items.size) {
    return knowledgeDBs; // No empty nodes found
  }

  const updatedRelations = myDB.relations.set(shortRelationsID, {
    ...existingRelations,
    items: filteredItems,
  });
  return knowledgeDBs.set(publicKey, {
    ...myDB,
    relations: updatedRelations,
  });
}

// Plan function to remove an empty node position (for closing empty editor)
// Also removes the injected empty node from local knowledgeDBs (no event published)
export function planRemoveEmptyNodePosition(
  plan: Plan,
  relationsID: LongID
): Plan {
  return {
    ...plan,
    knowledgeDBs: removeEmptyNodeFromKnowledgeDBs(
      plan.knowledgeDBs,
      plan.user.publicKey,
      relationsID
    ),
    temporaryEvents: plan.temporaryEvents.push({
      type: "REMOVE_EMPTY_NODE",
      relationsID,
    }),
  };
}

// Unified function for expanding a node with proper relation handling
// Creates relations only if none exist (like toggle does)
export function planExpandNode(
  plan: Plan,
  nodeID: LongID | ID,
  context: Context,
  view: View,
  viewPath: ViewPath
): Plan {
  // 1. Check if view.relations is valid (exists in DB) AND context matches
  const currentRelations = view.relations
    ? getRelationsNoReferencedBy(
      plan.knowledgeDBs,
      view.relations,
      plan.user.publicKey
    )
    : undefined;

  if (currentRelations && contextsMatch(currentRelations.context, context)) {
    // Valid relations with matching context - expand only if not already expanded
    if (view.expanded) {
      return plan; // Already expanded with correct relations, no update needed
    }
    return planUpdateViews(
      plan,
      updateView(plan.views, viewPath, {
        ...view,
        expanded: true,
      })
    );
  }

  // 2. Check for available relations for this (head, context)
  const availableRelations = getAvailableRelationsForNode(
    plan.knowledgeDBs,
    plan.user.publicKey,
    nodeID,
    context
  );

  if (availableRelations.size > 0) {
    // Use first available relation
    const firstRelation = availableRelations.first()!;
    // Only update if relations or expanded state differs
    if (view.relations === firstRelation.id && view.expanded) {
      return plan; // Already in correct state
    }
    return planUpdateViews(
      plan,
      updateView(plan.views, viewPath, {
        ...view,
        relations: firstRelation.id,
        expanded: true,
      })
    );
  }

  // 3. No relations exist - create new one
  const relations = newRelations(nodeID, context, plan.user.publicKey);
  const createRelationPlan = planUpsertRelations(plan, relations);
  return planUpdateViews(
    createRelationPlan,
    updateView(plan.views, viewPath, {
      ...view,
      relations: relations.id,
      expanded: true,
    })
  );
}

// Plan function to set an empty node position (for creating new node editor)
// This is simpler than creating actual node events - just stores where to inject
export function planSetEmptyNodePosition(
  plan: Plan,
  parentPath: ViewPath,
  stack: (LongID | ID)[],
  insertIndex: number
): Plan {
  // 1. Ensure we have our own relations (copies remote if needed, no event if unchanged)
  const planWithOwnRelations = upsertRelations(plan, parentPath, stack, (r) => r);

  // 2. Get relationsID and ensure expanded
  const [, view] = getNodeIDFromView(planWithOwnRelations, parentPath);
  const relationsID = view.relations;
  if (!relationsID) {
    return plan; // Shouldn't happen, but defensive
  }

  // 3. Expand if not already
  const planWithExpanded = view.expanded
    ? planWithOwnRelations
    : planUpdateViews(
        planWithOwnRelations,
        updateView(planWithOwnRelations.views, parentPath, {
          ...view,
          expanded: true,
        })
      );

  // 4. Add temporary event to show empty node at position
  return {
    ...planWithExpanded,
    temporaryEvents: planWithExpanded.temporaryEvents.push({
      type: "ADD_EMPTY_NODE",
      relationsID,
      index: insertIndex,
    }),
  };
}
