import React from "react";

type ErrorMessageProps = {
  error: string | null;
  setError: (error: string | null) => void;
};

export function ErrorMessage({
  error,
  setError,
}: ErrorMessageProps): JSX.Element {
  return (
    <>
      {error !== null && (
        <div
          className="error-inline"
          onClick={(): void => setError(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(e): void => {
            if (e.key === "Enter" || e.key === " ") setError(null);
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}
