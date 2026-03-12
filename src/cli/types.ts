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

export type InspectChildrenCliArgs = {
  configPath?: string;
  parentRelationId?: LongID;
  help: boolean;
};

export type WriteSetTextCliArgs = {
  configPath?: string;
  relationId?: LongID;
  text?: string;
  relayUrls: string[];
  help: boolean;
};

export type WriteCreateUnderCliArgs = {
  configPath?: string;
  parentRelationId?: LongID;
  stdin?: boolean;
  beforeItemId?: LongID | ID;
  afterItemId?: LongID | ID;
  relevance?: "contains" | Relevance;
  argument?: "none" | Argument;
  relayUrls: string[];
  help: boolean;
};

export type WriteLinkCliArgs = {
  configPath?: string;
  parentRelationId?: LongID;
  targetRelationId?: LongID;
  beforeItemId?: LongID | ID;
  afterItemId?: LongID | ID;
  relevance?: "contains" | Relevance;
  argument?: "none" | Argument;
  relayUrls: string[];
  help: boolean;
};

export type WriteSetRelevanceCliArgs = {
  configPath?: string;
  parentRelationId?: LongID;
  itemId?: LongID | ID;
  relevance?: "contains" | Relevance;
  relayUrls: string[];
  help: boolean;
};

export type WriteSetArgumentCliArgs = {
  configPath?: string;
  parentRelationId?: LongID;
  itemId?: LongID | ID;
  argument?: "none" | Argument;
  relayUrls: string[];
  help: boolean;
};

export type WriteDeleteItemCliArgs = {
  configPath?: string;
  parentRelationId?: LongID;
  itemId?: LongID | ID;
  relayUrls: string[];
  help: boolean;
};

export type WriteMoveItemCliArgs = {
  configPath?: string;
  sourceParentRelationId?: LongID;
  itemId?: LongID | ID;
  targetParentRelationId?: LongID;
  beforeItemId?: LongID | ID;
  afterItemId?: LongID | ID;
  relayUrls: string[];
  help: boolean;
};
