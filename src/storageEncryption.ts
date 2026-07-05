import { base64 } from "@scure/base";

// Storage keys are per-document, minted at first save and reused on every
// republish so a shared key (capability link) keeps opening later versions.
// 256-bit random, base64 — the age scrypt passphrase for the document.
export function newStorageKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64.encode(bytes);
}
