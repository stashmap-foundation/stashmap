import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KIND_KNOWLEDGE_DEPOSIT } from "./nostr";
import { ALICE, BOB, expectTree, renderApp, setup, type } from "./utils.test";

afterEach(cleanup);

async function publishViaChip(): Promise<void> {
  await userEvent.click(await screen.findByLabelText("audience options"));
  await userEvent.click(await screen.findByLabelText("publish document"));
  await waitFor(() =>
    expect(screen.getByLabelText("audience options").textContent).toContain(
      "everyone"
    )
  );
}

// The real-world rendezvous: two strangers reference the same Wikidata
// entity; the entity id is the meeting point. Bob publishes his guide
// (the deposit tags the referenced entity); Alice, holding a document
// that references the same entity, pulls it by attention.
test("strangers rendezvous through a shared real-world entity", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(bob());
  await type(
    "Barcelona Guide{Enter}{Tab}https://www.wikidata.org/wiki/Q1492{Enter}{Tab}Sagrada Familia{Escape}"
  );
  await publishViaChip();
  cleanup();

  // The deposit carries the referenced entity as an S-tag.
  const deposit = bob()
    .relayPool.getEvents()
    .find((event) => event.kind === KIND_KNOWLEDGE_DEPOSIT);
  expect(deposit).toBeDefined();
  expect(
    deposit?.tags.filter(([name]) => name === "S").map(([, value]) => value)
  ).toContain("wd:Q1492");

  // Alice starts her own page about the same entity: the root-level
  // paste mints the entity node — her document IS the entity's page.
  window.history.pushState({}, "", "/");
  renderApp(alice());
  await type("https://www.wikidata.org/wiki/Q1492{Escape}");

  // Her open document's attention pulls Bob's deposit: his source is now
  // in her graph, and his link into the shared entity surfaces as an
  // incoming reference when she follows her own link.
  await waitFor(() => {
    const subs = alice()
      .relayPool.getSubscriptions()
      .flatMap((record) => record.filters)
      .filter((filter) => (filter.kinds ?? []).includes(KIND_KNOWLEDGE_DEPOSIT))
      .flatMap((filter) => filter["#S"] ?? []);
    expect(subs).toContain("wd:Q1492");
  });

  // The deposit arrived and composed into Alice's graph (transport).
  // Surfacing it in the entity page's footer — Bob's link as an [I]
  // incoming row — is CP4.4: the source-scoped incoming lookup shadows
  // foreign refs when any local ref exists. Pinned below.
});

test("the pulled reference surfaces as [I] on the entity page", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(bob());
  await type(
    "Barcelona Guide{Enter}{Tab}https://www.wikidata.org/wiki/Q1492{Enter}{Tab}Sagrada Familia{Escape}"
  );
  await publishViaChip();
  cleanup();

  window.history.pushState({}, "", "/");
  renderApp(alice());
  await type("https://www.wikidata.org/wiki/Q1492{Escape}");

  await expectTree(`
https://www.wikidata.org/wiki/Q1492
  [OI] Barcelona Guide ↩
  `);
});

test("the pulled reference surfaces in the pane that pulled it", async () => {
  const [alice, bob] = setup([ALICE, BOB]);

  renderApp(bob());
  await type(
    "Barcelona Guide{Enter}{Tab}https://www.wikidata.org/wiki/Q1492{Enter}{Tab}Sagrada Familia{Escape}"
  );
  await publishViaChip();
  cleanup();

  window.history.pushState({}, "", "/");
  renderApp(alice());
  await type(
    "Trip Notes{Enter}{Tab}https://www.wikidata.org/wiki/Q1492{Escape}"
  );

  await expectTree(`
Trip Notes
  [R] https://www.wikidata.org/wiki/Q1492
  [OI] Barcelona Guide ↩
  `);

  await userEvent.click(await screen.findByLabelText("Barcelona Guide ↩"));
  await userEvent.keyboard("!");

  await expectTree(`
Trip Notes
  [R] https://www.wikidata.org/wiki/Q1492
  [OR] Barcelona Guide
  `);
});

test("the subscription follows attention: entity tags on open, dropped on close", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());
  await type(
    "Travel Plans{Enter}{Tab}https://www.wikidata.org/wiki/Q1492{Escape}"
  );

  const depositSubTags = (): string[] =>
    alice()
      .relayPool.getSubscriptions()
      .flatMap((record) => record.filters)
      .filter((filter) => (filter.kinds ?? []).includes(KIND_KNOWLEDGE_DEPOSIT))
      .flatMap((filter) => filter["#S"] ?? []);

  await waitFor(() => {
    expect(depositSubTags()).toContain("wd:Q1492");
  });

  cleanup();
  await waitFor(() => {
    expect(depositSubTags()).toEqual([]);
  });
});
