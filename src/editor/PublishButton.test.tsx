import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  copySecretLinkViaChip,
  findNewNodeEditor,
  navigateToNodeViaSearch,
  renderApp,
  renderTree,
  requireUser,
  setup,
} from "../utils.test";
import { parseStorageKeyFromHash } from "../navigationUrl";
import { KIND_DELETE, KIND_KNOWLEDGE_DEPOSIT } from "../nostr";

test("the audience chip publishes, pauses, and resumes a document", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);
  await userEvent.type(await findNewNodeEditor(), "My Essay{Escape}");
  cleanup();

  renderTree(alice);
  await navigateToNodeViaSearch(0, "My Essay");

  const chip = await screen.findByLabelText("audience options");
  expect(chip.textContent).toContain("private");
  await userEvent.click(chip);
  await userEvent.click(await screen.findByLabelText("publish document"));

  await waitFor(() =>
    expect(screen.getByLabelText("audience options").textContent).toContain(
      "everyone"
    )
  );

  await userEvent.click(screen.getByLabelText("audience options"));
  await userEvent.click(await screen.findByLabelText("pause publishing"));
  await waitFor(() =>
    expect(screen.getByLabelText("audience options").textContent).toContain(
      "paused"
    )
  );

  // autoClose="outside": the menu stays open across state edits.
  await userEvent.click(await screen.findByLabelText("resume publishing"));
  await waitFor(() =>
    expect(screen.getByLabelText("audience options").textContent).toContain(
      "everyone"
    )
  );
});

test("stop publishing retracts the deposit and returns the chip to private", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);
  await userEvent.type(await findNewNodeEditor(), "Loud Essay{Escape}");
  cleanup();

  const utils = renderTree(alice);
  await navigateToNodeViaSearch(0, "Loud Essay");
  await userEvent.click(await screen.findByLabelText("audience options"));
  await userEvent.click(await screen.findByLabelText("publish document"));

  const pubkey = requireUser(alice()).publicKey;
  await waitFor(() => {
    const deposit = utils.relayPool
      .getEvents()
      .find((event) => event.kind === KIND_KNOWLEDGE_DEPOSIT);
    expect(deposit?.content).toContain("Loud Essay");
  });
  const docId = utils.relayPool
    .getEvents()
    .find((event) => event.kind === KIND_KNOWLEDGE_DEPOSIT)
    ?.tags.find(([name]) => name === "d")?.[1];

  await userEvent.click(screen.getByLabelText("audience options"));
  await userEvent.click(await screen.findByLabelText("stop publishing"));

  await waitFor(() =>
    expect(screen.getByLabelText("audience options").textContent).toContain(
      "private"
    )
  );

  // The wire: a deletion request on the deposit coordinate, and an empty
  // replacement so relays that ignore it still lose content and rendezvous.
  await waitFor(() => {
    const events = utils.relayPool.getEvents();
    const retraction = events.find(
      (event) =>
        event.kind === KIND_DELETE &&
        event.tags.some(
          ([name, value]) =>
            name === "a" &&
            value === `${KIND_KNOWLEDGE_DEPOSIT}:${pubkey}:${docId}`
        )
    );
    expect(retraction).toBeDefined();
    const deposits = events.filter(
      (event) => event.kind === KIND_KNOWLEDGE_DEPOSIT
    );
    const newest = deposits[deposits.length - 1];
    expect(newest?.content).toBe("");
    expect(newest?.tags.some(([name]) => name === "S")).toBe(false);
  });
});

test("the copied secret link opens the private document for its holder", async () => {
  const [alice, bob] = setup([ALICE, BOB]);
  renderTree(alice);
  await userEvent.type(await findNewNodeEditor(), "Secret Plans{Escape}");
  cleanup();

  const link = await copySecretLinkViaChip(alice(), "Secret Plans");
  const url = new URL(link);
  expect(url.pathname).toMatch(/^\/d\//);
  expect(parseStorageKeyFromHash(url.hash)).toBeTruthy();

  window.history.pushState({}, "", "/");
  renderApp({
    ...bob(),
    initialRoute: `${url.pathname}${url.hash}`,
  });
  await screen.findAllByText("Secret Plans");

  // Without the link's key the document stays sealed.
  cleanup();
  window.history.pushState({}, "", "/");
  renderApp({
    ...bob(),
    initialRoute: url.pathname,
  });
  await expect(
    screen.findAllByText("Secret Plans", undefined, { timeout: 1500 })
  ).rejects.toThrow();
  expect(requireUser(alice()).publicKey).not.toBe(requireUser(bob()).publicKey);
});
