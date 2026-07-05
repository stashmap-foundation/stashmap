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

test("calendar nodes project dated rows; the past proposes ~", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    fetchCalendarFeed: async () => FEED,
  });

  await type(
    "Salon{Enter}{Tab}Termine https://scholarium.at/salon.ics{Escape}"
  );

  await userEvent.click(
    await screen.findByLabelText(
      "expand Termine https://scholarium.at/salon.ics"
    )
  );

  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
    {~} 01.01.2020 Founding seminar
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
    fetchCalendarFeed: async (url: string) => {
      fetchedUrls.push(url);
      return FEED;
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
    {~} 01.01.2020 Founding seminar
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
    fetchCalendarFeed: async () => FEED,
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
    {~} 01.01.2020 Founding seminar
    {!} 14.07.2030 Sommerfest
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  // Survives a reload: the entry is real workspace content now (the
  // expanded view state persists too, so no second expand click).
  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: async () => FEED });
  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
    {~} 01.01.2020 Founding seminar
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
    fetchCalendarFeed: async () => FEED,
  });

  await type(
    "Salon{Enter}{Tab}Termine https://scholarium.at/salon.ics{Escape}"
  );
  await userEvent.click(
    await screen.findByLabelText(
      "expand Termine https://scholarium.at/salon.ics"
    )
  );

  // Select the two future entries (shift-j extends the selection down).
  await clickRow("14.07.2030 Sommerfest");
  await userEvent.keyboard("{Shift>}j{/Shift}");
  await userEvent.keyboard("?");

  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
    {~} 01.01.2020 Founding seminar
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
    fetchCalendarFeed: async () => FEED,
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
    {~} 01.01.2020 Founding seminar
    14.07.2030 Sommerfest
      Excerpts we are going to read
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  // Real content: survives reload.
  cleanup();
  renderApp({ ...alice(), fetchCalendarFeed: async () => FEED });
  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
    {~} 01.01.2020 Founding seminar
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
    fetchCalendarFeed: async () => FEED,
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
    {~} 01.01.2020 Founding seminar
    14.07.2030 Sommerfest
    Notes
    ${dunbarText()}
  `,
    { showGutter: true }
  );

  // Drag a still-projected entry to resort it: it materializes at the
  // drop position, and the calendar projects no duplicate.
  dragTextOnto(dunbarText(), "14.07.2030 Sommerfest");
  await expectTree(
    `
Salon
  Termine https://scholarium.at/salon.ics
    {~} 01.01.2020 Founding seminar
    14.07.2030 Sommerfest
    ${dunbarText()}
    Notes
  `,
    { showGutter: true }
  );
});
