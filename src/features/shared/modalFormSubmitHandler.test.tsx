import { waitFor } from "@testing-library/react";
import { createSubmitHandler } from "./modalFormSubmitHandler";

type TestSubmitHandlerResponse = {
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onHide: () => void;
  setError: (error: string) => void;
  setLoading: (loading: boolean) => void;
  reload: () => void;
};

function submitHandler({
  submit,
}: {
  submit?: (form: HTMLFormElement) => Promise<void>;
}): TestSubmitHandlerResponse {
  const onHide = jest.fn();
  const setError = jest.fn();
  const setLoading = jest.fn();
  const reload = jest.fn();
  const onSubmit = createSubmitHandler({
    onHide,
    setError,
    setLoading,
    reload,
    submit: submit || jest.fn(),
  });
  return {
    onSubmit,
    onHide,
    setLoading,
    setError,
    reload,
  };
}

function testEvent(
  checkValidity?: () => boolean
): React.FormEvent<HTMLFormElement> {
  return {
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    currentTarget: {
      checkValidity: checkValidity || ((): boolean => true),
    },
  } as unknown as React.FormEvent<HTMLFormElement>;
}

test("Doesn't load if form is not valid", () => {
  const submit = jest.fn();
  const { onSubmit, setLoading, reload } = submitHandler({ submit });
  onSubmit(testEvent((): boolean => false));
  expect(setLoading).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

test("Displays error", () => {
  const submit = (): Promise<void> => {
    throw Error("Something went wrong");
  };
  const { onSubmit, setError, reload, setLoading, onHide } = submitHandler({
    submit,
  });
  onSubmit(testEvent());
  expect(setError).toHaveBeenCalledWith("Something went wrong");
  expect(setLoading).toHaveBeenCalledWith(true);
  expect(setLoading).toHaveBeenLastCalledWith(false);
  expect(reload).not.toHaveBeenCalled();
  expect(onHide).not.toHaveBeenCalled();
});

test("Submitting goes well", async () => {
  const submit = jest.fn();
  const { onHide, onSubmit, setLoading, reload, setError } = submitHandler({
    submit,
  });
  onSubmit(testEvent());
  await waitFor(() => {
    expect(setError).not.toHaveBeenCalled();
    expect(setLoading).toHaveBeenCalledWith(true);
    expect(setLoading).toHaveBeenLastCalledWith(false);
    expect(reload).toHaveBeenCalled();
    expect(onHide).toHaveBeenCalled();
  });
});
