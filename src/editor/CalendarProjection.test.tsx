import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ALICE, expectTree, renderApp, setup, type } from "../utils.test";

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
