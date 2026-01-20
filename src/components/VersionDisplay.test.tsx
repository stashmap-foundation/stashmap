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
  test("Reference node displays versioned text in path", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create: My Notes -> Holiday Destinations -> Barcelona
    await userEvent.click(
      (
        await screen.findAllByLabelText("add to My Notes")
      )[0]
    );
    await userEvent.type(
      await findNewNodeEditor(),
      "Holiday Destinations{Enter}"
    );
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await userEvent.click(
      await screen.findByLabelText("expand Holiday Destinations")
    );
    await userEvent.click(
      await screen.findByLabelText("add to Holiday Destinations")
    );
    await userEvent.type(await findNewNodeEditor(), "Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Edit Barcelona to BCN
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor);

    // Verify BCN is displayed
    await screen.findByLabelText("edit BCN");

    // Show "Referenced By" for BCN
    fireEvent.click(await screen.findByLabelText("show references to BCN"));
    await screen.findByLabelText("hide references to BCN");

    // The reference path should show versioned text "BCN" (not "Barcelona")
    // The full path is "My Notes → Holiday Destinations → BCN"
    await screen.findByText("My Notes → Holiday Destinations → BCN");
  });

  test("Editing a node creates a version and displays the new text", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create a parent node and a child "Barcelona"
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(
      (
        await screen.findAllByLabelText("add to My Notes")
      )[0]
    );
    await userEvent.type(
      await findNewNodeEditor(),
      "Holiday Destinations{Enter}"
    );
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand and add Barcelona as child
    await userEvent.click(
      await screen.findByLabelText("expand Holiday Destinations")
    );
    await userEvent.click(
      await screen.findByLabelText("add to Holiday Destinations")
    );
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
    await screen.findByLabelText("collapse My Notes");
    await userEvent.click(
      (
        await screen.findAllByLabelText("add to My Notes")
      )[0]
    );
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
    await userEvent.click(
      (
        await screen.findAllByLabelText("add to My Notes")
      )[0]
    );
    await userEvent.type(
      await findNewNodeEditor(),
      "Holiday Destinations{Enter}"
    );
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand and add Barcelona
    await userEvent.click(
      await screen.findByLabelText("expand Holiday Destinations")
    );
    await userEvent.click(
      await screen.findByLabelText("add to Holiday Destinations")
    );
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
    await userEvent.click(
      await screen.findByLabelText("add to Holiday Destinations")
    );
    await userEvent.type(await findNewNodeEditor(), "Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Both references to the same node show the same versioned text
    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
    Barcelona
    `);
  });

  test("~Versions list contains both original text and new version after first edit", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Holiday Destinations
    await userEvent.click(
      (
        await screen.findAllByLabelText("add to My Notes")
      )[0]
    );
    await userEvent.type(
      await findNewNodeEditor(),
      "Holiday Destinations{Enter}"
    );
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand and add Barcelona
    await userEvent.click(
      await screen.findByLabelText("expand Holiday Destinations")
    );
    await userEvent.click(
      await screen.findByLabelText("add to Holiday Destinations")
    );
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

  test("Editing a version inside ~Versions inserts new version at same position", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Holiday Destinations
    await userEvent.click(
      (
        await screen.findAllByLabelText("add to My Notes")
      )[0]
    );
    await userEvent.type(
      await findNewNodeEditor(),
      "Holiday Destinations{Enter}"
    );
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand and add Barcelona
    await userEvent.click(
      await screen.findByLabelText("expand Holiday Destinations")
    );
    await userEvent.click(
      await screen.findByLabelText("add to Holiday Destinations")
    );
    await userEvent.type(await findNewNodeEditor(), "Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Edit Barcelona to BCN (first edit)
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor);

    // Edit BCN to V3 (second edit)
    const bcnEditor = await screen.findByLabelText("edit BCN");
    await userEvent.click(bcnEditor);
    await userEvent.clear(bcnEditor);
    await userEvent.type(bcnEditor, "V3");
    fireEvent.blur(bcnEditor);

    // Now we have ~Versions: [V3, BCN, Barcelona]
    // Expand V3 and add ~Versions as a child to see them
    await userEvent.click(await screen.findByLabelText("expand V3"));
    await userEvent.click(await screen.findByLabelText("add to V3"));
    await userEvent.type(await findNewNodeEditor(), "~Versions{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");
    await userEvent.click(await screen.findByLabelText("expand ~Versions"));

    await expectTree(`
My Notes
  Holiday Destinations
    V3
      ~Versions
        V3
        BCN
        Barcelona
    `);

    // Now edit BCN (at position 1 inside ~Versions) to "BCN-updated"
    // BCN only appears inside ~Versions (parent shows "V3")
    const bcnInsideVersions = await screen.findByLabelText("edit BCN");
    await userEvent.click(bcnInsideVersions);
    await userEvent.clear(bcnInsideVersions);
    await userEvent.type(bcnInsideVersions, "BCN-updated");
    fireEvent.blur(bcnInsideVersions);

    // The new version should be inserted at the same position (1),
    // and BCN should shift down to position 2
    // Result: [V3, BCN-updated, BCN, Barcelona]
    await expectTree(`
My Notes
  Holiday Destinations
    V3
      ~Versions
        V3
        BCN-updated
        BCN
        Barcelona
    `);
  });

  test("Pressing Enter while editing inside ~Versions opens editor at correct position", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Holiday Destinations
    await userEvent.click(
      (
        await screen.findAllByLabelText("add to My Notes")
      )[0]
    );
    await userEvent.type(
      await findNewNodeEditor(),
      "Holiday Destinations{Enter}"
    );
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand and add Barcelona
    await userEvent.click(
      await screen.findByLabelText("expand Holiday Destinations")
    );
    await userEvent.click(
      await screen.findByLabelText("add to Holiday Destinations")
    );
    await userEvent.type(await findNewNodeEditor(), "Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Edit Barcelona to BCN (first edit)
    const barcelonaEditor = await screen.findByLabelText("edit Barcelona");
    await userEvent.click(barcelonaEditor);
    await userEvent.clear(barcelonaEditor);
    await userEvent.type(barcelonaEditor, "BCN");
    fireEvent.blur(barcelonaEditor);

    // Edit BCN to V3 (second edit)
    const bcnEditor = await screen.findByLabelText("edit BCN");
    await userEvent.click(bcnEditor);
    await userEvent.clear(bcnEditor);
    await userEvent.type(bcnEditor, "V3");
    fireEvent.blur(bcnEditor);

    // Now we have ~Versions: [V3, BCN, Barcelona]
    // Expand V3 and add ~Versions as a child to see them
    await userEvent.click(await screen.findByLabelText("expand V3"));
    await userEvent.click(await screen.findByLabelText("add to V3"));
    await userEvent.type(await findNewNodeEditor(), "~Versions{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");
    await userEvent.click(await screen.findByLabelText("expand ~Versions"));

    await expectTree(`
My Notes
  Holiday Destinations
    V3
      ~Versions
        V3
        BCN
        Barcelona
    `);

    // Now edit BCN (at position 1 inside ~Versions) and press Enter
    // BCN only appears inside ~Versions (parent shows "V3")
    const bcnInsideVersions = await screen.findByLabelText("edit BCN");
    await userEvent.click(bcnInsideVersions);
    await userEvent.clear(bcnInsideVersions);
    await userEvent.type(bcnInsideVersions, "BCN-updated{Enter}");

    // BUG: Editor appears after BCN instead of after BCN-updated.
    // When pressing Enter after editing inside ~Versions, the editor opens relative to the
    // edited node (which shifted down) rather than relative to the newly inserted version.
    // Ideal: [V3, BCN-updated, [NEW NODE], BCN, Barcelona]
    // Actual: [V3, BCN-updated, BCN, [NEW NODE], Barcelona]
    await expectTree(`
My Notes
  Holiday Destinations
    V3
      ~Versions
        V3
        BCN-updated
        BCN
        [NEW NODE]
        Barcelona
    `);

    // Close the editor
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Holiday Destinations
    V3
      ~Versions
        V3
        BCN-updated
        BCN
        Barcelona
    `);
  });

  test("Setting top version to not_relevant shows the previous version", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create Holiday Destinations
    await userEvent.click(
      (
        await screen.findAllByLabelText("add to My Notes")
      )[0]
    );
    await userEvent.type(
      await findNewNodeEditor(),
      "Holiday Destinations{Enter}"
    );
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Expand and add Barcelona
    await userEvent.click(
      await screen.findByLabelText("expand Holiday Destinations")
    );
    await userEvent.click(
      await screen.findByLabelText("add to Holiday Destinations")
    );
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
    const notRelevantButtons = await screen.findAllByLabelText(
      "mark BCN as not relevant"
    );
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

  test("Reference path filters out ~Versions and deduplicates", async () => {
    const [alice] = setup([ALICE]);
    renderTree(alice);

    // Create two parent nodes: Holiday Destinations and Cities in Spain
    await userEvent.click(
      (
        await screen.findAllByLabelText("add to My Notes")
      )[0]
    );
    await userEvent.type(
      await findNewNodeEditor(),
      "Holiday Destinations{Enter}"
    );
    await userEvent.type(await findNewNodeEditor(), "Cities in Spain{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Add Barcelona under Holiday Destinations
    await userEvent.click(
      await screen.findByLabelText("expand Holiday Destinations")
    );
    await userEvent.click(
      await screen.findByLabelText("add to Holiday Destinations")
    );
    await userEvent.type(await findNewNodeEditor(), "Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    // Add Barcelona under Cities in Spain using keyboard
    // Press Enter on Cities in Spain editor to create sibling, then Tab to indent
    const citiesEditor = await screen.findByLabelText("edit Cities in Spain");
    await userEvent.click(citiesEditor);
    await userEvent.type(citiesEditor, "{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Tab}Barcelona{Enter}");
    await userEvent.type(await findNewNodeEditor(), "{Escape}");

    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
  Cities in Spain
    Barcelona
    `);

    // Edit Barcelona under Cities in Spain to BCN
    // This creates ~Versions with [BCN, Barcelona] only for that context
    // Holiday Destinations → Barcelona is unaffected (different context)
    const barcelonaEditors = await screen.findAllByLabelText("edit Barcelona");
    // The second one is under Cities in Spain
    await userEvent.click(barcelonaEditors[1]);
    await userEvent.clear(barcelonaEditors[1]);
    await userEvent.type(barcelonaEditors[1], "BCN");
    fireEvent.blur(barcelonaEditors[1]);

    // Holiday Destinations still shows Barcelona, Cities in Spain shows BCN
    await expectTree(`
My Notes
  Holiday Destinations
    Barcelona
  Cities in Spain
    BCN
    `);

    // Show "Referenced By" for Barcelona (under Holiday Destinations)
    fireEvent.click(
      await screen.findByLabelText("show references to Barcelona")
    );
    await screen.findByLabelText("hide references to Barcelona");

    // Should show two references:
    // - "My Notes → Holiday Destinations → Barcelona" (direct)
    // - "My Notes → Cities in Spain → BCN" (filtered from "...BCN → ~Versions → Barcelona")
    await screen.findByText("My Notes → Holiday Destinations → Barcelona");
    await screen.findByText("My Notes → Cities in Spain → BCN");

    // Verify the unfiltered path is NOT shown
    expect(screen.queryByText(/Cities in Spain → BCN → ~Versions/)).toBeNull();
  });
});
