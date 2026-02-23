import React, { CSSProperties } from "react";
import { Badge as BSBadge, Card } from "react-bootstrap";

export type Children = {
  children?: React.ReactNode;
};

type BadgeProps = {
  value?: number;
  isLeft?: boolean;
  size?: number;
  ariaLabel?: string;
};

export function Badge({
  value,
  isLeft,
  size,
  ariaLabel,
}: BadgeProps): JSX.Element {
  return (
    <>
      {value !== undefined && value > 0 && (
        <div className="position-relative">
          <div
            className="position-absolute align-top"
            style={
              isLeft
                ? { top: "-20px", left: "-15px", zIndex: 1 }
                : { top: "-17px", right: "-15px", zIndex: 1 }
            }
          >
            <BSBadge
              aria-label={ariaLabel}
              pill
              bg="red"
              className="mb-1"
              style={{ fontSize: `${size || 55}%` }}
            >
              {value}
            </BSBadge>
          </div>
        </div>
      )}
    </>
  );
}

export function PaneColumn({
  children,
  columnSpan,
  dataTestId,
}: Children & {
  columnSpan?: number;
  dataTestId?: string;
}): JSX.Element {
  return (
    <div
      className="pane-column"
      data-testid={dataTestId || "pane-col"}
      style={columnSpan ? { gridColumn: `span ${columnSpan}` } : {}}
    >
      {children}
    </div>
  );
}

export function UIColumn({
  children,
  keyString,
}: Children & {
  keyString?: string;
}): JSX.Element {
  return (
    <div className="mb-2 outer-node flex-col" key={keyString || "outer-node"}>
      <div className="flex-col max-height-100">{children}</div>
    </div>
  );
}

type KnowledgeNodeCardProps = {
  badgeValue?: number;
  style?: CSSProperties | undefined;
  className?: string;
  cardBodyClassName?: string;
  "data-suggestion"?: string;
  "data-virtual-type"?: string;
  "data-other-user"?: string;
  "data-deleted"?: string;
};

export function NodeCard({
  children,
  badgeValue,
  style,
  className,
  cardBodyClassName,
  "data-suggestion": dataSuggestion,
  "data-virtual-type": dataVirtualType,
  "data-other-user": dataOtherUser,
  "data-deleted": dataDeleted,
}: Partial<Children> & KnowledgeNodeCardProps): JSX.Element {
  return (
    <Card
      className={`inner-node ${className || ""}`}
      style={style}
      data-suggestion={dataSuggestion}
      data-virtual-type={dataVirtualType}
      data-other-user={dataOtherUser}
      data-deleted={dataDeleted}
    >
      <Badge value={badgeValue} isLeft size={80} />
      <Card.Body className={cardBodyClassName || "ps-0 pb-2 pt-2"}>
        <div className="node-row">{children}</div>
      </Card.Body>
    </Card>
  );
}

type BtnProps = {
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  type?: "button" | "submit";
} & Children;

export function Button({
  children,
  ariaLabel,
  onClick,
  className,
  disabled,
  type,
}: BtnProps): JSX.Element {
  return (
    <button
      disabled={disabled}
      type={type === "submit" ? "submit" : "button"}
      className={className || "btn"}
      onClick={onClick}
      aria-label={ariaLabel}
      tabIndex={0}
    >
      {children && children}
    </button>
  );
}

export function CloseButton({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <button className="btn btn-icon" type="button" onClick={onClose}>
      <span aria-hidden="true">×</span>
      <span className="visually-hidden">Close</span>
    </button>
  );
}

export function CancelButton({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  return (
    <button className="btn btn-icon" type="button" onClick={onClose}>
      <span aria-hidden="true">⊘</span>
      <span className="visually-hidden">Cancel</span>
    </button>
  );
}
