export type Link =
  | {
      kind: "node";
      source: GraphNode;
      sourceId: SourceId;
      targetID: ID;
      text: string;
    }
  | {
      kind: "document";
      source: GraphNode;
      sourceId: SourceId;
      path: string;
      text: string;
    };
