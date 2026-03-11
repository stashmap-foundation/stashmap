export type SyncPullCliArgs = {
  configPath?: string;
  outDir?: string;
  relayUrls: string[];
  maxWaitMs?: number;
  help: boolean;
};

export type WriteCreateRootCliArgs = {
  configPath?: string;
  relayUrls: string[];
  title?: string;
  filePath?: string;
  stdin?: boolean;
  includeMarkdown?: boolean;
  help: boolean;
};
