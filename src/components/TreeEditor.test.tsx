import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  setup,
  findNewNodeEditor,
  expectTree,
  renderTree,
  renderApp,
  createAndSetAsRoot,
  type,
} from "../utils.test";

describe("Tree Editor - Comprehensive Tests", () => {
  describe("Root Empty Node Flow", () => {
    test("Create node from empty pane and press Enter to chain", async () => {
      const [alice] = setup([ALICE], {
        panes: [{ id: "pane-0", stack: [], author: ALICE.publicKey }],
      });
      renderTree(alice);

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "My First Note{Enter}");

      const chainedEditor = await findNewNodeEditor();
      await userEvent.type(chainedEditor, "Second Note{Escape}");

      await expectTree(`
My First Note
  Second Note
      `);
    });

    test("Empty Enter on root empty node keeps editor visible", async () => {
      const [alice] = setup([ALICE], {
        panes: [{ id: "pane-0", stack: [], author: ALICE.publicKey }],
      });
      renderTree(alice);

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "{Enter}");

      await screen.findByLabelText("new node editor");
    });

    test("Escape on root empty node with text saves and closes", async () => {
      const [alice] = setup([ALICE], {
        panes: [{ id: "pane-0", stack: [], author: ALICE.publicKey }],
      });
      renderTree(alice);

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "Saved Note{Escape}");

      await expectTree(`
Saved Note
      `);
    });
  });

  describe("Basic Node Creation", () => {
    test("Create first child with Enter on root", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("My Notes{Enter}{Tab}First Child{Escape}");

      await expectTree(`
My Notes
  First Child
      `);
    });

    test("Create multiple siblings with Enter chaining", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type(
        "My Notes{Enter}{Tab}Node 1{Enter}Node 2{Enter}Node 3{Escape}"
      );

      await expectTree(`
My Notes
  Node 1
  Node 2
  Node 3
      `);
    });

    test("Empty Enter closes editor without creating node", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Parent{Enter}{Tab}{Enter}");

      await expectTree(`
Parent
      `);
    });

    test("Escape on empty editor closes without creating node", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Parent{Enter}{Tab}{Escape}");

      await expectTree(`
Parent
      `);
    });

    test("Escape with text saves the node", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Parent{Enter}{Tab}Saved by Escape{Escape}");

      await expectTree(`
Parent
  Saved by Escape
      `);
    });
  });

  describe("Enter on Expanded Node - Insert at BEGINNING", () => {
    test("Enter on expanded node - editor appears BEFORE existing children", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type(
        "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child A{Enter}Child B{Escape}"
      );

      await expectTree(`
My Notes
  Parent
    Child A
    Child B
      `);

      const parentEditor = await screen.findByLabelText("edit Parent");
      await userEvent.click(parentEditor);
      await userEvent.keyboard("{Enter}");

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "New First");

      await expectTree(`
My Notes
  Parent
    [NEW NODE: New First]
    Child A
    Child B
      `);

      await userEvent.type(editor, "{Escape}");
    });

    test("Enter on expanded node inserts new child at BEGINNING", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type(
        "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child A{Enter}Child B{Escape}"
      );

      await expectTree(`
My Notes
  Parent
    Child A
    Child B
      `);

      const parentEditor = await screen.findByLabelText("edit Parent");
      await userEvent.click(parentEditor);
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "New First Child{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Parent
    New First Child
    Child A
    Child B
      `);
    });
  });

  describe("Enter on Collapsed Node - Insert as Sibling AFTER", () => {
    test("Enter on collapsed node - editor appears AFTER the node", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type(
        "My Notes{Enter}{Tab}Node 1{Enter}Node 2{Enter}Node 3{Escape}"
      );

      const node2Editor = await screen.findByLabelText("edit Node 2");
      await userEvent.click(node2Editor);
      await userEvent.keyboard("{Enter}");

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "New Node");

      await expectTree(`
My Notes
  Node 1
  Node 2
  [NEW NODE: New Node]
  Node 3
      `);

      await userEvent.type(editor, "{Escape}");
    });

    test("Enter on collapsed node inserts sibling after it", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type(
        "My Notes{Enter}{Tab}Node 1{Enter}Node 2{Enter}Node 3{Escape}"
      );

      await expectTree(`
My Notes
  Node 1
  Node 2
  Node 3
      `);

      const node2Editor = await screen.findByLabelText("edit Node 2");
      await userEvent.click(node2Editor);
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "After Node 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Node 1
  Node 2
  After Node 2
  Node 3
      `);
    });

    test("Enter on first sibling inserts after it", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("My Notes{Enter}{Tab}First{Enter}Second{Escape}");

      const firstEditor = await screen.findByLabelText("edit First");
      await userEvent.click(firstEditor);
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "After First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  First
  After First
  Second
      `);
    });

    test("Enter on last sibling inserts after it", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("My Notes{Enter}{Tab}First{Enter}Last{Escape}");

      const lastEditor = await screen.findByLabelText("edit Last");
      await userEvent.click(lastEditor);
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "After Last{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  First
  Last
  After Last
      `);
    });
  });

  describe("Tab Indent in New Editor - Insert at END of new parent", () => {
    test("Tab on new editor - editor visually appears AFTER existing children", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type(
        "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child A{Enter}Child B{Escape}"
      );

      await userEvent.click(await screen.findByLabelText("collapse Parent"));
      const parentEditor = await screen.findByLabelText("edit Parent");
      await userEvent.click(parentEditor);
      await userEvent.keyboard("{Enter}");

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "New Child");
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      await userEvent.keyboard("{Tab}");

      await expectTree(`
My Notes
  Parent
    Child A
    Child B
    New Child
      `);
    });

    test("Tab on new editor indents to previous sibling (which has children)", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("My Notes{Enter}{Tab}Parent{Enter}");

      const editor1 = await findNewNodeEditor();
      await userEvent.type(editor1, "Existing Child");

      const range1 = document.createRange();
      range1.selectNodeContents(editor1);
      range1.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range1);
      await userEvent.keyboard("{Tab}");

      await expectTree(`
My Notes
  Parent
    Existing Child
      `);

      await userEvent.click(await screen.findByLabelText("collapse Parent"));
      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");
      const editor2 = await findNewNodeEditor();
      await userEvent.type(editor2, "Second Child");

      const range2 = document.createRange();
      range2.selectNodeContents(editor2);
      range2.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range2);
      await userEvent.keyboard("{Tab}");

      await expectTree(`
My Notes
  Parent
    Existing Child
    Second Child
      `);
    });

    test("Tab on new editor to empty node - editor appears as first child", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("My Notes{Enter}{Tab}Empty Parent{Enter}");

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "First Child");

      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      await userEvent.keyboard("{Tab}");

      await expectTree(`
My Notes
  Empty Parent
    First Child
      `);
    });

    test("Tab on new editor to empty node (no children) creates first child", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("My Notes{Enter}{Tab}Empty Parent{Enter}");

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "First Child");

      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      await userEvent.keyboard("{Tab}");

      await expectTree(`
My Notes
  Empty Parent
    First Child
      `);
    });
  });

  describe("Tab on Existing Node - Move to Previous Sibling's Children", () => {
    test("Tab while editing existing node moves it under previous sibling", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("My Notes{Enter}{Tab}First{Enter}Second{Escape}");

      await expectTree(`
My Notes
  First
  Second
      `);

      const secondEditor = await screen.findByLabelText("edit Second");
      await userEvent.click(secondEditor);

      const range = document.createRange();
      range.selectNodeContents(secondEditor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      await userEvent.keyboard("{Tab}");

      await expectTree(`
My Notes
  First
    Second
      `);
    });

    test("Tab on existing node with previous sibling that has children - goes to END", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type(
        "My Notes{Enter}{Tab}First{Enter}{Tab}Child A{Enter}Child B{Escape}"
      );

      await userEvent.click(await screen.findByLabelText("collapse First"));
      await userEvent.click(await screen.findByLabelText("edit First"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Second{Escape}");

      await userEvent.click(await screen.findByLabelText("expand First"));

      await expectTree(`
My Notes
  First
    Child A
    Child B
  Second
      `);

      const secondEditor = await screen.findByLabelText("edit Second");
      await userEvent.click(secondEditor);

      const range = document.createRange();
      range.selectNodeContents(secondEditor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      await userEvent.keyboard("{Tab}");

      await expectTree(`
My Notes
  First
    Child A
    Child B
    Second
      `);
    });
  });

  describe("Enter on Node Behavior", () => {
    test("Enter on expanded node - editor appears BEFORE existing children", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type(
        "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child 1{Enter}Child 2{Escape}"
      );

      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "New First");

      await expectTree(`
My Notes
  Parent
    [NEW NODE: New First]
    Child 1
    Child 2
      `);

      await userEvent.type(editor, "{Escape}");
    });

    test("Enter on expanded node with children opens editor at BEGINNING", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("My Notes{Enter}{Tab}Parent{Enter}{Tab}Child 1{Escape}");

      await expectTree(`
My Notes
  Parent
    Child 1
      `);

      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "New First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Parent
    New First
    Child 1
      `);
    });

    test("Enter on collapsed node adds sibling after it", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("My Notes{Enter}{Tab}Node{Escape}");

      await expectTree(`
My Notes
  Node
      `);

      await userEvent.click(await screen.findByLabelText("edit Node"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Sibling{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Node
  Sibling
      `);
    });

    test("Enter on root node adds child", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Parent{Enter}{Tab}Child{Escape}");

      await expectTree(`
Parent
  Child
      `);
    });
  });

  describe("Deep Nesting", () => {
    test("Create deeply nested structure", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type(
        "My Notes{Enter}{Tab}Level 1{Enter}{Tab}Level 2{Enter}{Tab}Level 3{Escape}"
      );

      await expectTree(`
My Notes
  Level 1
    Level 2
      Level 3
      `);
    });

    test("Enter on deeply nested expanded node inserts at beginning", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type(
        "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child{Enter}{Tab}Grandchild 1{Enter}Grandchild 2{Escape}"
      );

      await expectTree(`
My Notes
  Parent
    Child
      Grandchild 1
      Grandchild 2
      `);

      const childEditor = await screen.findByLabelText("edit Child");
      await userEvent.click(childEditor);
      await userEvent.keyboard("{Enter}");

      await userEvent.type(
        await findNewNodeEditor(),
        "New First Grandchild{Enter}"
      );
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Parent
    Child
      New First Grandchild
      Grandchild 1
      Grandchild 2
      `);
    });
  });

  describe("Tab on Edit - Detailed Behavior", () => {
    test("Tab on existing node with cursor NOT at start does nothing", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Parent{Enter}{Tab}First{Enter}Second{Escape}");

      await expectTree(`
Parent
  First
  Second
      `);

      const secondEditor = await screen.findByLabelText("edit Second");
      await userEvent.click(secondEditor);

      const range = document.createRange();
      range.selectNodeContents(secondEditor);
      range.collapse(false);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      await userEvent.keyboard("{Tab}");

      await expectTree(`
Parent
  First
  Second
      `);
    });

    test("Tab on first child (no previous sibling) does nothing", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Parent{Enter}{Tab}Only Child{Escape}");

      await expectTree(`
Parent
  Only Child
      `);

      const onlyChildEditor = await screen.findByLabelText("edit Only Child");
      await userEvent.click(onlyChildEditor);

      const range = document.createRange();
      range.selectNodeContents(onlyChildEditor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      await userEvent.keyboard("{Tab}");

      await expectTree(`
Parent
  Only Child
      `);
    });

    test("Tab on existing node - previous sibling has NO children - becomes first child", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Parent{Enter}{Tab}Empty Parent{Enter}Will Move{Escape}");

      await expectTree(`
Parent
  Empty Parent
  Will Move
      `);

      const willMoveEditor = await screen.findByLabelText("edit Will Move");
      await userEvent.click(willMoveEditor);

      const range = document.createRange();
      range.selectNodeContents(willMoveEditor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      await userEvent.keyboard("{Tab}");

      await expectTree(`
Parent
  Empty Parent
    Will Move
      `);
    });

    test("Tab on existing node - previous sibling HAS children - goes to END", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Root{Enter}{Tab}Parent With Kids{Enter}Will Move{Escape}");
      await userEvent.click(
        await screen.findByLabelText("expand Parent With Kids")
      );
      await userEvent.click(
        await screen.findByLabelText("edit Parent With Kids")
      );
      await userEvent.keyboard("{Enter}");
      await userEvent.type(
        await findNewNodeEditor(),
        "Child A{Enter}Child B{Escape}"
      );

      await expectTree(`
Root
  Parent With Kids
    Child A
    Child B
  Will Move
      `);

      // Tab on Will Move
      const willMoveEditor = await screen.findByLabelText("edit Will Move");
      await userEvent.click(willMoveEditor);

      const range = document.createRange();
      range.selectNodeContents(willMoveEditor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      await userEvent.keyboard("{Tab}");

      await expectTree(`
Root
  Parent With Kids
    Child A
    Child B
    Will Move
      `);
    });

    test("editing node text and pressing Tab to indent persists both changes", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Parent{Enter}{Tab}Sibling{Enter}Sibling 2{Escape}");

      await expectTree(`
Parent
  Sibling
  Sibling 2
      `);

      const sibling2Editor = await screen.findByLabelText("edit Sibling 2");
      await userEvent.click(sibling2Editor);
      await userEvent.clear(sibling2Editor);
      await userEvent.type(sibling2Editor, "Child");

      // Verify the editor text changed by checking its content
      expect(sibling2Editor.textContent).toBe("Child");

      const range = document.createRange();
      range.selectNodeContents(sibling2Editor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      await userEvent.keyboard("{Tab}");

      await expectTree(`
Parent
  Sibling
    Child
      `);

      cleanup();
      renderTree(alice);

      await expectTree(`
Parent
  Sibling
    Child
      `);
    });
  });

  describe("Operations with Different Root (not My Notes)", () => {
    test("Create children under custom root", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await createAndSetAsRoot("Custom Root");

      // Now Custom Root is the top-level node
      await expectTree(`
Custom Root
      `);

      // Add children using plus button
      await userEvent.click(await screen.findByLabelText("edit Custom Root"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
Custom Root
  Child 1
  Child 2
      `);
    });

    test("Enter on collapsed child creates sibling (custom root)", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await createAndSetAsRoot("Custom Root");

      // Add children
      await userEvent.click(await screen.findByLabelText("edit Custom Root"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "A{Enter}");
      await userEvent.type(await findNewNodeEditor(), "B{Enter}");
      await userEvent.type(await findNewNodeEditor(), "C{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
Custom Root
  A
  B
  C
      `);

      // Press Enter on B (collapsed)
      const bEditor = await screen.findByLabelText("edit B");
      await userEvent.click(bEditor);
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "After B{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
Custom Root
  A
  B
  After B
  C
      `);
    });

    test("Enter on expanded child inserts at beginning (custom root)", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await createAndSetAsRoot("Custom Root");

      // Add a child and expand it
      await userEvent.click(await screen.findByLabelText("edit Custom Root"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Existing Child{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
Custom Root
  Parent
    Existing Child
      `);

      // Press Enter on expanded Parent
      const parentEditor = await screen.findByLabelText("edit Parent");
      await userEvent.click(parentEditor);
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "New First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
Custom Root
  Parent
    New First
    Existing Child
      `);
    });

    test("Tab indent works under custom root", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await createAndSetAsRoot("Custom Root");

      // Add siblings
      await userEvent.click(await screen.findByLabelText("edit Custom Root"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Second{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
Custom Root
  First
  Second
      `);

      // Tab on Second to indent under First
      const secondEditor = await screen.findByLabelText("edit Second");
      await userEvent.click(secondEditor);

      const range = document.createRange();
      range.selectNodeContents(secondEditor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      await userEvent.keyboard("{Tab}");

      await expectTree(`
Custom Root
  First
    Second
      `);
    });

    test("Tab in new editor works under custom root (sibling with children)", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await createAndSetAsRoot("Custom Root");

      // Create Parent with a child using Enter chaining + Tab
      await userEvent.click(await screen.findByLabelText("edit Custom Root"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");

      // Chained editor - Tab to indent under Parent
      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "First Child");

      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      await userEvent.keyboard("{Tab}");

      // After Tab on empty node, the empty node is replaced with real node "First Child"
      // Find the new editor for "First Child" and press Enter to chain
      const firstChildEditor = await screen.findByLabelText("edit First Child");
      await userEvent.type(firstChildEditor, "{Enter}");

      // Another child via chaining (already at correct level)
      await userEvent.type(await findNewNodeEditor(), "Second Child{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
Custom Root
  Parent
    First Child
    Second Child
      `);
    });

    test("Tab in new editor works under custom root (sibling without children)", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await createAndSetAsRoot("Custom Root");

      // Create Empty Parent, then Tab new editor to indent
      await userEvent.click(await screen.findByLabelText("edit Custom Root"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Empty Parent{Enter}");

      // Chained editor - Tab to indent under Empty Parent
      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "Becomes Child");

      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      await userEvent.keyboard("{Tab}");

      // After Tab on empty node, the empty node is replaced with real node "Becomes Child"
      // Find the new editor for "Becomes Child" and press Enter to chain
      const becomesChildEditor = await screen.findByLabelText(
        "edit Becomes Child"
      );
      await userEvent.type(becomesChildEditor, "{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
Custom Root
  Empty Parent
    Becomes Child
      `);
    });

    test("Plus button on collapsed child adds sibling (custom root)", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await createAndSetAsRoot("Custom Root");

      await userEvent.click(await screen.findByLabelText("edit Custom Root"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Target{Enter}");
      await userEvent.type(await findNewNodeEditor(), "After{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
Custom Root
  Target
  After
      `);

      // Click edit and Enter on collapsed Target
      await userEvent.click(await screen.findByLabelText("edit Target"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "New Sibling{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Should add as sibling after Target
      await expectTree(`
Custom Root
  Target
  New Sibling
  After
      `);
    });

    test("Deep nesting works under custom root", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await createAndSetAsRoot("Custom Root");

      // Create L1
      await userEvent.click(await screen.findByLabelText("edit Custom Root"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "L1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Create L2 under L1
      await userEvent.click(await screen.findByLabelText("expand L1"));
      await userEvent.click(await screen.findByLabelText("edit L1"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "L2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Create L3 under L2
      await userEvent.click(await screen.findByLabelText("expand L2"));
      await userEvent.click(await screen.findByLabelText("edit L2"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "L3{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
Custom Root
  L1
    L2
      L3
      `);
    });
  });

  describe("Root Node Operations", () => {
    test("Enter on root node creates child at beginning", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Root{Enter}{Tab}Child 1{Enter}Child 2{Escape}");

      await expectTree(`
Root
  Child 1
  Child 2
      `);

      const rootEditor = await screen.findByLabelText("edit Root");
      await userEvent.click(rootEditor);
      await userEvent.keyboard("{Enter}");
      await userEvent.type(
        await findNewNodeEditor(),
        "New First Child{Escape}"
      );

      await expectTree(`
Root
  New First Child
  Child 1
  Child 2
      `);
    });

    test("Enter on direct child of root creates sibling after it", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Root{Enter}{Tab}First{Enter}Second{Escape}");

      await expectTree(`
Root
  First
  Second
      `);

      const firstEditor = await screen.findByLabelText("edit First");
      await userEvent.click(firstEditor);
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "After First{Escape}");

      await expectTree(`
Root
  First
  After First
  Second
      `);
    });

    test("Enter on root creates child when second pane is open", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());
      await type("Root{Enter}Existing Child{Escape}");

      await expectTree(`
Root
  Existing Child
      `);

      await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
      await userEvent.click(await screen.findByLabelText("expand Root"));

      await expectTree(`
Root
  Existing Child
Root
  Existing Child
      `);

      const rootEditors = await screen.findAllByLabelText("edit Root");
      await userEvent.click(rootEditors[0]);
      await userEvent.keyboard("{Enter}");

      const editors = await screen.findAllByLabelText("new node editor");
      expect(editors).toHaveLength(2);
      await userEvent.type(editors[0], "New Child{Escape}");

      await expectTree(`
Root
  New Child
  Existing Child
Root
  New Child
  Existing Child
      `);
    });
  });

  describe("Edge Cases", () => {
    test("Rapid Enter creates multiple siblings in correct order", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type(
        "Root{Enter}{Tab}Item 1{Enter}Item 2{Enter}Item 3{Enter}Item 4{Enter}Item 5{Escape}"
      );

      await expectTree(`
Root
  Item 1
  Item 2
  Item 3
  Item 4
  Item 5
      `);
    });

    test("Blur saves node without chaining", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);
      await type("Root{Enter}{Tab}");

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "Saved by Blur");
      fireEvent.blur(editor);

      await expectTree(`
Root
  Saved by Blur
      `);
    });
  });
});
