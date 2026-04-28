import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  setup,
  renderApp,
  type,
  expectTree,
  getPane,
  navigateToNodeViaSearch,
} from "../utils.test";

describe("Back Button", () => {
  test("back button hidden when no navigation history", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}Child{Escape}");

    await expectTree(`
My Notes
  Child
    `);

    expect(screen.queryByLabelText("Go back")).toBeNull();
  });

  test("back button appears after navigating into fullscreen", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}Child{Escape}");

    await userEvent.click(
      await screen.findByLabelText("open Child in fullscreen")
    );

    await expectTree(`
Child
    `);

    await screen.findByLabelText("Go back");
  });

  test("back navigates to previous view, not just parent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}A{Enter}{Tab}B{Escape}");

    await expectTree(`
My Notes
  A
    B
    `);

    await userEvent.click(await screen.findByLabelText("open A in fullscreen"));

    await expectTree(`
A
  B
    `);

    await userEvent.click(await screen.findByLabelText("open B in fullscreen"));

    await expectTree(`
B
    `);

    await userEvent.click(await screen.findByLabelText("Go back"));

    await expectTree(`
A
  B
    `);

    await userEvent.click(await screen.findByLabelText("Go back"));

    await expectTree(`
My Notes
  A
    B
    `);
  });

  test("back after breadcrumb jump restores deep view", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}A{Enter}{Tab}B{Enter}{Tab}C{Escape}");

    await userEvent.click(await screen.findByLabelText("open A in fullscreen"));

    await expectTree(`
A
  B
    `);

    await userEvent.click(await screen.findByLabelText("open B in fullscreen"));

    await expectTree(`
B
  C
    `);

    await userEvent.click(await screen.findByLabelText("open C in fullscreen"));

    await expectTree(`
C
    `);

    await userEvent.click(await screen.findByLabelText("Navigate to My Notes"));

    await expectTree(`
My Notes
  A
    B
      C
    `);

    await userEvent.click(await screen.findByLabelText("Go back"));

    await expectTree(`
C
    `);
  });

  test("back button hidden after exhausting history", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}Child{Escape}");

    await userEvent.click(
      await screen.findByLabelText("open Child in fullscreen")
    );

    await expectTree(`
Child
    `);

    await screen.findByLabelText("Go back");

    await userEvent.click(await screen.findByLabelText("Go back"));

    await expectTree(`
My Notes
  Child
    `);

    expect(screen.queryByLabelText("Go back")).toBeNull();
  });

  test("per-pane independence in multi-pane layout", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}A{Enter}{Tab}B{Escape}");

    await userEvent.click(
      (
        await screen.findAllByLabelText("open in split pane")
      )[0]
    );

    await navigateToNodeViaSearch(1, "A");

    await userEvent.click(getPane(1).getByLabelText("open B in fullscreen"));

    await expectTree(`
My Notes
  A
    B
B
    `);

    await userEvent.click(getPane(0).getByLabelText("open A in fullscreen"));

    await expectTree(`
A
  B
B
    `);

    getPane(0).getByLabelText("Go back");
    getPane(1).getByLabelText("Go back");

    await userEvent.click(getPane(0).getByLabelText("Go back"));

    await expectTree(`
My Notes
  A
    B
B
    `);

    expect(getPane(0).queryByLabelText("Go back")).toBeNull();
    getPane(1).getByLabelText("Go back");
  });
});
