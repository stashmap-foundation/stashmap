import React, { useEffect, useMemo, useState } from "react";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { useApis } from "../../Apis";
import { Backend, BackendProvider } from "../../BackendContext";
import { DEFAULT_RELAYS } from "../../nostr";
import { sanitizeRelays } from "../../relays";
import { clearDatabase, openDB, StashmapDB } from "./cache/indexedDB";
import { CacheDBProvider } from "./cache/CacheDBContext";

function userFromPrivateKey(privateKey: string): User {
  const key = hexToBytes(privateKey);
  const publicKey = getPublicKey(key) as PublicKey;
  return {
    publicKey,
    privateKey: key,
  };
}

export function NostrBackendProvider({
  defaultRelayUrls,
  db,
  children,
}: {
  defaultRelayUrls?: Array<string>;
  db: StashmapDB | null;
  children: React.ReactNode;
}): JSX.Element {
  const { relayPool, fileStore } = useApis();
  const privKeyFromStorage = fileStore.getLocalStorage("privateKey");
  const userFromStorage =
    privKeyFromStorage !== null
      ? userFromPrivateKey(privKeyFromStorage)
      : undefined;
  const pubKeyFromStorage = fileStore.getLocalStorage("publicKey");
  const userWithPubkeyFromStorage =
    pubKeyFromStorage !== null
      ? { publicKey: pubKeyFromStorage as PublicKey }
      : undefined;
  const [user, setUser] = useState<User | undefined>(
    userFromStorage || userWithPubkeyFromStorage
  );
  const relays = defaultRelayUrls
    ? sanitizeRelays(
        defaultRelayUrls.map((url) => ({ url, read: true, write: true }))
      )
    : DEFAULT_RELAYS;

  useEffect(() => {
    return () => {
      if (db && typeof db.close === "function") {
        db.close();
      }
    };
  }, [db]);

  const backend: Backend = useMemo(() => {
    const login = (privateKey: string): User => {
      fileStore.setLocalStorage("privateKey", privateKey);
      const nextUser = userFromPrivateKey(privateKey);
      setUser(nextUser);
      return nextUser;
    };
    const loginWithExtension = (publicKey: PublicKey): User => {
      fileStore.setLocalStorage("publicKey", publicKey);
      const nextUser = { publicKey };
      setUser(nextUser);
      return nextUser;
    };
    const logout = async (): Promise<void> => {
      const publicKey = user?.publicKey;
      if (publicKey) {
        fileStore.deleteLocalStorage(publicKey);
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
      defaultRelays: relays,
    };
  }, [relayPool, fileStore, user, relays]);

  return (
    <BackendProvider backend={backend}>
      <CacheDBProvider db={db}>{children}</CacheDBProvider>
    </BackendProvider>
  );
}

export function NostrBackendDbProvider({
  defaultRelayUrls,
  children,
}: {
  defaultRelayUrls?: Array<string>;
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
    <NostrBackendProvider defaultRelayUrls={defaultRelayUrls} db={db}>
      {children}
    </NostrBackendProvider>
  );
}
