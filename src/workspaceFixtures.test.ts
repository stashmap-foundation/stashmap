/** @jest-environment node */

import fs from "fs";
import path from "path";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  write,
} from "./testFixtures/workspace";

test("knowstrInit creates a temp workspace with a fresh identity", () => {
  const { nsec, npub, path: workspaceDir, profilePath } = knowstrInit();

  expect(nsec).toMatch(/^nsec1/u);
  expect(npub).toMatch(/^npub1/u);
  expect(fs.existsSync(profilePath)).toBe(true);
  expect(profilePath).toBe(path.join(workspaceDir, ".knowstr", "profile.json"));
  expect(fs.existsSync(path.join(workspaceDir, ".knowstr", "me.nsec"))).toBe(
    true
  );
});

test("knowstrInit + write + knowstrSave assigns ids and normalizes markdown", async () => {
  const { path: workspaceDir } = knowstrInit();
  write(
    workspaceDir,
    "hello.md",
    `# Holiday Destinations

- Spain
- France
`
  );

  const result = await knowstrSave(workspaceDir);
  expect(result.changed_paths).toEqual([path.join(workspaceDir, "hello.md")]);

  expectMarkdown(
    workspaceDir,
    "hello.md",
    `# Holiday Destinations <!-- id:... -->

- Spain <!-- id:... -->
- France <!-- id:... -->
`
  );
});
