export type SyncPullCliArgs = {
  configPath?: string;
  outDir?: string;
  relayUrls: string[];
  maxWaitMs?: number;
  help: boolean;
};
