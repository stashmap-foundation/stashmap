import fs from "fs";
import pathModule from "path";
import { Map as ImmutableMap } from "immutable";
import { parseToDocumentPreservingExplicitIds } from "./core/Document";
import { buildOccurrences, treeFromOccurrences } from "./core/composition";
import { graphLookupFromData } from "./core/graphLookup";
import { createEmptyGraphIndex } from "./graphIndex";
import { LOCAL } from "./core/nodeRef";

const corpusPath = pathModule.resolve(__dirname, "../test/corpus");
const fixtureFiles = ["source.md", "diff.md", "expected.tree"];
const corpusDirs = fs
  .readdirSync(corpusPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const presentFiles = (dir: string): string[] =>
  fixtureFiles.filter((file) =>
    fs.existsSync(pathModule.join(corpusPath, dir, file))
  );
const incomplete = corpusDirs.filter((dir) => {
  const present = presentFiles(dir);
  return present.length > 0 && present.length < fixtureFiles.length;
});
if (incomplete.length > 0) {
  throw new Error(`Incomplete composition fixtures: ${incomplete.join(", ")}`);
}
const compositionFixtures = corpusDirs
  .filter((dir) => presentFiles(dir).length === fixtureFiles.length)
  .sort();

if (compositionFixtures.length === 0) {
  throw new Error("Composition corpus is empty");
}

function parseFixtureFile(
  filePath: string,
  docIdFallback: string
): ImmutableMap<ID, GraphNode> {
  const content = fs.readFileSync(filePath, "utf8");
  const { nodes } = parseToDocumentPreservingExplicitIds(LOCAL, content, {
    docIdFallback,
    updatedMsOverride: 0,
  });
  return nodes;
}

test.each(compositionFixtures)(
  "composition fixture composer: %s",
  (fixture) => {
    const fixturePath = pathModule.join(corpusPath, fixture);
    const sourcesPath = pathModule.join(fixturePath, "sources");
    const sourceFiles = [
      pathModule.join(fixturePath, "source.md"),
      ...(fs.existsSync(sourcesPath)
        ? fs
            .readdirSync(sourcesPath)
            .filter((file) => file.endsWith(".md"))
            .sort()
            .map((file) => pathModule.join(sourcesPath, file))
        : []),
    ];
    const sourceNodes = sourceFiles.reduce(
      (acc, file, index) =>
        acc.merge(parseFixtureFile(file, `doc-source-${index}`)),
      ImmutableMap<ID, GraphNode>()
    );
    const diffContent = fs.readFileSync(
      pathModule.join(fixturePath, "diff.md"),
      "utf8"
    );
    const { document, nodes: diffNodes } = parseToDocumentPreservingExplicitIds(
      LOCAL,
      diffContent,
      { docIdFallback: "doc-diff", updatedMsOverride: 0 }
    );
    expect(document.topNodeShortIds).toHaveLength(1);

    const knowledgeDBs = ImmutableMap<SourceId, KnowledgeData>([
      [LOCAL, { nodes: sourceNodes.merge(diffNodes) }],
    ]);
    const graph = graphLookupFromData({
      user: undefined,
      knowledgeDBs,
      graphIndex: createEmptyGraphIndex(),
    });

    const result = buildOccurrences(graph, {
      sourceId: LOCAL,
      id: document.topNodeShortIds[0],
    });

    const expected = fs.readFileSync(
      pathModule.join(fixturePath, "expected.tree"),
      "utf8"
    );
    expect(treeFromOccurrences(result)).toEqual(expected);
  }
);
