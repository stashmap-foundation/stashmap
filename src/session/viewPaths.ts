type ViewPathSegment = ID;

export type ViewPath = readonly [number, ...ViewPathSegment[]];

// Encode path IDs to handle colons in ref IDs (ref:ctx:target format)
function encodePathID(id: string): string {
  return id.replace(/:/g, "%3A");
}

function decodePathID(encoded: string): string {
  return encoded.replace(/%3A/g, ":");
}

export function parseViewPath(path: string): ViewPath {
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
    .map((piece) => decodePathID(piece) as ViewPathSegment);
  if (pathPieces.length === 0) {
    throw new Error("Invalid view path");
  }

  return [paneIndex, ...pathPieces];
}

export function viewPathToString(viewPath: ViewPath): string {
  const paneIndex = viewPath[0] as number;
  const pathPart = (viewPath.slice(1) as readonly ViewPathSegment[])
    .map((segment) => encodePathID(segment))
    .join(":");
  return `p${paneIndex}:${pathPart}`;
}

export function isRoot(viewPath: ViewPath): boolean {
  return viewPath.length === 2;
}

export function getPaneIndex(viewPath: ViewPath): number {
  return viewPath[0] as number;
}

export function getParentView(viewPath: ViewPath): ViewPath | undefined {
  if (isRoot(viewPath)) {
    return undefined;
  }
  return viewPath.slice(0, -1) as unknown as ViewPath;
}

export function getLast(viewPath: ViewPath): ViewPathSegment {
  return viewPath[viewPath.length - 1] as ViewPathSegment;
}
