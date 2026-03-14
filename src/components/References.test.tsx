import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  follow,
  getPane,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
  type,
} from "../utils.test";

describe("References", () => {
  test("Occurrence does not show when duplicate node only exists elsewhere in the same tree", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "Knowstr{Enter}{Tab}Is there a place for a Notekeeping tool in an AI world?{Enter}{Tab}Which AIs would I personally want?{Enter}{Tab}Project Specific AIs{Enter}{Tab}Knowstr{Escape}"
    );

    await expectTree(`
Knowstr
  Is there a place for a Notekeeping tool in an AI world?
    Which AIs would I personally want?
      Project Specific AIs
        Knowstr
    `);
  });

  test("Other user's version shows as suggestion and version entry", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(alice);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Alice child{Escape}"
    );
    cleanup();

    renderTree(bob);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Bob child{Escape}"
    );
    cleanup();

    renderTree(alice);
    await expectTree(`
Notes
  Cities
    Barcelona
      Alice child
      [S] Bob child
    `);
  });

  test("Clicking version fullscreen opens with that author's content", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(alice);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Alice child{Escape}"
    );
    cleanup();

    renderTree(bob);
    await type(
      "Notes{Enter}Cities{Enter}{Tab}Barcelona{Enter}{Tab}Bob child{Enter}Bob2{Enter}Bob3{Enter}Bob4{Escape}"
    );
    cleanup();

    renderTree(alice);
    await userEvent.click(
      await screen.findByLabelText(/open .* \+4 -1 in fullscreen/)
    );

    await expectTree(`
[O] Barcelona
  [O] Bob child
  [O] Bob2
  [O] Bob3
  [O] Bob4
  [VO] +1 -4
    `);
  });

  test("Concrete reference paths never show Loading text", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Notes{Enter}Level1{Enter}{Tab}Level2{Enter}{Tab}Level3{Enter}{Tab}Target{Escape}"
    );
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Other{Enter}{Tab}Target{Enter}{Tab}Child{Escape}");

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
    await navigateToNodeViaSearch(1, "Notes");
    await userEvent.click(getPane(1).getByLabelText("expand Level1"));
    await userEvent.click(getPane(1).getByLabelText("expand Level2"));
    await userEvent.click(getPane(1).getByLabelText("expand Level3"));

    const source = getPane(1).getByRole("treeitem", { name: "Target" });
    const target = getPane(0).getByRole("treeitem", { name: "Target" });

    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(source);
    fireEvent.dragOver(target, { altKey: true });
    fireEvent.drop(target, { altKey: true });
    await userEvent.keyboard("{/Alt}");
    await userEvent.click(getPane(1).getByLabelText("Close pane"));

    await expectTree(`
Other
  Target
    [R] Notes / Level1 / Level2 / Level3 / Target
    Child
    `);

    expect(screen.queryByText(/Loading/)).toBeNull();
  });

  test("Deleted relation shows (deleted) indicator in ~Log", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}Child{Escape}");

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  [R] My Notes
    `);

    await userEvent.click(await screen.findByText("My Notes"));

    await expectTree(`
My Notes
  Child
    `);

    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Escape}{Delete}");

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  [D] (deleted) My Notes
    `);

    cleanup();
    renderApp(alice());

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  [D] (deleted) My Notes
    `);
  });

  test("Deleted nested relation shows context path in ~Log", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Investment{Enter}{Tab}Alternative{Enter}{Tab}Bitcoin{Escape}");

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  [R] Investment
    `);

    await userEvent.click(await screen.findByText("Investment"));

    await expectTree(`
Investment
  Alternative
    Bitcoin
    `);

    await userEvent.click(await screen.findByLabelText("edit Investment"));
    await userEvent.keyboard("{Escape}{Delete}");

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  [D] (deleted) Investment
    `);

    cleanup();
    renderApp(alice());

    await userEvent.click(await screen.findByLabelText("Navigate to Log"));

    await expectTree(`
~Log
  [D] (deleted) Investment
    `);
  });
});
