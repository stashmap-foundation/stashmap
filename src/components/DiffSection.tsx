import React, { useState } from "react";
import { DiffItem, DiffSectionData } from "./DiffItem";
import { Indent } from "./Node";

type DiffSectionProps = {
  data: DiffSectionData;
};

export function DiffSection({ data }: DiffSectionProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const { parentPath, diffItems, levels } = data;

  const itemCount = diffItems.size;
  const label =
    itemCount === 1 ? "1 item from others" : `${itemCount} items from others`;

  const toggleExpanded = (): void => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="diff-section" data-testid="diff-section">
      <div className="diff-section-row">
        <Indent levels={levels} />
        <button
          type="button"
          className="diff-section-header"
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `collapse ${label}` : `expand ${label}`}
        >
          <span
            className={`diff-section-arrow ${isExpanded ? "expanded" : ""}`}
          >
            <span className="simple-icon-arrow-right" />
          </span>
          <span className="iconsminds-conference diff-section-icon" />
          <span className="diff-section-label">{label}</span>
        </button>
      </div>

      {isExpanded && (
        <div className="diff-section-items">
          {diffItems.map((diffItem) => (
            <DiffItem
              key={diffItem.nodeID}
              diffItem={diffItem}
              parentPath={parentPath}
              levels={levels + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
