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

test("a fetched feed parses into entries", async () => {
  const entries = await fetchCalendarEntries("https://x.org/salon.ics", () =>
    Promise.resolve(FEED)
  );
  expect(entries.map((e) => e.summary)).toEqual(["Sommerfest"]);
});

test("a non-https feed url is rejected before fetching", async () => {
  const fetcher = jest.fn(() => Promise.resolve(FEED));
  await expect(
    fetchCalendarEntries("http://x.org/salon.ics", fetcher)
  ).rejects.toThrow("https");
  await expect(
    fetchCalendarEntries("ftp://x.org/salon.ics", fetcher)
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

test("a webcal url passes validation", async () => {
  const fetcher = jest.fn(() => Promise.resolve(FEED));
  const entries = await fetchCalendarEntries(
    "webcal://x.org/salon.ics",
    fetcher
  );
  expect(entries.map((e) => e.summary)).toEqual(["Sommerfest"]);
});

test("private and loopback hosts are rejected before fetching", async () => {
  const fetcher = jest.fn(() => Promise.resolve(FEED));
  const urls = [
    "https://localhost/salon.ics",
    "https://feeds.localhost/salon.ics",
    "https://127.0.0.1/salon.ics",
    "https://10.0.0.5/salon.ics",
    "https://172.16.0.1/salon.ics",
    "https://192.168.1.1/salon.ics",
    "https://169.254.169.254/salon.ics",
    "https://0.0.0.0/salon.ics",
    "https://[::1]/salon.ics",
    "https://user:pass@x.org/salon.ics",
  ];
  await Promise.all(
    urls.map((url) =>
      expect(fetchCalendarEntries(url, fetcher)).rejects.toThrow()
    )
  );
  expect(fetcher).not.toHaveBeenCalled();
});

test("a failed fetch throws", async () => {
  await expect(
    fetchCalendarEntries("https://x.org/salon.ics", () =>
      Promise.reject(new Error("offline"))
    )
  ).rejects.toThrow("offline");
});

test("an error page throws instead of reading as an empty calendar", async () => {
  await expect(
    fetchCalendarEntries("https://x.org/salon.ics", () =>
      Promise.resolve("<html>502</html>")
    )
  ).rejects.toThrow("not an iCalendar feed");
});
