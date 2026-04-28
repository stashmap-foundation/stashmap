/* eslint-disable import/no-extraneous-dependencies */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
/* eslint-enable import/no-extraneous-dependencies */

export function getSelectedNodes(): string[] {
  return Array.from(
    document.querySelectorAll('.item[data-selected="true"]')
  ).map((el) => el.getAttribute("data-node-text") || "");
}

function getActionTargets(): string[] {
  const selected = getSelectedNodes();
  if (selected.length > 0) {
    return selected;
  }
  /* eslint-disable testing-library/no-node-access */
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const item = active.closest('.item[data-row-focusable="true"]');
    if (item) {
      return [item.getAttribute("data-node-text") || ""];
    }
  }
  /* eslint-enable testing-library/no-node-access */
  return [];
}

export async function expectTargets(...expected: string[]): Promise<void> {
  await waitFor(() => {
    expect(getActionTargets()).toEqual(expected);
  });
}

export async function expectNoTargets(): Promise<void> {
  await waitFor(() => {
    expect(getActionTargets()).toEqual([]);
  });
}

export async function clickRow(name: string): Promise<void> {
  const row = await screen.findByLabelText(name);
  await userEvent.click(row);
}

export function modClick(
  el: HTMLElement,
  modifiers: { metaKey?: boolean; shiftKey?: boolean }
): void {
  fireEvent.click(el, modifiers);
}
