import fs from "fs";
import crypto from "crypto";
import Store from "electron-store";

export type WorkspaceEntry = {
  path: string;
  lastOpenedAt: number;
  open: boolean;
};

export type RecentState = {
  workspaces: Record<string, WorkspaceEntry>;
};

export type RecentEntry = WorkspaceEntry & { id: string };

const SCHEMA = {
  workspaces: {
    type: "object",
    additionalProperties: {
      type: "object",
      properties: {
        path: { type: "string" },
        lastOpenedAt: { type: "number" },
        open: { type: "boolean" },
      },
      required: ["path", "lastOpenedAt", "open"],
    },
  },
} as const;

const DEFAULTS: RecentState = { workspaces: {} };

function findIdByPath(state: RecentState, p: string): string | undefined {
  const entry = Object.entries(state.workspaces).find(
    ([, value]) => value.path === p
  );
  return entry ? entry[0] : undefined;
}

export function applyAddOrTouch(
  state: RecentState,
  p: string,
  now: number = Date.now(),
  idGen: () => string = () => crypto.randomUUID()
): { state: RecentState; id: string } {
  const existingId = findIdByPath(state, p);
  const id = existingId ?? idGen();
  const previous = state.workspaces[id];
  return {
    state: {
      workspaces: {
        ...state.workspaces,
        [id]: {
          path: p,
          lastOpenedAt: now,
          open: previous?.open ?? false,
        },
      },
    },
    id,
  };
}

export function applyMarkOpenSingleWindow(
  state: RecentState,
  id: string
): RecentState {
  if (!state.workspaces[id]) {
    return state;
  }
  const updatedEntries = Object.entries(state.workspaces).map(
    ([entryId, entry]) => [entryId, { ...entry, open: entryId === id }] as const
  );
  return { workspaces: Object.fromEntries(updatedEntries) };
}

export function applyPrune(
  state: RecentState,
  exists: (p: string) => boolean = fs.existsSync
): RecentState {
  const filtered = Object.entries(state.workspaces).filter(([, entry]) =>
    exists(entry.path)
  );
  return { workspaces: Object.fromEntries(filtered) };
}

export function listMostRecent(state: RecentState): RecentEntry[] {
  return Object.entries(state.workspaces)
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function pickAutoOpenId(state: RecentState): string | undefined {
  const open = Object.entries(state.workspaces).find(
    ([, entry]) => entry.open === true
  );
  if (open) {
    return open[0];
  }
  return listMostRecent(state)[0]?.id;
}

export type RecentWorkspacesStore = {
  getState: () => RecentState;
  addOrTouch: (p: string) => string;
  markOpen: (id: string) => void;
  listAndPrune: () => RecentState;
};

export function createRecentWorkspacesStore(
  options: { cwd?: string } = {}
): RecentWorkspacesStore {
  const inner = new Store<RecentState>({
    name: "workspaces",
    defaults: DEFAULTS,
    schema: SCHEMA as unknown as Store.Schema<RecentState>,
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });

  const getState = (): RecentState => ({
    workspaces: inner.get("workspaces") || {},
  });

  const setState = (next: RecentState): void => {
    inner.set("workspaces", next.workspaces);
  };

  return {
    getState,
    addOrTouch(p: string): string {
      const { state, id } = applyAddOrTouch(getState(), p);
      setState(state);
      return id;
    },
    markOpen(id: string): void {
      setState(applyMarkOpenSingleWindow(getState(), id));
    },
    listAndPrune(): RecentState {
      const before = getState();
      const next = applyPrune(before);
      if (
        Object.keys(next.workspaces).length !==
        Object.keys(before.workspaces).length
      ) {
        setState(next);
      }
      return next;
    },
  };
}
