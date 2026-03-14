import { Map } from "immutable";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  follow,
  renderApp,
  renderTree,
  setup,
  type,
} from "../utils.test";

function getAncestorPaths(path: string, rootKey: string): string[] {
  const suffix = path.slice(rootKey.length);
  const parts = suffix.split(":");

  const numTriplets = Math.floor((parts.length - 4) / 3);
  const triplets = Array.from({ length: numTriplets }, (_, idx) => {
    const i = 1 + idx * 3;
    return [parts[i], parts[i + 1], parts[i + 2]] as const;
  });

  return triplets.reduce<{ current: string; ancestors: string[] }>(
    (acc, [a, b, c]) => {
      const next = `${acc.current}:${a}:${b}:${c}`;
      return { current: next, ancestors: [...acc.ancestors, next] };
    },
    { current: rootKey, ancestors: [] }
  ).ancestors;
}

function areAllAncestorsExpanded(
  views: Views,
  path: string,
  rootKey: string
): boolean {
  const ancestorPaths = getAncestorPaths(path, rootKey);
  return ancestorPaths.every((ancestorPath) => {
    const view = views.get(ancestorPath);
    return view?.expanded === true;
  });
}

test("search shows matches from different roots", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Crypto{Enter}{Tab}Bitcoin{Escape}");
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type("P2P{Enter}{Tab}Bitcoin{Escape}");

  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(
    await screen.findByLabelText("search input"),
    "Bitcoin{Enter}"
  );

  await expectTree(`
Search: Bitcoin
  [R] P2P / Bitcoin
  [R] Crypto / Bitcoin
  `);
});

test("search shows each matching context path", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type(
    "Notes{Enter}{Tab}Level1{Enter}{Tab}Level2{Enter}{Tab}Target{Escape}"
  );
  await userEvent.click(await screen.findByLabelText("Create new note"));
  await type(
    "Work{Enter}{Tab}Projects{Enter}{Tab}Target{Enter}{Tab}Child{Escape}"
  );

  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(
    await screen.findByLabelText("search input"),
    "Target{Enter}"
  );

  await expectTree(`
Search: Target
  [R] Work / Projects / Target
  [R] Notes / Level1 / Level2 / Target
  `);
});

test("other user's search result shows other-user indicator", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  await follow(alice, bob().user.publicKey);

  renderTree(bob);
  await type("Bob Root{Enter}{Tab}Shared{Escape}");
  cleanup();

  renderApp(alice());
  await userEvent.click(
    await screen.findByLabelText("Search to change pane 0 content")
  );
  await userEvent.type(
    await screen.findByLabelText("search input"),
    "Shared{Enter}"
  );

  await expectTree(`
Search: Shared
  [OR] Bob Root / Shared
  `);
});

test("Relevance selector shows when node is expanded", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);

  await type(
    "My Notes{Enter}{Tab}Parent{Enter}{Tab}Child1{Enter}Child2{Escape}"
  );

  await screen.findByText("Child1");
  await screen.findByText("Child2");

  expect(screen.getByLabelText("mark Child1 as not relevant")).toBeDefined();
  expect(screen.getByLabelText("mark Child2 as not relevant")).toBeDefined();
});

describe("areAllAncestorsExpanded", () => {
  test("returns false when parent is collapsed", () => {
    const rootKey = "p0:rootNode:0";
    const parentKey = "p0:rootNode:0:rootRel:parentNode:0";
    const childKey = "p0:rootNode:0:rootRel:parentNode:0:parentRel:childNode:0";

    const views: Views = Map({
      [rootKey]: { expanded: true },
      [parentKey]: { expanded: false },
      [childKey]: { expanded: true },
    });

    expect(areAllAncestorsExpanded(views, childKey, rootKey)).toBe(false);
    expect(areAllAncestorsExpanded(views, parentKey, rootKey)).toBe(true);
  });

  test("returns true when all ancestors are expanded", () => {
    const rootKey = "p0:rootNode:0";
    const parentKey = "p0:rootNode:0:rootRel:parentNode:0";
    const childKey = "p0:rootNode:0:rootRel:parentNode:0:parentRel:childNode:0";

    const views: Views = Map({
      [rootKey]: { expanded: true },
      [parentKey]: { expanded: true },
      [childKey]: { expanded: true },
    });

    expect(areAllAncestorsExpanded(views, childKey, rootKey)).toBe(true);
    expect(areAllAncestorsExpanded(views, parentKey, rootKey)).toBe(true);
  });
});
