import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import path from "path";
import { renderAppTree } from "../appTestUtils.test";
import { expectTree } from "../utils.test";
import { knowstrInit, write } from "../testFixtures/workspace";
import {
  SNAPSHOTS_DIR,
  snapshotIdForContent,
  snapshotRelativePath,
} from "../nodesDocumentEvent";

afterEach(cleanup);

const ARCHITECTURE_MD = [
  "# Architecture <!-- id:arch -->",
  "",
  "- Art Nouveau <!-- id:an1 -->",
  "  - Barcelona <!-- id:bcn -->",
  "  - Paris <!-- id:paris -->",
  "",
].join("\n");

function hobbiesMd(snapshotAttr: string): string {
  return [
    "# My Hobbies <!-- id:hob -->",
    "",
    `- Art Nouveau <!-- id:an2 basedOn="an1"${snapshotAttr} -->`,
    '  - Barcelona <!-- id:bcn2 basedOn="bcn" -->',
    "  - Vienna <!-- id:vienna -->",
    "",
  ].join("\n");
}

test("fork baseline from the filesystem snapshot store drives [S] rows", async () => {
  const { path: workspacePath } = knowstrInit();
  const snapshotContent = [
    "# Architecture <!-- id:arch -->",
    "",
    "- Art Nouveau <!-- id:an1 -->",
    "  - Barcelona <!-- id:bcn -->",
    "",
  ].join("\n");
  const snapshotId = snapshotIdForContent(snapshotContent);
  write(workspacePath, "architecture.md", ARCHITECTURE_MD);
  write(workspacePath, "hobbies.md", hobbiesMd(` snapshot="${snapshotId}"`));
  write(workspacePath, snapshotRelativePath(snapshotId), snapshotContent);

  await renderAppTree({ path: workspacePath, search: "Architecture" });
  await userEvent.click(await screen.findByLabelText("expand Art Nouveau"));

  await expectTree(`
Architecture
  Art Nouveau
    Barcelona
    Paris
    [S] Vienna
  `);
});

test("first save repairs a legacy fork: snapshot file written, id stamped", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "architecture.md", ARCHITECTURE_MD);
  write(workspacePath, "hobbies.md", hobbiesMd(""));

  await renderAppTree({ path: workspacePath, search: "My Hobbies" });

  await userEvent.click(await screen.findByLabelText("edit Art Nouveau"));
  await userEvent.keyboard("{Enter}{Tab}Madrid{Escape}");

  const snapshotsDir = path.join(workspacePath, SNAPSHOTS_DIR);
  await waitFor(() => {
    expect(fs.readdirSync(snapshotsDir)).toHaveLength(1);
  });
  const [snapshotFile] = fs.readdirSync(snapshotsDir);
  const snapshotContent = fs.readFileSync(
    path.join(snapshotsDir, snapshotFile),
    "utf8"
  );
  expect(snapshotIdForContent(snapshotContent)).toBe(snapshotFile.slice(0, -3));
  expect(snapshotContent).toContain("Architecture");

  const hobbies = fs.readFileSync(
    path.join(workspacePath, "hobbies.md"),
    "utf8"
  );
  expect(hobbies).toContain(`snapshot="${snapshotFile.slice(0, -3)}"`);
});
