import React, { useState } from "react";
import { getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { DEFAULT_RELAYS } from "./nostr";
import { useApis } from "./Apis";
import { UNAUTHENTICATED_USER_PK } from "./AppState";
import { sanitizeRelays } from "./relays";

type Context = {
  user: User | undefined;
  setUser: (user: User | undefined) => void;
  defaultRelays: Relays;
  defaultPaneRoot?: LongID;
};

const NostrAuthContext = React.createContext<Context | undefined>(undefined);

function getPublicKeyFromContext(context: Context): PublicKey | undefined {
  if (!context.user) {
    return undefined;
  }
  return context.user.publicKey;
}

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

export function useDefaultPaneRoot(): LongID | undefined {
  const context = React.useContext(NostrAuthContext);
  if (!context) {
    throw new Error("NostrAuthContext missing");
  }
  return context.defaultPaneRoot;
}

function userFromPrivateKey(privateKey: string): User {
  const key = hexToBytes(privateKey);
  const publicKey = getPublicKey(key) as PublicKey;
  return {
    publicKey,
    privateKey: key,
  };
}

export function useLogin(): (privateKey: string) => User {
  const context = React.useContext(NostrAuthContext);
  const { fileStore } = useApis();
  const { setLocalStorage } = fileStore;
  if (!context) {
    throw new Error("NostrAuthContext missing");
  }
  return (privateKey) => {
    setLocalStorage("privateKey", privateKey);
    const user = userFromPrivateKey(privateKey);
    context.setUser(user);
    return user;
  };
}

export function useLoginWithExtension(): (publicKey: PublicKey) => User {
  const context = React.useContext(NostrAuthContext);
  const { fileStore } = useApis();
  const { setLocalStorage } = fileStore;
  if (!context) {
    throw new Error("NostrAuthContext missing");
  }
  return (publicKey) => {
    setLocalStorage("publicKey", publicKey);
    const user = { publicKey };
    context.setUser(user);
    return user;
  };
}

export function useLogout(): () => void {
  const context = React.useContext(NostrAuthContext);
  const { fileStore } = useApis();
  const { deleteLocalStorage } = fileStore;
  if (!context) {
    throw new Error("NostrAuthContext missing");
  }

  return () => {
    context.setUser(undefined);
    const publicKey = getPublicKeyFromContext(context);
    if (publicKey) {
      deleteLocalStorage(publicKey);
    }
    deleteLocalStorage("privateKey");
    deleteLocalStorage("publicKey");
    window.location.reload();
  };
}

export function NostrAuthContextProvider({
  defaultRelayUrls,
  defaultPaneRoot,
  children,
}: {
  defaultRelayUrls?: Array<string>;
  defaultPaneRoot?: LongID;
  children: React.ReactNode;
}): JSX.Element {
  const { fileStore } = useApis();
  const privKeyFromStorage = fileStore.getLocalStorage("privateKey");
  const userFromStorage =
    privKeyFromStorage !== null
      ? userFromPrivateKey(privKeyFromStorage)
      : undefined;
  // when logging in with an extension, the publicKey is stored in local storage
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
        defaultRelayUrls?.map((url) => {
          return { url, read: true, write: true };
        })
      )
    : DEFAULT_RELAYS;

  return (
    <NostrAuthContext.Provider
      value={{
        setUser,
        user,
        defaultRelays: relays,
        defaultPaneRoot,
      }}
    >
      {children}
    </NostrAuthContext.Provider>
  );
}
