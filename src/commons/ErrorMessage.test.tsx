import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import { ErrorMessage } from "./ErrorMessage";

test("Renders empty if there is no error", () => {
  const { container } = render(
    <div>
      <ErrorMessage error={null} setError={jest.fn()} />
    </div>
  );
  expect(container.innerHTML).toEqual("<div></div>");
});

test("Renders message", () => {
  render(
    <div>
      <ErrorMessage error="my error" setError={jest.fn()} />
    </div>
  );
  screen.getByText("my error");
});

test("Sets error to null on close", () => {
  const setError = jest.fn();
  render(
    <div>
      <ErrorMessage error="my error" setError={setError} />
    </div>
  );
  const closeButton = screen.getByLabelText("Close alert");
  fireEvent.click(closeButton);
  expect(setError).toHaveBeenCalledTimes(1);
  expect(setError).toHaveBeenCalledWith(null);
});
