import React from "react";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";
import { Form } from "react-bootstrap";
import { ModalForm } from "./ModalForm";

type TestResult = {
  onHide: () => void;
  reload: () => void;
};

function createTestForm(
  submit: (form: HTMLFormElement) => Promise<void>
): TestResult {
  const reload = jest.fn();
  const onHide = jest.fn();
  render(
    <div>
      <ModalForm
        title="Form Title"
        onHide={onHide}
        reload={reload}
        submit={submit}
      >
        <Form.Group controlId="formAsset">
          <Form.Label>Asset</Form.Label>
          <Form.Control />
        </Form.Group>
      </ModalForm>
    </div>
  );
  return {
    reload,
    onHide,
  };
}

test("show error", () => {
  const { onHide, reload } = createTestForm(() => {
    throw Error("Something went wrong");
  });
  const submit = screen.getByText("Save");
  fireEvent.click(submit);
  screen.getByText("Something went wrong");
  expect(onHide).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

test("submit", async () => {
  const onSubmit = jest.fn();
  const { onHide, reload } = createTestForm(onSubmit);
  const submitBtn = screen.getByText("Save");
  fireEvent.click(submitBtn);
  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
