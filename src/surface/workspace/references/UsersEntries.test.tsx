import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nip19 } from "nostr-tools";
import {
  renderApp,
  setup,
  ALICE,
  BOB_PUBLIC_KEY,
  expectTree,
  type,
} from "../../../tests/testutils";

test("renamed user entry keeps its follow binding after reload", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  const npub = nip19.npubEncode(BOB_PUBLIC_KEY);

  await type(`Address Book{Enter}{Tab}${npub}{Escape}`);

  const entryEditor = await screen.findByLabelText(`edit ${npub}`);
  await userEvent.clear(entryEditor);
  await userEvent.type(entryEditor, ":robot: gardener{Escape}");

  await expectTree(`
Address Book
  :robot: gardener
      `);
  expect(screen.getByTitle("User entry")).not.toBeNull();

  fireEvent.click(await screen.findByLabelText("follow :robot: gardener"));
  await screen.findByLabelText("unfollow :robot: gardener");
  expect(screen.getByTitle("Followed user entry")).not.toBeNull();

  cleanup();
  renderApp(alice());

  await expectTree(`
Address Book
  :robot: gardener
      `);
  await screen.findByLabelText("unfollow :robot: gardener");
  expect(screen.getByTitle("Followed user entry")).not.toBeNull();
});

test("unfollow after rename keeps the custom name", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  const npub = nip19.npubEncode(BOB_PUBLIC_KEY);

  await type(`Contacts{Enter}{Tab}${npub}{Escape}`);

  fireEvent.click(await screen.findByLabelText(`follow ${npub}`));
  await screen.findByLabelText(`unfollow ${npub}`);

  const entryEditor = await screen.findByLabelText(`edit ${npub}`);
  await userEvent.clear(entryEditor);
  await userEvent.type(entryEditor, "gardener{Escape}");

  await expectTree(`
Contacts
  gardener
      `);
  await screen.findByLabelText("unfollow gardener");

  fireEvent.click(await screen.findByLabelText("unfollow gardener"));
  await screen.findByLabelText("follow gardener");

  await expectTree(`
Contacts
  gardener
      `);
  expect(screen.getByTitle("User entry")).not.toBeNull();

  cleanup();
  renderApp(alice());

  await expectTree(`
Contacts
  gardener
      `);
  await screen.findByLabelText("follow gardener");
});

test("same user in two documents shows petname from contact list", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  const npub = nip19.npubEncode(BOB_PUBLIC_KEY);

  await type(`Doc A{Enter}{Tab}${npub}{Escape}`);

  fireEvent.click(await screen.findByLabelText(`follow ${npub}`));
  await screen.findByLabelText(`unfollow ${npub}`);

  const entryEditor = await screen.findByLabelText(`edit ${npub}`);
  await userEvent.clear(entryEditor);
  await userEvent.type(entryEditor, "gardener{Escape}");

  await expectTree(`
Doc A
  gardener
      `);

  fireEvent.click(await screen.findByLabelText("Create new note"));

  await type(`Doc B{Enter}{Tab}${npub}{Escape}`);

  await expectTree(`
Doc B
  gardener
      `);
});

test("follow syncs petname across duplicate entries, unfollow restores originals", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  const npub = nip19.npubEncode(BOB_PUBLIC_KEY);

  await type(`Doc{Enter}{Tab}${npub}{Enter}${npub}{Escape}`);

  await expectTree(`
Doc
  ${npub}
  ${npub}
      `);

  const editors = await screen.findAllByLabelText(`edit ${npub}`);
  await userEvent.clear(editors[0]);
  await userEvent.type(editors[0], "gardener{Escape}");

  await expectTree(`
Doc
  gardener
  ${npub}
      `);

  fireEvent.click(await screen.findByLabelText("follow gardener"));
  await screen.findAllByLabelText("unfollow gardener");

  await expectTree(`
Doc
  gardener
  gardener
      `);

  const unfollowButtons = await screen.findAllByLabelText("unfollow gardener");
  fireEvent.click(unfollowButtons[0]);
  await screen.findByLabelText("follow gardener");

  await expectTree(`
Doc
  gardener
  ${npub}
      `);
});

test("user entries work in ordinary documents", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  const npub = nip19.npubEncode(BOB_PUBLIC_KEY);

  await type(`Agents{Enter}{Tab}${npub}{Escape}`);

  await expectTree(`
Agents
  ${npub}
      `);
  expect(screen.getByTitle("User entry")).not.toBeNull();

  fireEvent.click(await screen.findByLabelText(`follow ${npub}`));
  await screen.findByLabelText(`unfollow ${npub}`);
  expect(screen.queryByLabelText(`mark ${npub} as not relevant`)).toBeNull();
  expect(screen.getByTitle("Followed user entry")).not.toBeNull();

  const entryEditor = await screen.findByLabelText(`edit ${npub}`);
  await userEvent.clear(entryEditor);
  await userEvent.type(entryEditor, "gardener{Escape}");

  await expectTree(`
Agents
  gardener
      `);
  await screen.findByLabelText("unfollow gardener");

  cleanup();
  renderApp(alice());

  await expectTree(`
Agents
  gardener
      `);
  await screen.findByLabelText("unfollow gardener");
});
