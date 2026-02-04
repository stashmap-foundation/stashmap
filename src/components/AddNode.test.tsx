import { screen } from "@testing-library/react";
import { setup, ALICE, renderApp, type, expectTree } from "../utils.test";

test("Add note via keyboard", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("My First Note{Escape}");

  await screen.findByLabelText("edit My First Note");
});

test("Add nested note via keyboard", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  await type("Parent{Enter}Child Note{Escape}");

  await expectTree(`
Parent
  Child Note
  `);
});
