import { List, Map } from "immutable";
import type { UnsignedEvent } from "nostr-tools";
import type { RelayInformation } from "nostr-tools/lib/types/nip11";
import type { Contacts, PublicKey, User } from "../../graph/identity";
import type { KnowledgeDBs, SemanticIndex, GraphNode } from "../../graph/types";
import type { QueueStatus, PublishEvents } from "../../infra/publishTypes";
import type {
  Pane,
  RowFocusIntent,
  TemporaryViewState,
  Views,
} from "../../session/types";

export type NotificationMessage = {
  title: string;
  message: string;
  date?: Date;
  navigateToLink?: string;
};

export type LocationState = {
  referrer?: string;
};

export type LocalStorage = {
  setLocalStorage: (key: string, value: string) => void;
  getLocalStorage: (key: string) => string | null;
  deleteLocalStorage: (key: string) => void;
};

export type CompressedSettings = {
  v: string;
  n: Buffer;
};

export type CompressedSettingsFromStore = {
  v: string;
  n: string;
};

export type TemporaryEvent =
  | {
      type: "ADD_EMPTY_NODE";
      nodeID: string;
      index: number;
      emptyNode: GraphNode;
      paneIndex: number;
    }
  | { type: "REMOVE_EMPTY_NODE"; nodeID: string };

export type EventState = PublishEvents & {
  preLoginEvents: List<UnsignedEvent>;
  temporaryView: TemporaryViewState;
  temporaryEvents: List<TemporaryEvent>;
  queueStatus?: QueueStatus;
};

export type Data = {
  contacts: Contacts;
  user: User;
  contactsRelays: Map<PublicKey, import("../../infra/publishTypes").Relays>;
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
  relaysInfos: Map<string, RelayInformation | undefined>;
  publishEventsStatus: EventState;
  views: Views;
  panes: Pane[];
};

export type RowFocusIntentState = RowFocusIntent;
