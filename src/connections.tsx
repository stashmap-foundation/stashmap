export { EMPTY_SEMANTIC_ID, newDB } from "./graph/types";
export type { RefTargetSeed, TextSeed } from "./graph/types";
export {
  buildTextNodesFromGraphNodes,
  createSearchId,
  getIndexedNodesForKeys,
  getNodeContext,
  getNodeDepth,
  getNodeSemanticID,
  getNodeStack,
  getNodeText,
  getSemanticID,
  isEmptySemanticID,
  isSearchId,
  joinID,
  parseSearchId,
  shortID,
  splitID,
} from "./graph/context";
export {
  computeEmptyNodeMetadata,
  deleteNodes,
  ensureNodeNativeFields,
  getChildNodes,
  getNode,
  getSearchNodes,
  injectEmptyNodesIntoKnowledgeDBs,
  mergeKnowledgeDBs,
  moveNodes,
  nodeMatchesType,
  nodePassesFilters,
} from "./graph/queries";
export {
  createRefTarget,
  getNodeRouteTargetInfo,
  getRefLinkTargetInfo,
  getRefTargetInfo,
  isRefNode,
  resolveNode,
} from "./graph/references";
