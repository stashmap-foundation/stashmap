import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAppTree } from "../appTestUtils.test";
import { knowstrInit, knowstrSave, write } from "../testFixtures/workspace";
import { loadCliProfile } from "../cli/config";
import { buildDocumentRouteUrl } from "../navigationUrl";

// Regression: the post-save reparse used to drop the filename-derived
// title, so the first save (publishing included) silently renamed the
// document and the breadcrumb lost the filename.
test("publishing keeps the filename as the document's breadcrumb", async () => {
  const { path: workspacePath } = knowstrInit();
  write(workspacePath, "essay.md", "- Point one\n- Point two\n");
  knowstrSave(workspacePath);
  const profile = loadCliProfile({ cwd: workspacePath });
  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(profile.pubkey, "essay.md"),
  });
  await screen.findByText("Point one");
  expect(screen.getByLabelText("Navigation breadcrumbs").textContent).toContain(
    "essay"
  );

  await userEvent.click(await screen.findByLabelText("publish document"));
  await screen.findByLabelText("publishing options");
  expect(screen.getByLabelText("Navigation breadcrumbs").textContent).toContain(
    "essay"
  );
});
