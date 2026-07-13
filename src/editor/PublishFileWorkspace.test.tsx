import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAppTree } from "../appTestUtils.test";
import { knowstrInit, knowstrSave, write } from "../testFixtures/workspace";
import { loadCliProfile } from "../cli/config";
import { buildDocumentRouteUrl } from "../navigationUrl";
import { KIND_KNOWLEDGE_DEPOSIT, KIND_KNOWLEDGE_DOCUMENT } from "../nostr";

// Regression: the post-save reparse used to drop the filename-derived
// title, so the first save (publishing included) silently renamed the
// document and the breadcrumb lost the filename. Also proves publication
// is storage-independent: the desktop workspace lives on disk, yet the
// deposit — and only the deposit, never a storage event — goes to relays.
test("each unpublished document link has its own reach grant", async () => {
  const { path: workspacePath } = knowstrInit({
    relays: ["wss://relay.test.example"],
  });
  write(
    workspacePath,
    "source.md",
    "# Source\n\n[One](./one.md) and [Two](./two.md)\n"
  );
  write(workspacePath, "one.md", "# One\n");
  write(workspacePath, "two.md", "# Two\n");
  knowstrSave(workspacePath);
  const profile = loadCliProfile({ cwd: workspacePath });
  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(profile.pubkey, "source.md"),
  });
  await userEvent.click(await screen.findByLabelText("audience options"));
  await userEvent.click(await screen.findByLabelText("publish document"));
  await waitFor(() =>
    expect(screen.getByLabelText("audience options").textContent).toContain(
      "everyone"
    )
  );
  const reachGrants = await screen.findAllByLabelText(
    /publish linked document/u
  );
  expect(reachGrants).toHaveLength(2);
  const [publishOne, publishTwo] = reachGrants;
  const firstLabel = publishOne.getAttribute("aria-label");
  const secondLabel = publishTwo.getAttribute("aria-label");
  if (!firstLabel || !secondLabel) throw new Error("Reach grant label missing");
  await userEvent.click(publishOne);
  await waitFor(() => expect(screen.queryByLabelText(firstLabel)).toBeNull());
  expect(screen.getByLabelText(secondLabel)).toBeTruthy();
});

test("publishing keeps the filename and deposits from the file workspace", async () => {
  const { path: workspacePath } = knowstrInit({
    relays: ["wss://relay.test.example"],
  });
  write(workspacePath, "essay.md", "- Point one\n- Point two\n");
  knowstrSave(workspacePath);
  const profile = loadCliProfile({ cwd: workspacePath });
  const { relayPool } = await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(profile.pubkey, "essay.md"),
  });
  await screen.findByText("Point one");
  expect(screen.getByLabelText("Navigation breadcrumbs").textContent).toContain(
    "essay"
  );

  await userEvent.click(await screen.findByLabelText("audience options"));
  await userEvent.click(await screen.findByLabelText("publish document"));
  await waitFor(() =>
    expect(screen.getByLabelText("audience options").textContent).toContain(
      "everyone"
    )
  );
  expect(screen.getByLabelText("Navigation breadcrumbs").textContent).toContain(
    "essay"
  );

  await waitFor(() => {
    const deposit = relayPool
      .getEvents()
      .find((event) => event.kind === KIND_KNOWLEDGE_DEPOSIT);
    expect(deposit).toBeDefined();
    expect(deposit?.pubkey).toBe(profile.pubkey);
    expect(deposit?.tags.some(([name]) => name === "S")).toBe(true);
  });
  expect(
    relayPool
      .getEvents()
      .some((event) => event.kind === KIND_KNOWLEDGE_DOCUMENT)
  ).toBe(false);
});
