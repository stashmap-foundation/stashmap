/* eslint-disable functional/immutable-data, functional/no-let, no-console */
/**
 * Generates expected outputs for the shared Knowstr conformance corpus.
 *
 * The corpus lives in the deedsats-wallet repo and keeps the Dart
 * reimplementation of the parser/serializer nucleus byte-compatible with
 * this reference implementation. For every `inputs/<name>.md` this script
 * writes:
 *
 *   expected/<name>.out.md    parse -> render output
 *   expected/<name>.tree.json canonical JSON dump of the parsed tree
 *
 * Minted UUIDs (ids that do not literally appear in the input) are
 * canonicalized to `gen-1`, `gen-2`, ... in first-appearance order (docId
 * first, then pre-order over the tree) so outputs are deterministic.
 *
 * Usage:
 *   npx esbuild scripts/generateKnowstrCorpus.ts --bundle --platform=node \
 *     --outfile=/tmp/knowstr-corpus-gen.cjs
 *   node /tmp/knowstr-corpus-gen.cjs <corpusDir>
 */
/// <reference path="../src/types.ts" />
import * as fs from "fs";
import * as path from "path";
import { Map as ImmutableMap } from "immutable";
import { parseToDocumentPreservingExplicitIds } from "../src/core/Document";
import { renderDocumentMarkdown } from "../src/documentRenderer";
import { LOCAL } from "../src/core/nodeRef";
import { spansToMarkdown } from "../src/core/nodeSpans";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DumpNode = Record<string, unknown>;

function dumpNode(
  nodes: ImmutableMap<string, GraphNode>,
  id: string
): DumpNode {
  const node = nodes.get(id);
  if (!node) {
    throw new Error(`Missing node in dump: ${id}`);
  }
  return {
    id: node.id,
    text: spansToMarkdown(node.spans),
    ...(node.relevance !== undefined && { relevance: node.relevance }),
    ...(node.argument !== undefined && { argument: node.argument }),
    ...(node.blockKind !== undefined && { blockKind: node.blockKind }),
    ...(node.headingLevel !== undefined && {
      headingLevel: node.headingLevel,
    }),
    ...(node.listOrdered !== undefined && { listOrdered: node.listOrdered }),
    ...(node.listStart !== undefined && { listStart: node.listStart }),
    ...(node.basedOn !== undefined && { basedOn: node.basedOn }),
    ...(node.snapshotId !== undefined && { snapshotId: node.snapshotId }),
    ...(node.extraAttrs !== undefined && { extraAttrs: node.extraAttrs }),
    children: node.children
      .toArray()
      .map((childId: string) => dumpNode(nodes, childId)),
  };
}

function collectIds(dump: DumpNode, into: string[]): void {
  into.push(dump.id as string);
  (dump.children as DumpNode[]).forEach((child) => collectIds(child, into));
}

function canonicalizeGeneratedIds(
  input: string,
  docId: string,
  topNodes: DumpNode[],
  texts: string[]
): string[] {
  const idsInOrder: string[] = [docId];
  topNodes.forEach((dump) => collectIds(dump, idsInOrder));
  const mapping = new Map<string, string>();
  idsInOrder.forEach((id) => {
    if (UUID_RE.test(id) && !input.includes(id) && !mapping.has(id)) {
      mapping.set(id, `gen-${mapping.size + 1}`);
    }
  });
  return texts.map((text) => {
    let result = text;
    mapping.forEach((replacement, id) => {
      result = result.split(id).join(replacement);
    });
    return result;
  });
}

function generateFixture(inputsDir: string, expectedDir: string, file: string) {
  const name = file.replace(/\.md$/, "");
  const input = fs.readFileSync(path.join(inputsDir, file), "utf8");
  const { document, nodes } = parseToDocumentPreservingExplicitIds(
    LOCAL,
    input,
    { docIdFallback: `doc-${name}`, updatedMsOverride: 0 }
  );
  const knowledgeDBs = ImmutableMap<SourceId, KnowledgeData>([
    [LOCAL, { nodes }],
  ]);
  const rendered = renderDocumentMarkdown(knowledgeDBs, document);
  const topNodes = document.topNodeShortIds.map((id) => dumpNode(nodes, id));
  const dump = {
    docId: document.docId,
    title: document.title,
    topNodes,
  };
  const json = `${JSON.stringify(dump, null, 2)}\n`;
  const [canonicalMd, canonicalJson] = canonicalizeGeneratedIds(
    input,
    document.docId,
    topNodes,
    [rendered, json]
  );
  fs.writeFileSync(path.join(expectedDir, `${name}.out.md`), canonicalMd);
  fs.writeFileSync(path.join(expectedDir, `${name}.tree.json`), canonicalJson);
  console.log(`generated ${name}`);
}

function main() {
  const corpusDir = process.argv[2];
  if (!corpusDir) {
    console.error("usage: node corpus-gen.cjs <corpusDir>");
    process.exit(1);
  }
  const inputsDir = path.join(corpusDir, "inputs");
  const expectedDir = path.join(corpusDir, "expected");
  fs.mkdirSync(expectedDir, { recursive: true });
  const files = fs
    .readdirSync(inputsDir)
    .filter((file) => file.endsWith(".md"))
    .sort();
  files.forEach((file) => generateFixture(inputsDir, expectedDir, file));
  console.log(`done: ${files.length} fixtures`);
}

main();
