import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import { Button } from "react-bootstrap";
import { ModalFooter } from "./ModalFooter";

test("test default rendering", () => {
  const onAbort = jest.fn();
  render(<ModalFooter onHide={onAbort} loading={false} />);
  screen.getByText("Save");
  const abortBtn = screen.getByText("Cancel");
  fireEvent.click(abortBtn);
  expect(onAbort).toHaveBeenCalledTimes(1);
});

test("test custom button", () => {
  render(
    <ModalFooter
      onHide={jest.fn()}
      loading={false}
      SubmitButton={(): JSX.Element => <Button>My Custom Button</Button>}
    />
  );
  screen.getByText("My Custom Button");
});

test("test loading Spinner", () => {
  render(<ModalFooter onHide={jest.fn()} loading />);
  screen.getByLabelText("loading");
});
