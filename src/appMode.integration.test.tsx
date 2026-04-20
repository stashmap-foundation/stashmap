import { renderAppTree } from "./appTestUtils.test";
import { expectTree } from "./utils.test";
import { knowstrInit, knowstrSave, write } from "./testFixtures/workspace";

test("App renders a normalized workspace as a tree", async () => {
  const { path } = knowstrInit();
  write(
    path,
    "holidays.md",
    `# Holiday Destinations

- Spain
- France
`
  );
  await knowstrSave(path);

  await renderAppTree({ path, search: "Holiday Destinations" });

  await expectTree(`
Holiday Destinations
  Spain
  France
`);
});

test("App exposes the workspace identity via useUser", async () => {
  const { path, pubkey } = await renderAppTree();
  expect(path).toMatch(/knowstr-test-/u);
  expect(pubkey).toMatch(/^[0-9a-f]{64}$/u);
});
