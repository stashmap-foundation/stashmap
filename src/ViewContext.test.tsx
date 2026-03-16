import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Map } from "immutable";
import {
  ALICE,
  setup,
  expectTree,
  findNewNodeEditor,
  BOB,
  follow,
  forkReadonlyRoot,
  openReadonlyRoute,
  renderApp,
  renderTree,
  type,
} from "./utils.test";
import { parseRowPath, rowPathToString, RowPath } from "./rows/rowPaths";
import {
  updateRowPathsAfterDisconnect,
  updateRowPathsAfterMoveNodes,
  updateRowPathsAfterPaneDelete,
  updateRowPathsAfterPaneInsert,
} from "./session/views";

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

test("Contact views list via version and list remains unchanged", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(bob, alice().user.publicKey);

  renderTree(alice);
  await type(
    "My Notes{Enter}{Tab}Cities{Enter}{Tab}Paris{Enter}London{Escape}"
  );

  await expectTree(`
My Notes
  Cities
    Paris
    London
  `);
  cleanup();

  await forkReadonlyRoot(bob(), alice().user.publicKey, "My Notes");
  await userEvent.click(await screen.findByLabelText("expand Cities"));
  await userEvent.click(await screen.findByLabelText("edit Cities"));
  await userEvent.keyboard("{Enter}");
  await type("Madrid{Escape}");

  await expectTree(`
My Notes
  Cities
    Madrid
    Paris
    London
  `);
  cleanup();

  renderTree(alice);
  await expectTree(`
My Notes
  Cities
    Paris
    London
  `);
});

test("Alter View paths after disconnect", () => {
  const views = Map<string, { e: string }>({
    "p0:root:r:n": { e: "delete" },
    "p0:root:r:n:child": { e: "delete" },
    "p0:root:r:keep": { e: "p0:root:r:keep" },
    "p0:root2:r:nested:r:n": { e: "delete" },
    "p0:root2:r:other": { e: "p0:root2:r:other" },
  });
  const updatedViews = updateRowPathsAfterDisconnect(
    views as unknown as Views,
    "n" as LongID,
    "r" as LongID
  );

  const expectedResult = views
    .filter((v) => v.e !== "delete")
    .mapEntries((e) => [e[1].e, e[1]]);
  expect(updatedViews.keySeq().toJS()).toEqual(expectedResult.keySeq().toJS());
});

test("Alter View paths after disconnect with pane-prefixed paths", () => {
  const views = Map<string, { e: string }>({
    "p0:root:r:n": { e: "delete" },
    "p0:root:r:n:child": { e: "delete" },
    "p0:root:r:keep": { e: "p0:root:r:keep" },
    "p1:root:r:n": { e: "delete" },
    "p1:root:r:other": { e: "p1:root:r:other" },
  });
  const updatedViews = updateRowPathsAfterDisconnect(
    views as unknown as Views,
    "n" as LongID,
    "r" as LongID
  );

  const expectedResult = views
    .filter((v) => v.e !== "delete")
    .mapEntries((e) => [e[1].e, e[1]]);
  expect(updatedViews.keySeq().toJS()).toEqual(expectedResult.keySeq().toJS());
});

test("Parse View path", () => {
  expect(parseRowPath("p0:root")).toEqual([0, "root"]);
  expect(parseRowPath("p0:root:pl")).toEqual([0, "root", "pl"]);
  expect(parseRowPath("p1:root:pl:oop")).toEqual([1, "root", "pl", "oop"]);
});

test("View path roundtrip preserves node IDs", () => {
  const nodeId = "alice_550e8400-e29b-41d4-a716-446655440000" as LongID;
  const rowPath: RowPath = [0, "rel1" as LongID, nodeId];

  const serialized = rowPathToString(rowPath);
  const parsed = parseRowPath(serialized);

  expect(parsed).toEqual(rowPath);
  expect(parsed[2]).toBe(nodeId);
});

test("View doesn't change if list is forked from contact", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  renderTree(bob);
  await type(
    "My Notes{Enter}{Tab}Programming Languages{Enter}{Tab}OOP{Enter}{Tab}C++{Enter}Java{Enter}{Enter}FP{Enter}Logic{Enter}Scripting{Escape}"
  );
  await expectTree(`
My Notes
  Programming Languages
    OOP
      C++
      Java
    FP
    Logic
    Scripting
  `);
  const nodeUrl = await openReadonlyRoute("Programming Languages");
  cleanup();

  renderApp({ ...alice(), initialRoute: nodeUrl });
  await screen.findByText("READONLY");
  await userEvent.click(await screen.findByLabelText("expand OOP"));
  await expectTree(`
[O] Programming Languages
  [O] OOP
    [O] C++
    [O] Java
  [O] FP
  [O] Logic
  [O] Scripting
  `);

  await userEvent.click(await screen.findByLabelText("copy root to edit"));
  await waitFor(() => {
    expect(screen.queryByText("READONLY")).toBeNull();
  });
  await expectTree(`
Programming Languages
  OOP
    C++
    Java
  FP
  Logic
  Scripting
  `);

  await userEvent.click(
    await screen.findByLabelText("edit Programming Languages")
  );
  await userEvent.keyboard("{Enter}");
  await userEvent.type(
    await findNewNodeEditor(),
    "added programming language{Escape}"
  );
  await expectTree(`
Programming Languages
  added programming language
  OOP
    C++
    Java
  FP
  Logic
  Scripting
  `);
  cleanup();
});

test("Forked subtree breadcrumbs show source ancestors and navigate back to source tree", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  renderTree(bob);
  await type(
    "My Notes{Enter}{Tab}Programming Languages{Enter}{Tab}OOP{Enter}{Tab}C++{Enter}Java{Enter}{Enter}FP{Enter}Logic{Enter}Scripting{Escape}"
  );
  const nodeUrl = await openReadonlyRoute("Programming Languages");
  cleanup();

  renderApp({ ...alice(), initialRoute: nodeUrl });
  await screen.findByText("READONLY");
  await expectTree(`
[O] Programming Languages
  [O] OOP
  [O] FP
  [O] Logic
  [O] Scripting
  `);
  await userEvent.click(await screen.findByLabelText("copy root to edit"));

  await waitFor(() => {
    expect(screen.queryByText("READONLY")).toBeNull();
  });
  await expectTree(`
Programming Languages
  OOP
  FP
  Logic
  Scripting
  `);

  const breadcrumbs = screen.getByRole("navigation", {
    name: "Navigation breadcrumbs",
  });
  await within(breadcrumbs).findByLabelText("Navigate to My Notes");
  expect(within(breadcrumbs).getByText("Programming Languages")).toBeDefined();

  await userEvent.click(
    within(breadcrumbs).getByLabelText("Navigate to My Notes")
  );

  await screen.findByText("READONLY");
  await expectTree(`
[O] My Notes
  [O] Programming Languages
  `);

  await userEvent.click(
    await screen.findByLabelText("expand Programming Languages")
  );
  await userEvent.click(await screen.findByLabelText("expand OOP"));
  await expectTree(`
[O] My Notes
  [O] Programming Languages
    [O] OOP
      [O] C++
      [O] Java
    [O] FP
    [O] Logic
    [O] Scripting
  `);
  cleanup();
});

test("Forked subtree header source action opens source path", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  renderTree(bob);
  await type(
    "My Notes{Enter}{Tab}Programming Languages{Enter}{Tab}OOP{Enter}FP{Enter}Logic{Enter}Scripting{Escape}"
  );
  const nodeUrl = await openReadonlyRoute("Programming Languages");
  cleanup();

  renderApp({ ...alice(), initialRoute: nodeUrl });
  await screen.findByText("READONLY");
  await expectTree(`
[O] Programming Languages
  [O] OOP
  [O] FP
  [O] Logic
  [O] Scripting
  `);
  await userEvent.click(await screen.findByLabelText("copy root to edit"));

  await waitFor(() => {
    expect(screen.queryByText("READONLY")).toBeNull();
  });
  await expectTree(`
Programming Languages
  OOP
  FP
  Logic
  Scripting
  `);

  await screen.findByLabelText("Open source tree");
  await userEvent.click(await screen.findByLabelText("Open source tree"));

  await screen.findByText("READONLY");
  const breadcrumbs = screen.getByRole("navigation", {
    name: "Navigation breadcrumbs",
  });
  expect(within(breadcrumbs).getByText("My Notes")).toBeDefined();
  expect(within(breadcrumbs).getByText("Programming Languages")).toBeDefined();
  await expectTree(`
[O] Programming Languages
  [O] OOP
  [O] FP
  [O] Logic
  [O] Scripting
  `);
  cleanup();
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

test("updateRowPathsAfterPaneDelete removes views for deleted pane and shifts indices", () => {
  const views = Map<string, View>({
    "p0:root": { expanded: false },
    "p0:root:node1": { expanded: true },
    "p1:root": { expanded: false },
    "p1:root:node2": { expanded: true },
    "p2:root": { expanded: true },
    "p2:root:node3": { expanded: true },
    "p3:root": { expanded: true },
  });

  const updatedViews = updateRowPathsAfterPaneDelete(views, 1);

  expect(updatedViews.has("p0:root")).toBe(true);
  expect(updatedViews.has("p0:root:node1")).toBe(true);
  expect(updatedViews.has("p1:root:node2")).toBe(false);
  expect(updatedViews.get("p1:root")?.expanded).toBe(true);
  expect(updatedViews.get("p1:root:node3")?.expanded).toBe(true);
  expect(updatedViews.get("p2:root")?.expanded).toBe(true);
  expect(updatedViews.has("p3:root")).toBe(false);
});

test("updateRowPathsAfterPaneInsert shifts pane indices at and after insertion point", () => {
  const views = Map<string, View>({
    "p0:root": { expanded: false },
    "p0:root:node1": { expanded: true },
    "p1:root": { expanded: true },
    "p1:root:node2": { expanded: true },
    "p2:root": { expanded: true },
  });

  const updatedViews = updateRowPathsAfterPaneInsert(views, 1);

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

test("updateRowPathsAfterMoveNodes preserves paths when nodeID starts with digit", () => {
  const relID = "3abc_uuid" as LongID;
  const childAPath = `p0:root:${relID}:childA`;
  const childADeepPath = `p0:root:${relID}:childA:innerRel:grand`;
  const childBPath = `p0:root:${relID}:childB`;

  const views = Map<string, View>({
    "p0:root:0": { expanded: true },
    [childAPath]: { expanded: true },
    [childADeepPath]: { expanded: true },
    [childBPath]: { expanded: false },
  });

  const data = { views } as unknown as Data;

  const updatedViews = updateRowPathsAfterMoveNodes(data);

  expect(updatedViews.has(childAPath)).toBe(true);
  expect(updatedViews.get(childAPath)?.expanded).toBe(true);
  expect(updatedViews.has(childADeepPath)).toBe(true);
  expect(updatedViews.get(childADeepPath)?.expanded).toBe(true);
  expect(updatedViews.has(childBPath)).toBe(true);

  expect(updatedViews).toEqual(views);
});
