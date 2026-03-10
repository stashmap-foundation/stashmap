import { nip19 } from "nostr-tools";

const PUBLIC_KEY_REGEX = /^[a-fA-F0-9]{64}$/;

export function decodePublicKeyInputSync(
  input: string | undefined
): PublicKey | undefined {
  if (!input) {
    return undefined;
  }

  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return undefined;
  }

  try {
    const decodedInput = nip19.decode(trimmedInput);
    if (decodedInput.type === "npub") {
      return decodedInput.data as PublicKey;
    }
    if (decodedInput.type === "nprofile") {
      return decodedInput.data.pubkey as PublicKey;
    }
  } catch {
    // Fall through to raw hex parsing.
  }

  if (PUBLIC_KEY_REGEX.test(trimmedInput)) {
    return trimmedInput as PublicKey;
  }

  return undefined;
}
