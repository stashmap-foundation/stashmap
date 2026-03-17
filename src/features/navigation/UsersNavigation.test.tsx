import { fireEvent, screen } from "@testing-library/react";
import { renderApp, setup, ALICE } from "../../tests/testutils";

test("menu no longer exposes a dedicated users entry point", async () => {
  const [alice] = setup([ALICE]);
  renderApp(alice());

  fireEvent.click(await screen.findByLabelText("open menu"));
  expect(screen.queryByLabelText("open users")).toBeNull();
  expect(screen.queryByLabelText("copy invite link")).toBeNull();
});

test("legacy /follow routes redirect back to the dashboard", async () => {
  const [alice] = setup([ALICE]);
  renderApp({
    ...alice(),
    initialRoute: `/follow?publicKey=${ALICE.publicKey}`,
  });

  await screen.findByLabelText("open menu");
  expect(screen.queryByLabelText("follow user")).toBeNull();
});
