type RowPathSegment = ID;

export type RowPath = readonly [number, ...RowPathSegment[]];

// Encode path IDs to handle colons in ref IDs (ref:ctx:target format)
function encodePathID(id: string): string {
  return id.replace(/:/g, "%3A");
}

function decodePathID(encoded: string): string {
  return encoded.replace(/%3A/g, ":");
}

export function parseRowPath(path: string): RowPath {
  const pieces = path.split(":");
  if (pieces.length < 2) {
    throw new Error("Invalid view path");
  }

  const panePart = pieces[0];
  if (!panePart.startsWith("p")) {
    throw new Error("Invalid view path");
  }

  const paneIndex = parseInt(panePart.substring(1), 10);
  if (Number.isNaN(paneIndex)) {
    throw new Error("Invalid view path");
  }

  const pathPieces = pieces
    .slice(1)
    .map((piece) => decodePathID(piece) as RowPathSegment);
  if (pathPieces.length === 0) {
    throw new Error("Invalid view path");
  }

  return [paneIndex, ...pathPieces];
}

export function rowPathToString(rowPath: RowPath): string {
  const paneIndex = rowPath[0] as number;
  const pathPart = (rowPath.slice(1) as readonly RowPathSegment[])
    .map((segment) => encodePathID(segment))
    .join(":");
  return `p${paneIndex}:${pathPart}`;
}

export function isRoot(rowPath: RowPath): boolean {
  return rowPath.length === 2;
}

export function getPaneIndex(rowPath: RowPath): number {
  return rowPath[0] as number;
}

export function getParentRowPath(rowPath: RowPath): RowPath | undefined {
  if (isRoot(rowPath)) {
    return undefined;
  }
  return rowPath.slice(0, -1) as unknown as RowPath;
}

export function getLast(rowPath: RowPath): RowPathSegment {
  return rowPath[rowPath.length - 1] as RowPathSegment;
}
