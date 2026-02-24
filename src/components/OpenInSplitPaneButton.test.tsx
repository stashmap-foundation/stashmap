import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  setup,
  renderApp,
  type,
  expectTree,
  navigateToNodeViaSearch,
} from "../utils.test";

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

test("open reference node in split pane uses reference path", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Escape}"
  );
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("Countries in Europe{Enter}{Tab}Spain{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Spain"));
  await expectTree(`
Countries in Europe
  Spain
    [C] My Notes / Holiday Destinations / Spain
  `);

  const splitButtons = await screen.findAllByLabelText("open in split pane");
  await userEvent.click(splitButtons[splitButtons.length - 1]);

  await expectTree(`
Countries in Europe
  Spain
    [C] My Notes / Holiday Destinations / Spain
Holiday Destinations
  Spain
  `);
});
