#  A few constraints I’d add so this doesn’t turn into chaos:

- Move first, don’t rewrite.
    - preserve function bodies and signatures for now
- Enforce boundaries strictly.
    - if a function needs React, hooks, JSX, or browser-only APIs, it goes under features
    - if that placement feels wrong, record it in move.md instead of cheating the boundary
- Keep the app compiling during the move.
    - the easiest way is to move implementations to the new files and leave temporary re-exports from old locations
- Don’t use workspace as a top-level architecture name.
    - use graph, rows, session, app, infra, features

I’d structure the first pass like this:

- src/graph/
- src/rows/
- src/session/
- src/app/
- src/infra/
- src/features/
- move.md

## Initial Setup

- Created `src/graph/`
- Created `src/rows/`
- Created `src/session/`
- Created `src/app/`
- Created `src/infra/`
- Created `src/features/`
- Added ESLint import boundary rules for the new layer directories
- Created the first-pass target files for `graph`, `rows`, `session`, `app`, `infra`, and `features`

## Boundary Rules

- `graph` must not import `rows`, `session`, `app`, `infra`, or `features`
- `rows` may depend on `graph`, but not on `session`, `app`, `infra`, or `features`
- `session` is isolated and must not import `graph`, `rows`, `app`, `infra`, or `features`
- `app` may orchestrate `graph`, `rows`, and `session`, but must not import `infra` or `features`
- `infra` must not import `features`
- `features` is allowed to depend on lower layers during the move; if a React-bound function lands in the wrong feature or clearly belongs elsewhere later, record that explicitly here

## Feature Targets

- `src/features/app-shell/`
- `src/features/navigation/`
- `src/features/tree/`
- `src/features/editor/`
- `src/features/search/`
- `src/features/references/`

## Completed Moves

- Removed lower-layer imports from `features/*`
  - moved `UNAUTHENTICATED_USER_PK` and login-state helpers into `src/app/auth.ts`
  - moved `FinalizeEvent` into `src/infra/apiTypes.ts`
  - moved app-owned runtime types `Data` and `EventState` into `src/app/types.ts`
  - lower layers now use narrower local contracts instead of importing app-shell runtime bags:
    - `src/rows/data.ts`
    - `src/infra/markdownDocument.ts` via `MarkdownDocumentData`
    - `src/session/views.ts` via `HasViews`
  - moved temporary empty-node query helpers out of `graph` usage paths:
    - `TemporaryEvent` remains session-owned
    - feature/app code uses `src/session/temporaryNodes.ts`
    - row resolution now derives empty placeholders from row-local structural event data instead of importing `session`

- Extracted row-path utilities from `src/ViewContext.tsx` into `src/session/rowPaths.ts`
  - moved:
    - `RowPath`
    - `parseRowPath`
    - `rowPathToString`
    - `isRoot`
    - `getPaneIndex`
    - `getParentRowPath`
    - `getLast`
  - `src/ViewContext.tsx` currently re-exports these to keep the app stable during the transition

- Extracted pure view-state helpers from `src/ViewContext.tsx` into `src/session/views.ts`
  - moved:
    - `isExpanded`
    - `getParentKey`
    - `updateView`
    - `copyViewsWithNewPrefix`
    - `copyViewsWithNodesMapping`
  - `src/ViewContext.tsx` currently re-exports these to keep the app stable during the transition

- Moved pure selection helpers from `src/selection.ts` into `src/session/selection.ts`
  - moved:
    - `MultiSelectionState`
    - `toggleSelect`
    - `shiftSelect`
    - `clearSelection`
    - `deselectAllChildren`
  - `src/selection.ts` currently re-exports these to keep the app stable during the transition

- Moved `generatePaneId` from `src/SplitPanesContext.tsx` into `src/session/panes.ts`
  - `src/SplitPanesContext.tsx` currently re-exports it to keep existing imports stable

- Moved pure route/session helpers from `src/navigationUrl.ts` into `src/session/navigation.ts`
  - moved:
    - `pathToStack`
    - `buildNodeRouteUrl`
    - `parseNodeRouteUrl`
    - `parseAuthorFromSearch`
  - `src/navigationUrl.ts` currently re-exports these to keep existing imports stable

- Moved `getPane` from `src/planner.tsx` into `src/session/panes.ts`
  - `src/planner.tsx` currently re-exports it to keep existing imports stable

- Moved temporary-view state types from `src/types.ts` into `src/session/types.ts`
  - moved:
    - `TemporaryViewState`
    - `RowFocusIntent`
  - `src/types.ts` currently aliases these into the global type surface to keep the app stable during the transition

- Moved `defaultPane` from `src/Data.tsx` into `src/session/panes.ts`
  - `src/Data.tsx` currently re-exports it to keep existing imports stable

- Moved session-only planner commands into `src/session/*`
  - moved to `src/session/panes.ts`:
    - `planUpdatePanes`
  - moved to `src/session/views.ts`:
    - `planUpdateViews`
    - `planExpandNode`
  - moved to `src/session/focus.ts`:
    - `planSetRowFocusIntent`
  - moved to `src/session/selection.ts`:
    - `planSetTemporarySelectionState`
    - `planToggleTemporarySelection`
    - `planShiftTemporarySelection`
    - `planClearTemporarySelection`
    - `planSelectAllTemporaryRows`
  - `src/planner.tsx` currently re-exports these to keep existing imports stable

- Moved pure navigation-session state helpers from `src/NavigationStateContext.tsx` into `src/session/navigation.ts`
  - moved:
    - `HistoryState`
    - `urlToPane`

- Moved pure view-path maintenance helpers from `src/ViewContext.tsx` into `src/session/views.ts`
  - moved:
    - `updateRowPathsAfterMoveNodes`
    - `updateRowPathsAfterDisconnect`
    - `updateRowPathsAfterPaneDelete`
    - `updateRowPathsAfterPaneInsert`
    - `bulkUpdateRowPathsAfterAddNode`
  - `src/ViewContext.tsx` currently re-exports these to keep existing imports stable

- Moved the view-only `VirtualRowsMap` type from `src/ViewContext.tsx` into `src/rows/types.ts`
  - `src/ViewContext.tsx` currently re-exports the type to keep existing imports stable

- Moved `RowPath` primitives from `src/session/rowPaths.ts` into `src/rows/rowPaths.ts`
  - `src/session/rowPaths.ts` currently re-exports them as a compatibility shim

- Introduced dedicated row modules:
  - `src/rows/resolveRow.ts`
  - `src/rows/display.ts`
  - row-layer callers are now starting to import from these directly instead of `src/ViewContext.tsx`

- Emptied `src/ViewContext.tsx`
  - all function implementations were moved out
  - all callers were rewired to the new module homes
  - `src/ViewContext.tsx` has now been deleted
  - React row context/hooks moved to `src/features/tree/RowContext.tsx`
  - `upsertNodes` moved to `src/app/actions.ts`

- Moved navigation React contexts into `src/features/navigation`
  - `src/features/navigation/SplitPanesContext.tsx`
  - `src/features/navigation/NavigationStateContext.tsx`
  - all callers were rewired away from the old flat `src` files
  - `src/SplitPanesContext.tsx` and `src/NavigationStateContext.tsx` have now been deleted

- Moved tree projection into `src/rows/projectTree.ts`
  - `getTreeChildren` and `getNodesInTree` now live in the `rows` layer
  - callers were rewired away from `src/treeTraversal.ts`
  - `src/treeTraversal.ts` has now been deleted

- Moved child-node metadata and row-driven metadata updates out of flat legacy files
  - moved to `src/graph/commands.ts`:
    - `ChildNodeMetadata`
    - `updateChildNodeMetadata`
    - `planUpdateChildNodeMetadataById`
    - `planRemoveChildNodeById`
  - moved to `src/app/editorActions.ts`:
    - `planUpdateRowNodeMetadata`
  - moved to `src/features/tree/useChildNodeContext.ts`:
    - `useChildNodeContext`
  - deleted:
    - `src/nodeItemMetadata.ts`
    - `src/nodeItemMutations.ts`
    - `src/dataPlanner.ts`
    - `src/components/useNodeItemContext.ts`

- Drained `src/planner.tsx` into layer-appropriate homes
  - moved to `src/graph/commands.ts`:
    - graph plan construction and graph mutations
    - contact mutation planning
    - child attachment and subtree copy/move/delete helpers
  - moved to `src/app/actions.ts`:
    - unpublished-event rewriting
    - relay metadata event building
    - document-event construction
    - workspace plan construction
  - moved to `src/app/editorActions.ts`:
    - node text save/update flow
    - empty-node materialization/update flow
    - clipboard parsing
  - moved to `src/app/treeActions.ts`:
    - parent insertion
    - pane forking
    - subtree deep-copy orchestration
  - moved to `src/features/app-shell/PlannerContext.tsx`:
    - `PlanningContextProvider`
    - `usePlanner`
  - `src/planner.tsx` is now only a compatibility barrel

- Drained `src/Data.tsx` and `src/DataContext.tsx` utility logic into lower layers
  - moved to `src/infra/storage.ts`:
    - pane/view local-storage load/save
    - initial pane bootstrap from route/history/storage
  - moved to `src/graph/queries.ts`:
    - `mergeKnowledgeDBs`
  - moved to `src/features/app-shell/PermanentDocumentSyncBridge.tsx`:
    - permanent sync bridge component
  - moved to `src/features/app-shell/useRelaysInfo.ts`:
    - relay info fetching hook
  - `src/Data.tsx` now keeps feature-level app-shell wiring and state bootstrap
  - `src/DataContext.tsx` now keeps provider composition and imports merge helpers from `graph`

- Drained flat graph utility modules into `src/graph/*`
  - moved to `src/graph/types.ts`:
    - `EMPTY_SEMANTIC_ID`
    - `TextSeed`
    - `RefTargetSeed`
    - `newDB`
  - moved to `src/graph/context.ts`:
    - search-id helpers
    - semantic-id/context helpers
    - node stack/depth helpers
    - text-seed building helpers
  - moved to `src/graph/queries.ts`:
    - node lookup helpers
    - child-node lookup
    - search-node materialization
    - node child reorder/delete helpers
    - empty-node injection helpers
    - filter helpers
  - moved to `src/graph/references.ts`:
    - ref detection/resolution
    - route target resolution for refs and concrete nodes
  - moved to `src/graph/semanticIndex.ts`:
    - semantic index construction/update helpers
  - `src/connections.tsx`, `src/semanticIndex.ts`, and `src/knowledge.tsx` are now compatibility barrels only

- Moved tree feature React implementations out of flat legacy files
  - moved to `src/features/tree/PaneView.tsx`:
    - former `src/components/Workspace.tsx` implementation
  - moved to `src/features/tree/NodeView.tsx`:
    - former `src/components/Node.tsx` implementation
  - moved to `src/features/navigation/SplitPaneLayout.tsx`:
    - former `src/components/SplitPaneLayout.tsx` implementation
  - moved to `src/features/tree/DND.tsx`:
    - former `src/dnd.tsx` implementation
  - `src/components/Workspace.tsx`, `src/components/Node.tsx`, `src/components/SplitPaneLayout.tsx`, and `src/dnd.tsx` are now compatibility barrels only

- Moved remaining tree/search helper implementations into `src/features/*`
  - moved to `src/features/tree/TemporaryViewContext.tsx`:
    - former `src/components/TemporaryViewContext.tsx` implementation
  - moved to `src/features/tree/AddNode.tsx`:
    - former `src/components/AddNode.tsx` implementation
  - moved to `src/features/tree/SelectNodes.tsx`:
    - former `src/components/SelectNodes.tsx` implementation
  - moved to `src/features/tree/RightMenu.tsx`:
    - former `src/components/RightMenu.tsx` implementation
  - moved to `src/features/references/ReferenceDisplay.tsx`:
    - former `src/components/referenceDisplay.tsx` implementation
  - moved to `src/features/search/LoadSearchData.tsx`:
    - former `src/LoadSearchData.tsx` implementation
  - old flat files are now compatibility barrels only

- Moved app-shell runtime React implementations into `src/features/app-shell` and `src/features/navigation`
  - moved to `src/features/app-shell/Data.tsx`:
    - former `src/Data.tsx` implementation
  - moved to `src/features/app-shell/DataContext.tsx`:
    - former `src/DataContext.tsx` implementation
  - moved to `src/features/app-shell/DocumentStore.tsx`:
    - former `src/DocumentStore.tsx` implementation
  - moved to `src/features/navigation/PaneHistoryContext.tsx`:
    - former `src/PaneHistoryContext.tsx` implementation
  - moved to `src/features/app-shell/UserRelayContext.tsx`:
    - former `src/UserRelayContext.tsx` implementation
  - old flat files are now compatibility barrels only

- Moved app-shell auth/provider/router-support implementations into `src/features/app-shell`
  - moved to `src/features/app-shell/ApiContext.tsx`:
    - former `src/Apis.tsx` implementation
  - moved to `src/features/app-shell/NostrAuthContext.tsx`:
    - former `src/NostrAuthContext.tsx` implementation
  - moved to `src/features/app-shell/NostrProvider.tsx`:
    - former `src/NostrProvider.tsx` implementation
  - moved to `src/features/app-shell/RequireLogin.tsx`:
    - former `src/AppState.tsx` implementation
  - moved to `src/features/app-shell/StorePreLoginContext.tsx`:
    - former `src/StorePreLoginContext.tsx` implementation
  - moved to `src/features/app-shell/AppShell.tsx`:
    - former `src/components/Dashboard.tsx` implementation
  - moved to `src/features/tree/LoadingStatus.tsx`:
    - former `src/LoadingStatus.tsx` implementation
  - old flat files are now compatibility barrels only

- Moved remaining tree/editor/navigation helper implementations into `src/features/*`
  - moved to `src/features/tree/TreeView.tsx`:
    - former `src/components/TreeView.tsx` implementation
  - moved to `src/features/tree/Draggable.tsx`:
    - former `src/components/Draggable.tsx` implementation
  - moved to `src/features/tree/DroppableContainer.tsx`:
    - former `src/components/DroppableContainer.tsx` implementation
  - moved to `src/features/editor/EditorTextContext.tsx`:
    - former `src/components/EditorTextContext.tsx` implementation
  - moved to `src/features/tree/EvidenceSelector.tsx`:
    - former `src/components/EvidenceSelector.tsx` implementation
  - moved to `src/features/tree/RelevanceSelector.tsx`:
    - former `src/components/RelevanceSelector.tsx` implementation
  - moved to `src/features/tree/FileDropZone.tsx`:
    - former `src/components/FileDropZone.tsx` implementation
  - moved to `src/features/tree/FullscreenButton.tsx`:
    - former `src/components/FullscreenButton.tsx` implementation
  - moved to `src/features/navigation/OpenInSplitPaneButton.tsx`:
    - former `src/components/OpenInSplitPaneButton.tsx` implementation
  - moved to `src/features/tree/TypeFilterButton.tsx`:
    - former `src/components/TypeFilterButton.tsx` implementation
  - moved to `src/features/tree/keyboardNavigation.ts`:
    - former `src/components/keyboardNavigation.ts` implementation
  - moved to `src/features/navigation/responsive.tsx`:
    - former `src/components/responsive.tsx` implementation
  - moved to `src/features/tree/useRowStyle.ts`:
    - former `src/components/useItemStyle.ts` implementation
    - production callers now use `useRowStyle`; the old `useItemStyle` name only survives as a compatibility export
  - moved to `src/features/app-shell/NavbarControls.tsx`:
    - former `src/components/NavbarControls.tsx` implementation
  - old flat files are now compatibility barrels only

- Moved auth/search/relay-management feature implementations into `src/features/*`
  - moved to `src/features/app-shell/PublishingStatusWrapper.tsx`:
    - former `src/components/PublishingStatusWrapper.tsx` implementation
  - moved to `src/features/app-shell/Relays.tsx`:
    - former `src/components/Relays.tsx` implementation
  - moved to `src/features/search/SearchModal.tsx`:
    - former `src/components/SearchModal.tsx` implementation
  - moved to `src/features/tree/KeyboardShortcutsModal.tsx`:
    - former `src/components/KeyboardShortcutsModal.tsx` implementation
  - moved to `src/features/app-shell/SignIn.tsx`:
    - former `src/SignIn.tsx` implementation
  - moved to `src/features/app-shell/SignUp.tsx`:
    - former `src/SignUp.tsx` implementation
  - moved to `src/features/app-shell/usePermanentDocumentSync.ts`:
    - former `src/usePermanentDocumentSync.ts` implementation
  - old flat files are now compatibility barrels only

- Moved remaining app-shell/router/runtime helpers into final homes
  - moved to `src/features/app-shell/App.tsx`:
    - former `src/App.tsx` implementation
  - moved to `src/features/navigation/useDragAutoScroll.ts`:
    - former `src/useDragAutoScroll.ts` implementation
  - moved to `src/infra/nostr.ts`:
    - former `src/PublishQueue.ts` implementation
  - old flat files are now compatibility barrels only

- Split relay logic by layer
  - moved React relay hooks into `src/features/app-shell/useRelays.ts`:
    - `useReadRelays`
    - `usePreloadRelays`
    - `useRelaysToCreatePlan`
    - `useRelaysForRelayManagement`
  - moved pure relay rules into `src/relayUtils.ts`:
    - `getSuggestedRelays`
    - `getIsNecessaryReadRelays`
    - `applyWriteRelayConfig`
  - `src/relays.tsx` is now a compatibility surface that re-exports pure relay utilities and feature-level relay hooks

- Reduced reference-row cross-layer coupling
  - moved `referenceToText` into `src/rows/display.ts`
  - `src/buildReferenceRow.ts` now depends on `rows/display` and `session/panes` instead of depending on feature/UI code and planner just to format reference text and read pane state
  - `src/features/references/ReferenceDisplay.tsx` now keeps only the React rendering layer

- Boundary hold:
  - `buildNodeUrl` remains in `src/navigationUrl.ts`
  - reason: moving it into `src/session/navigation.ts` would violate the lint boundary because it depends on semantic projection (`getTextForSemanticID`)
  - keep it in the flat navigation boundary file for now instead of weakening the rule

- Moved legacy tree mutation/application helpers out of flat files
  - moved to `src/app/treeActions.ts`:
    - `planDisconnectFromParent`
    - `planDeleteNodeFromView`
    - `planMoveNodeWithView`
  - moved to `src/features/tree/batchOperations.ts`:
    - batch relevance/argument updates
    - batch indent/outdent behavior
    - current-row helper for batch operations
  - moved to `src/features/tree/useUpdateRelevance.ts`:
    - relevance conversion helpers
    - `useUpdateRelevance`
  - moved to `src/features/tree/useUpdateArgument.ts`:
    - `useUpdateArgument`
  - `src/treeMutations.ts`, `src/components/batchOperations.ts`, `src/components/useUpdateRelevance.ts`, and `src/components/useUpdateArgument.ts` are now compatibility barrels only

- Moved remaining low-level graph helpers out of flat files
  - moved to `src/graph/context.ts`:
    - root-anchor helpers
    - node public-key stamping helpers
  - moved to `src/graph/queries.ts`:
    - system-root lookup helpers
  - `src/rootAnchor.ts`, `src/systemRoots.ts`, and `src/userEntry.ts` are now compatibility barrels only

- Boundary / lint hold:
  - `src/nodeFactory.ts` stays as the implementation home for `newNode` and `newRefNode`
  - reason: moving these constructors into `src/graph/commands.ts` pulled `uuid` into a stricter lint context and produced unsafe-type errors
  - keep the constructors in the flat graph boundary file for now instead of weakening lint rules

- Drained the largest legacy tree UI modules into `features/tree`
  - moved the `PaneView` implementation from `src/components/Workspace.tsx` to `src/features/tree/PaneView.tsx`
  - moved the `Node` implementation from `src/components/Node.tsx` to `src/features/tree/NodeView.tsx`
  - `src/components/Workspace.tsx` and `src/components/Node.tsx` are now compatibility barrels only

- Drained pane layout and drag/drop implementation out of the flat layer
  - moved the split-pane layout implementation from `src/components/SplitPaneLayout.tsx` to `src/features/navigation/SplitPaneLayout.tsx`
  - moved the DnD implementation from `src/dnd.tsx` to `src/features/tree/DND.tsx`
  - `src/components/SplitPaneLayout.tsx` and `src/dnd.tsx` are now compatibility barrels only

- Renamed row-address primitives from `ViewPath` to `RowPath`
  - renamed:
    - `ViewPath` -> `RowPath`
    - `parseViewPath` -> `parseRowPath`
    - `viewPathToString` -> `rowPathToString`
    - `getParentView` -> `getParentRowPath`
    - `useViewPath` -> `useRowPath`
  - this was kept in `src/session/rowPaths.ts` for now to avoid reopening layer rules mid-move

## Resolved

- Row resolution no longer lives in `src/ViewContext.tsx`
  - `RowPath` moved into `src/rows/rowPaths.ts`
  - row resolution moved into `src/rows/resolveRow.ts`
  - row display moved into `src/rows/display.ts`
  - React row context/hooks moved into `src/features/tree/RowContext.tsx`

- Removed the legacy `src/connections.tsx` compatibility barrel
  - rewired all remaining production and test imports directly to:
    - `src/graph/context.ts`
    - `src/graph/queries.ts`
    - `src/graph/references.ts`
    - `src/graph/types.ts`
  - deleted `src/connections.tsx`

- Moved the pure markdown infrastructure slice into `src/infra/*`
  - moved:
    - `src/documentFormat.ts` -> `src/infra/documentFormat.ts`
    - `src/documentMaterialization.ts` -> `src/infra/documentMaterialization.ts`
    - `src/markdownImport.ts` -> `src/infra/markdownImport.ts`
    - `src/markdownNodes.ts` -> `src/infra/markdownNodes.ts`
    - `src/markdownTree.ts` -> `src/infra/markdownTree.ts`
    - `src/nodesDocumentEvent.ts` -> `src/infra/nodesDocumentEvent.ts`
  - kept the old top-level paths as compatibility barrels

- Moved the remaining markdown flow into `src/infra/*`
  - moved:
    - `src/markdownDocument.tsx` -> `src/infra/markdownDocument.ts`
    - `src/markdownPlan.ts` -> `src/infra/markdownPlan.ts`
    - `src/standaloneDocumentEvent.ts` -> `src/infra/standaloneDocumentEvent.ts`
  - kept the old top-level paths as compatibility barrels
  - temporary compromise:
    - `markdownDocument` and `markdownPlan` still depend on rows/session/app concepts
    - they are in `infra` for now because the current lint graph forbids `app -> infra`, and moving them into `app` would immediately violate the boundary rules

- Moved the semantic/reference slice into structured layers
  - moved:
    - `src/semanticProjection.ts` -> `src/graph/semanticProjection.ts`
    - `src/buildReferenceRow.ts` -> `src/rows/buildReferenceRow.ts`
  - split `buildNodeUrl` out of the mixed URL surface:
    - added `src/graph/nodeUrl.ts`
    - `src/navigationUrl.ts` is now a compatibility surface over `graph/nodeUrl` and `session/navigation`
  - removed the `session` dependency from `buildReferenceRow` by resolving the pane from `RowPath` directly

- Moved the persistence/sync/runtime slice into `src/infra/*`
  - moved:
    - `src/indexedDB.ts` -> `src/infra/indexedDB.ts`
    - `src/permanentSync.ts` -> `src/infra/permanentSync.ts`
    - `src/eventProcessing.ts` -> `src/infra/eventProcessing.ts`
    - `src/eventQuery.ts` -> `src/infra/eventQuery.ts`
  - kept the old top-level paths as compatibility barrels
  - `src/infra/permanentSync.ts` intentionally imports `../indexedDB` and `../eventQuery` through the compatibility layer so the existing Jest mocks still intercept those dependencies

- Split execution/publishing into `app` and `infra`
  - moved:
    - `src/executor.tsx` -> `src/app/executor.ts`
    - `src/nostrPublish.ts` -> `src/infra/nostrPublish.ts`
  - kept the old top-level paths as compatibility barrels
  - decision:
    - `executor` was placed in `app`, not `infra`, because it still depends on user/auth/finalization surfaces and orchestrates plan execution rather than raw transport publishing

- Moved the remaining small shared foundation helpers into structured layers
  - moved:
    - `src/contacts.ts` -> `src/infra/contacts.ts`
    - `src/serializer.tsx` -> `src/session/serializer.ts`
    - `src/nostr.ts` -> `src/infra/nostrCore.ts`
    - `src/nostrEvents.ts` -> `src/infra/nostrEvents.ts`
  - kept the old top-level paths as compatibility barrels
  - intentionally left `src/types.ts` in place for now
    - it is still the global declaration hub and needs a more deliberate split than a mechanical move

And the rule for ambiguous cases should be:

- “Can this module exist without React?”
    - yes: not features
    - no: features
- “Does this module mutate persisted node state?”
    - graph or app
- “Does it only manage panes/views/selection/focus?”
    - session
- “Does it translate nodes into visible entries?”
    - rows
- “Does it orchestrate multiple layers?”
    - app
