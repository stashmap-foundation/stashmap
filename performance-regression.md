 I looked at the uncommitted source changes. The strongest candidates are:

 1. src/core/planLookup.ts:10-30
     - findUniquePlanNodeByID scans every knowledgeDBs source on lookup miss:
       ```ts
         knowledgeDBs.valueSeq().map((db) => db.nodes.get(id))
       ```
     - This is especially suspicious because lookupPlanNode is used through existing hot view/planner paths. It also reintroduces ambiguous “unique anywhere” lookup behavior.
 2. src/treeTraversal.ts
     - createVirtualRow calls graphLookupFromData(data) for every virtual incoming/suggestion/version row.
     - getChildrenForRegularNode calls graphLookupFromData(data) for every expanded row.
     - nodePathLabel adds getNodeContext + getSemanticID work for incoming/version labels.
     - Since the slowest suite is now IncomingRefInteraction, this is high-suspicion.
 3. src/semanticProjection.ts:getIncomingCrefsForNode
     - Called for every rendered regular node from tree traversal.
     - Does several repeated computations per row:
         - coveredDocumentKeys recursively walks current child subtrees.
         - outgoingTargetRelIDs resolves every child ref source-aware.
         - maps incoming refs to owner nodes.
         - calls getNodeContext for every incoming candidate.
         - dedupes/sorts refs.
     - This is probably the main incoming-ref rendering hotspot.
 4. src/buildReferenceRow.ts
     - buildReferenceItem now creates graph lookups repeatedly:
         - parseRefInSource creates a graph.
         - deleted-ref branch creates another graph.
         - storedItem creates another graph.
         - findIndexedGraphLinkItem / findIndexedFileLinkItem each create graphs.
     - This can happen for every reference row render.
 5. src/editor/linkOperations.ts:44-63
     - Link navigation now calls graphLookupFromData(data) twice for node links:
         - once in nodeTarget
         - once in sourceResolvedNode
     - Since linkToHref runs during render, this can multiply quickly in link-heavy tests.
 6. Lower-confidence: src/semanticProjection.ts:getConcreteNodesForSemanticID
     - On direct lookup miss it scans all DBs and all nodes:
       ```ts
         candidateDBs.flatMap((db) => db.nodes.valueSeq().filter(...))
       ```
     - I don’t currently see it as a likely hot path, but it is an obvious whole-DB scan.
