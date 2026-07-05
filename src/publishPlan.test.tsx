import { LOCAL } from "./core/nodeRef";
import { linkSpan, plainSpans, getBlockLinkTarget } from "./core/nodeSpans";
import { newGraphNode } from "./core/nodeFactory";
import type { Document } from "./core/Document";
import {
  unpublishedLinkTarget,
  documentEntityLadder,
} from "./editor/publishReach";
import {
  createPlan,
  buildDocumentEvents,
  Plan,
  planCreateNoteAtRoot,
  planAddToParent,
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

test("publishing a document emits a deposit beside its storage event", () => {
  const { plan, docId, rootId } = planWithEssay();
  const published = planSetDocumentPublishState(plan, docId, {
    entities: ["asset:rgb:test-contract"],
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

test("the deposit's S set equals {roots} ∪ frontmatter entities (interop rule)", () => {
  const { plan, docId, rootId } = planWithEssay();
  const published = planSetDocumentPublishState(plan, docId, {
    entities: ["wd:Q1 wd:Q2"],
    paused: false,
  });

  const deposit = buildDocumentEvents(published).find(
    (e) => e.kind === KIND_KNOWLEDGE_DEPOSIT
  );
  const state = publishStateOf(frontMatterOf(deposit?.content ?? ""));

  expect(deposit?.tags.filter(([name]) => name === "S")).toEqual([
    ["S", rootId],
    ...(state?.entities ?? []).map((entity) => ["S", entity]),
  ]);
});

test("paused documents emit storage but no deposit; the flag rides the file", () => {
  const { plan, docId } = planWithEssay();
  const paused = planSetDocumentPublishState(plan, docId, {
    entities: ["asset:rgb:test-contract"],
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
    entities: ["asset:rgb:test-contract"],
    paused: true,
  });
  const unpaused = planSetDocumentPublishState(paused, docId, {
    entities: ["asset:rgb:test-contract"],
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

test("the reach chip resolves unpublished link targets in published documents", () => {
  const { plan, docId, rootId } = planWithEssay();
  const [planWithTarget] = planCreateNodesFromMarkdown(plan, "# Target\n");
  const targetDoc = planWithTarget.documents
    .valueSeq()
    .find((doc) => doc.docId !== docId);
  if (!targetDoc) {
    throw new Error("target document missing");
  }
  const linkRow = newGraphNode([linkSpan(targetDoc.topNodeShortIds[0], "T")], {
    parent: rootId,
    root: rootId,
  });
  const essayDoc = (published: Plan): Document => {
    const doc = published.documents.valueSeq().find((d) => d.docId === docId);
    if (!doc) {
      throw new Error("essay document missing");
    }
    return doc;
  };

  // Essay unpublished: no chip.
  expect(
    unpublishedLinkTarget(
      planWithTarget.knowledgeDBs,
      planWithTarget.documents,
      planWithTarget.documentByFilePath,
      essayDoc(planWithTarget),
      linkRow
    )
  ).toBeUndefined();

  // Essay published, target unpublished: the chip resolves the target.
  const published = planSetDocumentPublishState(planWithTarget, docId, {
    entities: [],
    paused: false,
  });
  expect(
    unpublishedLinkTarget(
      published.knowledgeDBs,
      published.documents,
      published.documentByFilePath,
      essayDoc(published),
      linkRow
    )?.docId
  ).toBe(targetDoc.docId);

  // Non-link rows never chip.
  expect(
    unpublishedLinkTarget(
      published.knowledgeDBs,
      published.documents,
      published.documentByFilePath,
      essayDoc(published),
      newGraphNode(plainSpans("plain row"), { parent: rootId, root: rootId })
    )
  ).toBeUndefined();

  // Target published too: chip gone.
  const bothPublished = planSetDocumentPublishState(
    published,
    targetDoc.docId,
    {
      entities: [],
      paused: false,
    }
  );
  expect(
    unpublishedLinkTarget(
      bothPublished.knowledgeDBs,
      bothPublished.documents,
      bothPublished.documentByFilePath,
      essayDoc(bothPublished),
      linkRow
    )
  ).toBeUndefined();
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

test("marker as new document root mints the entity node, idempotently", () => {
  const { plan } = planWithEssay();
  const first = planCreateNoteAtRoot(plan, CONTRACT_ID, 0);
  expect(first.node.id).toBe(`asset:${CONTRACT_ID}`);
  const countAfterFirst = first.plan.knowledgeDBs.get(LOCAL)?.nodes.size;

  const second = planCreateNoteAtRoot(first.plan, CONTRACT_ID, 0);
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
    .find((n) => getBlockLinkTarget(n) === `asset:${CONTRACT_ID}`);
  expect(linkRow).toBeDefined();
  expect(linkRow?.parent).toBe(rootId);

  // Typed children take the same path.
  const [typed] = planAddToParent(
    pasted,
    { id: CONTRACT_ID as ID, text: CONTRACT_ID },
    rootId
  );
  const links = typed.knowledgeDBs
    .get(LOCAL)
    ?.nodes.valueSeq()
    .filter((n) => getBlockLinkTarget(n) === `asset:${CONTRACT_ID}`)
    .toArray();
  expect(links?.length).toBe(2);
  expect(
    typed.knowledgeDBs.get(LOCAL)?.nodes.get(`asset:${CONTRACT_ID}`)
  ).toBeUndefined();
});

test("link placements feed the publish ladder", () => {
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
  expect(documentEntityLadder(pasted.knowledgeDBs, document)).toContain(
    `asset:${CONTRACT_ID}`
  );
});

test("the ladder reads through link targets with full context sets", () => {
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
  const rungs = documentEntityLadder(plan.knowledgeDBs, document);
  expect([...rungs].sort()).toEqual(["wd:Q1492", "wd:Q1492 wd:Q48435"]);
});

test("rungs are order-independent: sorted, space-joined sets", () => {
  const [alice] = setup([ALICE]);
  const [plan] = planCreateNodesFromMarkdown(
    createPlan(alice()),
    [
      "# Notes",
      "",
      "- [Sagrada Familia](#wd:Q48435)",
      "  - [Barcelona](#wd:Q1492)",
    ].join("\n")
  );
  const document = plan.documents.first(undefined);
  if (!document) {
    throw new Error("document missing");
  }
  const rungs = documentEntityLadder(plan.knowledgeDBs, document);
  expect([...rungs].sort()).toEqual(["wd:Q1492 wd:Q48435", "wd:Q48435"]);
});
