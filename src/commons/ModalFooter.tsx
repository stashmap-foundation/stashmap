import React from "react";
import Modal from "react-bootstrap/Modal";

type ModalFooterProps = {
  onHide: () => void;
  loading: boolean;
  SubmitButton?: () => JSX.Element;
};

export function ModalFooter({
  onHide,
  loading,
  SubmitButton,
}: ModalFooterProps): JSX.Element {
  const Submit =
    SubmitButton ||
    ((): JSX.Element => (
      <button type="submit" className="btn btn-outline-dark">
        Save
      </button>
    ));

  return (
    <Modal.Footer>
      <button
        type="button"
        className="btn btn-outline-dark me-auto"
        onClick={onHide}
      >
        Cancel
      </button>
      {loading ? (
        <div
          aria-label="loading"
          className="spinner-border text-success"
          role="status"
        />
      ) : (
        <Submit />
      )}
    </Modal.Footer>
  );
}
