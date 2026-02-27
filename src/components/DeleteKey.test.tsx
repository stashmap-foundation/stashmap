import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  findNewNodeEditor,
  follow,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  setup,
  type,
} from "../utils.test";

/* eslint-disable testing-library/no-node-access */
async function expectFocusedNode(name: string): Promise<void> {
  await waitFor(() => {
    const active = document.activeElement;
    expect(active).toBeInstanceOf(HTMLElement);
    const item = (active as HTMLElement).closest(
      '.item[data-row-focusable="true"]'
    );
    expect(item?.getAttribute("data-node-text")).toBe(name);
  });
}
/* eslint-enable testing-library/no-node-access */

describe("Delete key", () => {
  test("Delete key removes focused node from tree", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");

    await expectTree(`
Root
  A
  B
  C
    `);

    await userEvent.click(await screen.findByLabelText("edit B"));
    await userEvent.keyboard("{Escape}{Delete}");

    await expectTree(`
Root
  A
  C
    `);
  });

  test("Backspace key removes focused node from tree", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");

    await expectTree(`
Root
  A
  B
  C
    `);

    await userEvent.click(await screen.findByLabelText("edit B"));
    await userEvent.keyboard("{Escape}{Backspace}");

    await expectTree(`
Root
  A
  C
    `);
  });

  test("batch delete with selection", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");

    await expectTree(`
Root
  A
  B
  C
  D
    `);

    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Escape} jj {Delete}");

    await expectTree(`
Root
  B
  D
    `);
  });

  test("delete cleans up orphaned descendant relations", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Child{Enter}{Tab}GrandChild{Escape}"
    );

    await expectTree(`
Root
  Parent
    Child
      GrandChild
    `);

    const splitPaneButtons = screen.getAllByLabelText("open in split pane");
    await userEvent.click(splitPaneButtons[0]);
    await navigateToNodeViaSearch(1, "Child");

    await expectTree(`
Root
  Parent
    Child
      GrandChild
Child
  GrandChild
    `);

    await userEvent.click(screen.getAllByLabelText("edit Parent")[0]);
    await userEvent.keyboard("{Escape}{Delete}");

    await expectTree(`
Root
Child
    `);
  });

  test("deleting ~Versions does not delete orphaned descendant relations", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Barcelona{Escape}");

    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor, { relatedTarget: document.body });

    await expectTree(`
My Notes
  BCN
    `);

    await userEvent.click(await screen.findByLabelText("edit BCN"));
    await userEvent.keyboard("{Enter}");
    const newEditor = await findNewNodeEditor();
    await userEvent.type(newEditor, "~Versions");
    await userEvent.click(newEditor);
    await userEvent.keyboard("{Home}{Tab}");

    await expectTree(`
My Notes
  BCN
    ~Versions
    `);

    await userEvent.click(await screen.findByLabelText("expand ~Versions"));

    await expectTree(`
My Notes
  BCN
    ~Versions
      BCN
      Barcelona
    `);

    await userEvent.click(await screen.findByLabelText("edit ~Versions"));
    await userEvent.keyboard("{Escape}{Delete}");

    await waitFor(() => {
      expect(screen.queryByText("~Versions")).toBeNull();
    });

    await expectTree(`
My Notes
  BCN
    `);

    const bcnEditor = await screen.findByLabelText("edit BCN");
    await userEvent.click(bcnEditor);
    await userEvent.clear(bcnEditor);
    await userEvent.type(bcnEditor, "Barcelona");
    fireEvent.blur(bcnEditor, { relatedTarget: document.body });

    await expectTree(`
My Notes
  Barcelona
    `);
  });

  test("delete root node resets pane to empty", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}Child{Escape}");

    await expectTree(`
My Notes
  Child
    `);

    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Escape}{Delete}");

    await findNewNodeEditor();
    expect(screen.queryByText("My Notes")).toBeNull();
    expect(screen.queryByText("Child")).toBeNull();
  });

  test("delete root cleans up descendant relations", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Parent{Enter}{Tab}Child{Escape}");

    await expectTree(`
Root
  Parent
    Child
    `);

    const splitPaneButtons = screen.getAllByLabelText("open in split pane");
    await userEvent.click(splitPaneButtons[0]);
    await navigateToNodeViaSearch(1, "Child");

    await expectTree(`
Root
  Parent
    Child
Child
    `);

    await userEvent.click(screen.getAllByLabelText("edit Root")[0]);
    await userEvent.keyboard("{Escape}{Delete}");

    await waitFor(() => {
      expect(screen.queryByText("Root")).toBeNull();
      expect(screen.queryByText("Parent")).toBeNull();
      expect(screen.queryByText("Child")).toBeNull();
    });
  });

  test("cannot delete other user's root", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    await follow(alice, bob().user.publicKey);

    renderTree(bob);
    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Spain{Escape}"
    );

    await expectTree(`
My Notes
  Holiday Destinations
    Spain
    `);

    cleanup();

    renderTree(alice);
    await type("My Notes{Escape}");

    await expectTree(`
My Notes
  [S] Holiday Destinations
    `);

    await userEvent.click(
      await screen.findByLabelText("open Holiday Destinations in fullscreen")
    );

    await expectTree(`
[O] Holiday Destinations
  [O] Spain
    `);

    await userEvent.keyboard("j{Delete}");

    await expectTree(`
[O] Holiday Destinations
  [O] Spain
    `);
  });

  test("delete on empty page is no-op", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await findNewNodeEditor();

    await userEvent.keyboard("{Escape}{Delete}");

    await findNewNodeEditor();
  });

  test("other split pane viewing same root gets reset", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Child{Escape}");

    await expectTree(`
Root
  Child
    `);

    await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);

    const collapseButtons = await screen.findAllByLabelText("collapse Root");
    expect(collapseButtons.length).toBe(2);

    await userEvent.click(screen.getAllByLabelText("edit Root")[0]);
    await userEvent.keyboard("{Escape}{Delete}");

    await waitFor(() => {
      expect(screen.queryByText("Root")).toBeNull();
      expect(screen.queryByText("Child")).toBeNull();
    });
  });

  test("multiselect including root — root deletion wins", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");

    await expectTree(`
Root
  A
  B
    `);

    await userEvent.click(await screen.findByLabelText("edit Root"));
    await userEvent.keyboard("{Escape} j {Delete}");

    await waitFor(() => {
      expect(screen.queryByText("Root")).toBeNull();
      expect(screen.queryByText("A")).toBeNull();
      expect(screen.queryByText("B")).toBeNull();
    });

    await findNewNodeEditor();
  });

  test("delete middle node focuses next node", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");

    await userEvent.click(await screen.findByLabelText("edit B"));
    await userEvent.keyboard("{Escape}{Delete}");

    await expectTree(`
Root
  A
  C
    `);
    await expectFocusedNode("C");
  });

  test("delete last node focuses previous node", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Escape}");

    await userEvent.click(await screen.findByLabelText("edit C"));
    await userEvent.keyboard("{Escape}{Delete}");

    await expectTree(`
Root
  A
  B
    `);
    await expectFocusedNode("B");
  });

  test("batch delete focuses first node after last deleted", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");

    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Escape} jj {Delete}");

    await expectTree(`
Root
  B
  D
    `);
    await expectFocusedNode("D");
  });

  test("batch delete at end focuses last surviving node", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Enter}C{Enter}D{Escape}");

    await userEvent.click(await screen.findByLabelText("edit C"));
    await userEvent.keyboard("{Escape} j {Delete}");

    await expectTree(`
Root
  A
  B
    `);
    await expectFocusedNode("B");
  });

  test("alt-dragged cref shows deleted after ancestor deletion", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("A{Enter}{Tab}B{Enter}{Tab}C{Enter}{Tab}D{Enter}{Tab}E{Escape}");

    await expectTree(`
A
  B
    C
      D
        E
    `);

    await userEvent.click(await screen.findByLabelText("Open new pane"));

    const newEditor = await findNewNodeEditor();
    await userEvent.type(newEditor, "My links{Escape}");

    await expectTree(`
A
  B
    C
      D
        E
My links
    `);

    const myLinksItem = screen.getAllByRole("treeitem", {
      name: "My links",
    });
    const myLinksInPane1 = myLinksItem[myLinksItem.length - 1];

    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(screen.getAllByText("E")[0]);
    fireEvent.dragOver(myLinksInPane1, { altKey: true });
    fireEvent.drop(myLinksInPane1, { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await expectTree(`
A
  B
    C
      D
        E
My links
  [R] A / B / C / D / E
    `);

    await userEvent.click(screen.getAllByLabelText("edit C")[0]);
    await userEvent.keyboard("{Escape}{Delete}");

    await expectTree(`
A
  B
My links
  [D] (deleted) A / B / C / D / E
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
A
  B
My links
  [D] (deleted) A / B / C / D / E
    `);
  });

  test("alt-dragged cref deleted after refresh then ancestor deletion", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("A{Enter}{Tab}B{Enter}{Tab}C{Enter}{Tab}D{Enter}{Tab}E{Escape}");

    await userEvent.click(await screen.findByLabelText("Open new pane"));

    const newEditor = await findNewNodeEditor();
    await userEvent.type(newEditor, "My links{Escape}");

    const myLinksItems = screen.getAllByRole("treeitem", {
      name: "My links",
    });
    const myLinksInPane1 = myLinksItems[myLinksItems.length - 1];

    await userEvent.keyboard("{Alt>}");
    fireEvent.dragStart(screen.getAllByText("E")[0]);
    fireEvent.dragOver(myLinksInPane1, { altKey: true });
    fireEvent.drop(myLinksInPane1, { altKey: true });
    await userEvent.keyboard("{/Alt}");

    await expectTree(`
A
  B
    C
      D
        E
My links
  [R] A / B / C / D / E
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
A
  B
    C
      D
        E
My links
  [R] A / B / C / D / E
    `);

    await userEvent.click(screen.getAllByLabelText("edit C")[0]);
    await userEvent.keyboard("{Escape}{Delete}");

    await expectTree(`
A
  B
My links
  [D] (deleted) A / B / C / D / E
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
A
  B
My links
  [D] (deleted) A / B / C / D / E
    `);
  });
});
