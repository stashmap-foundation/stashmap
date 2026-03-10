import { List, Map } from "immutable";
import { UnsignedEvent } from "nostr-tools";
import { KIND_CONTACTLIST, KIND_MEMBERLIST } from "./nostr";
import { findAllTags, getMostRecentReplacableEvent } from "./nostrEvents";

type FollowList = Array<Contact>;

export function parseFollowListEvent(event: UnsignedEvent): FollowList {
  const contactListTags = findAllTags(event, "p");
  if (!contactListTags) {
    return [];
  }
  return contactListTags
    .filter((tag) => tag.length >= 1)
    .map((tag) => {
      const { length } = tag;
      const publicKey = tag[0] as PublicKey;
      // we don't use mainRelay and userName, but we don't want to be a nostr client that deletes a user's data
      const mainRelay = length >= 2 ? tag[1] : undefined;
      const userName = length >= 3 ? tag[2] : undefined;
      return {
        publicKey,
        mainRelay,
        userName,
      };
    });
}

export function parseVotes(event: UnsignedEvent): Map<PublicKey, number> {
  const votesTags = findAllTags(event, "votes");
  if (!votesTags) {
    return Map<PublicKey, number>();
  }
  return Map(
    votesTags
      .map((tag) => {
        const { length } = tag;
        if (length < 2) {
          return undefined;
        }
        const publicKey = tag[0] as PublicKey;
        const vote = parseInt(tag[1], 10);
        return [publicKey, vote];
      })
      .filter((v) => v !== undefined) as Array<[PublicKey, number]>
  );
}

function getContactsFromFollowList(followList: FollowList): Contacts {
  return Map<PublicKey, Contact>(
    followList.map((contact) => {
      return [
        contact.publicKey,
        {
          publicKey: contact.publicKey,
        },
      ];
    })
  );
}

export function findContacts(events: List<UnsignedEvent>): Contacts {
  const contactListEvent = getMostRecentReplacableEvent(
    events.filter((event) => event.kind === KIND_CONTACTLIST)
  );
  if (!contactListEvent) {
    return Map<PublicKey, Contact>();
  }
  const followList = parseFollowListEvent(contactListEvent);
  return getContactsFromFollowList(followList);
}

export function findMembers(events: List<UnsignedEvent>): Members {
  const memebrListEvent = getMostRecentReplacableEvent(
    events.filter((event) => event.kind === KIND_MEMBERLIST)
  );
  if (!memebrListEvent) {
    return Map<PublicKey, Member>();
  }
  const memberList = parseFollowListEvent(memebrListEvent);
  const votes = parseVotes(memebrListEvent);
  return Map<PublicKey, Member>(
    memberList.map((contact) => {
      return [
        contact.publicKey,
        {
          publicKey: contact.publicKey,
          votes: votes.get(contact.publicKey, 0),
        },
      ];
    })
  );
}
