import fs from "fs";
import os from "os";
import path from "path";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAppTree } from "../appTestUtils.test";
import { buildDocumentRouteUrl } from "../navigationUrl";
import { LOCAL } from "../core/nodeRef";
import { expectTree, setDropIndentLevel } from "../utils.test";

export function writeOverlayWorkspace(files: Record<string, string>): string {
  const workspacePath = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowstr-overlay-scenario-")
  );
  Object.entries(files).forEach(([name, content]) => {
    fs.writeFileSync(path.join(workspacePath, name), content);
  });
  return workspacePath;
}

export async function expandOverlayWorkspace(
  workspacePath: string,
  documentName: string
): Promise<void> {
  await renderAppTree({
    path: workspacePath,
    initialRoute: buildDocumentRouteUrl(LOCAL, documentName),
  });
  const [root] = await screen.findAllByRole("treeitem");
  await userEvent.click(root);
  await userEvent.keyboard("{Meta>}{ArrowDown}{/Meta}");
}

export async function reloadOverlayWorkspace(
  workspacePath: string,
  documentName: string
): Promise<void> {
  cleanup();
  await expandOverlayWorkspace(workspacePath, documentName);
}

export async function materializeOverlayRow(
  variant: string,
  name: string
): Promise<void> {
  if (variant !== "materialized-first") {
    return;
  }
  await userEvent.click(screen.getByRole("treeitem", { name }));
  await userEvent.keyboard("!");
}

export function dragOverlayRow(source: string, target: string): void {
  fireEvent.dragStart(screen.getByRole("treeitem", { name: source }));
  fireEvent.drop(screen.getByRole("treeitem", { name: target }));
}

export function reparentOverlayRow(
  source: string,
  target: string,
  depth: number
): void {
  fireEvent.dragStart(screen.getByRole("treeitem", { name: source }));
  setDropIndentLevel(source, target, depth);
  fireEvent.drop(screen.getByRole("treeitem", { name: target }));
}

export function dragOverlayOccurrence(
  source: string,
  sourceIndex: number,
  target: string,
  targetIndex: number
): void {
  const sourceRow = screen.getAllByRole("treeitem", { name: source })[
    sourceIndex
  ];
  const targetRow = screen.getAllByRole("treeitem", { name: target })[
    targetIndex
  ];
  fireEvent.dragStart(sourceRow);
  fireEvent.drop(targetRow);
}

export function readOverlayFile(workspacePath: string, name: string): string {
  return fs.readFileSync(path.join(workspacePath, name), "utf8");
}

export function writeOverlayFile(
  workspacePath: string,
  name: string,
  content: string
): void {
  fs.writeFileSync(path.join(workspacePath, name), content);
}

export function markerForVariant(variant: string): string {
  return variant === "materialized-first" ? "{!} " : "";
}

export async function expectOverlayTreeAfterReload(
  workspacePath: string,
  expected: string,
  showGutter: boolean
): Promise<void> {
  await reloadOverlayWorkspace(workspacePath, "note.md");
  await expectTree(expected, { showGutter });
}

test.skip("skip", () => {});
