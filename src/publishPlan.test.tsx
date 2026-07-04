import { LOCAL } from "./core/nodeRef";
import { linkSpan, plainSpans } from "./core/nodeSpans";
import { newGraphNode } from "./core/nodeFactory";
import type { Document } from "./core/Document";
import { unpublishedLinkTarget } from "./editor/publishReach";
import { createPlan, buildDocumentEvents, Plan } from "./planner";
import { planCreateNodesFromMarkdown } from "./markdownPlan";
import {
  pasteTextToTrees,
  planPasteMarkdownTrees,
} from "./editor/FileDropZone";
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

test("pasting an RGB contract id creates the identified asset node", () => {
  expect(pasteTextToTrees(`  ${CONTRACT_ID}\n`)).toEqual([
    {
      spans: plainSpans(CONTRACT_ID),
      children: [],
      blockKind: "list_item",
      uuid: `asset:${CONTRACT_ID}`,
    },
  ]);
  expect(pasteTextToTrees("just some text").some((tree) => tree.uuid)).toBe(
    false
  );

  const { plan, rootId } = planWithEssay();
  const parent = plan.knowledgeDBs.get(LOCAL)?.nodes.get(rootId);
  if (!parent) {
    throw new Error("parent missing");
  }
  const pasted = planPasteMarkdownTrees(
    plan,
    pasteTextToTrees(CONTRACT_ID),
    parent,
    0
  );
  expect(
    pasted.knowledgeDBs.get(LOCAL)?.nodes.get(`asset:${CONTRACT_ID}`)
  ).toBeDefined();
});
