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

export type WriteCreateRootCliArgs = {
  configPath?: string;
  relayUrls: string[];
  title?: string;
  filePath?: string;
  stdin?: boolean;
  includeMarkdown?: boolean;
  help: boolean;
};

export type WriteSetTextCliArgs = {
  configPath?: string;
  relationId?: LongID;
  text?: string;
  relayUrls: string[];
  help: boolean;
};

export type WriteCopyRootCliArgs = {
  configPath?: string;
  relationId?: LongID;
  relayUrls: string[];
  help: boolean;
};

export type WriteCreateUnderCliArgs = {
  configPath?: string;
  parentRelationId?: LongID;
  stdin?: boolean;
  beforeItemId?: ID;
  afterItemId?: ID;
  relevance?: "contains" | Relevance;
  argument?: "none" | Argument;
  relayUrls: string[];
  help: boolean;
};

export type WriteLinkCliArgs = {
  configPath?: string;
  parentRelationId?: LongID;
  targetRelationId?: LongID;
  beforeItemId?: ID;
  afterItemId?: ID;
  relevance?: "contains" | Relevance;
  argument?: "none" | Argument;
  relayUrls: string[];
  help: boolean;
};

export type WriteSetRelevanceCliArgs = {
  configPath?: string;
  parentRelationId?: LongID;
  itemId?: ID;
  relevance?: "contains" | Relevance;
  relayUrls: string[];
  help: boolean;
};

export type WriteSetArgumentCliArgs = {
  configPath?: string;
  parentRelationId?: LongID;
  itemId?: ID;
  argument?: "none" | Argument;
  relayUrls: string[];
  help: boolean;
};

export type WriteDeleteItemCliArgs = {
  configPath?: string;
  parentRelationId?: LongID;
  itemId?: ID;
  relayUrls: string[];
  help: boolean;
};

export type WriteMoveItemCliArgs = {
  configPath?: string;
  sourceParentRelationId?: LongID;
  itemId?: ID;
  targetParentRelationId?: LongID;
  beforeItemId?: ID;
  afterItemId?: ID;
  relayUrls: string[];
  help: boolean;
};
