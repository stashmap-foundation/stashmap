import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectOverlayTreeAfterReload,
  materializeOverlayRow,
  readOverlayFile,
  reparentOverlayRow,
} from "./OverlayScenario.test";
import {
  expandRecursiveWorkspace,
  recursiveMiddle,
  recursiveSource,
  recursiveTerminal,
  recursiveTree,
  writeRecursiveWorkspace,
} from "./RecursiveScenario.test";
import { expectTree } from "../utils.test";

const variants = ["projected", "materialized-first"];

async function recursiveVariant(
  variant: string,
  name: string
): Promise<string> {
  const workspacePath = writeRecursiveWorkspace();
  await expandRecursiveWorkspace(workspacePath);
  await materializeOverlayRow(variant, name);
  return workspacePath;
}

async function persisted(workspacePath: string, text: string): Promise<void> {
  await waitFor(() => {
    expect(readOverlayFile(workspacePath, "note.md")).toContain(text);
    expect(readOverlayFile(workspacePath, "outer.md")).toContain(
      recursiveSource
    );
    expect(readOverlayFile(workspacePath, "middle.md")).toContain(
      recursiveMiddle
    );
    expect(readOverlayFile(workspacePath, "terminal.md")).toContain(
      recursiveTerminal
    );
  });
}

afterEach(cleanup);

test.each(variants)(
  "changing relevance on a terminal row through two embeds [%s]",
  async (variant) => {
    const workspacePath = await recursiveVariant(variant, "Beta");
    await userEvent.click(screen.getByRole("treeitem", { name: "Beta" }));
    await userEvent.keyboard("?");
    const expected = recursiveTree("", "", "", "{?} ", "Beta", "");
    await expectTree(expected, { showGutter: true });
    await persisted(workspacePath, "(?) [Beta](#beta)");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "adding evidence to a terminal row through two embeds [%s]",
  async (variant) => {
    const workspacePath = await recursiveVariant(variant, "Beta");
    await userEvent.click(screen.getByRole("treeitem", { name: "Beta" }));
    await userEvent.keyboard("+");
    const marker = variant === "materialized-first" ? "{!+} " : "{+} ";
    const expected = recursiveTree("", "", "", marker, "Beta", "");
    await expectTree(expected, { showGutter: true });
    await persisted(workspacePath, "[Beta](#beta)");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "adding a combined marker to a terminal row through two embeds [%s]",
  async (variant) => {
    const workspacePath = await recursiveVariant(variant, "Beta");
    if (variant === "projected") {
      await userEvent.click(screen.getByRole("treeitem", { name: "Beta" }));
      await userEvent.keyboard("!");
    }
    await userEvent.click(screen.getByRole("treeitem", { name: "Beta" }));
    await userEvent.keyboard("+");
    const expected = recursiveTree("", "", "", "{!+} ", "Beta", "");
    await expectTree(expected, { showGutter: true });
    await persisted(workspacePath, "[Beta](#beta)");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "dismissing and restoring a terminal row through two embeds [%s]",
  async (variant) => {
    const workspacePath = await recursiveVariant(variant, "Beta");
    await userEvent.click(screen.getByRole("treeitem", { name: "Beta" }));
    await userEvent.keyboard("x");
    expect(screen.queryByRole("treeitem", { name: "Beta" })).toBeNull();
    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));
    await userEvent.click(screen.getByRole("treeitem", { name: "Beta" }));
    await userEvent.keyboard("?");
    await userEvent.click(screen.getByLabelText("toggle Not Relevant filter"));
    const expected = recursiveTree("", "", "", "{?} ", "Beta", "");
    await expectTree(expected, { showGutter: true });
    await persisted(workspacePath, "(?) [Beta](#beta)");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "rewording a terminal row twice through two embeds [%s]",
  async (variant) => {
    const workspacePath = await recursiveVariant(variant, "Beta");
    const editor = screen.getByRole("textbox", { name: "edit Beta" });
    await userEvent.clear(editor);
    await userEvent.type(editor, "First wording{Escape}");
    const second = screen.getByRole("textbox", { name: "edit First wording" });
    await userEvent.clear(second);
    await userEvent.type(second, "Final wording{Escape}");
    const marker = variant === "materialized-first" ? "{!} " : "";
    const expected = recursiveTree("", "", "", marker, "Final wording", "");
    await expectTree(expected, { showGutter: true });
    await persisted(workspacePath, "Final wording");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "marking the terminal parent through two embeds [%s]",
  async (variant) => {
    const workspacePath = await recursiveVariant(variant, "Terminal Parent");
    await userEvent.click(
      screen.getByRole("treeitem", { name: "Terminal Parent" })
    );
    await userEvent.keyboard("?");
    const expected = recursiveTree("", "", "", "", "Beta", "").replace(
      "            Terminal Parent",
      "            {?} Terminal Parent"
    );
    await expectTree(expected, { showGutter: true });
    await persisted(workspacePath, "(?) [Terminal Parent](#terminal-parent)");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "marking the terminal embed inside the middle embed [%s]",
  async (variant) => {
    const workspacePath = await recursiveVariant(variant, "Terminal");
    await userEvent.click(screen.getByRole("treeitem", { name: "Terminal" }));
    await userEvent.keyboard("?");
    const expected = recursiveTree("", "", "{?} ", "", "Beta", "");
    await expectTree(expected, { showGutter: true });
    await persisted(workspacePath, "(?) [Terminal](#middle-terminal)");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "marking the middle embed inside the outer embed [%s]",
  async (variant) => {
    const workspacePath = await recursiveVariant(variant, "Middle");
    await userEvent.click(screen.getByRole("treeitem", { name: "Middle" }));
    await userEvent.keyboard("?");
    const expected = recursiveTree("", "{?} ", "", "", "Beta", "");
    await expectTree(expected, { showGutter: true });
    await persisted(workspacePath, "(?) [Middle](#outer-middle)");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "marking the outer embed without flattening inner embeds [%s]",
  async (variant) => {
    const workspacePath = await recursiveVariant(variant, "Outer");
    await userEvent.click(screen.getByRole("treeitem", { name: "Outer" }));
    await userEvent.keyboard("?");
    const expected = recursiveTree("{?} ", "", "", "", "Beta", "");
    await expectTree(expected, { showGutter: true });
    await persisted(workspacePath, "(?) [Outer](#outer)");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving an outer projected row under a terminal row [%s]",
  async (variant) => {
    const workspacePath = await recursiveVariant(variant, "Beta");
    reparentOverlayRow("Outer Before", "Beta", 9);
    const marker = variant === "materialized-first" ? "{!} " : "";
    const expected = recursiveTree(
      "",
      "",
      "",
      marker,
      "Beta",
      "\n                Outer Before"
    ).replace("      Outer Before\n", "");
    await expectTree(expected, { showGutter: true });
    await persisted(workspacePath, "[Beta](#beta)");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);

test.each(variants)(
  "moving an embedded terminal sibling under another terminal row [%s]",
  async (variant) => {
    const workspacePath = await recursiveVariant(variant, "Beta");
    reparentOverlayRow("Gamma", "Beta", 9);
    const marker = variant === "materialized-first" ? "{!} " : "";
    const expected = recursiveTree(
      "",
      "",
      "",
      marker,
      "Beta",
      "\n                Gamma"
    ).replace("              Gamma\n", "");
    await expectTree(expected, { showGutter: true });
    await persisted(workspacePath, "[Gamma](#gamma)");
    await expectOverlayTreeAfterReload(workspacePath, expected, true);
  }
);
