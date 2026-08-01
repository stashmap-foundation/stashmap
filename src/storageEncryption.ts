import { Decrypter, Encrypter } from "age-encryption";
import { Event, UnsignedEvent, nip44 } from "nostr-tools";
import { base64 } from "@scure/base";
import { bytesToHex } from "@noble/hashes/utils";
import { isUserLoggedInWithSeed } from "./NostrAuthContext";
import { KIND_KNOWLEDGE_DOCUMENT } from "./nostr";

// Storage keys are per-document, minted at first save and reused on every
// republish so a shared key (capability link) keeps opening later versions.
// 256-bit random, base64 — the age scrypt passphrase for the document.
export function newStorageKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64.encode(bytes);
}

// The wire envelope mirrors the deedsats wallet's nostr_encrypt: the bulk
// payload is age/scrypt ciphertext under the storage key (work factor 1 —
// the key already has 256-bit entropy), and the storage key itself rides
// alongside, nip44-encrypted to the author. The event is self-contained:
// whoever can unwrap the key (the author, or anyone handed the key through
// a capability link) can open the document.
type StorageEnvelope = {
  key: string;
  data: string;
};

function selfConversationKey(user: KeyPair): Uint8Array {
  return nip44.v2.utils.getConversationKey(
    bytesToHex(user.privateKey),
    user.publicKey
  );
}

async function wrapStorageKey(user: User, storageKey: string): Promise<string> {
  if (isUserLoggedInWithSeed(user)) {
    return nip44.v2.encrypt(storageKey, selfConversationKey(user));
  }
  return window.nostr.nip44.encrypt(user.publicKey, storageKey);
}

async function unwrapStorageKey(user: User, wrapped: string): Promise<string> {
  if (isUserLoggedInWithSeed(user)) {
    return nip44.v2.decrypt(wrapped, selfConversationKey(user));
  }
  return window.nostr.nip44.decrypt(user.publicKey, wrapped);
}

async function encryptWithStorageKey(
  storageKey: string,
  plaintext: string
): Promise<string> {
  const encrypter = new Encrypter();
  encrypter.setPassphrase(storageKey);
  encrypter.setScryptWorkFactor(1);
  return base64.encode(await encrypter.encrypt(plaintext));
}

async function decryptWithStorageKey(
  storageKey: string,
  data: string
): Promise<string> {
  const decrypter = new Decrypter();
  decrypter.addPassphrase(storageKey);
  return decrypter.decrypt(base64.decode(data), "text");
}

export async function buildStorageEnvelope(
  user: User,
  storageKey: string,
  plaintext: string
): Promise<string> {
  const envelope: StorageEnvelope = {
    key: await wrapStorageKey(user, storageKey),
    data: await encryptWithStorageKey(storageKey, plaintext),
  };
  return JSON.stringify(envelope);
}

function parseEnvelope(content: string): StorageEnvelope | undefined {
  try {
    const parsed = JSON.parse(content) as Partial<StorageEnvelope>;
    return typeof parsed.key === "string" && typeof parsed.data === "string"
      ? { key: parsed.key, data: parsed.data }
      : undefined;
  } catch {
    return undefined;
  }
}

// Turns a wire storage event back into the internal plaintext form: content
// decrypted, storage key attached. The author unwraps the key from the
// envelope; everyone else gets a try at the capability keys they were
// handed. Returns undefined when the event cannot be opened — an
// undecryptable foreign document simply does not exist for this client.
export async function decryptStorageEvent(
  event: Event | UnsignedEvent,
  user: User | undefined,
  capabilityKeys: ReadonlyArray<string>
): Promise<((Event | UnsignedEvent) & EventAttachment) | undefined> {
  if (event.kind !== KIND_KNOWLEDGE_DOCUMENT) {
    return event;
  }
  const envelope = parseEnvelope(event.content);
  if (!envelope) {
    return undefined;
  }
  if (user && event.pubkey === user.publicKey) {
    try {
      const storageKey = await unwrapStorageKey(user, envelope.key);
      const content = await decryptWithStorageKey(storageKey, envelope.data);
      return { ...event, content, storageKey };
    } catch {
      return undefined;
    }
  }
  return capabilityKeys.reduce<
    Promise<((Event | UnsignedEvent) & EventAttachment) | undefined>
  >(
    (found, storageKey) =>
      found.then(
        async (result) =>
          result ??
          decryptWithStorageKey(storageKey, envelope.data).then(
            (content) => ({ ...event, content, storageKey }),
            () => undefined
          )
      ),
    Promise.resolve(undefined)
  );
}
