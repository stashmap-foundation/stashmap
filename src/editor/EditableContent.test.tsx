import { screen, waitFor } from "@testing-library/react";
import { renderAppTree } from "../appTestUtils.test";
import { LOCAL } from "../core/nodeRef";
import { buildDocumentRouteUrl } from "../navigationUrl";
import { knowstrInit, knowstrSave, write } from "../testFixtures/workspace";

test("editable rows with repeated identical entity links do not emit duplicate key warnings", async () => {
  const workspace = knowstrInit().path;
  write(
    workspace,
    "entities.md",
    [
      "# Tagged Entities <!-- id:tagged-entities -->",
      "- [Rußland](#wd:Q159) and [Rußland](#wd:Q159) <!-- id:duplicate-russia -->",
      "",
    ].join("\n")
  );
  await knowstrSave(workspace);

  const renderErrors = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    await renderAppTree({
      path: workspace,
      initialRoute: buildDocumentRouteUrl(LOCAL, "entities.md"),
    });
    await screen.findByLabelText("edit Rußland and Rußland");
    await waitFor(() => {
      expect(
        renderErrors.mock.calls.some((call) =>
          call.some(
            (part) =>
              typeof part === "string" &&
              part.includes("Encountered two children with the same key")
          )
        )
      ).toBe(false);
    });
  } finally {
    renderErrors.mockRestore();
  }
});
