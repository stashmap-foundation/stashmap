/** @jest-environment node */

import { validateEditedDocumentIntegrity } from "./workspaceIntegrity";

const BASELINE = `# Root {root}\n- Keep {keep}\n- Remove {remove}\n`;

test("validateEditedDocumentIntegrity rejects duplicate markers", () => {
  expect(() =>
    validateEditedDocumentIntegrity(
      BASELINE,
      "# Root {root}\n- Keep {keep}\n- Also Keep {keep}\n- Remove {remove}\n"
    )
  ).toThrow("Edited document contains duplicate markers: keep");
});

test("validateEditedDocumentIntegrity rejects invented markers", () => {
  expect(() =>
    validateEditedDocumentIntegrity(
      BASELINE,
      "# Root {root}\n- Keep {keep}\n- Remove {remove}\n- New {new-marker}\n"
    )
  ).toThrow("Edited document invents new markers: new-marker");
});

test("validateEditedDocumentIntegrity rejects lost markers", () => {
  expect(() =>
    validateEditedDocumentIntegrity(BASELINE, "# Root {root}\n- Keep {keep}\n")
  ).toThrow("Edited document loses markers: remove");
});

test("validateEditedDocumentIntegrity accepts delete-by-move and strips the Delete section", () => {
  const result = validateEditedDocumentIntegrity(
    BASELINE,
    [
      "# Root {root}",
      "- Keep {keep}",
      "",
      "# Delete",
      "- Remove {remove}",
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
        "# Root {root}",
        "- Keep {keep}",
        "- Delete",
        "  - Remove {remove}",
        "",
      ].join("\n")
    )
  ).toThrow(
    'Delete section must be a separate "# Delete" root at the end of the file'
  );
});
