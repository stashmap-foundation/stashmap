import React, { useMemo, useState } from "react";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { DEFAULT_RELAYS } from "./nostr";
import { useApis } from "./Apis";
import { UNAUTHENTICATED_USER_PK } from "./AppState";
import { sanitizeRelays } from "./relays";
import { clearDatabase } from "./indexedDB";

type IdentityContextValue = {
  user: User | undefined;
  login?: (privateKey: string) => User;
  loginWithExtension?: (publicKey: PublicKey) => User;
  logout?: () => Promise<void>;
  defaultRelays: Relays;
};

export const NostrAuthContext = React.createContext<
  IdentityContextValue | undefined
>(undefined);

export function isUserLoggedInWithSeed(user: User): user is KeyPair {
  return (user as KeyPair).privateKey !== undefined;
}

export function isUserLoggedInWithExtension(
  user: User
): user is { publicKey: PublicKey } {
  if (isUserLoggedInWithSeed(user)) {
    return false;
  }
  return user.publicKey !== UNAUTHENTICATED_USER_PK;
}

export function isUserLoggedIn(user: User): boolean {
  return isUserLoggedInWithSeed(user) || isUserLoggedInWithExtension(user);
}

export function useUser(): User | undefined {
  const context = React.useContext(NostrAuthContext);
  if (!context) {
    throw new Error("NostrAuthContext missing");
  }
  return context.user;
}

export function useUserOrAnon(): User {
  return useUser() || { publicKey: UNAUTHENTICATED_USER_PK };
}

export function useDefaultRelays(): Relays {
  const context = React.useContext(NostrAuthContext);
  if (!context) {
    throw new Error("NostrAuthContext missing");
  }
  return context.defaultRelays;
}

function userFromPrivateKey(privateKey: string): User {
  const key = hexToBytes(privateKey);
  const publicKey = getPublicKey(key) as PublicKey;
  return {
    publicKey,
    privateKey: key,
  };
}

export function useLogin(): ((privateKey: string) => User) | undefined {
  const context = React.useContext(NostrAuthContext);
  if (!context) {
    throw new Error("NostrAuthContext missing");
  }
  return context.login;
}

export function useLoginWithExtension():
  | ((publicKey: PublicKey) => User)
  | undefined {
  const context = React.useContext(NostrAuthContext);
  if (!context) {
    throw new Error("NostrAuthContext missing");
  }
  return context.loginWithExtension;
}

export function useLogout(): (() => Promise<void>) | undefined {
  const context = React.useContext(NostrAuthContext);
  if (!context) {
    throw new Error("NostrAuthContext missing");
  }
  return context.logout;
}

export function NostrAuthContextProvider({
  defaultRelayUrls,
  children,
}: {
  defaultRelayUrls?: Array<string>;
  children: React.ReactNode;
}): JSX.Element {
  const { fileStore } = useApis();
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

  const value = useMemo<IdentityContextValue>(() => {
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
      user,
      login,
      loginWithExtension,
      logout,
      defaultRelays: relays,
    };
  }, [user, relays, fileStore]);

  return (
    <NostrAuthContext.Provider value={value}>
      {children}
    </NostrAuthContext.Provider>
  );
}
