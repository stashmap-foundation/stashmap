import { knowstrInit, knowstrSave, write } from "../testFixtures/workspace";
import { renderAppTree } from "../appTestUtils.test";
import { expectTree } from "../utils.test";

test("external change to a known file shows up in the app", async () => {
  const { path } = knowstrInit();
  write(path, "doc.md", "# Doc\n- one\n");
  await knowstrSave(path);

  await renderAppTree({ path, search: "Doc" });

  await expectTree(`
Doc
  one
`);

  write(path, "doc.md", "# Doc\n- one\n- two\n");

  await expectTree(`
Doc
  one
  two
`);
});
