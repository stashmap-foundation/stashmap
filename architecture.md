Layers
  - graph
      - persisted domain model only
      - GraphNode, refs, roots, relevance, argument, semantic context
      - pure reads and writes over node state
  - rows
      - view-only projection layer
      - turns graph state into visible tree entries
      - owns a real TreeRow type
  - session
      - UI state only
      - panes, expanded state, selection, focus, navigation, view paths
  - app
      - orchestration/use-cases
      - resolves UI inputs into graph operations plus session updates
  - infra
      - Nostr, IndexedDB, markdown import/export, CLI, sync
  - features
      - React components and feature-specific hooks
      - tree, navigation, editor, search, references
      - render rows and dispatch app actions

  Dependency Direction

  - graph can depend on nothing above it
  - rows depends on graph
  - session is independent of graph rules except ids/path references
  - app depends on graph, rows, and session
  - infra depends on graph and app as needed
  - features depends on app, rows, and session

  No lower layer should import React.

  Module Layout

  - src/graph/model.ts
  - src/graph/queries.ts
  - src/graph/commands.ts
  - src/graph/context.ts
  - src/rows/types.ts
  - src/rows/projectTree.ts
  - src/rows/resolveRow.ts
  - src/rows/display.ts
  - src/session/panes.ts
  - src/session/views.ts
  - src/session/selection.ts
  - src/session/focus.ts
  - src/session/navigation.ts
  - src/session/rowPaths.ts
  - src/app/actions.ts
  - or split further into:
      - src/app/treeActions.ts
      - src/app/editorActions.ts
      - src/app/navigationActions.ts
  - src/infra/nostr/*
  - src/infra/storage/*
  - src/infra/markdown/*
  - src/infra/cli/*
  - src/infra/sync/*
  - src/features/app-shell/*
  - src/features/navigation/*
  - src/features/tree/*
  - src/features/editor/*
  - src/features/search/*
  - src/features/references/*

  Core Type Split
  This is the most important architectural line:

  - GraphNode
      - persisted graph object
  - TreeRow
      - visible tree entry

  TreeRow should be a real tagged union, for example:

  - node
  - reference
  - suggestion
  - version
  - empty

  Right now the app fakes rows with GraphNode, which is why naming and boundaries keep collapsing.

  Command Split
  There should be three command families.

  - graph commands
      - input: GraphPlan, nodeId, node payloads
      - output: GraphPlan
      - no view paths, no panes
  - session commands
      - input: SessionState, rowPath, viewKey, paneIndex
      - output: SessionState
      - no graph mutation
  - app actions
      - input: app/UI intent
      - output: updated app state
      - compose graph commands + session commands

  So:

  - pure data changes stay in graph/commands
  - pure UI changes stay in session/commands
  - mixed operations live in app/actions

  How Current Files Map

  - connections.tsx
      - split across graph/model, graph/queries, graph/context
  - treeTraversal.ts
      - becomes rows/projectTree
  - ViewContext.tsx
      - split into session/rowPaths, rows/resolveRow, rows/display
  - planner.tsx
      - split into graph/commands, session/commands, app/actions
  - components/Workspace.tsx
      - becomes thin UI/keyboard wiring over app actions

  What This Fixes

  - node and row stop being conflated
  - graph logic becomes callable by CLI and UI the same way
  - UI code stops owning mutation logic
  - selection/focus/pane behavior becomes an explicit subsystem
  - planner stops being the god module
