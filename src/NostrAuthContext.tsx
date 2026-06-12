import React from "react";

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

export function isUserLoggedInWithSeed(
  user: User | undefined
): user is KeyPair {
  return user !== undefined && (user as KeyPair).privateKey !== undefined;
}

export function isUserLoggedInWithExtension(
  user: User | undefined
): user is { publicKey: PublicKey } {
  return user !== undefined && !isUserLoggedInWithSeed(user);
}

export function isUserLoggedIn(user: User | undefined): user is User {
  return user !== undefined;
}

export function useUser(): User | undefined {
  const context = React.useContext(NostrAuthContext);
  if (!context) {
    throw new Error("NostrAuthContext missing");
  }
  return context.user;
}

export function useDefaultRelays(): Relays {
  const context = React.useContext(NostrAuthContext);
  if (!context) {
    throw new Error("NostrAuthContext missing");
  }
  return context.defaultRelays;
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
