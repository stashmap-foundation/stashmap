import { type Document, withDocumentRealWorldEntities } from "./core/Document";
import { LOCAL } from "./core/nodeRef";
import { getAllLinks, plainSpans } from "./core/nodeSpans";
import { EMPTY_NODE_ID } from "./core/connections";
import { parseInlineSpans } from "./core/markdownTree";
import { renderDocumentMarkdown } from "./documentRenderer";
import { newGraphNode } from "./rowModel";
import {
  createPlan,
  buildDocumentEvents,
  Plan,
  planCreateNoteAtRoot,
  planAddToParent,
  planSaveNodeAndEnsureNodes,
} from "./planner";
import { planCreateNodesFromMarkdown } from "./markdownPlan";
import {
  parseTextToTrees,
  planPasteMarkdownTrees,
} from "./editor/FileDropZone";
import { entityIdForText } from "./core/entityRecognition";
import { planSetDocumentPublishState } from "./core/plan";
import { KIND_KNOWLEDGE_DEPOSIT, KIND_KNOWLEDGE_DOCUMENT } from "./nostr";
import { parseFrontMatter, publishStateOf } from "./core/knowstrFrontmatter";
import { ALICE, setup } from "./utils.test";

function planWithEssay(): { plan: Plan; docId: string; rootId: string } {
  const [alice] = setup([ALICE]);
  const [plan] = planCreateNodesFromMarkdown(
    createPlan(alice()),
    "# Essay\n\n- Point one\n"
  );
  const document = plan.documents.first(undefined);
  if (!document || document.topNodeShortIds.length === 0) {
    throw new Error("essay document missing");
  }
  return {
    plan,
    docId: document.docId,
    rootId: document.topNodeShortIds[0],
  };
}

function frontMatterOf(content: string): FrontMatter {
  const match = content.match(/^---\n([\s\S]*?)---\n/u);
  return match ? parseFrontMatter(match[1]) : {};
}

function documentByRoot(plan: Plan, rootId: ID): Document {
  const document = plan.documents
    .valueSeq()
    .find((candidate) => candidate.topNodeShortIds.includes(rootId));
  if (!document) {
    throw new Error(`document missing for ${rootId}`);
  }
  return document;
}

function realWorldEntities(plan: Plan, document: Document): string[] {
  return withDocumentRealWorldEntities(
    plan.knowledgeDBs,
    plan.documents,
    plan.documentByFilePath,
    document
  ).realWorldEntities;
}

test("publishing a document emits a deposit beside its storage event", () => {
  const { plan, docId, rootId } = planWithEssay();
  const parent = plan.knowledgeDBs.get(LOCAL)?.nodes.get(rootId);
  if (!parent) {
    throw new Error("parent missing");
  }
  const linked = planPasteMarkdownTrees(
    plan,
    parseTextToTrees("[Asset](#asset:rgb:test-contract)"),
    parent,
    0
  );
  const published = planSetDocumentPublishState(linked, docId, {
    relays: ["wss://salon.example"],
    paused: false,
  });

  const events = buildDocumentEvents(published);
  const storage = events.find((e) => e.kind === KIND_KNOWLEDGE_DOCUMENT);
  const deposit = events.find((e) => e.kind === KIND_KNOWLEDGE_DEPOSIT);

  expect(storage).toBeDefined();
  expect(deposit).toBeDefined();
  expect(deposit?.content).toBe(storage?.content);
  expect(deposit?.tags.filter(([name]) => name === "S")).toEqual([
    ["S", rootId],
    ["S", "asset:rgb:test-contract"],
  ]);
  expect(storage?.tags.some(([name]) => name === "S")).toBe(false);
  expect(deposit?.writeRelayConf).toEqual({
    extraRelays: [
      { url: "wss://salon.example", read: false, write: true },
      { url: "wss://nostr.nodesmap.com/", read: false, write: true },
    ],
  });
});

test("the deposit's S set equals roots plus graph-derived tags", () => {
  const { plan, docId, rootId } = planWithEssay();
  const parent = plan.knowledgeDBs.get(LOCAL)?.nodes.get(rootId);
  if (!parent) {
    throw new Error("parent missing");
  }
  const linked = planPasteMarkdownTrees(
    plan,
    parseTextToTrees("[Barcelona](#wd:Q1492)"),
    parent,
    0
  );
  const published = planSetDocumentPublishState(linked, docId, {
    paused: false,
  });

  const deposit = buildDocumentEvents(published).find(
    (e) => e.kind === KIND_KNOWLEDGE_DEPOSIT
  );
  const state = publishStateOf(frontMatterOf(deposit?.content ?? ""));

  expect(state).toEqual({ paused: false });
  expect(deposit?.tags.filter(([name]) => name === "S")).toEqual([
    ["S", rootId],
    ["S", "wd:Q1492"],
  ]);
});

test("paused documents emit storage but no deposit; the flag rides the file", () => {
  const { plan, docId } = planWithEssay();
  const paused = planSetDocumentPublishState(plan, docId, {
    paused: true,
  });

  const events = buildDocumentEvents(paused);
  const storage = events.find((e) => e.kind === KIND_KNOWLEDGE_DOCUMENT);

  expect(events.some((e) => e.kind === KIND_KNOWLEDGE_DEPOSIT)).toBe(false);
  expect(publishStateOf(frontMatterOf(storage?.content ?? ""))?.paused).toBe(
    true
  );
});

test("unpausing emits a clean deposit without the paused flag", () => {
  const { plan, docId } = planWithEssay();
  const paused = planSetDocumentPublishState(plan, docId, {
    paused: true,
  });
  const unpaused = planSetDocumentPublishState(paused, docId, {
    paused: false,
  });

  const deposit = buildDocumentEvents(unpaused).find(
    (e) => e.kind === KIND_KNOWLEDGE_DEPOSIT
  );

  expect(deposit).toBeDefined();
  expect(deposit?.content.includes("paused")).toBe(false);
});

test("unpublished documents emit no deposit", () => {
  const { plan } = planWithEssay();
  expect(
    buildDocumentEvents(plan).some((e) => e.kind === KIND_KNOWLEDGE_DEPOSIT)
  ).toBe(false);
});

const CONTRACT_ID = "rgb:cdtFZh2Q-YTY1rYW-yBdMlZb-GbkThw~-ArYpJ72-eXiti5Y";

test("entity recognizers: rgb markers and wikidata urls", () => {
  expect(entityIdForText(`  ${CONTRACT_ID}\n`)).toBe(`asset:${CONTRACT_ID}`);
  expect(entityIdForText("https://www.wikidata.org/wiki/Q1492")).toBe(
    "wd:Q1492"
  );
  expect(entityIdForText("http://wikidata.org/wiki/Q42")).toBe("wd:Q42");
  expect(entityIdForText("just some text")).toBeUndefined();
  expect(entityIdForText("rgb:short")).toBeUndefined();
});

test("clipboard Markdown survives empty-row materialization and document rendering", () => {
  const { plan, docId, rootId } = planWithEssay();
  const root = plan.knowledgeDBs.get(LOCAL)?.nodes.get(rootId);
  if (!root) throw new Error("Missing root");
  const emptyNode = {
    ...newGraphNode(plainSpans(""), { root: rootId, parent: rootId }),
    id: EMPTY_NODE_ID,
  };
  const markdown = `[A fork of Hello](#e834645e-8bb5-44f7-89b2-41d5054746af)`;
  const result = planSaveNodeAndEnsureNodes(
    plan,
    parseInlineSpans(markdown),
    EMPTY_NODE_ID,
    emptyNode,
    [0, rootId, EMPTY_NODE_ID],
    root,
    [0, rootId],
    0
  );
  const document = result.plan.documents.find(
    (candidate) => candidate.docId === docId
  );
  if (!document) throw new Error("Missing document");

  expect(renderDocumentMarkdown(result.plan.knowledgeDBs, document)).toContain(
    `- ${markdown}`
  );
});

test("marker as new document root mints the entity node, idempotently", () => {
  const { plan } = planWithEssay();
  const first = planCreateNoteAtRoot(plan, plainSpans(CONTRACT_ID), 0);
  expect(first.node.id).toBe(`asset:${CONTRACT_ID}`);
  const countAfterFirst = first.plan.knowledgeDBs.get(LOCAL)?.nodes.size;

  const second = planCreateNoteAtRoot(first.plan, plainSpans(CONTRACT_ID), 0);
  expect(second.node.id).toBe(`asset:${CONTRACT_ID}`);
  expect(second.plan.knowledgeDBs.get(LOCAL)?.nodes.size).toBe(countAfterFirst);
  expect(second.plan.panes[0].rootNodeId).toBe(`asset:${CONTRACT_ID}`);
});

test("marker created under a parent becomes a link row, never a duplicate", () => {
  const { plan, rootId } = planWithEssay();
  const parent = plan.knowledgeDBs.get(LOCAL)?.nodes.get(rootId);
  if (!parent) {
    throw new Error("parent missing");
  }

  const pasted = planPasteMarkdownTrees(
    plan,
    parseTextToTrees(CONTRACT_ID),
    parent,
    0
  );
  // No entity node is minted under a parent…
  expect(
    pasted.knowledgeDBs.get(LOCAL)?.nodes.get(`asset:${CONTRACT_ID}`)
  ).toBeUndefined();
  // …the created row is a link targeting the entity (dangling allowed).
  const linkRow = pasted.knowledgeDBs
    .get(LOCAL)
    ?.nodes.valueSeq()
    .find((node) =>
      getAllLinks(node).some((link) => link.targetID === `asset:${CONTRACT_ID}`)
    );
  expect(linkRow).toBeDefined();
  expect(linkRow?.parent).toBe(rootId);

  // Typed children take the same path.
  const [typed] = planAddToParent(pasted, { text: CONTRACT_ID }, rootId);
  const links = typed.knowledgeDBs
    .get(LOCAL)
    ?.nodes.valueSeq()
    .filter((node) =>
      getAllLinks(node).some((link) => link.targetID === `asset:${CONTRACT_ID}`)
    )
    .toArray();
  expect(links?.length).toBe(2);
  expect(
    typed.knowledgeDBs.get(LOCAL)?.nodes.get(`asset:${CONTRACT_ID}`)
  ).toBeUndefined();
});

test("link placements feed the publish tags", () => {
  const { plan, docId, rootId } = planWithEssay();
  const parent = plan.knowledgeDBs.get(LOCAL)?.nodes.get(rootId);
  if (!parent) {
    throw new Error("parent missing");
  }
  const pasted = planPasteMarkdownTrees(
    plan,
    parseTextToTrees(CONTRACT_ID),
    parent,
    0
  );
  const document = pasted.documents.valueSeq().find((d) => d.docId === docId);
  if (!document) {
    throw new Error("document missing");
  }
  expect(realWorldEntities(pasted, document)).toContain(`asset:${CONTRACT_ID}`);
});

test("tags derive through link targets, one bare tag per linked entity", () => {
  const [alice] = setup([ALICE]);
  const [plan] = planCreateNodesFromMarkdown(
    createPlan(alice()),
    [
      "# Travel",
      "",
      "- [Barcelona](#wd:Q1492)",
      "  - [Sagrada Familia](#wd:Q48435)",
      "    - I want to see it",
      "  - Book flights",
    ].join("\n")
  );
  const document = plan.documents.first(undefined);
  if (!document) {
    throw new Error("document missing");
  }
  expect(realWorldEntities(plan, document)).toEqual(["wd:Q1492", "wd:Q48435"]);
});

test("repeated entities dedupe to one tag", () => {
  const [alice] = setup([ALICE]);
  const [plan] = planCreateNodesFromMarkdown(
    createPlan(alice()),
    [
      "# Notes",
      "",
      "- [Barcelona](#wd:Q1492)",
      "  - [Barcelona again](#wd:Q1492)",
    ].join("\n")
  );
  const document = plan.documents.first(undefined);
  if (!document) {
    throw new Error("document missing");
  }
  expect(realWorldEntities(plan, document)).toEqual(["wd:Q1492"]);
});

test("deep links tag the target container root", () => {
  const [alice] = setup([ALICE]);
  const [targetPlan] = planCreateNodesFromMarkdown(
    createPlan(alice()),
    [
      "# Life in Lviv <!-- id:lviv-life -->",
      "",
      "- Childhood <!-- id:lviv-childhood -->",
    ].join("\n")
  );
  const [plan] = planCreateNodesFromMarkdown(
    targetPlan,
    ["# Notes", "", "- [Childhood](#lviv-childhood)"].join("\n")
  );
  const document = plan.documents
    .valueSeq()
    .find((candidate) => candidate.title === "Notes");
  if (!document) {
    throw new Error("document missing");
  }

  expect(realWorldEntities(plan, document)).toEqual(["lviv-life"]);
});

test("direct link tags are source-local and directional", () => {
  const [alice] = setup([ALICE]);
  const [misesPlan] = planCreateNodesFromMarkdown(
    createPlan(alice()),
    ["# Mises <!-- id:mises -->", "", "- [Hayek](#hayek)"].join("\n")
  );
  const [hayekPlan] = planCreateNodesFromMarkdown(
    misesPlan,
    ["# Hayek <!-- id:hayek -->", "", "- [Wittgenstein](#wittgenstein)"].join(
      "\n"
    )
  );
  const [plan] = planCreateNodesFromMarkdown(
    hayekPlan,
    "# Wittgenstein <!-- id:wittgenstein -->"
  );
  const publish = (document: Document): string[][] => {
    const next = planSetDocumentPublishState(plan, document.docId, {
      paused: false,
    });
    const deposit = buildDocumentEvents(next).find(
      (event) => event.kind === KIND_KNOWLEDGE_DEPOSIT
    );
    if (!deposit) {
      throw new Error("deposit missing");
    }
    return deposit.tags.filter(([name]) => name === "S");
  };

  expect(publish(documentByRoot(plan, "mises"))).toEqual([
    ["S", "mises"],
    ["S", "hayek"],
  ]);
  expect(publish(documentByRoot(plan, "hayek"))).toEqual([
    ["S", "hayek"],
    ["S", "wittgenstein"],
  ]);
});
