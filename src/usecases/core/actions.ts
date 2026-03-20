import { List } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { UNAUTHENTICATED_USER_PK } from "./auth";

type HasPublishEvents = {
  publishEvents: List<UnsignedEvent>;
  user: {
    publicKey: string;
  };
};

export function replaceUnauthenticatedUser<T extends string>(
  from: T,
  publicKey: string
): T {
  return from.replaceAll(UNAUTHENTICATED_USER_PK, publicKey) as T;
}

function rewriteIDs(event: UnsignedEvent): UnsignedEvent {
  const replacedTags = event.tags.map((tag) =>
    tag.map((value) => replaceUnauthenticatedUser(value, event.pubkey))
  );
  return {
    ...event,
    content: replaceUnauthenticatedUser(event.content, event.pubkey),
    tags: replacedTags,
  };
}

export function planRewriteUnpublishedEvents<T extends HasPublishEvents>(
  plan: T,
  events: List<UnsignedEvent>
): T {
  const allEvents = plan.publishEvents.concat(events);
  const rewrittenEvents = allEvents.map((event) =>
    rewriteIDs({
      ...event,
      pubkey: plan.user.publicKey,
    })
  );
  return {
    ...plan,
    publishEvents: rewrittenEvents,
  };
}
