export function formatRootHeading(
  rootText: string,
  rootUuid: string,
  anchor?: RootAnchor,
  systemRole?: RootSystemRole
): string {
  const parts = [
    `id:${rootUuid}`,
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
  return `# ${rootText} <!-- ${parts.join(" ")} -->`;
}

export function formatNodeAttrs(
  uuid: string,
  options?: {
    hidden?: boolean;
    basedOn?: LongID;
    userPublicKey?: PublicKey;
  }
): string {
  const parts: string[] = [
    ...(uuid ? [`id:${uuid}`] : []),
    ...(options?.userPublicKey
      ? [`userPublicKey="${options.userPublicKey}"`]
      : []),
    ...(options?.hidden ? ["hidden"] : []),
    ...(options?.basedOn ? [`basedOn="${options.basedOn}"`] : []),
  ];
  if (parts.length === 0) {
    return "";
  }
  return ` <!-- ${parts.join(" ")} -->`;
}

const RELEVANCE_PREFIX: Record<string, string> = {
  relevant: "(!)",
  maybe_relevant: "(?)",
  little_relevant: "(~)",
  not_relevant: "(x)",
};

const ARGUMENT_PREFIX: Record<string, string> = {
  confirms: "(+)",
  contra: "(-)",
};

export function formatPrefixMarkers(
  relevance: Relevance,
  argument: Argument
): string {
  const parts: string[] = [
    ...(relevance && RELEVANCE_PREFIX[relevance]
      ? [RELEVANCE_PREFIX[relevance]]
      : []),
    ...(argument && ARGUMENT_PREFIX[argument]
      ? [ARGUMENT_PREFIX[argument]]
      : []),
  ];
  return parts.length > 0 ? `${parts.join(" ")} ` : "";
}
