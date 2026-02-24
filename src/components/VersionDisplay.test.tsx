import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  setup,
  expectTree,
  findNewNodeEditor,
  renderApp,
  renderTree,
  type,
} from "../utils.test";

const addChildViaTab = async (
  parentLabel: string,
  childText: string
): Promise<void> => {
  await userEvent.click(await screen.findByLabelText(`edit ${parentLabel}`));
  await userEvent.keyboard("{Enter}");
  const newNodeEditor = await findNewNodeEditor();
  await userEvent.type(newNodeEditor, childText);
  await userEvent.click(newNodeEditor);
  await userEvent.keyboard("{Home}{Tab}");
};

describe("Version Display", () => {
  test("Reference node displays versioned text in path", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Root1{Enter}{Tab}Barcelona{Enter}{Tab}Detail{Escape}");

    // Edit Barcelona to BCN
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor, { relatedTarget: document.body });

    await screen.findByLabelText("edit BCN");

    // Create second root referencing the same node (hashText("Barcelona"))
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Root2{Enter}{Tab}Barcelona{Enter}{Tab}Info{Escape}");

    // Incoming ref shows versioned text BCN from the source context
    await expectTree(`
Root2
  Barcelona
    Info
    [C] Root1 / BCN
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
Root2
  Barcelona
    Info
    [C] Root1 / BCN
    `);
  });

  test("Editing a node creates a version and displays the new text", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Barcelona{Escape}"
    );

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    `);

    // Now edit "Barcelona" to "BCN"
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor, { relatedTarget: document.body });

    // The tree should now show "BCN" instead of "Barcelona"
    await expectTree(`
My Notes
  Holiday Destinations
    BCN
    `);

    // Verify edit persists after re-render
    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
    `);
  });

  test("Multiple edits to the same node show the latest version", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Enter}{Tab}Version 1{Escape}");

    await expectTree(`
My Notes
  Version 1
    `);

    // Edit to Version 2
    const editor1 = await screen.findByLabelText("edit Version 1");
    await userEvent.click(editor1);
    await userEvent.clear(editor1);
    await userEvent.type(editor1, "Version 2");
    fireEvent.blur(editor1, { relatedTarget: document.body });

    await expectTree(`
My Notes
  Version 2
    `);

    // Edit to Version 3
    const editor2 = await screen.findByLabelText("edit Version 2");
    await userEvent.click(editor2);
    await userEvent.clear(editor2);
    await userEvent.type(editor2, "Version 3");
    fireEvent.blur(editor2, { relatedTarget: document.body });

    await expectTree(`
My Notes
  Version 3
    `);

    // Verify edits persist after re-render
    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Version 3
    `);
  });

  test("Creating a node with same text as existing sibling creates independent node", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Barcelona{Escape}"
    );

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    `);

    // Edit Barcelona to BCN
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor, { relatedTarget: document.body });

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
    `);

    await userEvent.click(
      await screen.findByLabelText("edit Holiday Destinations")
    );
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    BCN
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    BCN
    `);
  });

  test("~Versions list contains both original text and new version after first edit", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Barcelona{Escape}"
    );

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    `);

    // Edit Barcelona to BCN
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor, { relatedTarget: document.body });

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
    `);

    // Add ~Versions as a child via Tab indentation.
    await addChildViaTab("BCN", "~Versions");

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
      ~Versions
    `);

    // Expand ~Versions to see all versions
    await userEvent.click(await screen.findByLabelText("expand ~Versions"));

    // ~Versions should contain both BCN (current/top) and Barcelona (original)
    await expectTree(`
My Notes
  Holiday Destinations
    BCN
      ~Versions
        BCN
        Barcelona
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
      ~Versions
        BCN
        Barcelona
    `);
  });

  test("Editing a version inside ~Versions inserts new version at same position", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Barcelona{Escape}"
    );

    // Edit Barcelona to BCN (first edit)
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor, { relatedTarget: document.body });

    // Edit BCN to V3 (second edit)
    const bcnEditor = await screen.findByLabelText("edit BCN");
    await userEvent.click(bcnEditor);
    await userEvent.clear(bcnEditor);
    await userEvent.type(bcnEditor, "V3");
    fireEvent.blur(bcnEditor, { relatedTarget: document.body });

    // Now we have ~Versions: [V3, BCN, Barcelona]
    await addChildViaTab("V3", "~Versions");
    await userEvent.click(await screen.findByLabelText("expand ~Versions"));

    await expectTree(`
My Notes
  Holiday Destinations
    V3
      ~Versions
        V3
        BCN
        Barcelona
    `);

    // Now edit BCN (at position 1 inside ~Versions) to "BCN-updated"
    // BCN only appears inside ~Versions (parent shows "V3")
    const bcnInsideVersions = await screen.findByLabelText("edit BCN");
    await userEvent.click(bcnInsideVersions);
    await userEvent.clear(bcnInsideVersions);
    await userEvent.type(bcnInsideVersions, "BCN-updated");
    fireEvent.blur(bcnInsideVersions, { relatedTarget: document.body });

    // The new version should be inserted at the same position (1),
    // and BCN should shift down to position 2
    // Result: [V3, BCN-updated, BCN, Barcelona]
    await expectTree(`
My Notes
  Holiday Destinations
    V3
      ~Versions
        V3
        BCN-updated
        BCN
        Barcelona
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Holiday Destinations
    V3
      ~Versions
        V3
        BCN-updated
        BCN
        Barcelona
    `);
  });

  test("Pressing Enter while editing inside ~Versions opens editor at correct position", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Barcelona{Escape}"
    );

    // Edit Barcelona to BCN (first edit)
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor, { relatedTarget: document.body });

    // Edit BCN to V3 (second edit)
    const bcnEditor = await screen.findByLabelText("edit BCN");
    await userEvent.click(bcnEditor);
    await userEvent.clear(bcnEditor);
    await userEvent.type(bcnEditor, "V3");
    fireEvent.blur(bcnEditor, { relatedTarget: document.body });

    // Now we have ~Versions: [V3, BCN, Barcelona]
    await addChildViaTab("V3", "~Versions");
    await userEvent.click(await screen.findByLabelText("expand ~Versions"));

    await expectTree(`
My Notes
  Holiday Destinations
    V3
      ~Versions
        V3
        BCN
        Barcelona
    `);

    // Now edit BCN (at position 1 inside ~Versions) and press Enter
    // BCN only appears inside ~Versions (parent shows "V3")
    const bcnInsideVersions = await screen.findByLabelText("edit BCN");
    await userEvent.click(bcnInsideVersions);
    await userEvent.clear(bcnInsideVersions);
    await userEvent.type(bcnInsideVersions, "BCN-updated{Enter}");

    await expectTree(`
My Notes
  Holiday Destinations
    V3
      ~Versions
        V3
        BCN-updated
        [NEW NODE]
        BCN
        Barcelona
    `);

    // Close the editor
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Holiday Destinations
    V3
      ~Versions
        V3
        BCN-updated
        BCN
        Barcelona
    `);
  });

  test("Setting top version to not_relevant shows the previous version", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Barcelona{Escape}"
    );

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    `);

    // Edit Barcelona to BCN
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor, { relatedTarget: document.body });

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
    `);

    // Add ~Versions as a child via Tab indentation.
    await addChildViaTab("BCN", "~Versions");

    // Expand ~Versions to see all versions
    await userEvent.click(await screen.findByLabelText("expand ~Versions"));

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
      ~Versions
        BCN
        Barcelona
    `);

    // Mark the top version (BCN inside ~Versions) as not relevant
    // There are two "mark BCN as not relevant" buttons - parent and inside ~Versions
    const notRelevantButtons = await screen.findAllByLabelText(
      "mark BCN as not relevant"
    );
    // The second one is inside ~Versions
    fireEvent.click(notRelevantButtons[1]);

    // Now the display should fall back to showing Barcelona (the previous version)
    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
      ~Versions
        Barcelona
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
      ~Versions
        Barcelona
    `);
  });

  test("Reference path filters out ~Versions and deduplicates", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Holiday Destinations{Enter}{Tab}Barcelona{Enter}{Tab}Child1{Escape}"
    );
    await userEvent.click(await screen.findByLabelText("edit My Notes"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "Cities{Enter}{Tab}Barcelona{Enter}{Tab}Child2{Escape}"
    );

    // Edit Barcelona under Cities to BCN
    const barcelonaEditors = await screen.findAllByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditors[0]);
    await userEvent.clear(barcelonaEditors[0]);
    await userEvent.type(barcelonaEditors[0], "BCN");
    fireEvent.blur(barcelonaEditors[0], { relatedTarget: document.body });

    await screen.findByLabelText("edit BCN");

    // Create another root to see incoming refs from both contexts
    await userEvent.click(await screen.findByLabelText("Create new note"));
    await type("Other{Enter}{Tab}Barcelona{Enter}{Tab}Detail{Escape}");

    await expectTree(`
Other
  Barcelona
    Detail
    [C] My Notes / Cities / BCN
    [C] My Notes / Holiday Destinations / Barcelona
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
Other
  Barcelona
    Detail
    [C] My Notes / Cities / BCN
    [C] My Notes / Holiday Destinations / Barcelona
    `);
  });

  test("Manually adding ~Versions to a node without versions prepopulates with original", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "My Notes{Enter}{Tab}Original Text{Enter}{Tab}~Versions{Enter}{Tab}"
    );

    // ~Versions should be expanded and contain "Original Text" as the original version
    // Plus there should be an empty editor for the new node
    await expectTree(`
My Notes

    ~Versions
      [NEW NODE]
      Original Text
    `);
  });

  test("Editing root node persists after reload", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("My Notes{Escape}");

    await expectTree(`
My Notes
    `);

    const myNotesEditor = await screen.findByLabelText("edit My Notes");
    await userEvent.click(myNotesEditor);
    await userEvent.clear(myNotesEditor);
    await userEvent.type(myNotesEditor, "My Dashboard");
    fireEvent.blur(myNotesEditor, { relatedTarget: document.body });

    await expectTree(`
My Dashboard
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
My Dashboard
    `);
  });
});

describe("Duplicate node collision resolution", () => {
  test("Typing same text twice creates independent siblings", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Root{Enter}{Tab}Apple{Enter}{Tab}child of first{Escape}");

    await expectTree(`
Root
  Apple
    child of first
    `);

    await userEvent.click(await screen.findByLabelText("edit Root"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Apple{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
Root
  Apple
  Apple
    child of first
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
Root
  Apple
  Apple
    child of first
    `);
  });

  test("Data loss scenario: rename sibling then create same text", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type("Root{Enter}{Tab}Bugs:{Enter}{Tab}Login crash{Escape}");

    await expectTree(`
Root
  Bugs:
    Login crash
    `);

    const bugsEditor = await screen.findByLabelText("edit Bugs:");
    await userEvent.click(bugsEditor);
    await userEvent.clear(bugsEditor);
    await userEvent.type(bugsEditor, "Bugs (MVP)");
    fireEvent.blur(bugsEditor, { relatedTarget: document.body });

    await expectTree(`
Root
  Bugs (MVP)
    Login crash
    `);

    await userEvent.click(await screen.findByLabelText("edit Root"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Bugs:{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "{Tab}Signup error{Escape}"
    );

    await expectTree(`
Root
  Bugs:
    Signup error
  Bugs (MVP)
    Login crash
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
Root
  Bugs:
    Signup error
  Bugs (MVP)
    Login crash
    `);
  });

  test("DnD copy into parent with same-text sibling creates independent node", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Apple{Enter}{Tab}child A{Escape}");

    await expectTree(`
Root
  Apple
    child A
    `);

    await userEvent.click(await screen.findByLabelText("edit Root"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(await findNewNodeEditor(), "Basket{Escape}");

    await expectTree(`
Root
  Basket
  Apple
    child A
    `);

    await userEvent.click(await screen.findByLabelText("edit Basket"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "{Tab}Apple{Enter}{Tab}child B{Escape}"
    );

    await expectTree(`
Root
  Basket
    Apple
      child B
  Apple
    child A
    `);

    const innerApple = screen.getAllByRole("treeitem", { name: "Apple" })[0];
    const root = screen.getByRole("treeitem", { name: "Root" });

    fireEvent.dragStart(innerApple);
    fireEvent.drop(root);

    await expectTree(`
Root
  Apple
    child B
  Basket
  Apple
    child A
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Root
  Apple
    child B
  Basket
  Apple
    child A
    `);
  });

  test("Paste collision: paste text matching existing sibling creates independent node", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Item A{Enter}Item B{Escape}");

    await expectTree(`
Root
  Item A
  Item B
    `);

    const mockReadText = jest.fn();
    // eslint-disable-next-line functional/immutable-data
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    await userEvent.click(await screen.findByLabelText("Root"));
    mockReadText.mockResolvedValueOnce("Item A");
    await userEvent.keyboard("{Meta>}v{/Meta}");
    await screen.findAllByLabelText("Item A");

    await expectTree(`
Root
  Item A
  Item A
  Item B
    `);

    cleanup();
    renderApp(alice());

    await expectTree(`
Root
  Item A
  Item A
  Item B
    `);
  });

  test("Cmd+V paste collision: paste duplicates with different children next to existing", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}City{Enter}{Tab}Vienna{Escape}");

    await expectTree(`
Root
  City
    Vienna
    `);

    const mockReadText = jest.fn();
    // eslint-disable-next-line functional/immutable-data
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    await userEvent.click(await screen.findByLabelText("Root"));
    mockReadText.mockResolvedValueOnce("City\n\tParis");
    await userEvent.keyboard("{Meta>}v{/Meta}");

    await expectTree(`
Root
  City
  City
    Vienna
    `);

    await userEvent.click(await screen.findByLabelText("expand City"));

    await expectTree(`
Root
  City
    Paris
  City
    Vienna
    `);
  });

  test("Cmd+V paste: two same-name nodes with different children stay independent", async () => {
    const [alice] = setup([ALICE]);
    renderApp(alice());

    await type("Root{Enter}{Tab}Bitcoin{Enter}{Tab}Is Orange{Escape}");

    await expectTree(`
Root
  Bitcoin
    Is Orange
    `);

    await userEvent.click(await screen.findByLabelText("edit Root"));
    await userEvent.keyboard("{Enter}");
    await userEvent.type(
      await findNewNodeEditor(),
      "{Tab}Bitcoin{Enter}{Tab}Is Awesome{Escape}"
    );

    await expectTree(`
Root
  Bitcoin
    Is Awesome
  Bitcoin
    Is Orange
    `);

    const mockReadText = jest.fn();
    // eslint-disable-next-line functional/immutable-data
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: mockReadText },
      writable: true,
      configurable: true,
    });

    await userEvent.click(await screen.findByLabelText("Root"));
    mockReadText.mockResolvedValueOnce(
      "Bitcoin\n\thas only 21 Million\nBitcoin\n\tIs P2P"
    );
    await userEvent.keyboard("{Meta>}v{/Meta}");

    await screen.findAllByLabelText(/expand Bitcoin|collapse Bitcoin/);

    while (screen.queryAllByLabelText("expand Bitcoin").length > 0) {
      fireEvent.click(screen.getAllByLabelText("expand Bitcoin")[0]);
    }

    await expectTree(`
Root
  Bitcoin
    has only 21 Million
  Bitcoin
    Is P2P
  Bitcoin
    Is Awesome
  Bitcoin
    Is Orange
    `);
  });

  test("Tab indent creates independent child when sibling with same text exists", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    await type(
      "Root{Enter}{Tab}Parent{Enter}{Tab}Apple{Enter}{Tab}from first{Escape}"
    );

    await expectTree(`
Root
  Parent
    Apple
      from first
    `);

    await userEvent.click(await screen.findByLabelText("edit Parent"));
    await userEvent.keyboard("{Enter}");
    const newEditor = await findNewNodeEditor();
    await userEvent.type(newEditor, "Apple");
    await userEvent.click(newEditor);
    await userEvent.keyboard("{Escape}{Home}{Tab}");

    await expectTree(`
Root
  Parent
    Apple
    Apple
      from first
    `);

    cleanup();
    renderTree(alice);

    await expectTree(`
Root
  Parent
    Apple
    Apple
      from first
    `);
  });
});
