export type Link =
  | {
      kind: "node";
      source: GraphNode;
      targetID: LongID;
      text: string;
    }
  | {
      kind: "document";
      source: GraphNode;
      path: string;
      text: string;
    };
