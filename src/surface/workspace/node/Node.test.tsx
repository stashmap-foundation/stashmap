import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Event } from "nostr-tools";
import { KIND_KNOWLEDGE_DOCUMENT } from "../../../infra/nostrCore";
import {
  ALICE,
  setup,
  expectTree,
  renderApp,
  renderTree,
  findNewNodeEditor,
  type,
} from "../../../tests/testutils";

test("Edit nested node inline", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Nested Node{Escape}");

  await expectTree(`
My Notes
  Parent
    Nested Node
  `);

  const nestedEditor = await screen.findByLabelText("edit Nested Node");
  await userEvent.click(nestedEditor);
  await userEvent.clear(nestedEditor);
  await userEvent.type(nestedEditor, "My edited Note{Escape}");

  await screen.findByLabelText("edit My edited Note");
});

test("Edited node is shown in Tree View", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  await type("My Notes{Enter}{Tab}OOP Languages{Enter}{Tab}Java{Escape}");

  const javaEditor = await screen.findByLabelText("edit Java");
  await userEvent.clear(javaEditor);
  await userEvent.type(javaEditor, "C++{Escape}");

  await expectTree(`
My Notes
  OOP Languages
    C++
  `);

  cleanup();
  renderTree(alice);

  await expectTree(`
My Notes
  OOP Languages
    C++
  `);
});

// Tests for inline node creation via keyboard
describe("Inline Node Creation", () => {
  test("leaf nodes keep spacing and become expandable after first child", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Root{Enter}{Tab}Leaf{Escape}");

    expect(screen.queryByLabelText("expand Leaf")).toBeNull();
    expect(screen.queryByLabelText("collapse Leaf")).toBeNull();

    const leafEditor = await screen.findByLabelText("edit Leaf");
    expect(screen.queryByText("•")).toBeNull();

    await userEvent.click(leafEditor);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Child{Escape}");

    const childEditor = await screen.findByLabelText("edit Child");
    await userEvent.click(childEditor);
    const range = document.createRange();
    range.selectNodeContents(childEditor);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await userEvent.keyboard("{Tab}");

    await screen.findByLabelText(/expand Leaf|collapse Leaf/);
  });

  test("Create new sibling node by pressing Enter on existing node", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}First Child{Escape}");

    await expectTree(`
My Notes
  First Child
    `);

    // Click on First Child and press Enter to create sibling
    const childEditor = await screen.findByLabelText("edit First Child");
    await userEvent.click(childEditor);
    await userEvent.keyboard("{Enter}");

    // Verify empty editor appeared after First Child
    await expectTree(`
My Notes
  First Child
  [NEW NODE]
    `);

    // Type the new node text
    await userEvent.type(await findNewNodeEditor(), "Second Child");

    await expectTree(`
My Notes
  First Child
  [NEW NODE: Second Child]
    `);

    // Press Enter to save and create another sibling
    await userEvent.keyboard("{Enter}");

    await expectTree(`
My Notes
  First Child
  Second Child
  [NEW NODE]
    `);

    // Close the editor
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  First Child
  Second Child
    `);
  });

  test("Create multiple sibling nodes by pressing Enter repeatedly", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Node 1{Escape}");

    // Click on Node 1 and press Enter to start chaining
    const node1Editor = await screen.findByLabelText("edit Node 1");
    await userEvent.click(node1Editor);
    await userEvent.keyboard("{Enter}");

    // Create Node 2, 3, 4 by chaining Enter
    await userEvent.type(await findNewNodeEditor(), "Node 2{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Node 3{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Node 4{Escape}");

    await expectTree(`
My Notes
  Node 1
  Node 2
  Node 3
  Node 4
    `);
  });

  test("Empty Enter keeps new editor visible when outdent is unavailable", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Existing Child{Escape}");

    await expectTree(`
My Notes
  Existing Child
    `);

    // Click on Existing Child and press Enter to open editor
    const childEditor = await screen.findByLabelText("edit Existing Child");
    await userEvent.click(childEditor);
    await userEvent.keyboard("{Enter}");

    await expectTree(`
My Notes
  Existing Child
  [NEW NODE]
    `);

    // Press Enter without typing anything - keeps editor visible
    await userEvent.type(await findNewNodeEditor(), "{Enter}");

    // Empty editor remains in place
    await expectTree(`
My Notes
  Existing Child
  [NEW NODE]
    `);
  });

  test("Creating node via UI sends correct Nostr events", async () => {
    const [alice] = setup([ALICE]);
    const utils = alice();

    // Reset relay pool to track only new events
    utils.relayPool.resetPublishedOnRelays();

    renderTree(alice);

    await type("My Notes{Enter}{Tab}Child{Escape}");

    // Reset again to only track sibling creation events
    utils.relayPool.resetPublishedOnRelays();

    // Click on Child and press Enter to create sibling
    const childEditor = await screen.findByLabelText("edit Child");
    await userEvent.click(childEditor);
    await userEvent.keyboard("{Enter}");

    // Type in the new editor and save with Escape
    await userEvent.type(await findNewNodeEditor(), "New Sibling{Escape}");

    // Wait for the new node to appear
    await screen.findByLabelText("edit New Sibling");

    // Verify a document event was sent with the newly created sibling.
    const events = utils.relayPool.getEvents();
    const documentEvents = events.filter(
      (e: Event) => e.kind === KIND_KNOWLEDGE_DOCUMENT
    );
    const eventWithSibling = documentEvents.find((e: Event) =>
      e.content.includes("New Sibling")
    );
    expect(documentEvents.length).toBeGreaterThan(0);
    expect(eventWithSibling).toBeTruthy();
  });

  test("Enter on expanded parent inserts new child at BEGINNING of list", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child 1{Enter}Child 2{Escape}"
    );

    await expectTree(`
My Notes
  Parent
    Child 1
    Child 2
    `);

    // Click on expanded Parent and press Enter - should open editor at BEGINNING
    const parentEditor = await screen.findByLabelText("edit Parent");
    await userEvent.click(parentEditor);
    await userEvent.keyboard("{Enter}");

    // Type and save
    await userEvent.type(await findNewNodeEditor(), "New First Child{Escape}");

    // Verify tree order: New First Child should be first among children
    await expectTree(`
My Notes
  Parent
    New First Child
    Child 1
    Child 2
    `);
  });

  test("Create sibling with renderApp (full app integration)", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("My Notes{Enter}{Tab}First Child{Escape}");

    await expectTree(`
My Notes
  First Child
    `);

    // Click on First Child and press Enter to create sibling
    const childEditor = await screen.findByLabelText("edit First Child");
    await userEvent.click(childEditor);
    await userEvent.keyboard("{Enter}");

    // Verify empty editor appeared after First Child
    await expectTree(`
My Notes
  First Child
  [NEW NODE]
    `);

    // Type the new node text and save
    await userEvent.type(await findNewNodeEditor(), "Second Child{Escape}");

    await expectTree(`
My Notes
  First Child
  Second Child
    `);
  });
});
