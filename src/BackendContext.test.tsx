import React from "react";
import { render } from "@testing-library/react";
import { useBackend } from "./BackendContext";

function UseBackendHarness(): JSX.Element {
  useBackend();
  return <div />;
}

test("useBackend throws when BackendContext is not provided", () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<UseBackendHarness />)).toThrow(
    "BackendContext not provided"
  );
  spy.mockRestore();
});
