import { cleanup, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ALICE, expectTree, renderApp, setup, type } from "../utils.test";
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

test("upcoming entries project; bare past entries live behind the chip", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type(
    "Salon{Enter}{Tab}Termine https://scholarium.at/salon.ics{Escape}"
  );

  await userEvent.click(
    await screen.findByLabelText(
      "expand Termine https://scholarium.at/salon.ics"
    )
  );

  // The past entry doesn't project; the feed row wears the chip instead.
  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  // The chip reveals the past — unjudged, no gutter mark: pastness is
  // node-type rendering, never a judgment.
  await userEvent.click(await screen.findByLabelText("show 1 past date"));
  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  // …and hides it again.
  await userEvent.click(await screen.findByLabelText("hide past dates"));
  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
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

  await type(
    "Salon{Enter}{Tab}Termine https://scholarium.at/salon.ics{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText(
      "expand Termine https://scholarium.at/salon.ics"
    )
  );

  await clickRow("14.07.2030 Sommerfest");
  await userEvent.keyboard("!");

  // Materialized with the judgment; the projected siblings stay computed.
  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
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
  Termine https://scholarium.at/salon.ics
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

  await type(
    "Salon{Enter}{Tab}Termine https://scholarium.at/salon.ics{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText(
      "expand Termine https://scholarium.at/salon.ics"
    )
  );

  // Select the two upcoming entries (shift-j extends the selection down).
  await clickRow("14.07.2030 Sommerfest");
  await userEvent.keyboard("{Shift>}j{/Shift}");
  await userEvent.keyboard("?");

  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
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

  await type(
    "Salon{Enter}{Tab}Termine https://scholarium.at/salon.ics{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText(
      "expand Termine https://scholarium.at/salon.ics"
    )
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
  Termine https://scholarium.at/salon.ics
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
  Termine https://scholarium.at/salon.ics
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

test("dnd both ways: projections drag as themselves and accept drops", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type(
    "Salon{Enter}{Tab}Termine https://scholarium.at/salon.ics{Enter}Notes{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText(
      "expand Termine https://scholarium.at/salon.ics"
    )
  );

  // Drop a real row after a projected entry (drop-on-text inserts as a
  // sibling): the anchor entry materializes and the note keeps its slot;
  // the next projection follows the segment.
  dragTextOnto("Notes", "14.07.2030 Sommerfest");
  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
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
  Termine https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
    ${dunbarText()}
    Notes
  `,
    { showGutter: true }
  );
});

test("a touched past entry is file content: always visible, chip or not", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type(
    "Salon{Enter}{Tab}Termine https://scholarium.at/salon.ics{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText(
      "expand Termine https://scholarium.at/salon.ics"
    )
  );

  // Reveal the past, write under the entry — it materializes.
  await userEvent.click(await screen.findByLabelText("show 1 past date"));
  await userEvent.click(
    await screen.findByLabelText("edit 01.01.2020 Founding seminar")
  );
  await userEvent.keyboard("{Enter}{Tab}Excerpts we are going to read{Escape}");

  // Hide the past again: the touched entry stays — file content always
  // shows, unjudged, no gutter mark; only bare projections hide. The
  // chip is gone: nothing is hidden anymore.
  const expected = `
Salon
  Termine https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
      Excerpts we are going to read
    14.07.2030 Sommerfest
    ${dunbarText()}
  `;
  await expectTree(expected, { showGutter: true });
  expect(screen.queryByLabelText("hide past dates")).toBeNull();

  // An explicit judgment renders as any judgment does.
  await clickRow("01.01.2020 Founding seminar");
  await userEvent.keyboard("!");
  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
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

  await type(
    "Salon{Enter}{Tab}Termine https://scholarium.at/salon.ics{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText(
      "expand Termine https://scholarium.at/salon.ics"
    )
  );

  // Resort the two upcoming entries with the past hidden.
  dragTextOnto(dunbarText(), "14.07.2030 Sommerfest");

  const reordered = `
Salon
  Termine https://scholarium.at/salon.ics
    14.07.2030 Sommerfest
    ${dunbarText()}
  `;
  await expectTree(reordered, { showGutter: true });

  // The order is file content: it survives a reload.
  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: () => Promise.resolve(FEED) });
  await expectTree(reordered, { showGutter: true });

  // The hidden past entry never materialized: it still lives behind the
  // chip, projection-only.
  await userEvent.click(await screen.findByLabelText("show 1 past date"));
  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
    01.01.2020 Founding seminar
    14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );
  await userEvent.click(await screen.findByLabelText("hide past dates"));
  await expectTree(reordered, { showGutter: true });
});

test("past entries render dimmed by type, judged rows full strength", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: () => Promise.resolve(FEED),
  });

  await type(
    "Salon{Enter}{Tab}Termine https://scholarium.at/salon.ics{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText(
      "expand Termine https://scholarium.at/salon.ics"
    )
  );
  await userEvent.click(await screen.findByLabelText("show 1 past date"));

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
