export type SyncPullCliArgs = {
  configPath?: string;
  asUser?: PublicKey;
  outDir?: string;
  relayUrls: string[];
  maxWaitMs?: number;
  help: boolean;
};

export type PushCliArgs = {
  configPath?: string;
  relayUrls: string[];
  help: boolean;
};
