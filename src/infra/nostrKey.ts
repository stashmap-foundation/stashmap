import { getPublicKey, nip19 } from "nostr-tools";
// eslint-disable-next-line import/no-unresolved
import * as nip06 from "nostr-tools/nip06";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

/* eslint-disable no-empty */
export function convertInputToPrivateKey(input: string): string | undefined {
  const trimmed = input.trim();
  try {
    const { type, data } = nip19.decode(trimmed);
    if (type !== "nsec") {
      return undefined;
    }
    return bytesToHex(data);
  } catch {}
  try {
    return nip06.privateKeyFromSeedWords(trimmed);
  } catch {}
  try {
    getPublicKey(hexToBytes(trimmed));
    return trimmed;
  } catch {}
  return undefined;
}
/* eslint-enable no-empty */
