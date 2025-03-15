import { Map } from "immutable";
import React, { createContext, useEffect, useState } from "react";
import { useEventQuery } from "./commons/useNostrQuery";
import { useDefaultWorkspace } from "./NostrAuthContext";
import { MergeKnowledgeDB, useData } from "./DataContext";
import { useApis } from "./Apis";
import { KIND_DELETE, KIND_WORKSPACE } from "./nostr";
import { processEvents } from "./Data";
import { fallbackWorkspace, Plan, replaceUnauthenticatedUser } from "./planner";
import { useWorkspaceFromURL } from "./KnowledgeDataContext";
import {
  addWorkspaceNodesToFilter,
  createBaseFilter,
  filtersToFilterArray,
} from "./dataQuery";
import { getNodeFromID } from "./ViewContext";
import { useReadRelays } from "./relays";
import { shortID, splitID } from "./connections";
import { UNAUTHENTICATED_USER_PK } from "./AppState";

export function getWorkspaceFromID(
  workspaces: Map<PublicKey, Workspaces>,
  id: LongID,
  myself: PublicKey
): Workspace | undefined {
  const [remote, wsID] = splitID(id);
  if (!remote) {
    return workspaces.get(myself)?.get(wsID);
  }
  return workspaces.get(remote)?.get(wsID);
}

type WorkspaceContextType = {
  activeWorkspace: LongID;
  workspaces: Map<PublicKey, Workspaces>;
  setCurrentWorkspace: React.Dispatch<React.SetStateAction<LongID | undefined>>;
  workspace?: Workspace;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(
  undefined
);

export function WorkspaceContextProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const defaultWorkspace = useDefaultWorkspace();
  const { user, contacts, projectMembers, publishEventsStatus } = useData();
  const { relayPool, fileStore } = useApis();
  // If there is no workspace to be found, we create a new one with this ID
  const [fallbackWSID] = useState(fallbackWorkspace(user.publicKey));
  const wsFromURL = useWorkspaceFromURL();
  const [currentWorkspace, setCurrentWorkspace] = useState<LongID | undefined>(
    wsFromURL
      ? replaceUnauthenticatedUser(wsFromURL, user.publicKey)
      : undefined
  );
  const defaultWSAuthor = defaultWorkspace && splitID(defaultWorkspace)[0];

  const authors = [
    user.publicKey,
    ...contacts.keySeq().toArray(),
    ...(defaultWSAuthor ? [defaultWSAuthor] : []),
  ];

  const baseFilters = [
    {
      authors,
      kinds: [KIND_WORKSPACE],
    },
    {
      authors,
      kinds: [KIND_DELETE],
      "#k": [`${KIND_WORKSPACE}`],
    },
  ];
  const activeWorkspace =
    wsFromURL !== undefined
      ? replaceUnauthenticatedUser(wsFromURL, user.publicKey)
      : currentWorkspace ||
        ((user.publicKey !== UNAUTHENTICATED_USER_PK &&
          fileStore.getLocalStorage(
            `${user.publicKey}:activeWs`
          )) as LongID | null) ||
        defaultWorkspace ||
        fallbackWSID;

  const authorActiveWorkspace = splitID(activeWorkspace)[0];
  const filters = activeWorkspace
    ? [
        ...baseFilters,
        {
          ...(authorActiveWorkspace
            ? { authors: [authorActiveWorkspace] }
            : {}),
          "#d": [shortID(activeWorkspace)],
          kinds: [KIND_WORKSPACE],
        },
      ]
    : baseFilters;

  const { events } = useEventQuery(relayPool, filters, {
    readFromRelays: useReadRelays({
      user: true,
      project: true,
      contacts: true,
    }),
  });
  const workspaceEvents = events
    .valueSeq()
    .toList()
    .merge(publishEventsStatus.unsignedEvents);
  const processedEvents = processEvents(workspaceEvents);

  const workspaceNodesFilters = processedEvents.reduce((rdx, p) => {
    return addWorkspaceNodesToFilter(rdx, p.workspaces);
  }, createBaseFilter(contacts, projectMembers, user.publicKey));

  const { events: workspaceNodesEvents } = useEventQuery(
    relayPool,
    filtersToFilterArray(workspaceNodesFilters),
    {
      readFromRelays: useReadRelays({
        user: true,
        project: true,
        contacts: true,
      }),
    }
  );
  const knowledgeDBs = processEvents(
    workspaceNodesEvents
      .valueSeq()
      .toList()
      .merge(publishEventsStatus.unsignedEvents)
  ).map((data) => data.knowledgeDB);

  const workspaces = processedEvents.map((p) => p.workspaces);
  const workspace = getWorkspaceFromID(
    workspaces,
    activeWorkspace,
    user.publicKey
  );
  useEffect(() => {
    if (workspace && user.publicKey !== UNAUTHENTICATED_USER_PK) {
      fileStore.setLocalStorage(`${user.publicKey}:activeWs`, workspace.id);
    }
  }, [workspace, user.publicKey]);

  return (
    <WorkspaceContext.Provider
      value={{
        activeWorkspace,
        workspaces,
        setCurrentWorkspace,
        workspace,
      }}
    >
      <MergeKnowledgeDB knowledgeDBs={knowledgeDBs}>
        {children}
      </MergeKnowledgeDB>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceContext(): WorkspaceContextType {
  const context = React.useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error(
      "useWorkspaceContext must be used within a WorkspaceContextProvider"
    );
  }
  return context;
}

export function useActiveWorkspace(): Workspace | undefined {
  const { activeWorkspace, workspaces } = useWorkspaceContext();
  const { user } = useData();
  return getWorkspaceFromID(workspaces, activeWorkspace, user.publicKey);
}

export function CurrentWorkspaceTitle(): JSX.Element {
  const { knowledgeDBs, user } = useData();
  const activeWorksapce = useActiveWorkspace();
  if (!activeWorksapce) {
    return <span className="spinner-border spinner-navbar" />;
  }
  const node = getNodeFromID(
    knowledgeDBs,
    activeWorksapce.node,
    user.publicKey
  );
  if (!node) {
    return <span className="spinner-border spinner-navbar" />;
  }
  return <span>{node.text}</span>;
}

export function findNewActiveWorkspace(plan: Plan): LongID | undefined {
  return plan.workspaces.reduce(
    (rdx: LongID | undefined, workspaces): LongID | undefined => {
      return rdx || workspaces.first()?.id;
    },
    undefined
  );
}
