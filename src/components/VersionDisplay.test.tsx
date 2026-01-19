import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALICE,
  setup,
  expectTree,
  findNewNodeEditor,
  renderTree,
} from "../utils.test";

describe("Version Display", () => {
  test("Editing a node creates a version and displays the new text", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create a parent node and a child "Barcelona"
    (await screen.findAllByLabelText("collapse My Notes"))[0];
    await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
    await userEvent.type(await findNewNodeEditor(), "Holiday Destinations{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand and add Barcelona as child
    await userEvent.click(await screen.findByLabelText("expand Holiday Destinations"));
    await userEvent.click(await screen.findByLabelText("add to Holiday Destinations"));
    await userEvent.type(await findNewNodeEditor(), "Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    `);

    // Now edit "Barcelona" to "BCN"
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor);

    // The tree should now show "BCN" instead of "Barcelona"
    await expectTree(`
My Notes
  Holiday Destinations
    BCN
    `);
  });

  test("Multiple edits to the same node show the latest version", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create a node
    (await screen.findAllByLabelText("collapse My Notes"))[0];
    await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
    await userEvent.type(await findNewNodeEditor(), "Version 1{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Version 1
    `);

    // Edit to Version 2
    const editor1 = await screen.findByLabelText("edit Version 1");
    await userEvent.click(editor1);
    await userEvent.clear(editor1);
    await userEvent.type(editor1, "Version 2");
    fireEvent.blur(editor1);

    await expectTree(`
My Notes
  Version 2
    `);

    // Edit to Version 3
    const editor2 = await screen.findByLabelText("edit Version 2");
    await userEvent.click(editor2);
    await userEvent.clear(editor2);
    await userEvent.type(editor2, "Version 3");
    fireEvent.blur(editor2);

    await expectTree(`
My Notes
  Version 3
    `);
  });
});
