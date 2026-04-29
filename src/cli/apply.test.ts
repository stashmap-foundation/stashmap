/** @jest-environment node */

import fs from "fs";
import path from "path";
import {
  expectMarkdown,
  knowstrApply,
  knowstrInit,
  knowstrSave,
  readNodeId,
  write,
} from "../testFixtures/workspace";

test("apply --dry-run reports a new child under a known parent", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "holidays.md",
    `
# Holiday Destinations
- Spain
- France
`
  );
  await knowstrSave(workspaceDir);

  const rootId = readNodeId(
    workspaceDir,
    "holidays.md",
    "# Holiday Destinations"
  );
  const spainId = readNodeId(workspaceDir, "holidays.md", "- Spain");
  const franceId = readNodeId(workspaceDir, "holidays.md", "- France");

  write(
    workspaceDir,
    "inbox/bob.md",
    `
# Holiday Destinations <!-- id:${rootId} -->
- Spain <!-- id:${spainId} -->
- France <!-- id:${franceId} -->
- Germany <!-- id:germany -->
`
  );

  const result = await knowstrApply(workspaceDir, { dryRun: true });

  expect(result.dry_run).toBe(true);
  expect(result.graph_additions).toEqual([
    {
      parent_id: rootId,
      node_id: "germany",
      source_path: path.join(workspaceDir, "inbox", "bob.md"),
      target_path: path.join(workspaceDir, "holidays.md"),
    },
  ]);
  await expectMarkdown(
    workspaceDir,
    "holidays.md",
    `
# Holiday Destinations <!-- id:... -->

- Spain <!-- id:... -->
- France <!-- id:... -->
`
  );
  expect(fs.readdirSync(path.join(workspaceDir, "inbox"))).toEqual(["bob.md"]);
});

test("apply assigns ids to new inbox nodes before inserting them", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "holidays.md",
    `
# Holiday Destinations
- Spain
- France
`
  );
  await knowstrSave(workspaceDir);

  const rootId = readNodeId(
    workspaceDir,
    "holidays.md",
    "# Holiday Destinations"
  );
  const spainId = readNodeId(workspaceDir, "holidays.md", "- Spain");
  const franceId = readNodeId(workspaceDir, "holidays.md", "- France");

  write(
    workspaceDir,
    "inbox/bob.md",
    `
# Holiday Destinations <!-- id:${rootId} -->
- Spain <!-- id:${spainId} -->
- France <!-- id:${franceId} -->
- Germany
  - Berlin
`
  );

  const result = await knowstrApply(workspaceDir);

  await expectMarkdown(
    workspaceDir,
    "holidays.md",
    `
# Holiday Destinations <!-- id:... -->

- Spain <!-- id:... -->
- France <!-- id:... -->
- (?) Germany <!-- id:... -->
  - Berlin <!-- id:... -->
`
  );
  expect(result.invalid_inbox_paths).toEqual([]);
  expect(fs.readdirSync(path.join(workspaceDir, "inbox"))).toEqual([]);
});

test("apply writes a new child under a known parent with preserved id and clears inbox", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "holidays.md",
    `
# Holiday Destinations
- Spain
- France
`
  );
  await knowstrSave(workspaceDir);

  const rootId = readNodeId(
    workspaceDir,
    "holidays.md",
    "# Holiday Destinations"
  );
  const spainId = readNodeId(workspaceDir, "holidays.md", "- Spain");
  const franceId = readNodeId(workspaceDir, "holidays.md", "- France");

  write(
    workspaceDir,
    "inbox/bob.md",
    `
# Holiday Destinations <!-- id:${rootId} -->
- Spain <!-- id:${spainId} -->
- France <!-- id:${franceId} -->
- Germany <!-- id:germany -->
`
  );

  const result = await knowstrApply(workspaceDir);

  expect(result.dry_run).toBe(false);
  await expectMarkdown(
    workspaceDir,
    "holidays.md",
    `
# Holiday Destinations <!-- id:... -->

- Spain <!-- id:... -->
- France <!-- id:... -->
- (?) Germany <!-- id:germany -->
`
  );
  expect(fs.readdirSync(path.join(workspaceDir, "inbox"))).toEqual([]);
  expect(
    fs.readFileSync(path.join(workspaceDir, "knowstr_log.md"), "utf8")
  ).toContain("applied (?) germany under");
});

test("apply puts a fully unknown subtree into maybe_relevant", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "notes.md",
    `
# Notes
- Existing
`
  );
  await knowstrSave(workspaceDir);

  write(
    workspaceDir,
    "inbox/unknown.md",
    `
# Travel Ideas <!-- id:travel -->
- Austria <!-- id:austria -->
`
  );

  const result = await knowstrApply(workspaceDir);

  expect(result.maybe_relevant_paths).toEqual([
    path.join(workspaceDir, "maybe_relevant", "unknown.md"),
  ]);
  await expectMarkdown(
    workspaceDir,
    "maybe_relevant/unknown.md",
    `
# Travel Ideas <!-- id:travel -->

- Austria <!-- id:austria -->
`
  );
  expect(fs.readdirSync(path.join(workspaceDir, "inbox"))).toEqual([]);
});

test("apply rejects an inbox file with duplicate node ids within the same file", async () => {
  const { path: workspaceDir } = knowstrInit();
  await knowstrSave(workspaceDir);

  write(
    workspaceDir,
    "inbox/bad.md",
    `
# Notes <!-- id:dup -->
- one <!-- id:dup -->
`
  );

  await expect(
    knowstrApply(workspaceDir, { dryRun: true })
  ).rejects.toMatchObject({
    message: expect.stringContaining("duplicate node ids"),
  });
});

test("apply accepts an inbox file with no ids and mints them on apply", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "holidays.md",
    `
# Holiday Destinations
- Spain
`
  );
  await knowstrSave(workspaceDir);

  const rootId = readNodeId(
    workspaceDir,
    "holidays.md",
    "# Holiday Destinations"
  );

  write(
    workspaceDir,
    "inbox/fresh.md",
    `
# Holiday Destinations <!-- id:${rootId} -->
- Germany
`
  );

  const result = await knowstrApply(workspaceDir, { dryRun: true });
  expect(result.invalid_inbox_paths).toEqual([]);
  expect(result.graph_additions).toHaveLength(1);
});
