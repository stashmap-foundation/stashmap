import { expectMarkdown, ls } from "../testFixtures/workspace";
import { renderAppTree } from "../appTestUtils.test";
import { expectTree, findNewNodeEditor, type } from "../utils.test";

test("typing in the editor writes markdown files to the workspace", async () => {
  const { path } = await renderAppTree();
  if (!path) {
    throw new Error("expected renderAppTree to return a workspace path");
  }
  await findNewNodeEditor();

  await type("Holiday Destinations{Enter}{Tab}Spain{Enter}France{Escape}");

  await expectTree(`
Holiday Destinations
  Spain
  France
`);

  await expectMarkdown(
    path,
    "holiday-destinations.md",
    `
# Holiday Destinations <!-- id:... -->

- Spain <!-- id:... -->
- France <!-- id:... -->
`
  );
  expect(ls(path)).toEqual(["holiday-destinations.md", "log.md"]);
});
