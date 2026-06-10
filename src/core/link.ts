export type Link =
  | {
      kind: "node";
      source: GraphNode;
      targetID: ID;
      text: string;
    }
  | {
      kind: "document";
      source: GraphNode;
      path: string;
      text: string;
    };
