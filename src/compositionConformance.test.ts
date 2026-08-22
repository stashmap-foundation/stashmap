import * as fs from "fs";
import * as path from "path";
import {
  composeFixtureShowingTree,
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

test("an embed chain mounts each finished source under its embed line", () => {
  expect(
    composeFixtureShowingTree(fixtureFiles("05-root-embed-chain"), "diff.md")
  ).toBe(["o0", "  >inner", "    >terminal", "      c", ""].join("\n"));
});

test("a user's own line below an embed stays on the embed line, not in the source", () => {
  const tree = composeFixtureShowingTree(
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
  expect(tree).toBe(["o0", "  >src", "    a", "  own", ""].join("\n"));
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
  expect(
    composeFixtureShowingTree(
      fixtureFiles("07-ancestor-embed-cycle"),
      "diff.md"
    )
  ).toBe(["o0", "  >root", "    a", "      b cycle", ""].join("\n"));
});

test("a self-embed closes the cycle on its own line", () => {
  expect(
    composeFixtureShowingTree(fixtureFiles("08-self-embed"), "diff.md")
  ).toBe(["o0", "  >root", "    s cycle", ""].join("\n"));
});

test("a long embed chain composes every layer in order", () => {
  const depth = 4000;
  const chain = Array.from({ length: depth }, (_, index) =>
    index === depth - 1
      ? `# Terminal <!-- id:c${index} -->\n\n- Leaf <!-- id:leaf -->\n`
      : `# [step](#c${
          index + 1
        }) <!-- id:c${index} embed="true" -->\n\n- note ${index} <!-- id:m${index} -->\n`
  ).join("\n");
  const tree = composeFixtureTree(
    [
      { name: "source.md", content: chain },
      {
        name: "diff.md",
        content: '# [Outer](#c0) <!-- id:o0 embed="true" -->\n',
      },
    ],
    "diff.md"
  );
  const expected = [
    "Terminal <!-- id:o0 -->",
    "  Leaf <!-- base:leaf -->",
    ...Array.from({ length: depth - 1 }, (_, index) => {
      const layer = depth - 2 - index;
      return `  note ${layer} <!-- base:m${layer} -->`;
    }),
  ]
    .map((line) => `${line}\n`)
    .join("");
  expect(tree).toBe(expected);
});

test("deep nesting composes line for line", () => {
  const depth = 30;
  const lines = Array.from(
    { length: depth },
    (_, index) => `${"  ".repeat(index)}- L${index} <!-- id:n${index} -->`
  ).join("\n");
  const tree = composeFixtureTree(
    [
      { name: "source.md", content: `# Deep <!-- id:root -->\n\n${lines}\n` },
      {
        name: "diff.md",
        content: '# [Outer](#root) <!-- id:o0 embed="true" -->\n',
      },
    ],
    "diff.md"
  );
  const expected = [
    "Deep <!-- id:o0 -->",
    ...Array.from(
      { length: depth },
      (_, index) => `${"  ".repeat(index + 1)}L${index} <!-- base:n${index} -->`
    ),
  ]
    .map((line) => `${line}\n`)
    .join("");
  expect(tree).toBe(expected);
});

test("a cycle attaches to the embed line that reopens an open source", () => {
  expect(
    composeFixtureShowingTree(fixtureFiles("04-embed-cycle"), "diff.md")
  ).toBe(["o0", "  >root", "    a", "      s1 cycle", "    b", ""].join("\n"));

  const chained = composeFixtureShowingTree(
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
  expect(chained).toBe(["o0", "  >inner cycle", ""].join("\n"));
});
