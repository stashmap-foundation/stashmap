import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { knowstrInit, knowstrSave, write } from "../testFixtures/workspace";
import { renderAppTree } from "../appTestUtils.test";
import { expectTree, navigateToNodeViaSearch } from "../utils.test";

test("opening a workspace from the empty state shows its markdown content as a tree", async () => {
  const { path } = knowstrInit();
  write(
    path,
    "holidays.md",
    `
# Holiday Destinations
- Spain
- France
`
  );
  await knowstrSave(path);

  const { ipc } = await renderAppTree({ empty: true });
  ipc.queuePickedFolder(path);

  await userEvent.click(
    await screen.findByLabelText("Open Folder as Workspace")
  );

  await navigateToNodeViaSearch(0, "Holiday Destinations");

  await expectTree(`
Holiday Destinations
  Spain
  France
`);
});
