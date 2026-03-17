import type { RowFocusIntent } from "../../session/types";

export type { Data, EventState } from "../../app/types";

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
