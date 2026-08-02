import React, { useEffect, useMemo, useState } from "react";
import { Event, getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { useApis } from "../../Apis";
import { Backend, BackendProvider } from "../../BackendContext";
import { CONFIG_RELAYS, KIND_SETTINGS } from "../../nostr";
import {
  decryptWorkspaceConfigEvent,
  defaultWebWorkspaceConfig,
  normalizeWebWorkspaceConfig,
  selectLatestWorkspaceConfigEvent,
  WorkspaceConfig,
} from "../../workspaceConfig";
import { clearDatabase, openDB, StashmapDB } from "./cache/indexedDB";
import { CacheDBProvider } from "./cache/CacheDBContext";

function userFromPrivateKey(privateKey: string): User {
  const key = hexToBytes(privateKey);
  const publicKey = getPublicKey(key) as PublicKey;
  return { publicKey, privateKey: key };
}

export function NostrBackendProvider({
  db,
  initialWorkspaceConfig,
  children,
}: {
  db: StashmapDB | null;
  initialWorkspaceConfig: WorkspaceConfig;
  children: React.ReactNode;
}): JSX.Element {
  const { relayPool, fileStore } = useApis();
  const privateKey = fileStore.getLocalStorage("privateKey");
  const storedUser = privateKey ? userFromPrivateKey(privateKey) : undefined;
  const publicKey = fileStore.getLocalStorage("publicKey");
  const extensionUser = publicKey
    ? { publicKey: publicKey as PublicKey }
    : undefined;
  const [user, setUser] = useState<User | undefined>(
    storedUser || extensionUser
  );
  const fallbackWorkspaceConfig = useMemo(
    () => normalizeWebWorkspaceConfig(initialWorkspaceConfig),
    [initialWorkspaceConfig]
  );
  const [workspaceConfig, setWorkspaceConfig] = useState(
    fallbackWorkspaceConfig
  );

  useEffect(() => {
    setWorkspaceConfig(fallbackWorkspaceConfig);
    if (!user) {
      return () => {};
    }
    const controller = new AbortController();
    const validEvents = new Map<
      string,
      { event: Event; config: WorkspaceConfig }
    >();
    const subscription = relayPool.subscribeMany(
      CONFIG_RELAYS,
      [{ authors: [user.publicKey], kinds: [KIND_SETTINGS], limit: 1 }],
      {
        onevent: (event) => {
          decryptWorkspaceConfigEvent(user, event).then((config) => {
            if (!config || controller.signal.aborted) {
              return;
            }
            validEvents.set(event.id, { event, config });
            const winner = selectLatestWorkspaceConfigEvent(
              [...validEvents.values()].map((entry) => entry.event)
            );
            if (winner) {
              setWorkspaceConfig(validEvents.get(winner.id)?.config ?? config);
            }
          });
        },
      }
    );
    return () => {
      controller.abort();
      subscription.close();
    };
  }, [fallbackWorkspaceConfig, relayPool, user]);

  useEffect(() => {
    return () => {
      if (db && typeof db.close === "function") {
        db.close();
      }
    };
  }, [db]);

  const backend: Backend = useMemo(() => {
    const login = (nextPrivateKey: string): User => {
      fileStore.setLocalStorage("privateKey", nextPrivateKey);
      const nextUser = userFromPrivateKey(nextPrivateKey);
      setUser(nextUser);
      return nextUser;
    };
    const loginWithExtension = (nextPublicKey: PublicKey): User => {
      fileStore.setLocalStorage("publicKey", nextPublicKey);
      const nextUser = { publicKey: nextPublicKey };
      setUser(nextUser);
      return nextUser;
    };
    const logout = async (): Promise<void> => {
      if (user?.publicKey) {
        fileStore.deleteLocalStorage(user.publicKey);
      }
      fileStore.deleteLocalStorage("privateKey");
      fileStore.deleteLocalStorage("publicKey");
      setUser(undefined);
      await clearDatabase();
      window.history.replaceState(null, "", "/");
      window.location.reload();
    };
    return {
      subscribe: (relayList, filters, params) =>
        relayPool.subscribeMany(relayList, filters, params),
      publish: (relayList, event) => relayPool.publish(relayList, event),
      user,
      login,
      loginWithExtension,
      logout,
      workspaceConfig,
    };
  }, [relayPool, fileStore, user, workspaceConfig]);

  return (
    <BackendProvider backend={backend}>
      <CacheDBProvider db={db}>{children}</CacheDBProvider>
    </BackendProvider>
  );
}

export function NostrBackendDbProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element | null {
  const [db, setDb] = useState<StashmapDB | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    openDB().then((database) => {
      if (controller.signal.aborted) {
        if (database && typeof database.close === "function") {
          database.close();
        }
        return;
      }
      setDb(database || null);
    });
    return () => controller.abort();
  }, []);

  if (db === undefined) {
    return null;
  }

  return (
    <NostrBackendProvider
      db={db}
      initialWorkspaceConfig={defaultWebWorkspaceConfig()}
    >
      {children}
    </NostrBackendProvider>
  );
}
