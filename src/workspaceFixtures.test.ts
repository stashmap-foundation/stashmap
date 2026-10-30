/** @jest-environment node */

import fs from "fs";
import path from "path";
import { nip19 } from "nostr-tools";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  write,
} from "./testFixtures/workspace";
import { parseToDocument } from "./core/Document";
import { LOCAL } from "./core/nodeRef";
import {
  buildDepositEvent,
  selectLatestDepositEvents,
} from "./nodesDocumentEvent";
import { loadCliProfile } from "./cli/config";
import { loadWorkspaceAsDocuments } from "./infra/filesystem/workspaceBackend";

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
    `
# Holiday Destinations
- Spain
- France
`
  );

  const result = await knowstrSave(workspaceDir);
  expect(result.changed_paths).toEqual([path.join(workspaceDir, "hello.md")]);

  await expectMarkdown(
    workspaceDir,
    "hello.md",
    `
# Holiday Destinations <!-- id:... -->

- Spain <!-- id:... -->
- France <!-- id:... -->
`
  );
});

test("deposit construction derives one ordered a tag per linked file and i tag per linked thing", async () => {
  const { path: workspaceDir } = knowstrInit();
  const alice = nip19.npubEncode("b".repeat(64));
  write(
    workspaceDir,
    "source.md",
    "# Source <!-- id:source -->\n- Target <!-- id:target -->\n"
  );
  write(
    workspaceDir,
    "notes/main.md",
    [
      "# First <!-- id:a-root -->",
      "",
      "- See [target](../source.md#target) and [asset](rgb:contract) <!-- id:links -->",
      "- [Target](../source.md#target) <!-- id:block -->",
      "- ![Target](../source.md) <!-- id:embed -->",
      "- My target ~~[Target](../source.md#target)~~ <!-- id:reword -->",
      `- ![Her pizza](//${alice}/pizza.md#dough) <!-- id:foreign -->`,
      "- ![feed](webcal://example.com/feed) <!-- id:feed -->",
      "- [web](https://example.com/#top) <!-- id:web -->",
      "- [self](#a-root) <!-- id:self -->",
      "",
      "# Second <!-- id:second -->",
      "",
    ].join("\n")
  );
  await knowstrSave(workspaceDir);
  const profile = loadCliProfile({ cwd: workspaceDir });
  if (!profile.pubkey) {
    throw new Error("Missing test workspace pubkey");
  }
  const documents = await loadWorkspaceAsDocuments({ workspaceDir });
  const document = documents.find(
    (candidate) => candidate.docId === "notes/main.md"
  );
  if (!document) {
    throw new Error("Missing notes/main.md fixture document");
  }
  const content = fs.readFileSync(
    path.join(workspaceDir, "notes/main.md"),
    "utf8"
  );
  const dateNow = jest.spyOn(Date, "now").mockReturnValue(1234000);
  const event = buildDepositEvent(document, profile.pubkey, content, 1234);
  dateNow.mockRestore();

  expect(event).toEqual({
    kind: 34774,
    pubkey: profile.pubkey,
    created_at: 1234,
    tags: [
      ["d", "notes/main.md"],
      ...[
        `34774:${"b".repeat(64)}:pizza.md`,
        `34774:${profile.pubkey}:source.md`,
      ]
        .sort()
        .map((value) => ["a", value]),
      ["i", "https://example.com/"],
      ["i", "rgb:contract"],
      ["i", "webcal://example.com/feed"],
      ["ms", "1234000"],
    ],
    content,
  });
});

test("replacement ordering chooses the latest timestamp then ms", () => {
  const { path: workspaceDir } = knowstrInit();
  const profile = loadCliProfile({ cwd: workspaceDir });
  if (!profile.pubkey) {
    throw new Error("Missing test workspace pubkey");
  }
  const { document } = parseToDocument(LOCAL, "# Notes <!-- id:notes -->\n", {
    path: "notes.md",
  });
  const base = {
    ...buildDepositEvent(document, profile.pubkey, "# Notes\n", 100),
    sig: "0".repeat(128),
  };
  const older = {
    ...base,
    id: "0".repeat(64),
    created_at: 99,
    tags: [
      ["d", "notes.md"],
      ["ms", "99000"],
    ],
  };
  const lowerMs = {
    ...base,
    id: "f".repeat(64),
    tags: [
      ["d", "notes.md"],
      ["ms", "100000"],
    ],
  };
  const higherMs = {
    ...base,
    id: "a".repeat(64),
    tags: [
      ["d", "notes.md"],
      ["ms", "100001"],
    ],
  };
  const otherPath = {
    ...base,
    id: "b".repeat(64),
    created_at: 1,
    tags: [
      ["d", "other.md"],
      ["ms", "1000"],
    ],
  };

  expect(
    selectLatestDepositEvents([older, lowerMs, higherMs, otherPath])
  ).toEqual([higherMs, otherPath]);
});
