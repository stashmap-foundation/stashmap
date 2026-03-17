type OnSubmit = (event: React.FormEvent<HTMLFormElement>) => Promise<void>;

type SubmitHandlerProps = {
  onHide?: () => void;
  setError?: (error: string | null) => void;
  submit: (form: HTMLFormElement) => Promise<void>;
  setLoading: (loading: boolean) => void;
  reload?: () => void;
};

export function createSubmitHandler({
  reload,
  onHide,
  setError,
  submit,
  setLoading,
}: SubmitHandlerProps): OnSubmit {
  const onSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    const form = event.currentTarget;
    if (form.checkValidity() === false) {
      return;
    }
    setLoading(true);
    try {
      await submit(form);
    } catch (err) {
      const ex: Error = err as Error;
      if (setError) {
        setError(ex.message);
      }
      setLoading(false);
      return;
    }
    setLoading(false);
    if (onHide) {
      onHide();
    }
    if (reload) {
      reload();
    }
  };
  return onSubmit;
}
