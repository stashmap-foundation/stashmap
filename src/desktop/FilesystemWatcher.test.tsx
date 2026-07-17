import fs from "fs";
import pathModule from "path";
import { loadCliProfile } from "../cli/config";
import { parseToDocument } from "../core/Document";
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

test("/local/d route keeps showing a known file after top node ids change", async () => {
  const { path } = knowstrInit();
  write(path, "doc.md", "# Doc\n- one\n");
  await knowstrSave(path);

  const profile = loadCliProfile({ cwd: path });
  const savedContent = fs.readFileSync(pathModule.join(path, "doc.md"), "utf8");
  const { document } = parseToDocument(profile.pubkey, savedContent);

  await renderAppTree({
    path,
    initialRoute: `/local/d/${encodeURIComponent(document.docId)}`,
  });

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
