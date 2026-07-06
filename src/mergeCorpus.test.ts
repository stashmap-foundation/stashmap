/** @jest-environment node */
import fs from "fs";
import path from "path";
import { mergeSubscribed } from "./core/merge/kernel";
import { diffVersions } from "./core/merge/diff";
import { snapshotIdForContent } from "./nodesDocumentEvent";

// The merge corpus: one directory per case, named by its matrix code.
// The fixtures ARE the law (idea.md, The subscription law) — every ruling
// from the design sessions is encoded as a case, and the Dart
// implementation must pass byte-identical copies of this corpus.

const CORPUS_DIR = path.join(__dirname, "core", "merge", "corpus");

type CaseConfig = {
  mode: "subscribe" | "display" | "hash" | "error";
  join?: "id" | "basedOn";
};

function read(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, name), "utf8");
}

function readOptional(dir: string, name: string): string | undefined {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

function readSnapshots(dir: string): Record<string, string> {
  const snapDir = path.join(dir, "snapshots");
  if (!fs.existsSync(snapDir)) return {};
  return Object.fromEntries(
    fs
      .readdirSync(snapDir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => [name.slice(0, -3), read(snapDir, name)])
  );
}

function readTheirs(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => /^theirs(-\d+)?\.md$/u.test(name))
    .sort()
    .map((name) => read(dir, name));
}

function sorted<T>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    JSON.stringify(a) < JSON.stringify(b) ? -1 : 1
  );
}

const cases = fs
  .readdirSync(CORPUS_DIR)
  .filter((name) => fs.statSync(path.join(CORPUS_DIR, name)).isDirectory())
  .sort();

test("corpus is not empty", () => {
  expect(cases.length).toBeGreaterThan(30);
});

describe.each(cases)("%s", (caseName) => {
  const dir = path.join(CORPUS_DIR, caseName);
  const config = JSON.parse(read(dir, "case.json")) as CaseConfig;

  test("matches expectation", () => {
    if (config.mode === "hash") {
      const expected = JSON.parse(read(dir, "expected.json"));
      expect(snapshotIdForContent(read(dir, "content.md"))).toBe(
        expected.snapshot
      );
      return;
    }
    if (config.mode === "error") {
      const expected = JSON.parse(read(dir, "expected.json"));
      expect(() =>
        mergeSubscribed({
          mine: read(dir, "mine.md"),
          theirs: read(dir, "theirs.md"),
          snapshots: readSnapshots(dir),
        })
      ).toThrow(expected.error);
      return;
    }
    const expected = JSON.parse(read(dir, "expected.json"));
    if (config.mode === "subscribe") {
      const result = mergeSubscribed({
        mine: read(dir, "mine.md"),
        theirs: read(dir, "theirs.md"),
        snapshots: readSnapshots(dir),
      });
      const expectedMerged = readOptional(dir, "expected.md");
      if (expectedMerged !== undefined) {
        expect(result.merged).toBe(expectedMerged);
      }
      expect({
        changed: result.changed,
        suggestions: sorted(result.suggestions),
        detached: sorted(result.detached),
        pins: sorted(result.pins),
      }).toEqual({
        changed: expected.changed,
        suggestions: sorted(expected.suggestions),
        detached: sorted(expected.detached),
        pins: sorted(expected.pins),
      });
    } else {
      const result = diffVersions({
        mine: read(dir, "mine.md"),
        theirs: readTheirs(dir),
        baseline: readOptional(dir, "baseline.md"),
        join: config.join ?? "id",
      });
      expect({
        suggestions: sorted(result.suggestions),
        drift: result.drift,
      }).toEqual({
        suggestions: sorted(expected.suggestions),
        drift: expected.drift,
      });
    }
  });
});
