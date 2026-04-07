/** @jest-environment node */

import { formatCliError } from "./output";

test("formatCliError prints plain text instead of json", () => {
  expect(formatCliError(new Error("boom"))).toBe("Error: boom\n");
});

test("formatCliError preserves multiline messages", () => {
  expect(formatCliError(new Error("first line\nsecond line"))).toBe(
    "Error: first line\nsecond line\n"
  );
});
