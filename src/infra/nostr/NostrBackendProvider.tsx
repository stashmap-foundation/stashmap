import React, { useEffect, useMemo, useState } from "react";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { useApis } from "../../Apis";
import { Backend, BackendProvider } from "../../BackendContext";
import { DEFAULT_RELAYS } from "../../nostr";
import { sanitizeRelays } from "../../relays";
import { clearDatabase, openDB, StashmapDB } from "./cache/indexedDB";
import { CacheDBProvider } from "./cache/CacheDBContext";
import { execute as executeNostrPlan } from "./executor";

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
  children,
}: {
  defaultRelayUrls?: Array<string>;
  children: React.ReactNode;
}): JSX.Element {
  const { relayPool, fileStore, finalizeEvent } = useApis();
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

  const [db, setDb] = useState<StashmapDB | null | undefined>(undefined);
  useEffect(() => {
    openDB().then((database) => setDb(database || null));
  }, []);
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
    const nostrBackend: Backend = {
      subscribe: (relayList, filters, params) =>
        relayPool.subscribeMany(relayList, filters, params),
      publish: (relayList, event) => relayPool.publish(relayList, event),
      execute: (plan) =>
        executeNostrPlan({
          plan,
          backend: nostrBackend,
          finalizeEvent,
        }),
      user,
      login,
      loginWithExtension,
      logout,
      defaultRelays: relays,
    };
    return nostrBackend;
  }, [relayPool, fileStore, finalizeEvent, user, relays]);

  return (
    <BackendProvider backend={backend}>
      <CacheDBProvider db={db}>{children}</CacheDBProvider>
    </BackendProvider>
  );
}
