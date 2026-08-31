import * as fs from "fs";
import * as path from "path";
import { List, Map } from "immutable";
import { LOCAL } from "./core/nodeRef";
import { plainSpans } from "./core/nodeSpans";
import { IcalEntry, computedNodesFromFeeds, parseIcalFeed } from "./core/ical";
import {
  graphLookupFromData,
  lookupNode,
  resolveAuthoredFirst,
} from "./core/graphLookup";
import { addNodesToGraphIndex, createEmptyGraphIndex } from "./graphIndex";
import { showingTreeForRoot } from "./showings";
import {
  composeFixtureShowingTree,
  composeFixtureTree,
} from "./testFixtures/compositionCorpus";

const TWO_ENTRY_FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:dunbar@example.org",
  "DTSTART;VALUE=DATE:99990101",
  "SUMMARY:Dunbar",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:other@example.org",
  "DTSTART;VALUE=DATE:99990102",
  "SUMMARY:Other",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

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
  return ["source.md", "diff.md", "feed.ics"]
    .filter((name) => fs.existsSync(path.join(fixtureDir, name)))
    .map((name) => ({
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

test("a feed line mounts its calendar as a computed source, diff at the end", () => {
  expect(
    composeFixtureShowingTree(fixtureFiles("19-feed-arrangement"), "diff.md")
  ).toBe(
    [
      "o0",
      "  >salon",
      "    f1",
      "      >feed:https://example.org/salon.ics",
      "        ical:founding@example.org demoted",
      "        ical:standup@example.org",
      "        ical:retro@example.org",
      "      m1",
      "        >ical:founding@example.org",
      "      m2",
      "      n1",
      "",
    ].join("\n")
  );
});

test("a late-loading calendar changes the picture only through the rebuild", () => {
  const files = fixtureFiles("19-feed-arrangement");
  const withoutFeed = files.filter((file) => file.name !== "feed.ics");
  const before = [
    "o0",
    "  >salon",
    "    f1",
    "      m1",
    "      m2",
    "      n1",
    "",
  ].join("\n");
  const after = [
    "o0",
    "  >salon",
    "    f1",
    "      >feed:https://example.org/salon.ics",
    "        ical:founding@example.org demoted",
    "        ical:standup@example.org",
    "        ical:retro@example.org",
    "      m1",
    "        >ical:founding@example.org",
    "      m2",
    "      n1",
    "",
  ].join("\n");
  expect(composeFixtureShowingTree(withoutFeed, "diff.md")).toBe(before);
  expect(composeFixtureShowingTree(files, "diff.md")).toBe(after);
  expect(composeFixtureShowingTree(withoutFeed, "diff.md")).toBe(before);
  expect(composeFixtureShowingTree(files, "diff.md")).toBe(after);
});

test("a placement beside a feed yields to the feed's occurrence", () => {
  expect(
    composeFixtureShowingTree(
      fixtureFiles("27-event-direct-and-feed"),
      "diff.md"
    )
  ).toBe(
    [
      "o0",
      "  >salon",
      "    f1",
      "      >feed:https://example.org/salon.ics",
      "        ical:standup@example.org",
      "    l1 demoted",
      "",
    ].join("\n")
  );
});

test("a loaded feed never shadows an authored node with the same id", () => {
  const tree = composeFixtureShowingTree(
    [
      {
        name: "source.md",
        content: [
          "# Notes <!-- id:n1 -->",
          "",
          "- Dunbar <!-- id:ical:dunbar@example.org -->",
          "  - Detail <!-- id:d1 -->",
          '- [cal](feed:https://example.org/cal.ics) <!-- id:f1 embed="true" -->',
          "",
        ].join("\n"),
      },
      { name: "feed.ics", content: TWO_ENTRY_FEED },
    ],
    "source.md"
  );
  expect(tree).toBe(
    [
      "n1",
      "  ical:dunbar@example.org",
      "    d1",
      "  f1",
      "    >feed:https://example.org/cal.ics",
      "      ical:dunbar@example.org demoted",
      "      ical:other@example.org",
      "",
    ].join("\n")
  );
});

test("a plain feed link projects nothing even when the feed is loaded", () => {
  const tree = composeFixtureShowingTree(
    [
      {
        name: "source.md",
        content: [
          "# Notes <!-- id:n1 -->",
          "",
          '- [cal](feed:https://example.org/cal.ics) <!-- id:f1 embed="true" -->',
          "- [cal](feed:https://example.org/cal.ics) <!-- id:p1 -->",
          "",
        ].join("\n"),
      },
      { name: "feed.ics", content: TWO_ENTRY_FEED },
    ],
    "source.md"
  );
  expect(tree).toBe(
    [
      "n1",
      "  f1",
      "    >feed:https://example.org/cal.ics",
      "      ical:dunbar@example.org",
      "      ical:other@example.org",
      "  p1",
      "",
    ].join("\n")
  );
});

test("an authored parent never resolves a missing child from a feed", () => {
  const nodes = Map<ID, GraphNode>([
    [
      "n1",
      {
        children: List<ID>(["ical:dunbar@example.org"]),
        id: "n1",
        spans: plainSpans("Notes"),
        updated: 0,
        root: "n1",
        relevance: undefined,
      },
    ],
  ]);
  const graph = graphLookupFromData({
    user: undefined,
    knowledgeDBs: Map<SourceId, KnowledgeData>([[LOCAL, { nodes }]]),
    graphIndex: createEmptyGraphIndex(),
    computedNodes: computedNodesFromFeeds(
      Map<string, IcalEntry[]>([
        ["https://example.org/cal.ics", parseIcalFeed(TWO_ENTRY_FEED)],
      ])
    ),
  });
  const resolved = lookupNode(graph, "n1", LOCAL);
  if (!resolved) {
    throw new Error("Missing fixture root");
  }
  expect(showingTreeForRoot(graph, resolved).children).toEqual([]);
});

test("a mounted line stays projected when a placement child shares its id", () => {
  const tree = composeFixtureTree(
    [
      {
        name: "source.md",
        content: "# Source <!-- id:src -->\n\n- Alpha <!-- id:a -->\n",
      },
      {
        name: "diff.md",
        content: [
          '# [Source](#src) <!-- id:o0 embed="true" -->',
          "",
          "- Alpha <!-- id:a -->",
          "",
        ].join("\n"),
      },
    ],
    "diff.md"
  );
  expect(tree).toBe(
    [
      "Source <!-- id:o0 -->",
      "  Alpha <!-- base:a -->",
      "  Alpha <!-- id:a -->",
      "",
    ].join("\n")
  );
});

test("a plain duplicate line is demoted without carrying a link", () => {
  const tree = composeFixtureShowingTree(
    [
      {
        name: "source.md",
        content: "# Source <!-- id:s -->\n\n- Twin <!-- id:b -->\n",
      },
      {
        name: "diff.md",
        content: [
          '# [Source](#s) <!-- id:o0 embed="true" -->',
          "",
          "- Twin <!-- id:b -->",
          "",
        ].join("\n"),
      },
    ],
    "diff.md"
  );
  expect(tree).toBe(["o0", "  >s", "    b", "  b demoted", ""].join("\n"));
});

test("an empty calendar mounts with no entries", () => {
  const tree = composeFixtureShowingTree(
    [
      {
        name: "source.md",
        content: [
          "# Notes <!-- id:n1 -->",
          "",
          '- [cal](feed:https://example.org/cal.ics) <!-- id:f1 embed="true" -->',
          "",
        ].join("\n"),
      },
      {
        name: "feed.ics",
        content: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR",
      },
    ],
    "source.md"
  );
  expect(tree).toBe(
    ["n1", "  f1", "    >feed:https://example.org/cal.ics", ""].join("\n")
  );
});

test("a foreign authored node shadows a computed event", () => {
  const feedLine: GraphNode = {
    children: List<ID>(),
    id: "f1",
    spans: [
      { kind: "link", href: "feed:https://example.org/cal.ics", text: "cal" },
    ],
    updated: 0,
    root: "f1",
    relevance: undefined,
    extraAttrs: { embed: "true" },
  };
  const bobNode: GraphNode = {
    children: List<ID>(),
    id: "ical:dunbar@example.org",
    spans: plainSpans("Bob's note"),
    updated: 0,
    root: "ical:dunbar@example.org",
    relevance: undefined,
  };
  const bobNodes = Map<ID, GraphNode>([[bobNode.id, bobNode]]);
  const graph = graphLookupFromData({
    user: undefined,
    knowledgeDBs: Map<SourceId, KnowledgeData>([
      [LOCAL, { nodes: Map<ID, GraphNode>([["f1", feedLine]]) }],
      ["bob", { nodes: bobNodes }],
    ]),
    graphIndex: addNodesToGraphIndex(
      createEmptyGraphIndex(),
      bobNodes,
      undefined,
      "bob"
    ),
    computedNodes: computedNodesFromFeeds(
      Map<string, IcalEntry[]>([
        ["https://example.org/cal.ics", parseIcalFeed(TWO_ENTRY_FEED)],
      ])
    ),
  });
  const resolved = lookupNode(graph, "f1", LOCAL);
  if (!resolved) {
    throw new Error("Missing fixture root");
  }
  const calendar = showingTreeForRoot(graph, resolved).target;
  if (!calendar) {
    throw new Error("Missing mounted calendar");
  }
  expect(
    calendar.children.map((child) => `${child.ref.sourceId}:${child.node.id}`)
  ).toEqual(["bob:ical:dunbar@example.org", `${LOCAL}:ical:other@example.org`]);
});

test("a direct embed in a foreign document yields to an authored node in another source", () => {
  const bobLine: GraphNode = {
    children: List<ID>(),
    id: "b1",
    spans: [{ kind: "link", href: "#ical:dunbar@example.org", text: "event" }],
    updated: 0,
    root: "b1",
    relevance: undefined,
    extraAttrs: { embed: "true" },
  };
  const carolNode: GraphNode = {
    children: List<ID>(),
    id: "ical:dunbar@example.org",
    spans: plainSpans("Carol's note"),
    updated: 0,
    root: "ical:dunbar@example.org",
    relevance: undefined,
  };
  const bobNodes = Map<ID, GraphNode>([[bobLine.id, bobLine]]);
  const carolNodes = Map<ID, GraphNode>([[carolNode.id, carolNode]]);
  const graph = graphLookupFromData({
    user: undefined,
    knowledgeDBs: Map<SourceId, KnowledgeData>([
      ["bob", { nodes: bobNodes }],
      ["carol", { nodes: carolNodes }],
    ]),
    graphIndex: addNodesToGraphIndex(
      addNodesToGraphIndex(createEmptyGraphIndex(), bobNodes, undefined, "bob"),
      carolNodes,
      undefined,
      "carol"
    ),
    computedNodes: computedNodesFromFeeds(
      Map<string, IcalEntry[]>([
        ["https://example.org/cal.ics", parseIcalFeed(TWO_ENTRY_FEED)],
      ])
    ),
  });
  const resolved = lookupNode(graph, "b1", "bob");
  if (!resolved) {
    throw new Error("Missing fixture root");
  }
  const { target } = showingTreeForRoot(graph, resolved);
  if (!target) {
    throw new Error("Missing mounted target");
  }
  expect(`${target.ref.sourceId}:${target.node.id}`).toBe(
    "carol:ical:dunbar@example.org"
  );
});

test("authored shadow resolution is loading-order independent", () => {
  const shadow = (source: string): Map<ID, GraphNode> =>
    Map<ID, GraphNode>([
      [
        "ical:dunbar@example.org",
        {
          children: List<ID>(),
          id: "ical:dunbar@example.org",
          spans: plainSpans(`${source}'s note`),
          updated: 0,
          root: "ical:dunbar@example.org",
          relevance: undefined,
        },
      ],
    ]);
  const graphFor = (order: string[]): ReturnType<typeof graphLookupFromData> =>
    graphLookupFromData({
      user: undefined,
      knowledgeDBs: Map<SourceId, KnowledgeData>(
        order.map((source) => [source, { nodes: shadow(source) }])
      ),
      graphIndex: order.reduce(
        (index, source) =>
          addNodesToGraphIndex(index, shadow(source), undefined, source),
        createEmptyGraphIndex()
      ),
      computedNodes: computedNodesFromFeeds(
        Map<string, IcalEntry[]>([
          ["https://example.org/cal.ics", parseIcalFeed(TWO_ENTRY_FEED)],
        ])
      ),
    });
  const winners = [
    ["bob", "carol"],
    ["carol", "bob"],
  ].map(
    (order) =>
      resolveAuthoredFirst(graphFor(order), "ical:dunbar@example.org", LOCAL)
        ?.ref.sourceId
  );
  expect(winners).toEqual(["bob", "bob"]);
});

test("an authored node whose id starts with feed: stays an ordinary node", () => {
  const tree = composeFixtureShowingTree(
    [
      {
        name: "source.md",
        content: "# Notes <!-- id:feed:notes -->\n\n- Child <!-- id:c -->\n",
      },
      {
        name: "diff.md",
        content: '# [Notes](#feed:notes) <!-- id:o0 embed="true" -->\n',
      },
    ],
    "diff.md"
  );
  expect(tree).toBe(["o0", "  >feed:notes", "    c", ""].join("\n"));
});

test("a move statement disappears into its target", () => {
  expect(
    composeFixtureShowingTree(fixtureFiles("33-full-ladder"), "diff.md")
  ).toBe(["o0", "  >s", "    a", "    g", "    b", ""].join("\n"));
});

test("a statement targeting another diff line dangles in any line order", () => {
  const sourceFile = {
    name: "source.md",
    content: "# Source <!-- id:s -->\n\n- Alpha <!-- id:a -->\n",
  };
  const noteFirst = [
    '# [Source](#s) <!-- id:o0 embed="true" -->',
    "",
    "- My note <!-- id:n1 -->",
    '- [My note](#n1) <!-- id:m1 embed="true" after="a" -->',
    "",
  ].join("\n");
  const statementFirst = [
    '# [Source](#s) <!-- id:o0 embed="true" -->',
    "",
    '- [My note](#n1) <!-- id:m1 embed="true" after="a" -->',
    "- My note <!-- id:n1 -->",
    "",
  ].join("\n");
  expect(
    composeFixtureShowingTree(
      [sourceFile, { name: "diff.md", content: noteFirst }],
      "diff.md"
    )
  ).toBe(["o0", "  >s", "    a", "  n1", "  m1", ""].join("\n"));
  expect(
    composeFixtureShowingTree(
      [sourceFile, { name: "diff.md", content: statementFirst }],
      "diff.md"
    )
  ).toBe(["o0", "  >s", "    a", "  m1", "  n1", ""].join("\n"));
});

test("a name naming the applied statement finds the moved row", () => {
  const tree = composeFixtureShowingTree(
    [
      {
        name: "source.md",
        content: [
          "# Source <!-- id:s -->",
          "",
          "- Alpha <!-- id:a -->",
          "- Beta <!-- id:b -->",
          "- Gamma <!-- id:g -->",
          "",
        ].join("\n"),
      },
      {
        name: "diff.md",
        content: [
          '# [Source](#s) <!-- id:o0 embed="true" -->',
          "",
          '- [Gamma](#g) <!-- id:m1 embed="true" after="a" -->',
          '- My note <!-- id:n1 after="m1" -->',
          "",
        ].join("\n"),
      },
    ],
    "diff.md"
  );
  expect(tree).toBe(
    ["o0", "  >s", "    a", "    g", "    n1", "    b", ""].join("\n")
  );
});

test("an applied statement's own lines follow onto the target", () => {
  const tree = composeFixtureShowingTree(
    [
      {
        name: "source.md",
        content: [
          "# Source <!-- id:s -->",
          "",
          "- Alpha <!-- id:a -->",
          "- Beta <!-- id:b -->",
          "- Gamma <!-- id:g -->",
          "",
        ].join("\n"),
      },
      {
        name: "diff.md",
        content: [
          '# [Source](#s) <!-- id:o0 embed="true" -->',
          "",
          '- [Gamma](#g) <!-- id:m1 embed="true" after="a" -->',
          "  - My note <!-- id:c1 -->",
          "",
        ].join("\n"),
      },
    ],
    "diff.md"
  );
  expect(tree).toBe(
    ["o0", "  >s", "    a", "    g", "      c1", "    b", ""].join("\n")
  );
});

test("a moved row takes its subtree along", () => {
  const tree = composeFixtureShowingTree(
    [
      {
        name: "source.md",
        content: [
          "# Source <!-- id:s -->",
          "",
          "- Alpha <!-- id:a -->",
          "- Beta <!-- id:b -->",
          "- Gamma <!-- id:g -->",
          "  - G one <!-- id:g1 -->",
          "  - G two <!-- id:g2 -->",
          "",
        ].join("\n"),
      },
      {
        name: "diff.md",
        content: [
          '# [Source](#s) <!-- id:o0 embed="true" -->',
          "",
          '- [Gamma](#g) <!-- id:m1 embed="true" after="a" -->',
          "",
        ].join("\n"),
      },
    ],
    "diff.md"
  );
  expect(tree).toBe(
    ["o0", "  >s", "    a", "    g", "      g1", "      g2", "    b", ""].join(
      "\n"
    )
  );
});

test("the first row of a name circle parks lapsed and the rest unfold around it", () => {
  expect(
    composeFixtureShowingTree(fixtureFiles("37-name-circle"), "diff.md")
  ).toBe(["o0", "  >s", "    a", "  n2", "  n1 lapsed", ""].join("\n"));
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
