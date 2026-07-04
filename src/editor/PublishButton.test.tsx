import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  findNewNodeEditor,
  navigateToNodeViaSearch,
  renderTree,
  setup,
} from "../utils.test";

test("the header button publishes, pauses, and resumes a document", async () => {
  const [alice] = setup([ALICE]);
  renderTree(alice);
  await userEvent.type(await findNewNodeEditor(), "My Essay{Escape}");
  cleanup();

  renderTree(alice);
  await navigateToNodeViaSearch(0, "My Essay");

  await userEvent.click(await screen.findByLabelText("publish document"));

  const toggle = await screen.findByLabelText("publishing options");
  expect(toggle.textContent).toContain("now publishing");

  await userEvent.click(toggle);
  await userEvent.click(await screen.findByLabelText("pause publishing"));
  await waitFor(() =>
    expect(screen.getByLabelText("publishing options").textContent).toContain(
      "paused"
    )
  );

  await userEvent.click(screen.getByLabelText("publishing options"));
  await userEvent.click(await screen.findByLabelText("resume publishing"));
  await waitFor(() =>
    expect(screen.getByLabelText("publishing options").textContent).toContain(
      "published"
    )
  );
});
