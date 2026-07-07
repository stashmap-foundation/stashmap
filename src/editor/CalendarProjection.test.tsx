import { cleanup, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  expectTree,
  forkOwnRoot,
  navigateToNodeViaSearch,
  openNodeInFullscreen,
  renderApp,
  renderTree,
  setup,
  type,
} from "../utils.test";
import { clickRow } from "./Multiselect.testUtils";

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:dunbar@scholarium.at",
  "DTSTART:20300921T180000Z",
  "SUMMARY:Seminar Robin Dunbar",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:sommerfest@scholarium.at",
  "DTSTART;VALUE=DATE:20300714",
  "SUMMARY:Sommerfest",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:archive@scholarium.at",
  "DTSTART;VALUE=DATE:20200101",
  "SUMMARY:Founding seminar",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

// Local wall time of the Z instant, mirroring icalEntryDisplayText — keeps
// the expectation timezone-independent.
function dunbarText(): string {
  const date = new Date(Date.UTC(2030, 8, 21, 18, 0, 0));
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(
    date.getMonth() + 1
  )}.${date.getFullYear()} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )} Seminar Robin Dunbar`;
}

afterEach(cleanup);

test("upcoming entries project; bare past entries live behind the action row", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");

  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );

  // The past entry doesn't project; the action row in the footer
  // announces and reveals it.
  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  // The action row reveals the past — unjudged, no judgment gutter mark:
  // pastness is node-type rendering, never a judgment.
  await userEvent.click(await screen.findByLabelText("Show 1 past date"));
  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  // …and hides it again.
  await userEvent.click(await screen.findByLabelText("Hide past dates"));
  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );
});

test("bare feed urls wrap; the label renames without losing the feed", async () => {
  const [alice] = setup([ALICE]);
  const fetchedUrls: string[] = [];
  renderApp({
    ...alice(),
    fetchCalendarFeed: (url: string) => {
      // eslint-disable-next-line functional/immutable-data
      fetchedUrls.push(url);
      return Promise.resolve(FEED);
    },
  });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");

  // The editor shows and edits the label only; the URL is structural.
  const editor = await screen.findByLabelText(
    "edit https://scholarium.at/salon.ics"
  );
  await userEvent.click(editor);
  await userEvent.keyboard("{Control>}a{/Control}Salon Termine{Escape}");

  await userEvent.click(await screen.findByLabelText("expand Salon Termine"));

  await expectTree(
    `
Salon
  Salon Termine
    14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  // The fetch always used the clean URL — never a garbage span across
  // the link form's halves.
  expect(new Set(fetchedUrls)).toEqual(
    new Set(["https://scholarium.at/salon.ics"])
  );
});

test("judging a projected entry materializes it with the judgment", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );

  await clickRow("14.07.2030 Sommerfest");
  await userEvent.keyboard("!");

  // Materialized with the judgment; the projected siblings stay computed.
  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    {!} 14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  // Survives a reload: the entry is real workspace content now (the
  // expanded view state persists too, so no second expand click).
  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    {!} 14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );
});

test("multiselect judgment materializes projected and spares untouched", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );

  // Select the two upcoming entries (shift-j extends the selection down).
  await clickRow("14.07.2030 Sommerfest");
  await userEvent.keyboard("{Shift>}j{/Shift}");
  await userEvent.keyboard("?");

  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    {?} 14.07.2030 Sommerfest
    {?} ${dunbarText()}
  `,
    { showGutter: true }
  );
});

test("writing under a projected entry materializes it with the note", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );

  // Focus the projected entry's editor, Enter to open a position below,
  // Tab to indent under it, write the note.
  await userEvent.click(
    await screen.findByLabelText("edit 14.07.2030 Sommerfest")
  );
  await userEvent.keyboard("{Enter}{Tab}Excerpts we are going to read{Escape}");

  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
      Excerpts we are going to read
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  // Real content: survives reload.
  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
      Excerpts we are going to read
    ${dunbarText()}
  `,
    { showGutter: true }
  );
});

function dragTextOnto(sourceText: string, targetText: string): void {
  // Dropping on a row's text element means "into that row as a child".
  const source = screen.getAllByText(sourceText)[0];
  const target = screen.getAllByText(targetText)[0];
  fireEvent.dragStart(source);
  fireEvent.dragOver(target);
  fireEvent.drop(target);
}

async function altDragTextOnto(
  sourceText: string,
  targetText: string
): Promise<void> {
  const source = screen.getAllByText(sourceText)[0];
  const target = screen.getAllByText(targetText)[0];
  await userEvent.keyboard("{Alt>}");
  fireEvent.dragStart(source);
  fireEvent.dragOver(target, { altKey: true });
  fireEvent.drop(target, { altKey: true });
  await userEvent.keyboard("{/Alt}");
}

test("the same feed in two places: independent placements, notes stay local", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type(
    "Salon{Enter}{Tab}https://scholarium.at/salon.ics{Enter}{Shift>}{Tab}{/Shift}Studium{Enter}{Tab}https://scholarium.at/salon.ics{Escape}"
  );
  const expands = await screen.findAllByLabelText(
    "expand https://scholarium.at/salon.ics"
  );
  await userEvent.click(expands[0]);
  await userEvent.click(
    (
      await screen.findAllByLabelText("expand https://scholarium.at/salon.ics")
    )[0]
  );

  await expectTree(`
Salon
  https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
    ${dunbarText()}
  Studium
    https://scholarium.at/salon.ics
      14.07.2030 Sommerfest
      ${dunbarText()}
  `);

  // Write a different note under the same entry in each context. Every
  // take is its own placement (a link row targeting the one canonical
  // id) — never a second body, never a pointer into the other context.
  const editors = await screen.findAllByLabelText("edit 14.07.2030 Sommerfest");
  await userEvent.click(editors[0]);
  await userEvent.keyboard("{Enter}{Tab}Meine Notiz{Escape}");
  const editorsAfter = await screen.findAllByLabelText(
    "edit 14.07.2030 Sommerfest"
  );
  await userEvent.click(editorsAfter[editorsAfter.length - 1]);
  await userEvent.keyboard("{Enter}{Tab}Andere Notiz{Escape}");

  const expected = `
Salon
  https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
      Meine Notiz
    ${dunbarText()}
  Studium
    https://scholarium.at/salon.ics
      14.07.2030 Sommerfest
        Andere Notiz
      ${dunbarText()}
  `;
  await expectTree(expected);

  // File truth round-trips: two placements of one entry id, each with
  // its local note.
  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await expectTree(expected);
});

test("following a dangling entry link opens the carrying calendar at the entry", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type(
    "Salon{Enter}{Tab}https://scholarium.at/salon.ics{Enter}{Shift>}{Tab}{/Shift}Notes{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await altDragTextOnto(dunbarText(), "Notes");

  // No minted node anywhere carries the ical: id — the link resolves
  // through the feed that carries the UID: the calendar opens as root,
  // scrolled to the projected entry.
  await userEvent.click(
    await screen.findByLabelText(
      `Navigate to Salon / https://scholarium.at/salon.ics / ${dunbarText()}`
    )
  );
  await expectTree(`
https://scholarium.at/salon.ics
  14.07.2030 Sommerfest
  ${dunbarText()}
  `);
});

test("cross-pane drag of an entry lays down a link row, never a copy", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type(
    "Salon{Enter}{Tab}https://scholarium.at/salon.ics{Enter}{Shift>}{Tab}{/Shift}Notes{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  await navigateToNodeViaSearch(1, "Notes");
  await openNodeInFullscreen(1, "Notes");

  // A plain cross-pane drag deep-copies ordinary rows — but a canonical
  // id never copies into a second body: the appearance in the other
  // pane is a link row targeting the one entry id.
  const source = screen.getAllByText(dunbarText())[0];
  const notesItems = screen.getAllByRole("treeitem", { name: "Notes" });
  const target = notesItems[notesItems.length - 1];
  fireEvent.dragStart(source);
  fireEvent.dragOver(target);
  fireEvent.drop(target);

  await expectTree(`
Salon
  https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
    ${dunbarText()}
  Notes
Notes
  [R] ${dunbarText()}
  `);
});

test("alt-drag references an entry: clean label, canonical target, dangling allowed", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  // The feed-as-link calendar: the raw markdown link form lives in the
  // file; every read path shows the label.
  await type(
    "Salon{Enter}{Tab}https://scholarium.at/salon.ics{Enter}Notes{Escape}"
  );
  const editor = await screen.findByLabelText(
    "edit https://scholarium.at/salon.ics"
  );
  await userEvent.click(editor);
  await userEvent.keyboard("{Control>}a{/Control}Kalender Studium{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand Kalender Studium")
  );

  await expectTree(`
Salon
  Kalender Studium
    14.07.2030 Sommerfest
    ${dunbarText()}
  Notes
  `);

  // Alt-drag a still-projected entry into Notes: a reference — dangling
  // allowed, nothing materialized anywhere. The label is the breadcrumb
  // in display form: the calendar reads by its label, never as raw link
  // markdown, so the new row neither nests links nor carries the feed
  // URL (which would make it read as the calendar itself).
  await altDragTextOnto(dunbarText(), "Notes");

  await expectTree(`
Salon
  Kalender Studium
    14.07.2030 Sommerfest
    ${dunbarText()}
  Notes
  [R] Salon / Kalender Studium / ${dunbarText()}
  `);

  // The persisted form survives the file round-trip: reload parses the
  // link back rather than tripping over nested markdown.
  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await expectTree(`
Salon
  Kalender Studium
    14.07.2030 Sommerfest
    ${dunbarText()}
  Notes
  [R] Salon / Kalender Studium / ${dunbarText()}
  `);
  expect(screen.queryByText(/deleted/)).toBeNull();
});

test("dnd both ways: projections drag as themselves and accept drops", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type(
    "Salon{Enter}{Tab}https://scholarium.at/salon.ics{Enter}Notes{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );

  // Drop a real row after a projected entry (drop-on-text inserts as a
  // sibling): the anchor entry materializes and the note keeps its slot;
  // the next projection follows the segment.
  dragTextOnto("Notes", "14.07.2030 Sommerfest");
  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
    Notes
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  // Drag a still-projected entry to resort it: a within-calendar
  // reorder materializes the whole displayed sequence; the dragged
  // entry lands at the drop position with no duplicate.
  dragTextOnto(dunbarText(), "14.07.2030 Sommerfest");
  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
    ${dunbarText()}
    Notes
  `,
    { showGutter: true }
  );
});

test("a touched past entry is file content: always visible, revealed or not", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );

  // Reveal the past, write under the entry — it materializes.
  await userEvent.click(await screen.findByLabelText("Show 1 past date"));
  await userEvent.click(
    await screen.findByLabelText("edit 01.01.2020 Founding seminar")
  );
  await userEvent.keyboard("{Enter}{Tab}Excerpts we are going to read{Escape}");

  // The touched entry is file content now — and with nothing left
  // hidden, the action row is gone entirely.
  const expected = `
Salon
  https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
      Excerpts we are going to read
    14.07.2030 Sommerfest
    ${dunbarText()}
  `;
  await expectTree(expected, { showGutter: true });
  expect(screen.queryByLabelText("Hide past dates")).toBeNull();

  // An explicit judgment renders as any judgment does.
  await clickRow("01.01.2020 Founding seminar");
  await userEvent.keyboard("!");
  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    {!} 01.01.2020 Founding seminar
      Excerpts we are going to read
    14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );
});

test("reorder materializes only the displayed sequence — hidden past stays a projection", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );

  // Resort the two upcoming entries with the past hidden.
  dragTextOnto(dunbarText(), "14.07.2030 Sommerfest");

  const reordered = `
Salon
  https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
    ${dunbarText()}
  `;
  await expectTree(reordered, { showGutter: true });

  // The order is file content: it survives a reload.
  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await expectTree(reordered, { showGutter: true });

  // The hidden past entry never materialized: it still lives behind
  // the action row, projection-only.
  await userEvent.click(await screen.findByLabelText("Show 1 past date"));
  await expectTree(
    `
Salon
  https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );
  await userEvent.click(await screen.findByLabelText("Hide past dates"));
  await expectTree(reordered, { showGutter: true });
});

test("past entries render dimmed by type, judged rows full strength", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type("Salon{Enter}{Tab}https://scholarium.at/salon.ics{Escape}");
  await userEvent.click(
    await screen.findByLabelText("expand https://scholarium.at/salon.ics")
  );
  await userEvent.click(await screen.findByLabelText("Show 1 past date"));

  // Style assertions need the wrapping styled span — DOM traversal is the
  // point here.
  /* eslint-disable testing-library/no-node-access */
  const pastText = screen.getAllByText("01.01.2020 Founding seminar")[0];
  expect(pastText.closest("span[style*='opacity']")).not.toBeNull();
  const upcomingText = screen.getAllByText("14.07.2030 Sommerfest")[0];
  expect(upcomingText.closest("span[style*='opacity']")).toBeNull();

  // Deliberate emphasis beats default de-emphasis.
  await clickRow("01.01.2020 Founding seminar");
  await userEvent.keyboard("!");
  const judged = screen.getAllByText("01.01.2020 Founding seminar")[0];
  expect(judged.closest("span[style*='opacity']")).toBeNull();
  /* eslint-enable testing-library/no-node-access */
});

test("a suggested calendar link is a plain proposal: label, no liveness", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);
  await type("Events{Enter}{Tab}Placeholder{Escape}");
  cleanup();

  // Fork the root; in the fork, add a calendar feed link and name it.
  await forkOwnRoot(alice, "Events", "Events Fork");
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await navigateToNodeViaSearch(0, "Events Fork");
  await userEvent.click(await screen.findByLabelText("edit Placeholder"));
  await userEvent.keyboard("{Enter}https://scholarium.at/salon.ics{Escape}");
  const editor = await screen.findByLabelText(
    "edit https://scholarium.at/salon.ics"
  );
  await userEvent.click(editor);
  await userEvent.keyboard("{Control>}a{/Control}Termine{Escape}");
  cleanup();

  // The original sees the fork's addition as a suggestion: rendered by
  // its LABEL, and dead — no triangle, no past chip, no projections.
  // Overlays attach to file rows only; a proposal is a leaf of the
  // proposal system.
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await navigateToNodeViaSearch(0, "Events");
  await expectTree(`
Events
  Placeholder
  [S] Termine
  [S] Events Events Fork
  `);
  expect(screen.queryByLabelText("expand Termine")).toBeNull();
  expect(screen.queryByLabelText(/Show \d+ past/u)).toBeNull();
});
