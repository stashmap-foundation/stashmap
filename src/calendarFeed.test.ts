import { fetchCalendarEntries } from "./calendarFeed";

const FEED = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:a@x",
  "DTSTART:20260714T100000Z",
  "SUMMARY:Sommerfest",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\n");

test("failure returns the last good projection", async () => {
  const url = "https://x.org/cache-test.ics";
  const good = await fetchCalendarEntries(url, () => Promise.resolve(FEED));
  expect(good.map((e) => e.summary)).toEqual(["Sommerfest"]);

  const stale = await fetchCalendarEntries(url, () =>
    Promise.reject(new Error("offline"))
  );
  expect(stale).toEqual(good);

  const garbage = await fetchCalendarEntries(url, () =>
    Promise.resolve("<html>502</html>")
  );
  expect(garbage).toEqual(good);
});

test("failure with no cache throws", async () => {
  await expect(
    fetchCalendarEntries("https://x.org/never-seen.ics", () =>
      Promise.reject(new Error("offline"))
    )
  ).rejects.toThrow("offline");
});
