import { Map } from "immutable";
import { Filter, SimplePool, Event } from "nostr-tools";
import { useEventQuery } from "../commons/useNostrQuery";
import { KIND_NIP05 } from "../nostr";
import { useReadRelays } from "../relays";

function createNip05Query(publicKey: PublicKey): Filter {
  return {
    kinds: [KIND_NIP05],
    authors: [publicKey],
  };
}

export function useNip05Query(
  simplePool: SimplePool,
  author: PublicKey
): {
  events: Map<string, Event>;
  eose: boolean;
} {
  const { events, eose } = useEventQuery(
    simplePool,
    [createNip05Query(author)],
    {
      readFromRelays: useReadRelays({
        // We don't know anything about this user yet, so let's look everywhere
        defaultRelays: true,
        user: true,
        
        contacts: true,
      }),
    }
  );
  return { events, eose };
}
