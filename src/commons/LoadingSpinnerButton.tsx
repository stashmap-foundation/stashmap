import React, { useState, useEffect, useRef } from "react";
import { Spinner } from "react-bootstrap";
import { Button } from "./Ui";

export type LoadingSpinnerBtnProps = {
  children?: React.ReactNode;
  onClick?: () => Promise<void>;
  afterOnClick?: () => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  type?: "submit" | "button";
};

export function LoadingSpinnerButton({
  children,
  onClick,
  afterOnClick,
  className,
  disabled,
  ariaLabel,
  type,
}: LoadingSpinnerBtnProps): JSX.Element {
  const [loading, setLoading] = useState(false);
  const componentIsMounted = useRef(true);
  useEffect(() => {
    return () => {
      // eslint-disable-next-line functional/immutable-data
      componentIsMounted.current = false;
    };
  }, []);
  const submit = async (): Promise<void> => {
    if (onClick) {
      setLoading(true);
      await onClick();
      // Don't Update status if component is not mounted anymore
      if (componentIsMounted.current) {
        setLoading(false);
      }
      if (afterOnClick !== undefined) {
        afterOnClick();
      }
    }
  };
  if (loading) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px" }}>
        <Spinner animation="border" role="status" size="sm" />
      </div>
    );
  }
  return (
    <Button
      className={className}
      ariaLabel={ariaLabel}
      onClick={submit}
      disabled={disabled}
      type={type}
    >
      {children}
    </Button>
  );
}
