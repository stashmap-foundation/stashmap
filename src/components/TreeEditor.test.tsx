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

    test("Empty Enter on root empty node closes editor without creating", async () => {
      const [alice] = setup([ALICE], {
        panes: [{ id: "pane-0", stack: [], author: ALICE.publicKey }],
      });
      renderTree(alice);

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "{Enter}");

      expect(screen.queryByLabelText("new node editor")).toBeNull();
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
    test("Create first child using plus button on root", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Root "My Notes" is already visible and expanded
      await screen.findByLabelText("collapse My Notes");

      // Click edit and press Enter to add a child
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      // Type and submit with Enter
      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "First Child{Enter}");

      // Close the chained editor with Escape
      const nextEditor = await findNewNodeEditor();
      await userEvent.type(nextEditor, "{Escape}");

      await expectTree(`
My Notes
  First Child
      `);
    });

    test("Create multiple siblings with Enter chaining", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      // Create three nodes in sequence using Enter chaining
      await userEvent.type(await findNewNodeEditor(), "Node 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Node 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Node 3{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

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

      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      // Press Enter on empty editor
      await userEvent.type(await findNewNodeEditor(), "{Enter}");

      // Tree should still just have root
      await expectTree(`
My Notes
      `);
    });

    test("Escape on empty editor closes without creating node", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
      `);
    });

    test("Escape with text saves the node", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      await userEvent.type(
        await findNewNodeEditor(),
        "Saved by Escape{Escape}"
      );

      await expectTree(`
My Notes
  Saved by Escape
      `);
    });
  });

  describe("Enter on Expanded Node - Insert at BEGINNING", () => {
    test("Enter on expanded node - editor appears BEFORE existing children", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create Parent with children
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child A{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child B{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Press Enter on expanded Parent - editor should appear BEFORE children
      const parentEditor = await screen.findByLabelText("edit Parent");
      await userEvent.click(parentEditor);
      await userEvent.keyboard("{Enter}");

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "New First");

      // Editor should be BEFORE Child A and Child B
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

      // Create Parent node
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand Parent and add children
      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "Child A{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child B{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Parent
    Child A
    Child B
      `);

      // Press Enter on expanded Parent
      const parentEditor = await screen.findByLabelText("edit Parent");
      await userEvent.click(parentEditor);
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "New First Child{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // New node should be FIRST child
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

      // Create siblings
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "Node 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Node 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Node 3{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Press Enter on Node 2 - editor should appear after Node 2
      const node2Editor = await screen.findByLabelText("edit Node 2");
      await userEvent.click(node2Editor);
      await userEvent.keyboard("{Enter}");

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "New Node");

      // Editor should be after Node 2 and before Node 3
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

      // Create siblings
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "Node 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Node 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Node 3{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Node 1
  Node 2
  Node 3
      `);

      // Press Enter on Node 2 (collapsed, no children)
      const node2Editor = await screen.findByLabelText("edit Node 2");
      await userEvent.click(node2Editor);
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "After Node 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // New node should be after Node 2
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

      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Second{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Press Enter on First
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

      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Last{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Press Enter on Last
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

      // First create Parent with existing children
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand Parent and add children A and B
      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child A{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child B{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Collapse Parent, then Enter to get sibling editor, then Tab to indent
      await userEvent.click(await screen.findByLabelText("collapse Parent"));
      const parentEditor = await screen.findByLabelText("edit Parent");
      await userEvent.click(parentEditor);
      await userEvent.keyboard("{Enter}");

      // Tab to indent under Parent
      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "New Child");
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      await userEvent.keyboard("{Tab}");

      // Tab materializes and moves the node - it appears AFTER Child B
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

      // Create Parent with a child using proper Enter chaining
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");

      // Chained editor is in afterSibling position - Tab to indent under Parent
      const editor1 = await findNewNodeEditor();
      await userEvent.type(editor1, "Existing Child");

      // Move cursor to start and Tab to indent under Parent
      const range1 = document.createRange();
      range1.selectNodeContents(editor1);
      range1.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range1);
      await userEvent.keyboard("{Tab}");

      // Tab materializes and moves Existing Child under Parent (auto-expands)
      await expectTree(`
My Notes
  Parent
    Existing Child
      `);

      // Collapse Parent, then add a sibling after it (via edit + Enter on collapsed Parent)
      await userEvent.click(await screen.findByLabelText("collapse Parent"));
      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");
      const editor2 = await findNewNodeEditor();
      await userEvent.type(editor2, "Second Child");

      // Move cursor to start and Tab - should go to END of Parent's children
      const range2 = document.createRange();
      range2.selectNodeContents(editor2);
      range2.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range2);
      await userEvent.keyboard("{Tab}");

      // Both children should be under Parent
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

      // Create an empty parent (no children)
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Empty Parent{Enter}");

      // Tab to indent under Empty Parent
      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "First Child");

      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      await userEvent.keyboard("{Tab}");

      // Tab materializes and moves the node under Empty Parent
      await expectTree(`
My Notes
  Empty Parent
    First Child
      `);
    });

    test("Tab on new editor to empty node (no children) creates first child", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create an empty parent (no children)
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Empty Parent{Enter}");

      // Now we're in editor for sibling - Tab to indent under Empty Parent
      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "First Child");

      // Move cursor to start and Tab
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      await userEvent.keyboard("{Tab}");

      // Tab materializes and moves the node under Empty Parent
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

      // Create two siblings
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Second{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  First
  Second
      `);

      // Edit "Second" and Tab at start to move it under "First"
      const secondEditor = await screen.findByLabelText("edit Second");
      await userEvent.click(secondEditor);

      // Move cursor to start
      const range = document.createRange();
      range.selectNodeContents(secondEditor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      await userEvent.keyboard("{Tab}");

      // Wait for move to complete - Second should now be under First (level 2)
      // Tab auto-expands the target node, so Second should be visible immediately
      await expectTree(`
My Notes
  First
    Second
      `);
    });

    test("Tab on existing node with previous sibling that has children - goes to END", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create First with children, then Second
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Second{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand First and add children
      await userEvent.click(await screen.findByLabelText("expand First"));
      await userEvent.click(await screen.findByLabelText("edit First"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child A{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child B{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  First
    Child A
    Child B
  Second
      `);

      // Tab on Second to move under First
      const secondEditor = await screen.findByLabelText("edit Second");
      await userEvent.click(secondEditor);

      const range = document.createRange();
      range.selectNodeContents(secondEditor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      await userEvent.keyboard("{Tab}");

      // Second should be at END of First's children
      await expectTree(`
My Notes
  First
    Child A
    Child B
    Second
      `);
    });
  });

  describe("Plus Button Behavior", () => {
    test("Plus button on expanded node - editor appears BEFORE existing children", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create Parent with children
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Click edit and Enter on expanded Parent - editor should appear BEFORE children
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

    test("Plus button on expanded node with children opens editor at BEGINNING", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create Parent with children
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand and add children
      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Parent
    Child 1
      `);

      // Click edit and Enter on expanded Parent (which now has collapse button)
      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "New First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // New node should be at BEGINNING
      await expectTree(`
My Notes
  Parent
    New First
    Child 1
      `);
    });

    test("Plus button on collapsed node adds sibling after it", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create a node
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Node{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Node
      `);

      // Click edit and Enter on collapsed Node - adds sibling after (not child)
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

    test("Plus button on root node adds child", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await screen.findByLabelText("collapse My Notes");

      // Click edit and Enter on root
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Root Child{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Root Child
      `);
    });
  });

  describe("Deep Nesting", () => {
    test("Create deeply nested structure", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      // Create Level 1
      await userEvent.type(await findNewNodeEditor(), "Level 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand Level 1 and create Level 2
      await userEvent.click(await screen.findByLabelText("expand Level 1"));
      await userEvent.click(await screen.findByLabelText("edit Level 1"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Level 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand Level 2 and create Level 3
      await userEvent.click(await screen.findByLabelText("expand Level 2"));
      await userEvent.click(await screen.findByLabelText("edit Level 2"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Level 3{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

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

      // Create nested structure: Parent > Child > Grandchild
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("edit Parent"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await userEvent.click(await screen.findByLabelText("expand Child"));
      await userEvent.click(await screen.findByLabelText("edit Child"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Grandchild 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Grandchild 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Parent
    Child
      Grandchild 1
      Grandchild 2
      `);

      // Press Enter on expanded Child - new node at BEGINNING
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

      // Create two siblings
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Second{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  First
  Second
      `);

      // Click to edit Second
      const secondEditor = await screen.findByLabelText("edit Second");
      await userEvent.click(secondEditor);

      // Move cursor to END (not start)
      const range = document.createRange();
      range.selectNodeContents(secondEditor);
      range.collapse(false); // false = collapse to end
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      // Tab should do nothing when cursor is not at start
      await userEvent.keyboard("{Tab}");

      // Tree should remain unchanged
      await expectTree(`
My Notes
  First
  Second
      `);
    });

    test("Tab on first child (no previous sibling) does nothing", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create a single child
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Only Child{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Only Child
      `);

      // Click to edit Only Child (it's the first/only child, no previous sibling)
      const onlyChildEditor = await screen.findByLabelText("edit Only Child");
      await userEvent.click(onlyChildEditor);

      // Move cursor to start
      const range = document.createRange();
      range.selectNodeContents(onlyChildEditor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      // Tab should do nothing (no previous sibling to indent under)
      await userEvent.keyboard("{Tab}");

      // Tree should remain unchanged
      await expectTree(`
My Notes
  Only Child
      `);
    });

    test("Tab on existing node - previous sibling has NO children - becomes first child", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create two siblings where First has NO children
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Empty Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Will Move{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Empty Parent
  Will Move
      `);

      // Tab on Will Move to indent under Empty Parent
      const willMoveEditor = await screen.findByLabelText("edit Will Move");
      await userEvent.click(willMoveEditor);

      const range = document.createRange();
      range.selectNodeContents(willMoveEditor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      await userEvent.keyboard("{Tab}");

      // Will Move should now be FIRST (and only) child of Empty Parent
      await expectTree(`
My Notes
  Empty Parent
    Will Move
      `);
    });

    test("Tab on existing node - previous sibling HAS children - goes to END", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create Parent with children, then a sibling
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(
        await findNewNodeEditor(),
        "Parent With Kids{Enter}"
      );
      await userEvent.type(await findNewNodeEditor(), "Will Move{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Add children to Parent With Kids
      await userEvent.click(
        await screen.findByLabelText("expand Parent With Kids")
      );
      await userEvent.click(
        await screen.findByLabelText("edit Parent With Kids")
      );
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child A{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child B{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
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

      // Will Move should now be LAST child (after Child B)
      await expectTree(`
My Notes
  Parent With Kids
    Child A
    Child B
    Will Move
      `);
    });

    test("editing node text and pressing Tab to indent persists both changes", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      const myNotesEditor = await screen.findByLabelText("edit My Notes");
      await userEvent.click(myNotesEditor);
      await userEvent.keyboard("{Enter}");
      await userEvent.type(
        await findNewNodeEditor(),
        "Sibling{Enter}Sibling 2{Escape}"
      );

      await expectTree(`
My Notes
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
My Notes
  Sibling
    Child
      `);

      cleanup();
      renderTree(alice);

      await expectTree(`
My Notes
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

      // First add some children to root using plus button
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Child 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Child 1
  Child 2
      `);

      // Now press Enter on root node (My Notes) - should create child at beginning
      const rootEditor = await screen.findByLabelText("edit My Notes");
      await userEvent.click(rootEditor);
      await userEvent.keyboard("{Enter}");

      // New editor should appear before Child 1
      await userEvent.type(
        await findNewNodeEditor(),
        "New First Child{Escape}"
      );

      await expectTree(`
My Notes
  New First Child
  Child 1
  Child 2
      `);
    });

    test("Enter on direct child of root creates sibling after it", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create children under root
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Second{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  First
  Second
      `);

      // Press Enter on First - should create sibling after it
      const firstEditor = await screen.findByLabelText("edit First");
      await userEvent.click(firstEditor);
      await userEvent.keyboard("{Enter}");

      await userEvent.type(await findNewNodeEditor(), "After First{Escape}");

      await expectTree(`
My Notes
  First
  After First
  Second
      `);
    });

    test("Enter on root creates child when second pane is open", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      // Create a child first
      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Existing Child{Escape}");

      await expectTree(`
My Notes
  Existing Child
      `);

      // Open My Notes in a second pane
      await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);

      // Wait for second pane - tree shows both panes
      await expectTree(`
My Notes
  Existing Child
My Notes
  Existing Child
      `);

      // Press Enter on root in the first pane to create new child
      const rootEditors = await screen.findAllByLabelText("edit My Notes");
      await userEvent.click(rootEditors[0]);
      await userEvent.keyboard("{Enter}");

      // New node editor should appear in both panes, but only pane 0 has autoFocus
      const editors = await screen.findAllByLabelText("new node editor");
      expect(editors).toHaveLength(2);
      await userEvent.type(editors[0], "New Child{Escape}");

      // Both panes should show the new child
      await expectTree(`
My Notes
  New Child
  Existing Child
My Notes
  New Child
  Existing Child
      `);
    });
  });

  describe("Edge Cases", () => {
    test("Rapid Enter creates multiple siblings in correct order", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      // Rapid creation
      await userEvent.type(await findNewNodeEditor(), "Item 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Item 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Item 3{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Item 4{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Item 5{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
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

      await screen.findByLabelText("collapse My Notes");
      await userEvent.click(await screen.findByLabelText("edit My Notes"));
      await userEvent.keyboard("{Enter}");

      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "Saved by Blur");
      fireEvent.blur(editor);

      await expectTree(`
My Notes
  Saved by Blur
      `);
    });
  });
});
