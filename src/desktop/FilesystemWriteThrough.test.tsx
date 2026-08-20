import fs from "fs";
import os from "os";
import pathModule from "path";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Map as ImmutableMap } from "immutable";
import { Event, verifyEvent } from "nostr-tools";
import userEvent from "@testing-library/user-event";
import {
  expectMarkdown,
  knowstrInit,
  knowstrSave,
  ls,
  write,
} from "../testFixtures/workspace";
import { renderAppTree } from "../appTestUtils.test";
import {
  expectTree,
  findNewNodeEditor,
  navigateToNodeViaSearch,
  type,
} from "../utils.test";
import type { WritePublisher } from "../infra/filesystem/writeSupport";
import { buildDocumentRouteUrl } from "../navigationUrl";
import { LOCAL } from "../core/nodeRef";

async function expectKnowstrDocIdFrontmatter(
  workspacePath: string,
  relativePath: string
): Promise<void> {
  await waitFor(() => {
    const content = fs.readFileSync(`${workspacePath}/${relativePath}`, "utf8");
    expect(content).toMatch(/^---\n[\s\S]*knowstr_doc_id:/u);
  });
}

const compositionCorpusPath = pathModule.resolve(
  __dirname,
  "../../test/corpus"
);
const compositionFixtures = fs
  .readdirSync(compositionCorpusPath, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      ["source.md", "diff.md", "expected.tree"].every((file) =>
        fs.existsSync(pathModule.join(compositionCorpusPath, entry.name, file))
      )
  )
  .map((entry) => entry.name)
  .sort();

if (compositionFixtures.length === 0) {
  throw new Error("Composition corpus is empty");
}

function visibleFixtureTree(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const match = line.match(
        /^(.*) <!-- (?:id|base):\S+((?: flag:\S+)*) -->$/u
      );
      if (!match) {
        return line;
      }
      const [, text, flags] = match;
      return flags.includes("flag:dangling") ? `${text}†` : text;
    })
    .join("\n");
}

test.each(compositionFixtures)(
  "composition fixture UI: %s",
  async (fixture) => {
    const fixturePath = pathModule.join(compositionCorpusPath, fixture);
    const workspacePath = fs.mkdtempSync(
      pathModule.join(os.tmpdir(), "knowstr-composition-")
    );
    fs.copyFileSync(
      pathModule.join(fixturePath, "source.md"),
      pathModule.join(workspacePath, "source.md")
    );
    fs.copyFileSync(
      pathModule.join(fixturePath, "diff.md"),
      pathModule.join(workspacePath, "diff.md")
    );

    await renderAppTree({
      path: workspacePath,
      initialRoute: buildDocumentRouteUrl(LOCAL, "diff.md"),
    });
    const [root] = await screen.findAllByRole("treeitem");
    await userEvent.click(root);
    await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");

    const expected = visibleFixtureTree(
      fs.readFileSync(pathModule.join(fixturePath, "expected.tree"), "utf8")
    );
    await expectTree(expected, { showGutter: true, composedOnly: true });
  }
);

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
- Holiday Destinations <!-- id:... -->
  - Spain <!-- id:... -->
  - France <!-- id:... -->
`
  );
  expect(ls(path)).toEqual(["holiday-destinations.md", "log.md"]);
});

test("adding a sibling to a hand-written file updates the same file (no duplicate)", async () => {
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

test("creating a new document via the app persists knowstr_doc_id frontmatter to disk", async () => {
  const { path } = await renderAppTree();
  if (!path) {
    throw new Error("expected renderAppTree to return a workspace path");
  }
  await findNewNodeEditor();
  await type("My Notes{Enter}{Tab}Spain{Escape}");

  await expectKnowstrDocIdFrontmatter(path, "my-notes.md");
});

test("adding a sibling to holidays.md persists frontmatter", async () => {
  const { path } = knowstrInit();
  write(path, "holidays.md", "# Holiday Destinations\n- France\n- Paris\n");

  await renderAppTree({ path, search: "Holiday Destinations" });
  await expectTree(`
Holiday Destinations
  France
  Paris
`);

  await userEvent.click(await screen.findByLabelText("edit Paris"));
  await userEvent.keyboard("{Enter}Spain{Escape}");

  await expectTree(`
Holiday Destinations
  France
  Paris
  Spain
`);

  await expectKnowstrDocIdFrontmatter(path, "holidays.md");
});

test("editing a hand-written file persists knowstr_doc_id frontmatter to disk", async () => {
  const { path } = knowstrInit();
  write(path, "notes.md", "# Notes\n- alpha\n");

  await renderAppTree({ path, search: "Notes" });
  await expectTree(`
Notes
  alpha
`);

  await userEvent.click(await screen.findByLabelText("edit alpha"));
  await userEvent.keyboard("{Enter}beta{Escape}");

  await expectTree(`
Notes
  alpha
  beta
`);

  await expectKnowstrDocIdFrontmatter(path, "notes.md");
});

test("opening a workspace does not write to any file on disk", async () => {
  const { path } = knowstrInit();
  const before = `
# Doc
- one
`;
  write(path, "doc.md", before);

  await renderAppTree({ path, search: "Doc" });
  await expectTree(`
Doc
  one
`);

  expect(ls(path)).toEqual(["doc.md"]);
  expect(fs.readFileSync(`${path}/doc.md`, "utf8")).toBe(before);
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

test("a manually-created log.md does not collide with the auto-created Log root", async () => {
  const { path } = knowstrInit();
  write(path, "log.md", "# My Log\n- alpha\n");

  await renderAppTree({ path });
  await screen.findByLabelText("Navigate to Log");
  await findNewNodeEditor();

  await type("Holiday Destinations{Escape}");

  await expectTree(`
Holiday Destinations
`);

  const files = ls(path);
  expect(files).toContain("log.md");
  expect(files).toContain("holiday-destinations.md");
  expect(files).not.toContain("log-2.md");
  expect(files).not.toContain("~log.md");

  await userEvent.click(await screen.findByLabelText("Navigate to Log"));

  await expectTree(`
My Log
  Holiday Destinations
  alpha
`);
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

test("paragraph prefix marks render in the gutter and can be updated", async () => {
  const { path } = knowstrInit();
  write(
    path,
    "doc.md",
    `
# Root

(?-) marked paragraph

plain paragraph
`
  );

  await renderAppTree({ path, search: "Root" });

  await expectTree(
    `
Root
  {?-} marked paragraph
  plain paragraph
`,
    { showGutter: true }
  );

  await userEvent.click(
    await screen.findByLabelText("set plain paragraph to relevant")
  );

  await expectTree(
    `
Root
  {?-} marked paragraph
  {!} plain paragraph
`,
    { showGutter: true }
  );

  await expectMarkdown(
    path,
    "doc.md",
    `
# Root <!-- id:... -->

(-?) marked paragraph <!-- id:... -->

(!) plain paragraph <!-- id:... -->
`
  );
});

test("alt-drag link from a hand-written file points to the same id persisted on disk", async () => {
  const { path } = knowstrInit();
  write(path, "notes.md", "# First\n- Item One\n");
  write(path, "links.md", "# My Links");

  await renderAppTree({ path });

  await navigateToNodeViaSearch(0, "First");
  await userEvent.click(await screen.findByLabelText("Open new pane"));
  await navigateToNodeViaSearch(1, "My Links");

  await expectTree(`
First
  Item One
My Links
`);

  const myLinksItems = screen.getAllByRole("treeitem", { name: "My Links" });
  const myLinksInPane1 = myLinksItems[myLinksItems.length - 1];

  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(screen.getAllByText("Item One")[0]);
  fireEvent.dragOver(myLinksInPane1, { altKey: true });
  fireEvent.drop(myLinksInPane1, { altKey: true });
  await userEvent.keyboard("{/Alt}");

  await expectTree(`
First
  Item One
My Links
  Item One
`);

  await waitFor(() => {
    const notes = fs.readFileSync(`${path}/notes.md`, "utf8");
    expect(notes).toMatch(/Item One <!-- id:([0-9a-f-]+) -->/u);
    const links = fs.readFileSync(`${path}/links.md`, "utf8");
    expect(links).toMatch(/\]\(#[^)]+\)/u);
  });

  const notesContent = fs.readFileSync(`${path}/notes.md`, "utf8");
  const linksContent = fs.readFileSync(`${path}/links.md`, "utf8");

  const itemOneIdMatch = notesContent.match(
    /Item One <!-- id:([0-9a-f-]+) -->/u
  );
  const linkTargetMatch = linksContent.match(/\]\(#[^)]*?_?([0-9a-f-]+)\)/u);

  expect(itemOneIdMatch?.[1]).toBeDefined();
  expect(linkTargetMatch?.[1]).toBeDefined();
  expect(linkTargetMatch?.[1]).toBe(itemOneIdMatch?.[1]);
});

function recordingPublisher(
  resultFor: (relayUrl: string, event: Event) => PublishStatus
): {
  publisher: WritePublisher;
  publishEvent: jest.MockedFunction<WritePublisher["publishEvent"]>;
} {
  const publishEvent = jest.fn<
    Promise<PublishResultsOfEvent>,
    [string[], Event]
  >((relayUrls, event) =>
    Promise.resolve({
      event,
      results: ImmutableMap<string, PublishStatus>(
        relayUrls.map((url) => [url, resultFor(url, event)])
      ),
    })
  );
  const publisher: WritePublisher = { publishEvent };
  return { publisher, publishEvent };
}

async function addSettingsRelay(url: string): Promise<void> {
  await userEvent.type(screen.getByLabelText("add room relay"), url);
  await userEvent.click(screen.getByLabelText("save room relay"));
}

async function configureFilesystemWorkspace(
  roomRelays: string[]
): Promise<void> {
  await screen.findByText("Workspace Settings");
  await roomRelays.reduce(
    (saved, url) => saved.then(() => addSettingsRelay(url)),
    Promise.resolve()
  );
  await userEvent.click(screen.getByText("Save"));
}

const publicationModes = [
  {
    label: "local",
    roomRelays: [],
    expected: [],
  },
  {
    label: "shared",
    roomRelays: ["wss://room.example/"],
    expected: [{ kind: 34774, relays: ["wss://room.example/"] }],
  },
];

test.each(publicationModes)(
  "$label publishes only the saved document through configured channels",
  async ({ roomRelays, expected }) => {
    const workspacePath = fs.mkdtempSync(
      pathModule.join(os.tmpdir(), "knowstr-publication-")
    );
    write(
      workspacePath,
      "doc.md",
      "---\nknowstr_doc_id: routed-doc\n---\n# Doc <!-- id:root -->\n- row <!-- id:row -->\n"
    );
    write(
      workspacePath,
      "untouched.md",
      "---\nknowstr_doc_id: untouched-doc\n---\n# Untouched <!-- id:untouched -->\n"
    );
    await knowstrSave(workspacePath);
    const { publisher, publishEvent } = recordingPublisher(() => ({
      status: "fulfilled",
    }));
    await renderAppTree({
      path: workspacePath,
      initialRoute: "/relays",
      publisher,
    });
    await configureFilesystemWorkspace(roomRelays);
    await navigateToNodeViaSearch(0, "Doc");
    const now = jest.spyOn(Date, "now").mockReturnValue(1750000000123);

    await userEvent.click(await screen.findByLabelText("edit row"));
    await userEvent.keyboard("{End} changed{Escape}");
    await waitFor(() =>
      expect(publishEvent).toHaveBeenCalledTimes(expected.length)
    );
    now.mockRestore();

    const calls = publishEvent.mock.calls.map(([relayUrls, event]) => ({
      relayUrls,
      event,
    }));
    expect(
      calls.map(({ relayUrls, event }) => ({
        kind: event.kind,
        relays: relayUrls,
      }))
    ).toEqual(expected);
    calls.forEach(({ event }) => {
      expect(verifyEvent(event)).toBe(true);
      expect(event.created_at).toBe(1750000000);
      expect(event.tags[0]).toEqual(["d", "routed-doc"]);
    });
    const normalized = fs.readFileSync(
      pathModule.join(workspacePath, "doc.md"),
      "utf8"
    );
    const deposit = calls.find(({ event }) => event.kind === 34774)?.event;
    if (deposit) {
      expect(deposit.content).toBe(normalized);
      expect(deposit.tags).toEqual([
        ["d", "routed-doc"],
        ["S", "root"],
        ["ms", "1750000000123"],
      ]);
    }
  }
);

test("partial and total relay failures are reported and retried on the next save", async () => {
  const workspacePath = fs.mkdtempSync(
    pathModule.join(os.tmpdir(), "knowstr-publication-retry-")
  );
  write(
    workspacePath,
    "doc.md",
    "---\nknowstr_doc_id: retry-doc\n---\n# Doc <!-- id:root -->\n- row <!-- id:row -->\n"
  );
  await knowstrSave(workspacePath);
  const { publisher, publishEvent } = recordingPublisher((relayUrl, event) => {
    const succeeds =
      event.content.includes("row one two three") ||
      (event.content.includes("row one") &&
        !event.content.includes("row one two") &&
        relayUrl === "wss://one.example/");
    return succeeds
      ? { status: "fulfilled" }
      : { status: "rejected", reason: "offline" };
  });
  await renderAppTree({
    path: workspacePath,
    initialRoute: "/relays",
    publisher,
  });
  await configureFilesystemWorkspace([
    "wss://one.example/",
    "wss://two.example/",
  ]);
  await navigateToNodeViaSearch(0, "Doc");

  await userEvent.click(await screen.findByLabelText("edit row"));
  await userEvent.keyboard("{End} one{Escape}");
  await waitFor(() => expect(publishEvent).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByLabelText("sync status").textContent).toBe("1/2 relays")
  );
  await expect(publishEvent.mock.results[0]?.value).resolves.toMatchObject({
    results: ImmutableMap({
      "wss://one.example/": { status: "fulfilled" },
      "wss://two.example/": { status: "rejected", reason: "offline" },
    }),
  });

  await userEvent.click(await screen.findByLabelText("edit row one"));
  await userEvent.keyboard("{End} two{Escape}");
  await waitFor(() => expect(publishEvent).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByLabelText("sync status").textContent).toBe("error")
  );
  await userEvent.click(await screen.findByLabelText("edit row one two"));
  await userEvent.keyboard("{End} three{Escape}");
  await waitFor(() => expect(publishEvent).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(screen.getByLabelText("sync status").textContent).toBe("synced")
  );
  expect(publishEvent.mock.calls.map(([relayUrls]) => relayUrls)).toEqual([
    ["wss://one.example/", "wss://two.example/"],
    ["wss://one.example/", "wss://two.example/"],
    ["wss://one.example/", "wss://two.example/"],
  ]);
  expect(
    publishEvent.mock.calls.map(
      ([, event]) => event.tags.find((tag) => tag[0] === "d")?.[1]
    )
  ).toEqual(["retry-doc", "retry-doc", "retry-doc"]);
});
