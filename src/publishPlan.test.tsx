import { type Document } from "./core/Document";
import { LOCAL } from "./core/nodeRef";
import { buildDepositEvent } from "./nodesDocumentEvent";
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
import { KIND_KNOWLEDGE_DOCUMENT } from "./nostr";
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

function documentByRoot(plan: Plan, rootId: ID): Document {
  const document = plan.documents
    .valueSeq()
    .find((candidate) => candidate.topNodeShortIds.includes(rootId));
  if (!document) {
    throw new Error(`document missing for ${rootId}`);
  }
  return document;
}

function linkTags(plan: Plan, document: Document): string[][] {
  return buildDepositEvent(
    document,
    ALICE.publicKey,
    renderDocumentMarkdown(plan.knowledgeDBs, document),
    0
  ).tags.filter((tag) => tag[0] === "a" || tag[0] === "i");
}

test("document writes emit storage events only", () => {
  const { plan } = planWithEssay();
  const events = buildDocumentEvents(plan);

  expect(events.size).toBeGreaterThan(0);
  expect(events.every((event) => event.kind === KIND_KNOWLEDGE_DOCUMENT)).toBe(
    true
  );
});

const CONTRACT_ID = "rgb:cdtFZh2Q-YTY1rYW-yBdMlZb-GbkThw~-ArYpJ72-eXiti5Y";

test("entity recognizers: rgb markers and wikidata urls", () => {
  expect(entityIdForText(`  ${CONTRACT_ID}\n`)).toBe(`${CONTRACT_ID}`);
  expect(entityIdForText("https://www.wikidata.org/wiki/Q1492")).toBe(
    "wikidata:Q1492"
  );
  expect(entityIdForText("http://wikidata.org/wiki/Q42")).toBe("wikidata:Q42");
  expect(entityIdForText("just some text")).toBeUndefined();
  expect(entityIdForText("rgb:short")).toBeUndefined();
});

test("clipboard Markdown survives empty-row materialization and document rendering", () => {
  const { plan, docId, rootId } = planWithEssay();
  const root = plan.knowledgeDBs.get(LOCAL)?.nodes.get(rootId);
  if (!root) throw new Error("Missing root");
  const emptyNode = newGraphNode(plainSpans(""), {
    id: EMPTY_NODE_ID,
    root: rootId,
    parent: rootId,
  });
  const markdown = `[A link to Hello](#e834645e-8bb5-44f7-89b2-41d5054746af)`;
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
    `- !${markdown}`
  );
});

test("marker as new document root becomes a row about the thing, never its id", () => {
  const { plan } = planWithEssay();
  const first = planCreateNoteAtRoot(plan, plainSpans(CONTRACT_ID), 0);
  expect(first.node.id).not.toContain(CONTRACT_ID);
  expect(first.node.spans).toEqual([
    { kind: "link", href: CONTRACT_ID, text: CONTRACT_ID },
  ]);
  expect(first.plan.panes[0].rootNodeId).toBe(first.node.id);
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
    pasted.knowledgeDBs.get(LOCAL)?.nodes.get(`${CONTRACT_ID}`)
  ).toBeUndefined();
  // …the created row is a link targeting the entity (dangling allowed).
  const linkRow = pasted.knowledgeDBs
    .get(LOCAL)
    ?.nodes.valueSeq()
    .find((node) =>
      getAllLinks(node, LOCAL).some((link) => link.target.id === CONTRACT_ID)
    );
  expect(linkRow).toBeDefined();
  expect(linkRow?.parent).toBe(rootId);

  // Typed children take the same path.
  const [typed] = planAddToParent(pasted, { text: CONTRACT_ID }, rootId);
  const links = typed.knowledgeDBs
    .get(LOCAL)
    ?.nodes.valueSeq()
    .filter((node) =>
      getAllLinks(node, LOCAL).some((link) => link.target.id === CONTRACT_ID)
    )
    .toArray();
  expect(links?.length).toBe(2);
  expect(
    typed.knowledgeDBs.get(LOCAL)?.nodes.get(`${CONTRACT_ID}`)
  ).toBeUndefined();
});

test("a bare feed url becomes a real feed link row on every write path", () => {
  const { plan, rootId } = planWithEssay();
  const parent = plan.knowledgeDBs.get(LOCAL)?.nodes.get(rootId);
  if (!parent) {
    throw new Error("parent missing");
  }
  const url = "https://x.org/salon.ics";
  const pasted = planPasteMarkdownTrees(
    plan,
    parseTextToTrees(`Notes\n${url}`),
    parent,
    0
  );
  const [added] = planAddToParent(pasted, { text: ` ${url} ` }, rootId);
  const feedRows = added.knowledgeDBs
    .get(LOCAL)
    ?.nodes.valueSeq()
    .filter((node) =>
      node.spans.some(
        (span) =>
          span.kind === "link" &&
          span.href === url.replace("https://", "webcal://")
      )
    )
    .toArray();
  expect(feedRows?.length).toBe(2);
  feedRows?.forEach((node) => {
    expect(node.spans).toEqual([
      { kind: "link", href: url.replace("https://", "webcal://"), text: url },
    ]);
    expect(node.extraAttrs?.embed).toBe("true");
  });
});

test("link placements tag the deposit with the thing", () => {
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
  expect(linkTags(pasted, document)).toEqual([["i", CONTRACT_ID]]);
});

test("deposit tags derive through link targets and dedupe", () => {
  const [alice] = setup([ALICE]);
  const [plan] = planCreateNodesFromMarkdown(
    createPlan(alice()),
    [
      "# Travel",
      "",
      "- [Barcelona](wikidata:Q1492)",
      "  - [Sagrada Familia](wikidata:Q48435)",
      "    - I want to see it",
      "  - [Barcelona again](wikidata:Q1492)",
      "  - Book flights",
    ].join("\n")
  );
  const document = plan.documents.first(undefined);
  if (!document) {
    throw new Error("document missing");
  }
  expect(linkTags(plan, document)).toEqual([
    ["i", "wikidata:Q1492"],
    ["i", "wikidata:Q48435"],
  ]);
});

test("deep links tag the file holding the target", () => {
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
    ["# Notes", "", "- [Childhood](life-in-lviv.md#lviv-childhood)"].join("\n")
  );
  const document = plan.documents
    .valueSeq()
    .find((candidate) => candidate.title === "Notes");
  if (!document) {
    throw new Error("document missing");
  }

  expect(linkTags(plan, document)).toEqual([
    ["a", `34774:${ALICE.publicKey}:life-in-lviv.md`],
  ]);
});

test("file tags are directional: a document tags what it links to, never what links to it", () => {
  const [alice] = setup([ALICE]);
  const [misesPlan] = planCreateNodesFromMarkdown(
    createPlan(alice()),
    ["# Mises <!-- id:mises -->", "", "- [Hayek](hayek.md)"].join("\n")
  );
  const [hayekPlan] = planCreateNodesFromMarkdown(
    misesPlan,
    ["# Hayek <!-- id:hayek -->", "", "- [Wittgenstein](wittgenstein.md)"].join(
      "\n"
    )
  );
  const [plan] = planCreateNodesFromMarkdown(
    hayekPlan,
    "# Wittgenstein <!-- id:wittgenstein -->"
  );
  expect(linkTags(plan, documentByRoot(plan, "mises.md#mises"))).toEqual([
    ["a", `34774:${ALICE.publicKey}:hayek.md`],
  ]);
  expect(linkTags(plan, documentByRoot(plan, "hayek.md#hayek"))).toEqual([
    ["a", `34774:${ALICE.publicKey}:wittgenstein.md`],
  ]);
  expect(
    linkTags(plan, documentByRoot(plan, "wittgenstein.md#wittgenstein"))
  ).toEqual([]);
});
