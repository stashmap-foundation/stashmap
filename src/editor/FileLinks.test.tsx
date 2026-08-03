import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import path from "path";
import { renderAppTree } from "../appTestUtils.test";
import { expectTree } from "../utils.test";
import {
  knowstrInit,
  knowstrSave,
  readNodeId,
  write,
} from "../testFixtures/workspace";

test("Cross-file link round-trips through save and renders in tree", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  const after = fs.readFileSync(path.join(workspacePath, "a.md"), "utf8");

  expect(after).toContain("[Open B](./b.md)");

  await renderAppTree({ path: workspacePath, search: "A" });

  await expectTree(`
A
  Open B
  `);
});

test("Cross-directory link resolves and is clickable to target root", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "notes/a.md", "# A\n\n- [Open B](../topics/b.md)\n");
  write(workspacePath, "topics/b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "A" });

  const navigateLink = await screen.findByRole("link", { name: "Open B" });
  await userEvent.click(navigateLink);

  await screen.findByLabelText(/^edit B(\s|$)/);
  await screen.findByText("B-child");
});

test("File link surfaces as incoming reference on target's root", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "B" });

  await expectTree(`
B
  B-child
  [I] A ↩
  `);
});

test("Accepting a file-link incoming ref links back to the source row", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "B" });

  await expectTree(`
B
  B-child
  [I] A ↩
  `);

  const incoming = await screen.findByRole("treeitem", {
    name: "A ↩",
  });
  await userEvent.click(incoming);
  await userEvent.keyboard("!");

  await expectTree(`
B
  B-child
  A↩
  `);

  const reverseLink = await screen.findByRole("link", {
    name: "A",
  });
  expect(reverseLink.getAttribute("data-href")).toMatch(/^#/u);

  await userEvent.click(reverseLink);

  await expectTree(`
A
  Open B!↩
  `);
});

test("Deleted file link target renders per-link dead furniture", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- [Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  fs.unlinkSync(path.join(workspacePath, "b.md"));
  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "A" });

  await expectTree(`
A
  Open B†
  `);
  expect(
    screen.getByRole("link", {
      name: "Open B. Target no longer exists",
    }).style.cursor
  ).toBe("default");
});

test("Mixed node-links and file-links all render", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "destinations.md",
    "# Holiday Destinations\n\n- France\n- Spain\n"
  );
  write(workspacePath, "hello.md", "# Hello Doc\n\n- Hello-child\n");
  await knowstrSave(workspacePath);

  const franceID = readNodeId(workspacePath, "destinations.md", "France");
  const helloRootID = readNodeId(workspacePath, "hello.md", "Hello Doc");

  write(
    workspacePath,
    "links.md",
    `# Links\n\n- [Holiday / France](#${franceID})\n- [Hello Doc](#${helloRootID})\n- [Hello](./hello.md)\n`
  );
  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "Links" });

  await expectTree(`
Links
  Holiday / France
  Hello Doc
  Hello
  `);
});

test("Cross-document node links survive a save round-trip", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "destinations.md",
    "# Holiday Destinations\n\n- France\n- Spain\n"
  );
  write(workspacePath, "hello.md", "# Hello Doc\n\n- Hello-child\n");
  await knowstrSave(workspacePath);

  const franceID = readNodeId(workspacePath, "destinations.md", "France");
  const helloRootID = readNodeId(workspacePath, "hello.md", "Hello Doc");

  write(
    workspacePath,
    "links.md",
    `# Links\n\n- [Holiday / France](#${franceID})\n- [Hello Doc](#${helloRootID})\n- [Hello](./hello.md)\n`
  );
  await knowstrSave(workspacePath);

  const after = fs.readFileSync(path.join(workspacePath, "links.md"), "utf8");
  expect(after).toContain(`[Holiday / France](#${franceID})`);
  expect(after).toContain(`[Hello Doc](#${helloRootID})`);
  expect(after).toContain("[Hello](./hello.md)");
});

test("Cross-document node links survive an app reload", async () => {
  const { path: workspacePath } = knowstrInit();
  write(
    workspacePath,
    "destinations.md",
    "# Holiday Destinations\n\n- France\n- Spain\n"
  );
  write(workspacePath, "hello.md", "# Hello Doc\n\n- Hello-child\n");
  await knowstrSave(workspacePath);

  const franceID = readNodeId(workspacePath, "destinations.md", "France");

  write(
    workspacePath,
    "links.md",
    `# Links\n\n- [Holiday / France](#${franceID})\n- [Hello](./hello.md)\n`
  );
  await knowstrSave(workspacePath);

  await renderAppTree({ path: workspacePath, search: "Links" });
  await expectTree(`
Links
  Holiday / France
  Hello
  `);

  cleanup();
  await renderAppTree({ path: workspacePath, search: "Links" });

  await expectTree(`
Links
  Holiday / France
  Hello
  `);
});

test("File link with prefix markers preserves them on the incoming reference", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "a.md", "# A\n\n- (!+)[Open B](./b.md)\n");
  write(workspacePath, "b.md", "# B\n\n- B-child\n");

  await knowstrSave(workspacePath);
  await renderAppTree({ path: workspacePath, search: "B" });

  await expectTree(
    `
B
  B-child
  [I] A !+↩
  `,
    { showGutter: true }
  );

  await userEvent.click(screen.getByRole("treeitem", { name: "A !+↩" }));
  await userEvent.keyboard("?");
  await expectTree(
    `
B
  B-child
  {?} A!+↩
  `,
    { showGutter: true }
  );

  cleanup();
  await renderAppTree({ path: workspacePath, search: "A" });
  await expectTree(
    `
A
  {!+} Open B?↩
  `,
    { showGutter: true }
  );
});
