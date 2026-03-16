#  A few constraints I’d add so this doesn’t turn into chaos:

- Move first, don’t rewrite.
    - preserve function bodies and signatures for now
- Enforce boundaries strictly.
    - if a function needs React, hooks, JSX, or browser-only APIs, it goes under ui
    - if that placement feels wrong, record it in move.md instead of cheating the boundary
- Keep the app compiling during the move.
    - the easiest way is to move implementations to the new files and leave temporary re-exports from old locations
- Don’t use workspace as a top-level architecture name.
    - use graph, rows, session, app, infra, ui

I’d structure the first pass like this:

- src/graph/
- src/rows/
- src/session/
- src/app/
- src/infra/
- src/ui/
- move.md

## Initial Setup

- Created `src/graph/`
- Created `src/rows/`
- Created `src/session/`
- Created `src/app/`
- Created `src/infra/`
- Created `src/ui/`
- Added ESLint import boundary rules for the new layer directories
- Created the first-pass target files for `graph`, `rows`, `session`, `app`, `infra`, and `ui`

## Boundary Rules

- `graph` must not import `rows`, `session`, `app`, `infra`, or `ui`
- `rows` may depend on `graph`, but not on `session`, `app`, `infra`, or `ui`
- `session` is isolated and must not import `graph`, `rows`, `app`, `infra`, or `ui`
- `app` may orchestrate `graph`, `rows`, and `session`, but must not import `infra` or `ui`
- `infra` must not import `ui`
- `ui` is allowed to depend on lower layers during the move; if a React-bound function lands in `ui` but clearly belongs elsewhere later, record that explicitly here

## Completed Moves

- Extracted view-path utilities from `src/ViewContext.tsx` into `src/session/viewPaths.ts`
  - moved:
    - `ViewPath`
    - `parseViewPath`
    - `viewPathToString`
    - `isRoot`
    - `getPaneIndex`
    - `getParentView`
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
    - `updateViewPathsAfterMoveNodes`
    - `updateViewPathsAfterDisconnect`
    - `updateViewPathsAfterPaneDelete`
    - `updateViewPathsAfterPaneInsert`
    - `bulkUpdateViewPathsAfterAddNode`
  - `src/ViewContext.tsx` currently re-exports these to keep existing imports stable

And the rule for ambiguous cases should be:

- “Can this module exist without React?”
    - yes: not ui
    - no: ui
- “Does this module mutate persisted node state?”
    - graph or app
- “Does it only manage panes/views/selection/focus?”
    - session
- “Does it translate nodes into visible entries?”
    - rows
- “Does it orchestrate multiple layers?”
    - app
