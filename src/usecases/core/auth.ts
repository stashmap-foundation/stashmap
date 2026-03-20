import type { KeyPair, PublicKey, User } from "../../graph/identity";

export const UNAUTHENTICATED_USER_PK = "UNAUTHENTICATEDUSERPK" as PublicKey;

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
