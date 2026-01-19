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

  test("Creating a node with same text as previously versioned node shows the typed text", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Holiday Destinations
    await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
    await userEvent.type(await findNewNodeEditor(), "Holiday Destinations{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand and add Barcelona
    await userEvent.click(await screen.findByLabelText("expand Holiday Destinations"));
    await userEvent.click(await screen.findByLabelText("add to Holiday Destinations"));
    await userEvent.type(await findNewNodeEditor(), "Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    `);

    // Edit Barcelona to BCN
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor);

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
    `);

    // Now create another node with text "Barcelona" (same content-addressed ID)
    // This adds "Barcelona" to top of ~Versions, so BOTH nodes show "Barcelona"
    // (they're the same node with the same ~Versions)
    await userEvent.click(await screen.findByLabelText("add to Holiday Destinations"));
    await userEvent.type(await findNewNodeEditor(), "Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Both references to the same node show the same versioned text
    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    `);
  });

  test("~Versions list contains both original text and new version after first edit", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Holiday Destinations
    await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
    await userEvent.type(await findNewNodeEditor(), "Holiday Destinations{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand and add Barcelona
    await userEvent.click(await screen.findByLabelText("expand Holiday Destinations"));
    await userEvent.click(await screen.findByLabelText("add to Holiday Destinations"));
    await userEvent.type(await findNewNodeEditor(), "Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    `);

    // Edit Barcelona to BCN
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor);

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
    `);

    // Expand BCN to manually add ~Versions as a child
    await userEvent.click(await screen.findByLabelText("expand BCN"));

    // Add ~Versions as a child by typing it (content-addressed ID will match existing ~Versions)
    await userEvent.click(await screen.findByLabelText("add to BCN"));
    await userEvent.type(await findNewNodeEditor(), "~Versions{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
      ~Versions
    `);

    // Expand ~Versions to see all versions
    await userEvent.click(await screen.findByLabelText("expand ~Versions"));

    // ~Versions should contain both BCN (current/top) and Barcelona (original)
    await expectTree(`
My Notes
  Holiday Destinations
    BCN
      ~Versions
        BCN
        Barcelona
    `);
  });

  test("Setting top version to not_relevant shows the previous version", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Holiday Destinations
    await userEvent.click((await screen.findAllByLabelText("add to My Notes"))[0]);
    await userEvent.type(await findNewNodeEditor(), "Holiday Destinations{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand and add Barcelona
    await userEvent.click(await screen.findByLabelText("expand Holiday Destinations"));
    await userEvent.click(await screen.findByLabelText("add to Holiday Destinations"));
    await userEvent.type(await findNewNodeEditor(), "Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    `);

    // Edit Barcelona to BCN
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor);

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
    `);

    // Expand BCN to manually add ~Versions as a child
    await userEvent.click(await screen.findByLabelText("expand BCN"));

    // Add ~Versions as a child by typing it
    await userEvent.click(await screen.findByLabelText("add to BCN"));
    await userEvent.type(await findNewNodeEditor(), "~Versions{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand ~Versions to see all versions
    await userEvent.click(await screen.findByLabelText("expand ~Versions"));

    await expectTree(`
My Notes
  Holiday Destinations
    BCN
      ~Versions
        BCN
        Barcelona
    `);

    // Mark the top version (BCN inside ~Versions) as not relevant
    // There are two "mark BCN as not relevant" buttons - parent and inside ~Versions
    const notRelevantButtons = await screen.findAllByLabelText("mark BCN as not relevant");
    // The second one is inside ~Versions
    fireEvent.click(notRelevantButtons[1]);

    // Now the display should fall back to showing Barcelona (the previous version)
    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
      ~Versions
        Barcelona
    `);
  });
});
