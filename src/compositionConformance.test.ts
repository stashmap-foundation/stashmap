/**
 * Conformance: every composition fixture under test/corpus/ runs through the
 * production parser and composer; the projected tree MUST match
 * expected.tree byte-for-byte. scripts/generateKnowstrCorpus.ts is the sole
 * expectation generator — this test never rewrites expectations.
 */
import * as fs from "fs";
import * as path from "path";
import { composeFixtureTree } from "./treeTraversal";

const corpusDir = path.resolve(__dirname, "../test/corpus");
const fixtures = fs
  .readdirSync(corpusDir, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      ["source.md", "diff.md", "expected.tree"].every((file) =>
        fs.existsSync(path.join(corpusDir, entry.name, file))
      )
  )
  .map((entry) => entry.name)
  .sort();

if (fixtures.length === 0) {
  throw new Error("Composition corpus is empty");
}

test.each(fixtures)(
  "composition fixture composes to expected.tree: %s",
  (fixture) => {
    const fixtureDir = path.join(corpusDir, fixture);
    const files = ["source.md", "diff.md"].map((name) => ({
      name,
      content: fs.readFileSync(path.join(fixtureDir, name), "utf8"),
    }));
    const expected = fs.readFileSync(
      path.join(fixtureDir, "expected.tree"),
      "utf8"
    );
    expect(composeFixtureTree(files, "diff.md")).toBe(expected);
  }
);
