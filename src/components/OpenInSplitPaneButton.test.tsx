import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  setup,
  renderApp,
  type,
  expectTree,
  navigateToNodeViaSearch,
} from "../utils.test";

async function setupHeadLevelReferenceInSecondPane(): Promise<void> {
  await type("Root{Enter}Source{Enter}Target{Enter}OtherParent{Escape}");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(1, "Target");

  const targetTreeItems = screen.getAllByRole("treeitem", { name: "Target" });
  const targetInPane1 = targetTreeItems[targetTreeItems.length - 1];

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(screen.getAllByText("Source")[0]);
  fireEvent.dragOver(targetInPane1, { altKey: true });
  fireEvent.drop(targetInPane1, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  await expectTree(`
Root
  Source
  Target
  OtherParent
Target
  [R] Root / Source
  `);
}

test("open in split pane creates a new pane with the node content", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  await expectTree(`
My Notes
  Cities
    Paris
    London
  `);

  await userEvent.click(
    (
      await screen.findAllByLabelText("open in split pane")
    )[0]
  );

  await navigateToNodeViaSearch(1, "Cities");

  await screen.findByLabelText("Search to change pane 0 content");
  await screen.findByLabelText("Search to change pane 1 content");
});

test("open reference row in split pane uses reference path", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Escape}"
  );

  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(
    await screen.findByLabelText("search input"),
    "Spain{Enter}"
  );

  await expectTree(`
Search: Spain
  [R] My Notes / Holiday Destinations / Spain
  `);

  const splitButtons = await screen.findAllByLabelText("open in split pane");
  await userEvent.click(splitButtons[splitButtons.length - 1]);

  await expectTree(`
Search: Spain
  [R] My Notes / Holiday Destinations / Spain
Holiday Destinations
  Spain
  `);
});

test("clicking a head-level reference opens its parent node", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await setupHeadLevelReferenceInSecondPane();

  await userEvent.click(screen.getByLabelText("Navigate to Root / Source"));

  await expectTree(`
Root
  Source
  Target
  OtherParent
Root
  Source
  Target
  OtherParent
  `);
});

test("open head-level reference in split pane uses parent node route", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await setupHeadLevelReferenceInSecondPane();

  const splitButtons = screen.getAllByLabelText("open in split pane");
  await userEvent.click(splitButtons[splitButtons.length - 1]);

  await expectTree(`
Root
  Source
  Target
  OtherParent
Target
  [R] Root / Source
Root
  Source
  Target
  OtherParent
  `);
});
