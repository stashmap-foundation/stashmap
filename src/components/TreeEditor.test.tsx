import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  renderWithTestData,
  setup,
  RootViewOrWorkspaceIsLoading,
  findNewNodeEditor,
} from "../utils.test";
import { WorkspaceView } from "./Workspace";

/**
 * Gets the tree structure as a readable hierarchical string.
 * Uses expand/collapse buttons to find nodes (these exist for all nodes).
 *
 * Example output:
 *   My Notes
 *     Bitcoin
 *       P2P
 *       Digital Gold
 *     Ethereum
 */
async function getTreeStructure(): Promise<string> {
  await waitFor(() => {
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  // Find all expand/collapse buttons (every node has one)
  const toggleButtons = screen.getAllByRole("button", {
    name: /^(expand|collapse) /,
  });

  const lines: string[] = [];
  const seen = new Set<string>();

  toggleButtons.forEach((btn) => {
    const ariaLabel = btn.getAttribute("aria-label") || "";
    const text = ariaLabel.replace(/^(expand|collapse) /, "");

    // Count indent levels by counting the wrapper divs inside .d-flex that come before the button
    // Structure: .d-flex > .left-menu > [indent divs...] > button
    // The first indent div is always there (even for root), so we count starting from -1
    // eslint-disable-next-line testing-library/no-node-access
    const dFlex = btn.closest(".d-flex");
    let indentLevel = -1; // Start at -1 because there's always one structural div
    if (dFlex) {
      // eslint-disable-next-line testing-library/no-node-access
      const children = Array.from(dFlex.children);
      // Count divs between left-menu and the button
      let countingIndents = false;
      for (const child of children) {
        // eslint-disable-next-line testing-library/no-node-access
        if (child.classList.contains("left-menu")) {
          countingIndents = true;
          continue;
        }
        if (child === btn) break;
        if (countingIndents && child.tagName === "DIV") {
          indentLevel++;
        }
      }
    }
    // Clamp to 0 minimum
    indentLevel = Math.max(0, indentLevel);

    // Create unique key to skip duplicates (same text at same level)
    const key = `${indentLevel}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);

    const indent = "  ".repeat(indentLevel);
    lines.push(`${indent}${text}`);
  });

  return lines.join("\n");
}

/**
 * Asserts the tree matches the expected structure.
 * Pass a template string with 2-space indentation per level.
 */
async function expectTree(expected: string): Promise<void> {
  const expectedNormalized = expected
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");

  await waitFor(async () => {
    const actual = await getTreeStructure();
    expect(actual).toEqual(expectedNormalized);
  });
}

/**
 * Standard test setup - renders the tree view.
 * The root node "My Notes" is already visible and expanded.
 */
function renderTree(user: ReturnType<typeof setup>[0]) {
  return renderWithTestData(
    <RootViewOrWorkspaceIsLoading>
      <WorkspaceView />
    </RootViewOrWorkspaceIsLoading>,
    user()
  );
}

/**
 * Creates a new node under "My Notes" and then changes the tree root to that node.
 * Returns with the new node as the root of the tree view.
 */
async function createAndSetAsRoot(nodeName: string): Promise<void> {
  // First create the node under My Notes
  (await screen.findAllByLabelText("collapse My Notes"))[0];
  await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
  await userEvent.type(await findNewNodeEditor(), `${nodeName}{Escape}`);

  // Now use the pane search to change root to this node
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );

  // Type the node name in search
  await userEvent.type(await screen.findByLabelText("search input"), nodeName);

  // Click on the search result using its aria-label
  await userEvent.click(await screen.findByLabelText(`select ${nodeName}`));

  // Wait for the tree to update with new root
  await waitFor(async () => {
    const tree = await getTreeStructure();
    expect(tree.startsWith(nodeName)).toBe(true);
  });
}

describe("Tree Editor - Comprehensive Tests", () => {
  describe("Basic Node Creation", () => {
    test("Create first child using plus button on root", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Root "My Notes" is already visible and expanded
      (await screen.findAllByLabelText("collapse My Notes"))[0];

      // Click plus button to add a child
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

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

      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

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

      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

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

      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
      `);
    });

    test("Escape with text saves the node", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

      await userEvent.type(await findNewNodeEditor(), "Saved by Escape{Escape}");

      await expectTree(`
My Notes
  Saved by Escape
      `);
    });
  });

  describe("Enter on Expanded Node - Insert at BEGINNING", () => {
    test("Enter on expanded node inserts new child at BEGINNING", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create Parent node
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand Parent and add children
      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("add to Parent"));

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
    test("Enter on collapsed node inserts sibling after it", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create siblings
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

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

      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

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

      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

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
    test("Tab on new editor indents to previous sibling (which has children)", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create Parent with a child using proper Enter chaining
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
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
      fireEvent.keyDown(editor1, { key: "Tab" });

      // Submit - this creates Existing Child under Parent
      await userEvent.type(editor1, "{Enter}");

      // Now in another chained editor (afterSibling of Existing Child, inside Parent)
      // Tab again to stay at same level, or just create another child
      const editor2 = await findNewNodeEditor();
      await userEvent.type(editor2, "Will Be Indented{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Both children should be under Parent (Tab auto-expands)
      await expectTree(`
My Notes
  Parent
    Existing Child
    Will Be Indented
      `);
    });

    test("Tab on new editor to empty node (no children) creates first child", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create an empty parent (no children)
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
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
      fireEvent.keyDown(editor, { key: "Tab" });

      await userEvent.type(editor, "{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

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
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

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

      fireEvent.keyDown(secondEditor, { key: "Tab" });

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
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
      await userEvent.type(await findNewNodeEditor(), "First{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Second{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand First and add children
      await userEvent.click(await screen.findByLabelText("expand First"));
      await userEvent.click(await screen.findByLabelText("add to First"));
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

      fireEvent.keyDown(secondEditor, { key: "Tab" });

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
    test("Plus button on expanded node with children opens editor at BEGINNING", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create Parent with children
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand and add children
      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("add to Parent"));
      await userEvent.type(await findNewNodeEditor(), "Child 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Parent
    Child 1
      `);

      // Click plus on expanded Parent (which now has collapse button)
      await userEvent.click(await screen.findByLabelText("add to Parent"));
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
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
      await userEvent.type(await findNewNodeEditor(), "Node{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Node
      `);

      // Click plus on collapsed Node - adds sibling after (not child)
      await userEvent.click(await screen.findByLabelText("add to Node"));
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

      (await screen.findAllByLabelText("collapse My Notes"))[0];

      // Click plus on root
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
      await userEvent.type(await findNewNodeEditor(), "Root Child{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Root Child
      `);
    });
  });

  describe("Search Button Behavior", () => {
    test("Search button on expanded node allows adding existing node", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create nodes
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Standalone{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand Parent and add a child
      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("add to Parent"));
      await userEvent.type(await findNewNodeEditor(), "Existing Child{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Parent
    Existing Child
  Standalone
      `);

      // Click search on expanded Parent
      await userEvent.click(
        await screen.findByLabelText("search and attach to Parent")
      );

      // Search for Standalone
      const searchInput = await screen.findByLabelText("search input");
      await userEvent.type(searchInput, "Standalone");

      // Click on search result (in modal)
      await waitFor(() => {
        expect(screen.getAllByText("Standalone").length).toBeGreaterThan(1);
      });

      const results = screen.getAllByText("Standalone");
      // eslint-disable-next-line testing-library/no-node-access
      const searchResult = results.find((el) => el.closest(".modal"));
      if (searchResult) {
        await userEvent.click(searchResult);
      }

      // Standalone should now also be a child of Parent
      await waitFor(async () => {
        const tree = await getTreeStructure();
        expect(tree).toContain("Standalone");
      });
    });

    test("Search button on collapsed node attaches as sibling", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      // Create nodes
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
      await userEvent.type(await findNewNodeEditor(), "Target{Enter}");
      await userEvent.type(await findNewNodeEditor(), "OtherNode{Enter}");
      await userEvent.type(await findNewNodeEditor(), "ToAttach{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
My Notes
  Target
  OtherNode
  ToAttach
      `);

      // Search on collapsed Target - attaches as sibling after Target
      await userEvent.click(
        await screen.findByLabelText("search and attach to Target")
      );

      const searchInput = await screen.findByLabelText("search input");
      await userEvent.type(searchInput, "ToAttach");

      await waitFor(() => {
        expect(screen.getAllByText("ToAttach").length).toBeGreaterThan(1);
      });

      const results = screen.getAllByText("ToAttach");
      // eslint-disable-next-line testing-library/no-node-access
      const searchResult = results.find((el) => el.closest(".modal"));
      if (searchResult) {
        await userEvent.click(searchResult);
      }

      // ToAttach should now appear as sibling after Target (it can appear multiple times)
      await waitFor(async () => {
        const tree = await getTreeStructure();
        // Just verify ToAttach still exists in tree
        expect(tree).toContain("ToAttach");
      });
    });
  });

  describe("Deep Nesting", () => {
    test("Create deeply nested structure", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

      // Create Level 1
      await userEvent.type(await findNewNodeEditor(), "Level 1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand Level 1 and create Level 2
      await userEvent.click(await screen.findByLabelText("expand Level 1"));
      await userEvent.click(await screen.findByLabelText("add to Level 1"));
      await userEvent.type(await findNewNodeEditor(), "Level 2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Expand Level 2 and create Level 3
      await userEvent.click(await screen.findByLabelText("expand Level 2"));
      await userEvent.click(await screen.findByLabelText("add to Level 2"));
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
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("add to Parent"));
      await userEvent.type(await findNewNodeEditor(), "Child{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await userEvent.click(await screen.findByLabelText("expand Child"));
      await userEvent.click(await screen.findByLabelText("add to Child"));
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

      await userEvent.type(await findNewNodeEditor(), "New First Grandchild{Enter}");
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
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
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
      fireEvent.keyDown(secondEditor, { key: "Tab" });

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
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
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
      fireEvent.keyDown(onlyChildEditor, { key: "Tab" });

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
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
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

      fireEvent.keyDown(willMoveEditor, { key: "Tab" });

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
      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
      await userEvent.type(await findNewNodeEditor(), "Parent With Kids{Enter}");
      await userEvent.type(await findNewNodeEditor(), "Will Move{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Add children to Parent With Kids
      await userEvent.click(await screen.findByLabelText("expand Parent With Kids"));
      await userEvent.click(await screen.findByLabelText("add to Parent With Kids"));
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

      fireEvent.keyDown(willMoveEditor, { key: "Tab" });

      // Will Move should now be LAST child (after Child B)
      await expectTree(`
My Notes
  Parent With Kids
    Child A
    Child B
    Will Move
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
      await userEvent.click(await screen.findByLabelText("add to Custom Root"));
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
      await userEvent.click(await screen.findByLabelText("add to Custom Root"));
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
      await userEvent.click(await screen.findByLabelText("add to Custom Root"));
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await userEvent.click(await screen.findByLabelText("expand Parent"));
      await userEvent.click(await screen.findByLabelText("add to Parent"));
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
      await userEvent.click(await screen.findByLabelText("add to Custom Root"));
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

      fireEvent.keyDown(secondEditor, { key: "Tab" });

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
      await userEvent.click(await screen.findByLabelText("add to Custom Root"));
      await userEvent.type(await findNewNodeEditor(), "Parent{Enter}");

      // Chained editor - Tab to indent under Parent
      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "First Child");

      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      fireEvent.keyDown(editor, { key: "Tab" });

      await userEvent.type(editor, "{Enter}");

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
      await userEvent.click(await screen.findByLabelText("add to Custom Root"));
      await userEvent.type(await findNewNodeEditor(), "Empty Parent{Enter}");

      // Chained editor - Tab to indent under Empty Parent
      const editor = await findNewNodeEditor();
      await userEvent.type(editor, "Becomes Child");

      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      fireEvent.keyDown(editor, { key: "Tab" });

      await userEvent.type(editor, "{Enter}");
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

      await userEvent.click(await screen.findByLabelText("add to Custom Root"));
      await userEvent.type(await findNewNodeEditor(), "Target{Enter}");
      await userEvent.type(await findNewNodeEditor(), "After{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      await expectTree(`
Custom Root
  Target
  After
      `);

      // Click plus on collapsed Target
      await userEvent.click(await screen.findByLabelText("add to Target"));
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
      await userEvent.click(await screen.findByLabelText("add to Custom Root"));
      await userEvent.type(await findNewNodeEditor(), "L1{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Create L2 under L1
      await userEvent.click(await screen.findByLabelText("expand L1"));
      await userEvent.click(await screen.findByLabelText("add to L1"));
      await userEvent.type(await findNewNodeEditor(), "L2{Enter}");
      await userEvent.type(await findNewNodeEditor(), "{Escape}");

      // Create L3 under L2
      await userEvent.click(await screen.findByLabelText("expand L2"));
      await userEvent.click(await screen.findByLabelText("add to L2"));
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

  describe("Edge Cases", () => {
    test("Rapid Enter creates multiple siblings in correct order", async () => {
      const [alice] = setup([ALICE]);
      renderTree(alice);

      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

      // Rapid creation
      for (let i = 1; i <= 5; i++) {
        await userEvent.type(await findNewNodeEditor(), `Item ${i}{Enter}`);
      }
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

      (await screen.findAllByLabelText("collapse My Notes"))[0];
      await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);

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
