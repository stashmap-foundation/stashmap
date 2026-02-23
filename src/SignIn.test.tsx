import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UNAUTHENTICATED_USER_PK } from "./AppState";
import { renderApp, findNewNodeEditor } from "./utils.test";

// eslint-disable-next-line no-console
const originalConsoleError = console.error;
beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const msg = String(args[0]);
    if (msg.includes("Not implemented: navigation")) return;
    originalConsoleError(...args);
  });
});
afterAll(() => {
  jest.restoreAllMocks();
});

test("Login and logout with seed phrase", async () => {
  renderApp({ user: undefined });
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "leader monkey parrot ring guide accident before fence cannon height naive bean{enter}"
  );

  await screen.findByLabelText("new node editor", undefined, {
    timeout: 5000,
  });

  fireEvent.click(screen.getByLabelText("open menu"));
  await screen.findByLabelText("copy npub");

  const logoutButton = await screen.findByLabelText("logout");
  fireEvent.click(logoutButton);
  await screen.findByLabelText("sign in");
});

test("Login with nsec", async () => {
  renderApp({ user: undefined });
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp{enter}"
  );
  fireEvent.click(await screen.findByLabelText("open menu"));
  await screen.findByLabelText("copy npub");
});

test("Login with private key", async () => {
  renderApp({ user: undefined });
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a{enter}"
  );
  fireEvent.click(await screen.findByLabelText("open menu"));
  await screen.findByLabelText("copy npub");
});

test("Display Error", async () => {
  renderApp({ user: undefined });
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "0000completenonsense{enter}"
  );
  await screen.findByText("Input is not a valid nsec, private key or mnemonic");
});

test("Logout clears history state and does not save panes for unauthenticated user", async () => {
  renderApp({ user: undefined });
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "leader monkey parrot ring guide accident before fence cannon height naive bean{enter}"
  );
  await screen.findByLabelText("new node editor", undefined, { timeout: 5000 });
  await userEvent.type(await findNewNodeEditor(), "Test Node{Escape}");
  await screen.findByLabelText("edit Test Node");

  await waitFor(() => {
    expect(window.history.state?.panes?.length).toBe(1);
  });

  fireEvent.click(await screen.findByLabelText("open menu"));
  fireEvent.click(await screen.findByLabelText("logout"));
  await screen.findByLabelText(/^sign in/);

  await waitFor(() => {
    expect(window.history.state?.panes).toBeUndefined();
  });
  expect(
    localStorage.getItem(`stashmap-panes-${UNAUTHENTICATED_USER_PK}`)
  ).toBeNull();
});

test("Split panes don't persist after logout", async () => {
  const view = renderApp({ user: undefined });
  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "leader monkey parrot ring guide accident before fence cannon height naive bean{enter}"
  );
  await screen.findByLabelText("new node editor", undefined, { timeout: 5000 });
  await userEvent.type(
    await findNewNodeEditor(),
    "Root{Enter}{Tab}Child{Escape}"
  );
  await screen.findByLabelText("collapse Root");

  await userEvent.click(screen.getAllByLabelText("open in split pane")[0]);
  const collapseButtons = await screen.findAllByLabelText("collapse Root");
  expect(collapseButtons.length).toBe(2);

  fireEvent.click(await screen.findByLabelText("open menu"));
  fireEvent.click(await screen.findByLabelText("logout"));
  await screen.findByLabelText(/^sign in/);
  cleanup();

  renderApp({
    relayPool: view.relayPool,
    fileStore: view.fileStore,
    user: undefined,
  });
  await screen.findByLabelText(/^sign in/);
  expect(screen.queryAllByLabelText("collapse Root").length).toBe(0);
});

test("Sign in persists created Notes", async () => {
  const view = renderApp({
    user: undefined,
    timeToStorePreLoginEvents: 0,
  });
  await userEvent.type(await findNewNodeEditor(), "Hello World!{Escape}");
  await userEvent.click(
    await screen.findByLabelText("sign in to save changes")
  );
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a{enter}"
  );

  await screen.findByLabelText("edit Hello World!", undefined, {
    timeout: 5000,
  });
  fireEvent.click(await screen.findByLabelText("open menu"));
  fireEvent.click(await screen.findByLabelText("logout"));
  cleanup();

  renderApp({
    relayPool: view.relayPool,
    fileStore: view.fileStore,
    user: undefined,
  });
  expect(screen.queryAllByLabelText("edit Hello World!").length).toBe(0);

  await userEvent.click(await screen.findByLabelText("sign in"));
  await userEvent.type(
    await screen.findByPlaceholderText(
      "nsec, private key or mnemonic (12 words)"
    ),
    "7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a{enter}"
  );
  await screen.findByLabelText("edit Hello World!", undefined, {
    timeout: 5000,
  });
});
