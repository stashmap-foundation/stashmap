import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Map } from "immutable";
import { ALICE, setup, expectTree, renderTree, type } from "./utils.test";
import {
  parseViewPath,
  viewPathToString,
  updateViewPathsAfterPaneDelete,
  updateViewPathsAfterPaneInsert,
  ViewPath,
} from "./rowModel";

test("Move View Settings on Delete", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);
  await type(
    "My Notes{Enter}{Tab}Programming Languages{Enter}{Tab}C{Enter}{Tab}C++{Enter}{Shift>}{Tab}{/Shift}Java{Escape}"
  );

  await expectTree(`
My Notes
  Programming Languages
    C
      C++
    Java
  `);

  await userEvent.click(screen.getByLabelText("collapse My Notes"));
  await userEvent.click(screen.getByLabelText("expand My Notes"));
  await userEvent.click(
    screen.getByLabelText("collapse Programming Languages")
  );
  await userEvent.click(screen.getByLabelText("expand Programming Languages"));
  const cToggle = screen.getByLabelText(/expand C|collapse C/);
  if (cToggle.getAttribute("aria-label") === "expand C") {
    await userEvent.click(cToggle);
  }

  await screen.findByText("C++");
  await userEvent.click(screen.getByLabelText("mark Java as not relevant"));
  await screen.findByText("C++");
  screen.getByLabelText("collapse C");

  await userEvent.click(screen.getByLabelText("collapse C"));
  screen.getByLabelText("expand C");
  expect(screen.queryByText("C++")).toBeNull();
});

test("Move Node Up", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  await type(
    "My Notes{Enter}{Tab}Programming Languages{Enter}{Tab}FPL{Enter}OOP{Enter}{Tab}C++{Enter}Java{Escape}"
  );

  await expectTree(`
My Notes
  Programming Languages
    FPL
    OOP
      C++
      Java
  `);

  const oop = screen.getByText("OOP");
  const pl = screen.getByLabelText("Programming Languages");

  fireEvent.dragStart(oop);
  fireEvent.drop(pl);
  await expectTree(`
My Notes
  Programming Languages
    OOP
      C++
      Java
    FPL
  `);
  cleanup();

  renderTree(alice);
  // View state should be preserved - OOP was moved before FPL and is still expanded
  await expectTree(`
My Notes
  Programming Languages
    OOP
      C++
      Java
    FPL
  `);
});

test("Parse View path", () => {
  expect(parseViewPath("p0:root")).toEqual([0, "root"]);
  expect(parseViewPath("p0:root:pl")).toEqual([0, "root", "pl"]);
  expect(parseViewPath("p1:root:pl:oop")).toEqual([1, "root", "pl", "oop"]);
});

test("View path roundtrip preserves node IDs", () => {
  const nodeId = "alice_550e8400-e29b-41d4-a716-446655440000" as ID;
  const viewPath: ViewPath = [0, "rel1" as ID, nodeId];

  const serialized = viewPathToString(viewPath);
  const parsed = parseViewPath(serialized);

  expect(parsed).toEqual(viewPath);
  expect(parsed[2]).toBe(nodeId);
});

test("Disconnect Nodes", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);
  await type(
    "My Notes{Enter}{Tab}Programming Languages{Enter}{Tab}C{Enter}C++{Enter}Java{Enter}Rust{Escape}"
  );

  await expectTree(`
My Notes
  Programming Languages
    C
    C++
    Java
    Rust
  `);

  fireEvent.click(await screen.findByLabelText("mark Java as not relevant"));
  await expectTree(`
My Notes
  Programming Languages
    C
    C++
    Rust
  `);

  fireEvent.click(await screen.findByLabelText("mark C as not relevant"));
  await expectTree(`
My Notes
  Programming Languages
    C++
    Rust
  `);

  cleanup();
});

test("updateViewPathsAfterPaneDelete removes views for deleted pane and shifts indices", () => {
  const views = Map<string, View>({
    "p0:root": { expanded: false },
    "p0:root:node1": { expanded: true },
    "p1:root": { expanded: false },
    "p1:root:node2": { expanded: true },
    "p2:root": { expanded: true },
    "p2:root:node3": { expanded: true },
    "p3:root": { expanded: true },
  });

  const updatedViews = updateViewPathsAfterPaneDelete(views, 1);

  expect(updatedViews.has("p0:root")).toBe(true);
  expect(updatedViews.has("p0:root:node1")).toBe(true);
  expect(updatedViews.has("p1:root:node2")).toBe(false);
  expect(updatedViews.get("p1:root")?.expanded).toBe(true);
  expect(updatedViews.get("p1:root:node3")?.expanded).toBe(true);
  expect(updatedViews.get("p2:root")?.expanded).toBe(true);
  expect(updatedViews.has("p3:root")).toBe(false);
});

test("updateViewPathsAfterPaneInsert shifts pane indices at and after insertion point", () => {
  const views = Map<string, View>({
    "p0:root": { expanded: false },
    "p0:root:node1": { expanded: true },
    "p1:root": { expanded: true },
    "p1:root:node2": { expanded: true },
    "p2:root": { expanded: true },
  });

  const updatedViews = updateViewPathsAfterPaneInsert(views, 1);

  expect(updatedViews.has("p0:root")).toBe(true);
  expect(updatedViews.get("p0:root")?.expanded).toBe(false);
  expect(updatedViews.has("p0:root:node1")).toBe(true);

  expect(updatedViews.has("p1:root")).toBe(false);
  expect(updatedViews.has("p2:root")).toBe(true);
  expect(updatedViews.get("p2:root")?.expanded).toBe(true);
  expect(updatedViews.has("p2:root:node2")).toBe(true);

  expect(updatedViews.has("p3:root")).toBe(true);
  expect(updatedViews.get("p3:root")?.expanded).toBe(true);
});
