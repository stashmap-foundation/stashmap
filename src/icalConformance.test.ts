/**
 * Conformance: the fixtures under icalFixtures/ are COPIES of the wallet
 * corpus (deedsats-wallet packages/knowstr_core/test/corpus/ical-ids.json
 * and corpus/ical/) — two implementations projecting the same feed MUST
 * derive byte-identical ids and entries. When the corpus changes, re-copy.
 */
import * as fs from "fs";
import * as path from "path";
import { icalEntryId } from "./core/icalId";
import {
  IcalEntry,
  icalFeedLinkPartsOf,
  icalFeedLinkText,
  icalFeedUrlOf,
  isBareIcalFeedUrl,
  mergeProjectedEntries,
  parseIcalFeed,
} from "./core/ical";

type IdCase = {
  name: string;
  uid: string;
  recurrenceId?: string;
  expected: string;
};

const idFixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, "icalFixtures/ical-ids.json"), "utf8")
) as { cases: IdCase[] };

describe("icalEntryId conformance", () => {
  idFixtures.cases.forEach((c) => {
    test(c.name, () => {
      expect(icalEntryId(c.uid, c.recurrenceId)).toEqual(c.expected);
    });
  });

  test("empty uid is rejected", () => {
    expect(() => icalEntryId("")).toThrow();
  });
});

describe("parseIcalFeed conformance", () => {
  const sample = fs.readFileSync(
    path.join(__dirname, "icalFixtures/sample.ics"),
    "utf8"
  );
  const expected = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "icalFixtures/sample.expected.json"),
      "utf8"
    )
  ) as {
    entries: {
      id: string;
      uid: string;
      summary: string;
      start: string | null;
      allDay: boolean;
    }[];
  };

  test("sample feed projects per the corpus expectation", () => {
    const entries = parseIcalFeed(sample);
    expect(entries.map((e) => e.id)).toEqual(expected.entries.map((e) => e.id));
    expect(entries.map((e) => e.summary)).toEqual(
      expected.entries.map((e) => e.summary)
    );
    expect(entries.map((e) => e.allDay)).toEqual(
      expected.entries.map((e) => e.allDay)
    );
    // Start instants: the Z entry is a UTC instant, the all-day entry a
    // local date, the undated entry undefined.
    const [allDayEntry, utcEntry, undated] = entries;
    expect(new Date(utcEntry.startMs!).toISOString()).toEqual(
      "2026-09-21T18:00:00.000Z"
    );
    expect(new Date(allDayEntry.startMs!).getMonth()).toEqual(6);
    expect(new Date(allDayEntry.startMs!).getDate()).toEqual(14);
    expect(undated.startMs).toBeUndefined();
  });

  test("garbage input throws instead of reading as an empty calendar", () => {
    expect(() => parseIcalFeed("<html>502 Bad Gateway</html>")).toThrow();
  });

  test("text escapes unescape", () => {
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:x",
      "SUMMARY:semi\\; comma\\, slash\\\\ line\\nbreak",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    expect(parseIcalFeed(feed)[0].summary).toEqual(
      "semi; comma, slash\\ line\nbreak"
    );
  });
});

describe("icalFeedUrlOf", () => {
  test("recognizes only the typed feed link form", () => {
    expect(icalFeedUrlOf("[Kalender](feed:https://x.org/salon.ics)")).toEqual(
      "https://x.org/salon.ics"
    );
    expect(
      icalFeedUrlOf("Termine https://x.org/salon.ics")
    ).toBeUndefined();
    expect(icalFeedUrlOf("https://x.org/salon.ics")).toBeUndefined();
    expect(icalFeedUrlOf("webcal://x.org/feed")).toBeUndefined();
    expect(icalFeedUrlOf("just text")).toBeUndefined();
  });
});

describe("mergeProjectedEntries", () => {
  const entry = (id: string): IcalEntry => ({
    id,
    uid: id,
    summary: id,
    allDay: false,
  });

  test("nothing materialized: pure feed order", () => {
    expect(mergeProjectedEntries([], [entry("a"), entry("b")])).toEqual([
      { kind: "projection", entry: entry("a") },
      { kind: "projection", entry: entry("b") },
    ]);
  });

  test("materialized rows keep document order, projections ride anchors", () => {
    // Feed order a,b,c — the user materialized b and moved a plain note in.
    const items = mergeProjectedEntries(
      ["note", "b"],
      [entry("a"), entry("b"), entry("c")]
    );
    expect(items).toEqual([
      { kind: "projection", entry: entry("a") },
      { kind: "child", childId: "note" },
      { kind: "child", childId: "b" },
      { kind: "projection", entry: entry("c") },
    ]);
  });

  test("a note after an entry keeps its slot; projections follow the segment", () => {
    // children: [a, note]; feed: a, b — b anchors to a but emits after
    // a's segment (the note), not between them.
    const items = mergeProjectedEntries(
      ["a", "note"],
      [entry("a"), entry("b")]
    );
    expect(items).toEqual([
      { kind: "child", childId: "a" },
      { kind: "child", childId: "note" },
      { kind: "projection", entry: entry("b") },
    ]);
  });

  test("reordered materialized entries win over feed order", () => {
    // Feed a,b — user materialized both and swapped them.
    const items = mergeProjectedEntries(
      ["b", "a"],
      [entry("a"), entry("b"), entry("c")]
    );
    expect(items).toEqual([
      { kind: "child", childId: "b" },
      { kind: "projection", entry: entry("c") },
      { kind: "child", childId: "a" },
    ]);
  });
});

describe("feed-as-link form", () => {
  test("parses label and url; text is yours, identity in the parentheses", () => {
    expect(
      icalFeedLinkPartsOf("[Salon Kalender](feed:https://x.org/salon.ics)")
    ).toEqual({ label: "Salon Kalender", url: "https://x.org/salon.ics" });
    expect(
      icalFeedLinkPartsOf("[Kalender](https://x.org/salon.ics)")
    ).toBeUndefined();
    expect(icalFeedLinkPartsOf("https://x.org/salon.ics")).toBeUndefined();
    expect(icalFeedLinkPartsOf("[note](#u1)")).toBeUndefined();
  });

  test("bare feed urls wrap into the typed form; mixed text does not", () => {
    expect(isBareIcalFeedUrl("https://x.org/salon.ics")).toBe(true);
    expect(isBareIcalFeedUrl("  webcal://x.org/f.ics ")).toBe(true);
    expect(isBareIcalFeedUrl("Termine https://x.org/salon.ics")).toBe(false);
    expect(isBareIcalFeedUrl("[x](feed:https://x.org/f.ics)")).toBe(false);
    expect(icalFeedLinkText("https://x.org/f.ics")).toEqual(
      "[https://x.org/f.ics](feed:https://x.org/f.ics)"
    );
  });
});
