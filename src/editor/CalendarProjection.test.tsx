import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ALICE, expectTree, renderApp, setup, type } from "../utils.test";

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:dunbar@scholarium.at",
  "DTSTART:20260921T180000Z",
  "SUMMARY:Seminar Robin Dunbar",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:sommerfest@scholarium.at",
  "DTSTART;VALUE=DATE:20260714",
  "SUMMARY:Sommerfest",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

afterEach(cleanup);

test("calendar nodes project feed entries as rows", async () => {
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

  await expectTree(`
Salon
  Termine https://scholarium.at/salon.ics
    Sommerfest
    Seminar Robin Dunbar
  `);
});
