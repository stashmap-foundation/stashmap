export function formatRootHeading(
  rootText: string,
  rootUuid: string,
  basedOn?: LongID,
  snapshotDTag?: string,
  anchor?: RootAnchor,
  systemRole?: RootSystemRole
): string {
  const parts = [
    `id:${rootUuid}`,
    ...(basedOn ? [`basedOn="${basedOn}"`] : []),
    ...(snapshotDTag ? [`snapshot="${snapshotDTag}"`] : []),
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
    ...(anchor?.sourceNodeID ? [`sourceNode="${anchor.sourceNodeID}"`] : []),
    ...(anchor?.sourceParentNodeID
      ? [`sourceParent="${anchor.sourceParentNodeID}"`]
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

function clampHeadingLevel(level: number): number {
  if (level < 1) {
    return 1;
  }
  if (level > 6) {
    return 6;
  }
  return level;
}

export function formatHeadingLine(
  level: number,
  prefix: string,
  text: string,
  attrs: string
): string {
  return `${"#".repeat(clampHeadingLevel(level))} ${prefix}${text}${attrs}`;
}

export function formatBulletLine(
  indent: string,
  prefix: string,
  text: string,
  attrs: string
): string {
  return `${indent}- ${prefix}${text}${attrs}`;
}

export function formatOrderedLine(
  indent: string,
  number: number,
  prefix: string,
  text: string,
  attrs: string
): string {
  return `${indent}${number}. ${prefix}${text}${attrs}`;
}

export function formatWithFrontMatter(
  content: string,
  frontMatter?: string
): string {
  if (!frontMatter) {
    return content;
  }
  return `${frontMatter}\n${content}`;
}
