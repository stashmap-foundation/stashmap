# Remember

- To run typescript use: npm run typescript
- Reuse code! If you find yourself copying and pasting code, consider refactoring it into a reusable function or component.
- We program purely functional, don't use let or var, only const.
- Don't add any comments to the code, except when they are really necessary, which is very rare. Code should be self-explanatory. Don't add any comments where you tell me waht you are doing.

## Testing

- In order to create test data, just use the keyboard. For example, Holiday Destinations{Enter}{Tab}Spain{Enter}France{Enter} will create a nice Tree with Holiday Destinations as root and Spain and France as children.
- VERY IMPORTANT: Look at existing tests for examples and how we write tests. It will also show you which helpers to use.
- DON'T EVER .skip an existing test. If you can't fix it, let it fail and ask for help.
- Don't do html access in tests, use aria-labels
- When writing tests, we prefer to use await findBy instead of queryBy. We prefer to test for one element with full aria label then multiple elements. We prefer to find concrete elements over expect(foo.length).toBe(2)
- prefer expectTree over extractNodes in tests
