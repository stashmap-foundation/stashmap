import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nip19 } from "nostr-tools";
import {
  ALICE,
  ALICE_PRIVATE_KEY,
  ANON,
  BOB,
  renderApp,
  renderWithTestData,
  setup,
  setupTestDB,
  typeNewNode,
} from "./utils.test";
import { App } from "./App";

const npub = nip19.npubEncode(
  "17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917"
);

test("Login and logout with seed phrase", async () => {
  renderWithTestData(<App />, { user: undefined });
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "leader monkey parrot ring guide accident before fence cannon height naive bean{enter}"
  );

  await screen.findByText("Default Workspace", undefined, {
    timeout: 5000,
  });

  fireEvent.click(screen.getByLabelText("open menu"));
  fireEvent.click(screen.getByLabelText("show profile"));
  await screen.findByDisplayValue(npub);

  fireEvent.click(await screen.findByLabelText("open menu"));
  const logoutButton = await screen.findByLabelText("logout");
  fireEvent.click(logoutButton);
  await screen.findByLabelText("sign in");
});

test("Login with nsec", async () => {
  renderWithTestData(<App />, { user: undefined });
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp{enter}"
  );
  fireEvent.click(await screen.findByLabelText("open menu"));
  fireEvent.click(screen.getByLabelText("show profile"));
  await screen.findByDisplayValue(npub);
});

test("Login with private key", async () => {
  renderWithTestData(<App />, { user: undefined });
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a{enter}"
  );
  fireEvent.click(await screen.findByLabelText("open menu"));
  fireEvent.click(screen.getByLabelText("show profile"));
  await screen.findByDisplayValue(npub);
});

test("Display Error", async () => {
  renderWithTestData(<App />, { user: undefined });
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "0000completenonsense{enter}"
  );
  await screen.findByText("Input is not a valid nsec, private key or mnemonic");
});

test("Sign in persists created Notes", async () => {
  const view = renderWithTestData(<App />, {
    user: undefined,
    timeToStorePreLoginEvents: 0,
  });
  typeNewNode(view, "Hello World!");
  await userEvent.click(await screen.findByText("Sign in to Save"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a{enter}"
  );

  // After login the note is still there
  await screen.findByText("Hello World!");
  // Logout and clear screen
  fireEvent.click(await screen.findByLabelText("open menu"));
  fireEvent.click(await screen.findByLabelText("logout"));
  cleanup();

  // Open App
  renderWithTestData(<App />, {
    relayPool: view.relayPool,
    fileStore: view.fileStore,
    user: undefined,
  });
  expect(screen.queryAllByText("Hello World!").length).toBe(0);

  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a{enter}"
  );
  // After login the note is still there
  await screen.findByText("Hello World!");
});

test("Merge Views", async () => {
  const [bob, alice] = setup([BOB, ALICE]);
  const bobsDB = await setupTestDB(
    bob(),
    [["My Notes", [["Bitcoin"], ["Nostr"]]]],
    { activeWorkspace: "My Notes" }
  );
  renderApp({
    ...alice(),
    defaultWorkspace: bobsDB.activeWorkspace,
  });
  await userEvent.click(
    await screen.findByLabelText("increase width of Bitcoin")
  );
  // Bitcoin column is expanded
  screen.getByLabelText("decrease width of Bitcoin");

  cleanup();
  renderWithTestData(<App />, {
    relayPool: bob().relayPool,
    user: undefined,
    defaultWorkspace: bobsDB.activeWorkspace,
  });
  await userEvent.click(
    await screen.findByLabelText("increase width of Nostr")
  );
  // Nostr column is expanded, but Bitcoin column is not
  screen.getByLabelText("decrease width of Nostr");
  expect(screen.queryByLabelText("decrease width of Bitcoin")).toBeNull();

  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    `${ALICE_PRIVATE_KEY}{enter}`
  );
  // After Login both columns are expanded because the views of the existing user are merged
  await screen.findByLabelText("increase width of Nostr");
  await screen.findByLabelText("increase width of Bitcoin");
});

test("Don't change workspace title after signin", async () => {
  const [anon] = setup([ANON]);
  cleanup();
  renderApp(anon());
  const switchWsBtn = await screen.findByLabelText("switch workspace");
  await userEvent.click(switchWsBtn);
  const newWsBtn = screen.getByText("New Workspace");
  fireEvent.click(newWsBtn);
  await userEvent.type(
    screen.getByLabelText("title of new workspace"),
    "My Brand New Workspace"
  );
  await userEvent.click(screen.getByText("Create Workspace"));
  await screen.findAllByText("My Brand New Workspace");
  screen.getByLabelText("search and attach to My Brand New Workspace");
  await userEvent.click(await screen.findByText("Sign in to Save"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a{enter}"
  );
  await screen.findAllByText("My Brand New Workspace");
  // After login there is not default workspace name to be seen
  expect(screen.queryByText("Default Workspace")).toBeNull();
});
