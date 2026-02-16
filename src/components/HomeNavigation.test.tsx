import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  BOB,
  expectTree,
  follow,
  renderApp,
  renderTree,
  setup,
  type,
  navigateToNodeViaSearch,
} from "../utils.test";

describe("Home Navigation", () => {
  describe("Home Button", () => {
    test("home button is visible after ~Log exists", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("My Notes{Escape}");

      await screen.findByLabelText("Navigate to Log");
    });

    test("home button is hidden when ~Log does not exist", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await screen.findByLabelText("new node editor");

      expect(screen.queryByLabelText("Navigate to Log")).toBeNull();
    });

    test("clicking home button navigates to ~Log", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("My Notes{Escape}");

      await userEvent.click(await screen.findByLabelText("Navigate to Log"));

      await screen.findByLabelText("collapse ~Log");
    });

    test("clicking home button from another user's content navigates to your own ~Log", async () => {
      const [alice, bob] = setup([ALICE, BOB]);
      await follow(alice, bob().user.publicKey);

      renderTree(bob);
      await type(
        "My Notes{Enter}{Tab}Programming Languages{Enter}{Tab}Rust{Enter}{Tab}Memory Safety{Escape}"
      );
      cleanup();

      renderTree(alice);
      await type("Alice Home Note{Escape}");
      await userEvent.click(await screen.findByLabelText("Create new note"));
      await type("My Notes{Enter}{Tab}Programming Languages{Escape}");

      await userEvent.click(
        await screen.findByLabelText("expand Programming Languages")
      );
      await userEvent.click(
        await screen.findByLabelText("open Rust in fullscreen")
      );
      await screen.findByText("READONLY");

      await userEvent.click(await screen.findByLabelText("Navigate to Log"));

      await screen.findByLabelText("collapse ~Log");
      await screen.findByText("Alice Home Note");
    });
  });

  describe("Cmd+H Shortcut", () => {
    test("Cmd+H navigates to ~Log", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("My Notes{Enter}{Tab}Child{Escape}");

      await expectTree(`
My Notes
  Child
      `);

      await userEvent.keyboard("{Meta>}h{/Meta}");

      await screen.findByLabelText("collapse ~Log");
    });

    test("Ctrl+H navigates to ~Log", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("My Notes{Enter}{Tab}Child{Escape}");

      await userEvent.keyboard("{Control>}h{/Control}");

      await screen.findByLabelText("collapse ~Log");
    });

    test("Cmd+H does nothing when ~Log does not exist", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await screen.findByLabelText("new node editor");

      await userEvent.keyboard("{Meta>}h{/Meta}");

      await screen.findByLabelText("new node editor");
      expect(screen.queryByLabelText("collapse ~Log")).toBeNull();
    });
  });

  describe("New Note Button", () => {
    test("clicking new note button shows empty create editor", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("My Notes{Escape}");

      await userEvent.click(await screen.findByLabelText("Create new note"));

      await screen.findByLabelText("new node editor");
    });
  });

  describe("~Log Node", () => {
    test("creating a note at root creates ~Log and links note", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("First Note{Escape}");

      await userEvent.click(await screen.findByLabelText("Navigate to Log"));

      await expectTree(`
~Log
  [R] First Note
      `);
    });

    test("creating multiple notes at root shows all in ~Log", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("First Note{Escape}");
      await userEvent.click(await screen.findByLabelText("Create new note"));
      await type("Second Note{Escape}");

      await userEvent.click(await screen.findByLabelText("Navigate to Log"));

      await expectTree(`
~Log
  [R] Second Note
  [R] First Note
      `);
    });

    test("~Log is searchable", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("My Notes{Escape}");

      await navigateToNodeViaSearch(0, "~Log");

      await screen.findByLabelText("collapse ~Log");
    });

    test("note under ~Log is a reference to actual node", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("My Notes{Enter}{Tab}Child{Escape}");

      await userEvent.click(await screen.findByLabelText("Navigate to Log"));

      await waitFor(() => {
        expect(screen.getByText("My Notes")).toBeDefined();
      });
    });

    test("Home button and ~Log with multiple notes survives reload", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("First Note{Escape}");
      await userEvent.click(await screen.findByLabelText("Create new note"));
      await type("Second Note{Escape}");
      await userEvent.click(await screen.findByLabelText("Create new note"));
      await type("Third Note{Escape}");

      await userEvent.click(await screen.findByLabelText("Navigate to Log"));

      await expectTree(`
~Log
  [R] Third Note
  [R] Second Note
  [R] First Note
      `);

      cleanup();
      renderApp(alice());

      await screen.findByLabelText("Navigate to Log");

      await userEvent.click(await screen.findByLabelText("Navigate to Log"));

      await expectTree(`
~Log
  [R] Third Note
  [R] Second Note
  [R] First Note
      `);
    });

    test("clicking note in ~Log navigates to node with children", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("My Notes{Enter}{Tab}Child One{Enter}Child Two{Escape}");

      await expectTree(`
My Notes
  Child One
  Child Two
      `);

      await userEvent.click(await screen.findByLabelText("Navigate to Log"));

      await expectTree(`
~Log
  [R] My Notes
      `);

      await userEvent.click(await screen.findByText("My Notes"));

      await expectTree(`
My Notes
  Child One
  Child Two
      `);
    });

    test("Home button remains visible after clicking reference in ~Log", async () => {
      const [alice] = setup([ALICE]);
      renderApp(alice());

      await type("My Notes{Enter}{Tab}Child{Escape}");

      await userEvent.click(await screen.findByLabelText("Navigate to Log"));

      await screen.findByLabelText("Navigate to Log");

      await userEvent.click(await screen.findByText("My Notes"));

      await screen.findByLabelText("Navigate to Log");

      cleanup();
      renderApp(alice());

      await screen.findByLabelText("Navigate to Log");
    });
  });
});
