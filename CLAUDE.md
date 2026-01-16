# Remember

- To run typescript use: npm run typescript
- Don't skip tests if they fail
- Don't do html access in tests, use aria-labels
- When writing tests, we prefer to use await findBy instead of queryBy. We prefer to test for one element with full aria label then multiple elements. We prefer to find concrete elements over expect(foo.length).toBe(2)
