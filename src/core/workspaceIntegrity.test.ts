/** @jest-environment node */

import { validateEditedDocumentIntegrity } from "./workspaceIntegrity";

const BASELINE = `# Root <!-- id:root -->\n- Keep <!-- id:keep -->\n- Remove <!-- id:remove -->\n`;

test("validateEditedDocumentIntegrity rejects duplicate markers", () => {
  expect(() =>
    validateEditedDocumentIntegrity(
      BASELINE,
      "# Root <!-- id:root -->\n- Keep <!-- id:keep -->\n- Also Keep <!-- id:keep -->\n- Remove <!-- id:remove -->\n"
    )
  ).toThrow("Edited document contains duplicate markers: keep");
});

test("validateEditedDocumentIntegrity rejects invented markers", () => {
  expect(() =>
    validateEditedDocumentIntegrity(
      BASELINE,
      "# Root <!-- id:root -->\n- Keep <!-- id:keep -->\n- Remove <!-- id:remove -->\n- New <!-- id:new-marker -->\n"
    )
  ).toThrow("Edited document invents new markers: new-marker");
});

test("validateEditedDocumentIntegrity rejects lost markers", () => {
  expect(() =>
    validateEditedDocumentIntegrity(
      BASELINE,
      "# Root <!-- id:root -->\n- Keep <!-- id:keep -->\n"
    )
  ).toThrow("Edited document loses markers: remove");
});

test("validateEditedDocumentIntegrity accepts delete-by-move and strips the Delete section", () => {
  const result = validateEditedDocumentIntegrity(
    BASELINE,
    [
      "# Root <!-- id:root -->",
      "- Keep <!-- id:keep -->",
      "",
      "# Delete",
      "- Remove <!-- id:remove -->",
      "",
    ].join("\n")
  );

  expect(result.deletedMarkers).toEqual(["remove"]);
  expect(result.sanitizedRoot.children.map((child) => child.text)).toEqual([
    "Keep",
  ]);
});

test("validateEditedDocumentIntegrity rejects list-style Delete sections", () => {
  expect(() =>
    validateEditedDocumentIntegrity(
      BASELINE,
      [
        "# Root <!-- id:root -->",
        "- Keep <!-- id:keep -->",
        "- Delete",
        "  - Remove <!-- id:remove -->",
        "",
      ].join("\n")
    )
  ).toThrow(
    'Delete section must be a separate "# Delete" root at the end of the file'
  );
});
