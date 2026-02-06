export type KeyboardMode = "normal" | "insert";

export type ActiveRowState = {
  activeRowKey: string;
  activeRowIndex: number;
};

export const ROW_SELECTOR = '[data-row-focusable="true"]';

export function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return (
    target.closest("input, textarea, [contenteditable='true']") !== null
  );
}

export function getFocusableRows(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll(ROW_SELECTOR)).filter(
    (el): el is HTMLElement => el instanceof HTMLElement
  );
}

export function getRowFromElement(
  target: EventTarget | null
): HTMLElement | undefined {
  if (!(target instanceof HTMLElement)) {
    return undefined;
  }
  const row = target.closest(ROW_SELECTOR);
  if (!(row instanceof HTMLElement)) {
    return undefined;
  }
  return row;
}

export function getRowDepth(row: HTMLElement): number {
  const raw = row.getAttribute("data-row-depth");
  return Number(raw || 0);
}

export function getRowIndex(row: HTMLElement): number {
  const raw = row.getAttribute("data-row-index");
  return Number(raw || 0);
}

export function getRowKey(row: HTMLElement): string {
  return row.getAttribute("data-view-key") || "";
}

export function focusRow(row: HTMLElement | undefined): void {
  if (!row) {
    return;
  }
  row.focus();
}
