import React, { useEffect, useRef, useState } from "react";
import { Modal, Form } from "react-bootstrap";
import { ErrorMessage } from "./ErrorMessage";
import { ModalFooter } from "./ModalFooter";
import { createSubmitHandler } from "./modalFormSubmitHandler";

type ModalFormProps = {
  children: React.ReactNode;
  onHide: () => void;
  title: string;
  submit: (form: HTMLFormElement) => Promise<void>;
  formRef?: React.Ref<HTMLFormElement>;
  SubmitButton?: () => JSX.Element;
  reload?: () => void;
  hideFooter?: boolean;
  size?: "sm" | "lg" | "xl";
  hideAfterSubmit?: boolean;
};

export function ModalForm({
  children,
  onHide,
  title,
  submit,
  formRef,
  SubmitButton,
  reload,
  hideFooter,
  size,
  hideAfterSubmit,
}: ModalFormProps): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const componentIsMounted = useRef(true);
  useEffect(() => {
    return () => {
      // eslint-disable-next-line functional/immutable-data
      componentIsMounted.current = false;
    };
  }, []);

  const hideIfMounted = (): void => {
    if (componentIsMounted.current) {
      onHide();
    }
  };

  const onSubmit = createSubmitHandler({
    reload,
    onHide:
      hideAfterSubmit === true || hideAfterSubmit === undefined
        ? hideIfMounted
        : undefined,
    setLoading: (l: boolean) => {
      if (componentIsMounted.current) {
        setLoading(l);
      }
    },
    setError,
    submit,
  });

  return (
    <Modal show onHide={onHide} size={size}>
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Form onSubmit={onSubmit} ref={formRef} title={title} name={title}>
        <Modal.Body>
          <ErrorMessage error={error} setError={setError} />
          {children}
        </Modal.Body>
        {!hideFooter && (
          <ModalFooter
            loading={loading}
            SubmitButton={SubmitButton}
            onHide={onHide}
          />
        )}
      </Form>
    </Modal>
  );
}
