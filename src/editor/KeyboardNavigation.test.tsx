import fs from "fs";
import os from "os";
import pathModule from "path";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ALICE, expectTree, renderApp, setup, type } from "../utils.test";
import { renderAppTree } from "../appTestUtils.test";
import { write } from "../testFixtures/workspace";
import { buildDocumentRouteUrl } from "../navigationUrl";
import { LOCAL } from "../core/nodeRef";

async function renderNestedFilesystemTree(): Promise<void> {
  const workspacePath = fs.mkdtempSync(
    pathModule.join(os.tmpdir(), "knowstr-expand-subtree-")
  );
  write(
    workspacePath,
    "nested.md",
    [
      "# Root <!-- id:root -->",
      "",
      "- A <!-- id:a -->",
      "  - A1 <!-- id:a1 -->",
      "    - A2 <!-- id:a2 -->",
      "- B <!-- id:b -->",
      "  - B1 <!-- id:b1 -->",
      "",
    ].join("\n")
  );
  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, "nested.md"),
  });
  await screen.findByRole("treeitem", { name: "Root" });
}

describe("Keyboard Navigation", () => {
  test("normal mode pane shortcuts: N new note, P new pane, q close pane", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    await userEvent.keyboard("N");
    await screen.findByLabelText("new node editor");
    await userEvent.type(
      await screen.findByLabelText("new node editor"),
      "Second{Escape}"
    );

    await userEvent.keyboard("P");
    await screen.findByLabelText("Search to change pane 1 content");
    const newNoteButtons = await screen.findAllByLabelText("Create new note");
    await userEvent.click(newNoteButtons[1]);
    await userEvent.keyboard("q");

    await waitFor(() => {
      expect(
        screen.queryByLabelText("Search to change pane 1 content")
      ).toBeNull();
    });
  });

  test("keyboard shortcuts work immediately after reload", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    cleanup();
    renderApp(alice());

    await userEvent.keyboard("N");
    await screen.findByLabelText("new node editor");
  });

  test("normal mode j/k + Enter moves focus and opens editor", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await userEvent.keyboard("ggj{Enter} changed{Escape}");
    await screen.findByLabelText(/edit (?=.*A)(?=.*changed).*/i);
  });

  test("ArrowDown and ArrowUp in insert mode move editing to adjacent nodes", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    const editorA = await screen.findByLabelText("edit A");

    await userEvent.click(editorA);
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Control>}a{/Control}moved");
    await userEvent.keyboard("{ArrowUp}");
    await userEvent.keyboard("{Control>}a{/Control}up{Escape}");
    await expectTree(`
Root
  up
  moved
      `);
  });

  test("Cmd+Down expands every descendant of the focused root", async () => {
    await renderNestedFilesystemTree();
    await expectTree(`
Root
  A
  B
    `);

    await userEvent.click(
      await screen.findByRole("treeitem", { name: "Root" })
    );
    await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

    await expectTree(`
Root
  A
    A1
      A2
  B
    B1
    `);
  });

  test("Cmd+Down expands only the focused row's descendants", async () => {
    await renderNestedFilesystemTree();
    await expectTree(`
Root
  A
  B
    `);

    await userEvent.click(await screen.findByRole("treeitem", { name: "A" }));
    await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

    await expectTree(`
Root
  A
    A1
      A2
  B
    `);
  });

  test("Cmd+Up collapses the focused root and every descendant", async () => {
    await renderNestedFilesystemTree();
    await userEvent.click(
      await screen.findByRole("treeitem", { name: "Root" })
    );
    await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
    await expectTree(`
Root
  A
    A1
      A2
  B
    B1
    `);

    await userEvent.click(
      await screen.findByRole("treeitem", { name: "Root" })
    );
    await userEvent.keyboard("{Meta>}{ArrowUp}{/Meta}");
    await expectTree(`
Root
    `);

    await userEvent.click(
      await screen.findByRole("treeitem", { name: "Root" })
    );
    await userEvent.keyboard("{ArrowRight}");
    await expectTree(`
Root
  A
  B
    `);
  });

  test("Cmd+Up collapses only the focused subtree", async () => {
    await renderNestedFilesystemTree();
    await userEvent.click(
      await screen.findByRole("treeitem", { name: "Root" })
    );
    await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

    await userEvent.click(await screen.findByRole("treeitem", { name: "A" }));
    await userEvent.keyboard("{Meta>}{ArrowUp}{/Meta}");
    await expectTree(`
Root
  A
  B
    B1
    `);

    await userEvent.click(await screen.findByRole("treeitem", { name: "A" }));
    await userEvent.keyboard("{ArrowRight}");
    await expectTree(`
Root
  A
    A1
  B
    B1
    `);
  });

  test("Escape after editing returns focus to the same row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Escape}");
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Control>}a{/Control}updated{Escape}");
    await expectTree(`
Root
  updated
      `);
    await userEvent.keyboard("{Enter}bc{Escape}");
    await screen.findByLabelText(/edit (?=.*updated)(?=.*b)(?=.*c).*/i);
  });

  test("Escape after creating a new node keeps focus on that new row", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await userEvent.type(
      await screen.findByLabelText("new node editor"),
      "Fresh node{Escape}"
    );
    await userEvent.keyboard("{Enter} again{Escape}");
    await screen.findByLabelText(/edit (?=.*Fresh node)(?=.*again).*/i);
  });

  test("Escape after Tab indent keeps focus on the moved node", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}B{Escape}");
    await userEvent.click(await screen.findByLabelText("edit B"));
    await userEvent.keyboard("{Home}{Tab}{Escape}{Enter} moved{Escape}");
    await expectTree(`
Root
  A
    movedB
    `);
  });

  test("Shift+Tab outdents node at cursor start", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Enter}{Tab}B{Escape}");
    await userEvent.click(await screen.findByLabelText("edit B"));
    await userEvent.keyboard("{Home}{Shift>}{Tab}{/Shift}");

    await expectTree(`
Root
  A
  B
    `);
  });

  test("x marks current node as not relevant and filter key 4 shows it again", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Escape}");
    await userEvent.click(await screen.findByLabelText("edit A"));
    await userEvent.keyboard("{Escape}x");
    await waitFor(() => {
      expect(screen.queryByText("A")).toBeNull();
    });

    await userEvent.keyboard("4");
    const notRelevantFilter = await screen.findByLabelText(
      "toggle Not Relevant filter"
    );
    expect(notRelevantFilter.getAttribute("aria-pressed")).toBe("true");
  });

  test("f-prefixed symbols toggle pane filters", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    const relevantFilter = await screen.findByLabelText(
      "toggle Relevant filter"
    );

    expect(relevantFilter.getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("f!");
    expect(relevantFilter.getAttribute("aria-pressed")).toBe("false");

    await userEvent.keyboard("f!");
    expect(relevantFilter.getAttribute("aria-pressed")).toBe("true");
  });

  test("z opens current row in fullscreen", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}A{Escape}");
    await userEvent.keyboard("ggjz");
    await screen.findByLabelText("Navigate to Root");
  });

  test("Escape closes keyboard shortcuts modal opened with F1", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Escape}");
    await userEvent.keyboard("{F1}");
    await screen.findByLabelText("keyboard shortcuts");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByLabelText("keyboard shortcuts")).toBeNull();
    });
  });

  test("H navigates to home (~Log) in normal mode", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Escape}");
    await userEvent.keyboard("H");
    await screen.findByLabelText("collapse ~Log");
  });
});
