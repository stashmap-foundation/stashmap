import React from "react";
import { UNAUTHENTICATED_USER_PK } from "./AppState";

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
