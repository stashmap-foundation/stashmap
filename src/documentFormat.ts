export function formatRootHeading(
  rootText: string,
  rootUuid: string,
  rootSemanticID: ID,
  anchor?: RootAnchor,
  systemRole?: RootSystemRole
): string {
  const parts = [
    rootUuid,
    `semantic="${rootSemanticID}"`,
    ...(anchor?.snapshotContext.size
      ? [`anchorContext="${anchor.snapshotContext.join(":")}"`]
      : []),
    ...(anchor?.snapshotLabels?.length
      ? [
          `anchorLabels="${anchor.snapshotLabels
            .map((label) => encodeURIComponent(label))
            .join("|")}"`,
        ]
      : []),
    ...(anchor?.sourceAuthor ? [`sourceAuthor="${anchor.sourceAuthor}"`] : []),
    ...(anchor?.sourceRootID ? [`sourceRoot="${anchor.sourceRootID}"`] : []),
    ...(anchor?.sourceRelationID
      ? [`sourceRelation="${anchor.sourceRelationID}"`]
      : []),
    ...(anchor?.sourceParentRelationID
      ? [`sourceParent="${anchor.sourceParentRelationID}"`]
      : []),
    ...(systemRole ? [`systemRole="${systemRole}"`] : []),
  ];
  return `# ${rootText} {${parts.join(" ")}}`;
}

export function formatNodeAttrs(
  uuid: string,
  relevance: Relevance,
  argument: Argument,
  options?: {
    hidden?: boolean;
    basedOn?: LongID;
    semanticID?: ID;
    userPublicKey?: PublicKey;
  }
): string {
  const parts: string[] = [
    ...(uuid ? [uuid] : []),
    ...(options?.semanticID ? [`semantic="${options.semanticID}"`] : []),
    ...(options?.userPublicKey
      ? [`userPublicKey="${options.userPublicKey}"`]
      : []),
    ...(relevance ? [`.${relevance}`] : []),
    ...(argument ? [`.${argument}`] : []),
    ...(options?.hidden ? [".hidden"] : []),
    ...(options?.basedOn ? [`basedOn="${options.basedOn}"`] : []),
  ];
  if (parts.length === 0) {
    return "";
  }
  return ` {${parts.join(" ")}}`;
}
