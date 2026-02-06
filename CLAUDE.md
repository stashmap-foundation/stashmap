# Remember

- To run typescript use: npm run typescript
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
