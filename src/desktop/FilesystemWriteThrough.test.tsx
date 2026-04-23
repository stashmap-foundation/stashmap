import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  ls,
  write,
} from "../testFixtures/workspace";
import { renderAppTree } from "../appTestUtils.test";
import { expectTree, findNewNodeEditor, type } from "../utils.test";

test("typing in the editor writes markdown files to the workspace", async () => {
  const { path } = await renderAppTree();
  if (!path) {
    throw new Error("expected renderAppTree to return a workspace path");
  }
  await findNewNodeEditor();

  await type("Holiday Destinations{Enter}{Tab}Spain{Enter}France{Escape}");

  await expectTree(`
Holiday Destinations
  Spain
  France
`);

  await expectMarkdown(
    path,
    "holiday-destinations.md",
    `
# Holiday Destinations <!-- id:... -->

- Spain <!-- id:... -->
- France <!-- id:... -->
`
  );
  expect(ls(path)).toEqual(["holiday-destinations.md", "log.md"]);
});

test("adding a sibling after a heading writes unambiguous markdown", async () => {
  const { path } = knowstrInit();
  write(
    path,
    "holidays.md",
    `
# Holiday Destinations
## Bali
- Beaches
`
  );
  await knowstrSave(path);

  await renderAppTree({ path, search: "Holiday Destinations" });

  await expectTree(`
Holiday Destinations
  Bali
`);

  await userEvent.click(await screen.findByLabelText("edit Bali"));
  await userEvent.keyboard("{Enter}Spain{Escape}");

  await expectTree(`
Holiday Destinations
  Bali
  Spain
`);

  expect(ls(path)).toEqual(["holidays.md"]);
  await expectMarkdown(
    path,
    "holidays.md",
    `
# Holiday Destinations <!-- id:... -->

## Bali <!-- id:... -->

- Beaches <!-- id:... -->

## Spain <!-- id:... -->
`
  );
});

test("paragraph siblings are preserved on round-trip", async () => {
  const { path } = knowstrInit();
  write(
    path,
    "doc.md",
    `
# Root

A standalone paragraph.

## Heading
`
  );
  await knowstrSave(path);

  await renderAppTree({ path, search: "Root" });

  await expectTree(`
Root
  A standalone paragraph.
  Heading
`);

  await userEvent.click(
    await screen.findByLabelText("edit A standalone paragraph.")
  );
  await userEvent.keyboard("{Enter}Mid{Escape}");

  await userEvent.click(await screen.findByLabelText("edit Heading"));
  await userEvent.keyboard("{Enter}Trailing{Escape}");

  await expectTree(`
Root
  A standalone paragraph.
  Mid
  Heading
  Trailing
`);

  await expectMarkdown(
    path,
    "doc.md",
    `
# Root <!-- id:... -->

A standalone paragraph. <!-- id:... -->

- Mid <!-- id:... -->

## Heading <!-- id:... -->

## Trailing <!-- id:... -->
`
  );
});
