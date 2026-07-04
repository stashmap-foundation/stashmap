import { createPlan, buildDocumentEvents } from "./planner";
import { planCreateNodesFromMarkdown } from "./markdownPlan";
import { planSetDocumentPublishState, GraphPlan } from "./core/plan";
import { KIND_KNOWLEDGE_DEPOSIT, KIND_KNOWLEDGE_DOCUMENT } from "./nostr";
import { parseFrontMatter, publishStateOf } from "./core/knowstrFrontmatter";
import { ALICE, setup } from "./utils.test";

function planWithEssay(): { plan: GraphPlan; docId: string; rootId: string } {
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
    extraRelays: [{ url: "wss://salon.example", read: false, write: true }],
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
