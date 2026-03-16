import { isSearchId, parseSearchId } from "../connections";
import { getNodeUserPublicKey } from "../userEntry";
import { type RowPath } from "./rowPaths";
import {
  getCurrentReferenceForView,
  getNodeForView,
  getRowIDFromView,
} from "./resolveRow";

export function getDisplayTextForView(
  data: Data,
  rowPath: RowPath,
  stack: ID[],
  virtualType?: VirtualType,
  currentRow?: GraphNode
): string {
  const reference = getCurrentReferenceForView(
    data,
    rowPath,
    stack,
    virtualType,
    currentRow
  );
  if (reference) {
    return reference.text;
  }
  const [rowID] = getRowIDFromView(data, rowPath);
  if (isSearchId(rowID as ID)) {
    const query = parseSearchId(rowID as ID) || "";
    return `Search: ${query}`;
  }
  const ownNode = getNodeForView(data, rowPath, stack);
  const userPublicKey = getNodeUserPublicKey(ownNode);
  const contactPetname = userPublicKey
    ? data.contacts.get(userPublicKey)?.userName
    : undefined;
  if (contactPetname) {
    return contactPetname;
  }
  return ownNode?.text ?? "";
}
