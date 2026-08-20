import * as fs from "fs";
import * as path from "path";
import {
  composeFixtureShowings,
  composeFixtureTree,
} from "./testFixtures/compositionCorpus";

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

function fixtureFiles(fixture: string): { name: string; content: string }[] {
  const fixtureDir = path.join(corpusDir, fixture);
  return ["source.md", "diff.md"].map((name) => ({
    name,
    content: fs.readFileSync(path.join(fixtureDir, name), "utf8"),
  }));
}

test.each(fixtures)(
  "composition fixture composes to expected.tree: %s",
  (fixture) => {
    const expected = fs.readFileSync(
      path.join(corpusDir, fixture, "expected.tree"),
      "utf8"
    );
    expect(composeFixtureTree(fixtureFiles(fixture), "diff.md")).toBe(expected);
  }
);

test("an embed chain keeps every line as a showing with its embed trail", () => {
  const [root] = composeFixtureShowings(
    fixtureFiles("05-root-embed-chain"),
    "diff.md"
  );
  expect(root.name).toEqual(["o0"]);
  expect(root.target?.node.id).toBe("inner");
  expect(root.target?.name).toEqual(["o0", "inner"]);
  expect(root.target?.target?.node.id).toBe("terminal");
  expect(root.target?.target?.name).toEqual(["o0", "inner", "terminal"]);
  expect(root.target?.target?.children.map((child) => child.name)).toEqual([
    ["o0", "inner", "c"],
  ]);
});

test("a user's own line below an embed carries the embed in its name", () => {
  const [root] = composeFixtureShowings(
    [
      {
        name: "source.md",
        content: "# Source <!-- id:src -->\n\n- Argument A <!-- id:a -->\n",
      },
      {
        name: "diff.md",
        content: [
          '# [Source](#src) <!-- id:o0 embed="true" -->',
          "",
          "- My own note <!-- id:own -->",
          "",
        ].join("\n"),
      },
    ],
    "diff.md"
  );
  expect(root.children.map((child) => child.name)).toEqual([["o0", "own"]]);
  expect(root.target?.children.map((child) => child.name)).toEqual([
    ["o0", "a"],
  ]);
});

test("expected.tree text is accessible display text", () => {
  const tree = composeFixtureTree(
    [
      {
        name: "source.md",
        content: [
          "# Source <!-- id:root -->",
          "",
          "- See [Spain](#wd:Q29) and **compare** <!-- id:a -->",
          "- My words ~~[Old words](#u1)~~ <!-- id:b -->",
          "- Escaped \\* star and `code` <!-- id:c -->",
          "- ~~struck~~ text with ![Alt words](https://example.org/x.png) <!-- id:d -->",
          "",
        ].join("\n"),
      },
      {
        name: "diff.md",
        content: '# [Source](#root) <!-- id:o0 embed="true" -->\n',
      },
    ],
    "diff.md"
  );
  expect(tree).toBe(
    [
      "Source <!-- id:o0 -->",
      "  See Spain and compare <!-- base:a -->",
      "  My words <!-- base:b -->",
      "  Escaped * star and code <!-- base:c -->",
      "  struck text with Alt words <!-- base:d -->",
      "",
    ].join("\n")
  );
});

test("an embed of a structural ancestor closes the cycle at once", () => {
  const [root] = composeFixtureShowings(
    fixtureFiles("07-ancestor-embed-cycle"),
    "diff.md"
  );
  const argumentA = root.target?.children[0];
  const backToA = argumentA?.children[0];
  expect(backToA?.node.id).toBe("b");
  expect(backToA?.cycle).toBe(true);
  expect(backToA?.target).toBeUndefined();
  expect(backToA?.children).toEqual([]);
});

test("a self-embed closes the cycle on its own line", () => {
  const [root] = composeFixtureShowings(
    fixtureFiles("08-self-embed"),
    "diff.md"
  );
  const myself = root.target?.children[0];
  expect(myself?.node.id).toBe("s");
  expect(myself?.cycle).toBe(true);
  expect(myself?.target).toBeUndefined();
});

test("a cycle attaches to the embed line that reopens an open source", () => {
  const [root] = composeFixtureShowings(
    fixtureFiles("04-embed-cycle"),
    "diff.md"
  );
  const argumentA = root.target?.children[0];
  const backToSource = argumentA?.children[0];
  expect(backToSource?.node.id).toBe("s1");
  expect(backToSource?.cycle).toBe(true);
  expect(backToSource?.target).toBeUndefined();
  expect(root.cycle).toBe(false);

  const [chained] = composeFixtureShowings(
    [
      {
        name: "source.md",
        content: '# [Diff](#o0) <!-- id:inner embed="true" -->\n',
      },
      {
        name: "diff.md",
        content: '# [Source](#inner) <!-- id:o0 embed="true" -->\n',
      },
    ],
    "diff.md"
  );
  expect(chained.cycle).toBe(false);
  expect(chained.target?.node.id).toBe("inner");
  expect(chained.target?.cycle).toBe(true);
  expect(chained.target?.target).toBeUndefined();
});
