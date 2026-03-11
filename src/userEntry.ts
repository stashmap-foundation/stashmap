import { decodePublicKeyInputSync } from "./nostrPublicKeys";

export function getUsersEntryPublicKey(
  text: string,
  relation?: Relations
): PublicKey | undefined {
  return (
    decodePublicKeyInputSync(text) ||
    relation?.userPublicKey ||
    decodePublicKeyInputSync(relation?.text)
  );
}

export function withUsersEntryPublicKey(
  relation: Relations,
  text = relation.text
): Relations {
  const userPublicKey = getUsersEntryPublicKey(text, relation);
  if (!userPublicKey) {
    return relation;
  }

  return {
    ...relation,
    userPublicKey,
  };
}
