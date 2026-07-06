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
