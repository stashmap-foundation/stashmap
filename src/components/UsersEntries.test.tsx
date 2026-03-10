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
} from "../utils.test";

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
