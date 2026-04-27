export function formatRootHeading(
  rootText: string,
  rootUuid: string,
  basedOn?: LongID,
  snapshotDTag?: string,
  anchor?: RootAnchor,
  systemRole?: RootSystemRole,
  nodeKind?: NodeKind
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
    ...(nodeKind ? [`nodeKind="${nodeKind}"`] : []),
  ];
  return `# ${rootText} <!-- ${parts.join(" ")} -->`;
}

export function formatNodeAttrs(
  uuid: string,
  options?: {
    hidden?: boolean;
    basedOn?: LongID;
    userPublicKey?: PublicKey;
    nodeKind?: NodeKind;
  }
): string {
  const parts: string[] = [
    ...(uuid ? [`id:${uuid}`] : []),
    ...(options?.userPublicKey
      ? [`userPublicKey="${options.userPublicKey}"`]
      : []),
    ...(options?.hidden ? ["hidden"] : []),
    ...(options?.basedOn ? [`basedOn="${options.basedOn}"`] : []),
    ...(options?.nodeKind ? [`nodeKind="${options.nodeKind}"`] : []),
  ];
  if (parts.length === 0) {
    return "";
  }
  return ` <!-- ${parts.join(" ")} -->`;
}

const RELEVANCE_CHAR: Record<string, string> = {
  relevant: "!",
  maybe_relevant: "?",
  little_relevant: "~",
  not_relevant: "x",
};

const ARGUMENT_CHAR: Record<string, string> = {
  confirms: "+",
  contra: "-",
};

export function formatPrefixMarkers(
  relevance: Relevance,
  argument: Argument
): string {
  const argChar = argument ? ARGUMENT_CHAR[argument] : undefined;
  const relChar = relevance ? RELEVANCE_CHAR[relevance] : undefined;
  if (argChar && relChar) {
    return `(${argChar}${relChar}) `;
  }
  if (argChar) {
    return `(${argChar}) `;
  }
  if (relChar) {
    return `(${relChar}) `;
  }
  return "";
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

const BULLET_LINE_RE = /^\s*-\s/;
const ORDERED_LINE_RE = /^\s*\d+\.\s/;

function isBlockLine(line: string): boolean {
  if (line.length === 0) return false;
  if (BULLET_LINE_RE.test(line)) return false;
  if (ORDERED_LINE_RE.test(line)) return false;
  return true;
}

export function addBlankLinesAroundHeadings(lines: string[]): string[] {
  return lines.reduce<string[]>((acc, line, index) => {
    const prevLine = acc.length > 0 ? acc[acc.length - 1] : undefined;
    const prevIsBlock = prevLine !== undefined && isBlockLine(prevLine);
    const currentIsBlock = isBlockLine(line);
    const needsBlankBefore = currentIsBlock && index > 0 && prevLine !== "";
    const needsBlankAfterPrev =
      prevIsBlock && !currentIsBlock && line !== "" && prevLine !== "";
    if (needsBlankBefore || needsBlankAfterPrev) {
      return [...acc, "", line];
    }
    return [...acc, line];
  }, []);
}
