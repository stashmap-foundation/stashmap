import { List, type Map } from "immutable";
import type { UnsignedEvent } from "nostr-tools";
import type { RelayInformation } from "nostr-tools/lib/types/nip11";
import type { Contacts, PublicKey, User } from "../../graph/identity";
import type { KnowledgeDBs, SemanticIndex } from "../../graph/types";
import type { StoredSnapshotRecord } from "../../infra/indexedDB";
import type {
  Pane,
  RowFocusIntent,
  TemporaryEvent,
  TemporaryViewState,
  Views,
} from "../../session/types";
import type {
  PublishEvents,
  QueueStatus,
  Relays,
} from "../../infra/publishTypes";

export type EventState = PublishEvents & {
  preLoginEvents: List<UnsignedEvent>;
  temporaryView: TemporaryViewState;
  temporaryEvents: List<TemporaryEvent>;
  queueStatus?: QueueStatus;
};

export type SnapshotLoadStatus = "loading" | "loaded" | "unavailable";

export type Data = {
  contacts: Contacts;
  user: User;
  contactsRelays: Map<PublicKey, Relays>;
  knowledgeDBs: KnowledgeDBs;
  semanticIndex: SemanticIndex;
  snapshots?: Map<string, StoredSnapshotRecord>;
  snapshotStatuses?: Map<string, SnapshotLoadStatus>;
  relaysInfos: Map<string, RelayInformation | undefined>;
  publishEventsStatus: EventState;
  views: Views;
  panes: Pane[];
};

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

export type RowFocusIntentState = RowFocusIntent;
