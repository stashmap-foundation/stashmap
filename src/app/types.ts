import { List, type Map } from "immutable";
import type { UnsignedEvent } from "nostr-tools";
import type { RelayInformation } from "nostr-tools/lib/types/nip11";
import type { GraphPlan } from "../graph/commands";
import type { Contacts, PublicKey, User } from "../graph/identity";
import type { KnowledgeDBs, SemanticIndex } from "../graph/types";
import type { PublishEvents, QueueStatus, Relays } from "../infra/publishTypes";
import type {
  Pane,
  TemporaryEvent,
  TemporaryViewState,
  Views,
} from "../session/types";

export type EventState = PublishEvents & {
  preLoginEvents: List<UnsignedEvent>;
  temporaryView: TemporaryViewState;
  temporaryEvents: List<TemporaryEvent>;
  queueStatus?: QueueStatus;
};

export type Data = {
  contacts: Contacts;
  user: User;
  contactsRelays: Map<PublicKey, Relays>;
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
  relaysInfos: Map<string, RelayInformation | undefined>;
  publishEventsStatus: EventState;
  views: Views;
  panes: Pane[];
};

export type WorkspacePlan = GraphPlan &
  Pick<
    Data,
    | "contactsRelays"
    | "semanticIndex"
    | "relaysInfos"
    | "publishEventsStatus"
    | "views"
    | "panes"
  > & {
    temporaryView: TemporaryViewState;
    temporaryEvents: List<TemporaryEvent>;
  };

export type Plan = WorkspacePlan;
