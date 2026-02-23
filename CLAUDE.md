# Remember

- To run typescript use: npm run typescript
- To run lint use: npm run lint
- Ignore "React is declared but its value is never read" warnings - they are almost always stale
- Reuse code! If you find yourself copying and pasting code, consider refactoring it into a reusable function or component.
- We program purely functional, don't use let or var, only const.
- Don't add any comments to the code, except when they are really necessary, which is very rare. Code should be self-explanatory. Don't add any comments where you tell me waht you are doing.
- Don't use inline imports in type declarations (e.g., `import("./Foo").Bar`). Use regular top-level imports instead.

## Testing

- In order to create test data, just use the keyboard. For example, Holiday Destinations{Enter}{Tab}Spain{Enter}France{Enter} will create a nice Tree with Holiday Destinations as root and Spain and France as children.
- VERY IMPORTANT: Look at existing tests for examples and how we write tests. It will also show you which helpers to use.
- DON'T EVER .skip an existing test. If you can't fix it, let it fail and ask for help.
- Don't do html access in tests, use aria-labels
- When writing tests, we prefer to use await findBy instead of queryBy. We prefer to test for one element with full aria label then multiple elements. We prefer to find concrete elements over expect(foo.length).toBe(2)
- prefer expectTree over extractNodes in tests
- Use `textContent("My Notes >>> Source")` helper to find elements whose text spans multiple DOM nodes (e.g. `>>>` in a bold span). Use `getPane(0).getByText(...)` to scope queries to a specific pane. If you encounter tests doing `screen.getByText("some text")` with pane-specific content or multi-span text, update them to use these helpers.
- Use `getPane(paneIndex)` helper instead of manual `within(document.querySelector(...))` to scope test queries to a specific split pane

### Write Integration Tests, Not Unit Tests with Mocked Contexts

BAD - Unit test with mocked ViewContext and fake node IDs:
```tsx
const viewPath: ViewPath = [
  0,
  { nodeID: "fakeRoot" as LongID, nodeIndex: 0 as NodeIndex },
  { nodeID: refId, nodeIndex: 0 as NodeIndex },
];
renderWithTestData(
  <ViewContext.Provider value={viewPath}>
    <FullscreenButton />
  </ViewContext.Provider>
);
```

GOOD - Integration test that creates real nodes and tests real behavior:
```tsx
renderTree(bob);
await userEvent.type(
  await findNewNodeEditor(),
  "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Escape}"
);
// ... setup alice, follow bob ...
renderTree(alice);
await userEvent.click(
  await screen.findByLabelText("open Holiday Destinations in fullscreen")
);
await screen.findByLabelText("Navigate to My Notes"); // verify breadcrumb
```

Key principles:
- Tests start with empty editor (findNewNodeEditor) and type to create nodes
- Use renderTree(user) or renderApp(user()) to render the full app
- Verify behavior through UI (aria-labels, expectTree) not internal state
- Each test creates its own data by typing, no shared setup with pre-existing nodes
- Test the actual user flow, not isolated components with mocked contexts

# Workflow Orchestration

## Architecture File

- Maintain an "architecture.md" file in the root of the repo.
- Read that file before starting a task and update it whenever you have learnings about the system architecture or whenever we make architectural decisions.

## Plan Mode Default
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

## Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

## Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

## Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

## Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

## Bug Fixes

- If linter, tests or typescript fails. Don't ask "Did I break this in this branch?", just fix it.

# Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimat Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

