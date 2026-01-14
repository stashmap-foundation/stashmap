import React from "react";
import { List } from "immutable";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  ALICE,
  BOB,
  findNodeByText,
  follow,
  renderWithTestData,
  setup,
  setupTestDB,
} from "../utils.test";
import { newNode, addRelationToRelations } from "../connections";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { execute } from "../executor";
import Data from "../Data";
import { LoadNode } from "../dataQuery";
import {
  RootViewContextProvider,
  newRelations,
} from "../ViewContext";
import { TreeView } from "./TreeView";
import { DraggableNote } from "./Draggable";
import { TemporaryViewProvider } from "./TemporaryViewContext";
import { DND } from "../dnd";
import { DEFAULT_TYPE_FILTERS, TYPE_COLORS } from "../constants";

describe("TYPE_COLORS", () => {
  test("has correct colors for relevance types", () => {
    expect(TYPE_COLORS.relevant).toBe("#0288d1");
    expect(TYPE_COLORS.maybe_relevant).toBe("#00acc1");
    expect(TYPE_COLORS.little_relevant).toBe("#26c6da");
    expect(TYPE_COLORS.not_relevant).toBe("#ff9800");
  });

  test("has correct colors for argument types", () => {
    expect(TYPE_COLORS.confirms).toBe("#2e7d32");
    expect(TYPE_COLORS.contra).toBe("#c62828");
  });

  test("has inactive color", () => {
    expect(TYPE_COLORS.inactive).toBe("#d0d0d0");
  });
});

describe("DEFAULT_TYPE_FILTERS", () => {
  test("includes relevant (empty string)", () => {
    expect(DEFAULT_TYPE_FILTERS).toContain("");
  });

  test("includes maybe_relevant", () => {
    expect(DEFAULT_TYPE_FILTERS).toContain("maybe_relevant");
  });

  test("includes confirms", () => {
    expect(DEFAULT_TYPE_FILTERS).toContain("confirms");
  });

  test("includes contra", () => {
    expect(DEFAULT_TYPE_FILTERS).toContain("contra");
  });

  test("excludes little_relevant by default", () => {
    expect(DEFAULT_TYPE_FILTERS).not.toContain("little_relevant");
  });

  test("excludes not_relevant by default", () => {
    expect(DEFAULT_TYPE_FILTERS).not.toContain("not_relevant");
  });
});

describe("TypeFilterButton", () => {
  test("shows filter button for nodes with children", async () => {
    const [alice] = setup([ALICE]);
    const db = await setupTestDB(alice(), [["Parent", ["Child"]]]);
    const parent = findNodeByText(db, "Parent") as KnowNode;

    renderWithTestData(
      <Data user={alice().user}>
        <RootViewContextProvider root={parent.id}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode>
                <>
                  <DraggableNote />
                  <TreeView />
                </>
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </RootViewContextProvider>
      </Data>,
      {
        ...alice(),
        initialRoute: `/d/${parent.id}`,
      }
    );

    await screen.findByText("Parent");

    // Filter button should exist - get first one (parent's)
    const filterButtons = screen.getAllByLabelText("filter suggestions");
    expect(filterButtons.length).toBeGreaterThanOrEqual(1);
  });

  test("opens filter popover on click", async () => {
    const [alice] = setup([ALICE]);
    const db = await setupTestDB(alice(), [["Parent", ["Child"]]]);
    const parent = findNodeByText(db, "Parent") as KnowNode;

    renderWithTestData(
      <Data user={alice().user}>
        <RootViewContextProvider root={parent.id}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode>
                <>
                  <DraggableNote />
                  <TreeView />
                </>
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </RootViewContextProvider>
      </Data>,
      {
        ...alice(),
        initialRoute: `/d/${parent.id}`,
      }
    );

    await screen.findByText("Parent");

    // Click filter button - get first one (parent's)
    const filterButtons = screen.getAllByLabelText("filter suggestions");
    fireEvent.click(filterButtons[0]);

    // Popover should show filter options
    await screen.findByText("Relevant");
    await screen.findByText("Maybe Relevant");
    await screen.findByText("Little Relevant");
    await screen.findByText("Not Relevant");
    await screen.findByText("Confirms");
    await screen.findByText("Contradicts");
  });

  test("toggling filter hides/shows items", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent", alicePK);
    const relevant = newNode("Relevant Item", alicePK);
    const maybeRelevant = newNode("Maybe Relevant Item", alicePK);

    // Create relations with different relevance levels
    let relations = newRelations(parent.id, List(), alicePK);
    relations = addRelationToRelations(relations, relevant.id, "");
    relations = addRelationToRelations(relations, maybeRelevant.id, "maybe_relevant");

    const plan = planUpsertRelations(
      planUpsertNode(
        planUpsertNode(
          planUpsertNode(createPlan(alice()), parent),
          relevant
        ),
        maybeRelevant
      ),
      relations
    );
    await execute({ ...alice(), plan });

    renderWithTestData(
      <Data user={alice().user}>
        <RootViewContextProvider root={parent.id}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode>
                <>
                  <DraggableNote />
                  <TreeView />
                </>
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </RootViewContextProvider>
      </Data>,
      {
        ...alice(),
        initialRoute: `/d/${parent.id}`,
      }
    );

    await screen.findByText("Parent");
    await screen.findByText("Relevant Item");
    await screen.findByText("Maybe Relevant Item");

    // Open filter popover - get first filter button (parent's)
    const filterButtons = screen.getAllByLabelText("filter suggestions");
    fireEvent.click(filterButtons[0]);
    await screen.findByText("Maybe Relevant");

    // Toggle off "Maybe Relevant" filter
    fireEvent.click(screen.getByText("Maybe Relevant"));

    // Maybe Relevant Item should be hidden
    await waitFor(() => {
      expect(screen.queryByText("Maybe Relevant Item")).toBeNull();
    });

    // Relevant Item should still be visible
    expect(screen.getByText("Relevant Item")).toBeDefined();
  });

  test("enabling not_relevant filter shows hidden items", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent", alicePK);
    const relevant = newNode("Relevant Item", alicePK);
    const notRelevant = newNode("Not Relevant Item", alicePK);

    // Create relations with different relevance levels
    let relations = newRelations(parent.id, List(), alicePK);
    relations = addRelationToRelations(relations, relevant.id, "");
    relations = addRelationToRelations(relations, notRelevant.id, "not_relevant");

    const plan = planUpsertRelations(
      planUpsertNode(
        planUpsertNode(
          planUpsertNode(createPlan(alice()), parent),
          relevant
        ),
        notRelevant
      ),
      relations
    );
    await execute({ ...alice(), plan });

    renderWithTestData(
      <Data user={alice().user}>
        <RootViewContextProvider root={parent.id}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode>
                <>
                  <DraggableNote />
                  <TreeView />
                </>
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </RootViewContextProvider>
      </Data>,
      {
        ...alice(),
        initialRoute: `/d/${parent.id}`,
      }
    );

    await screen.findByText("Parent");
    await screen.findByText("Relevant Item");

    // Not Relevant Item should be hidden by default
    expect(screen.queryByText("Not Relevant Item")).toBeNull();

    // Open filter popover - get first filter button (parent's)
    const filterButtons = screen.getAllByLabelText("filter suggestions");
    fireEvent.click(filterButtons[0]);
    await screen.findByText("Not Relevant");

    // Toggle on "Not Relevant" filter
    fireEvent.click(screen.getByText("Not Relevant"));

    // Not Relevant Item should now be visible
    await screen.findByText("Not Relevant Item");
  });

  test("does not show filter button in Referenced By mode", async () => {
    const [alice] = setup([ALICE]);
    const db = await setupTestDB(alice(), [["Money", ["Bitcoin"]]]);
    const bitcoin = findNodeByText(db, "Bitcoin") as KnowNode;

    renderWithTestData(
      <Data user={alice().user}>
        <RootViewContextProvider root={bitcoin.id}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode referencedBy>
                <>
                  <DraggableNote />
                  <TreeView />
                </>
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </RootViewContextProvider>
      </Data>,
      {
        ...alice(),
        initialRoute: `/d/${bitcoin.id}`,
      }
    );

    await screen.findByText("Bitcoin");

    // Switch to Referenced By view
    fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
    await screen.findByLabelText("hide references to Bitcoin");
    await screen.findByText(/Money/);

    // Filter button should NOT be visible in Referenced By mode
    // The root node's filter button should be hidden
    expect(screen.queryByLabelText("filter suggestions")).toBeNull();
  });

  test("filter state persists across interactions", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent", alicePK);
    const relevant = newNode("Relevant Item", alicePK);
    const maybeRelevant = newNode("Maybe Relevant Item", alicePK);

    let relations = newRelations(parent.id, List(), alicePK);
    relations = addRelationToRelations(relations, relevant.id, "");
    relations = addRelationToRelations(relations, maybeRelevant.id, "maybe_relevant");

    const plan = planUpsertRelations(
      planUpsertNode(
        planUpsertNode(
          planUpsertNode(createPlan(alice()), parent),
          relevant
        ),
        maybeRelevant
      ),
      relations
    );
    await execute({ ...alice(), plan });

    renderWithTestData(
      <Data user={alice().user}>
        <RootViewContextProvider root={parent.id}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode>
                <>
                  <DraggableNote />
                  <TreeView />
                </>
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </RootViewContextProvider>
      </Data>,
      {
        ...alice(),
        initialRoute: `/d/${parent.id}`,
      }
    );

    await screen.findByText("Parent");

    // Open filter popover and toggle off "Maybe Relevant"
    // Get first filter button (parent's)
    let filterButtons = screen.getAllByLabelText("filter suggestions");
    fireEvent.click(filterButtons[0]);
    await screen.findByText("Maybe Relevant");
    fireEvent.click(screen.getByText("Maybe Relevant"));

    // Close popover by clicking outside
    fireEvent.click(document.body);

    // Item should still be hidden
    await waitFor(() => {
      expect(screen.queryByText("Maybe Relevant Item")).toBeNull();
    });

    // Reopen filter popover
    filterButtons = screen.getAllByLabelText("filter suggestions");
    fireEvent.click(filterButtons[0]);

    // The "Maybe Relevant" filter should still be toggled off
    // (indicated by the item still being hidden after reopening)
    await waitFor(() => {
      expect(screen.queryByText("Maybe Relevant Item")).toBeNull();
    });
  });
});

describe("Suggestions filter", () => {
  test("DEFAULT_TYPE_FILTERS includes suggestions", () => {
    expect(DEFAULT_TYPE_FILTERS).toContain("suggestions");
  });

  test("TYPE_COLORS has suggestions color", () => {
    expect(TYPE_COLORS.suggestions).toBe("#7b1fa2");
  });

  test("filter popover shows Suggestions option", async () => {
    const [alice] = setup([ALICE]);
    const db = await setupTestDB(alice(), [["Parent", ["Child"]]]);
    const parent = findNodeByText(db, "Parent") as KnowNode;

    renderWithTestData(
      <Data user={alice().user}>
        <RootViewContextProvider root={parent.id}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode>
                <>
                  <DraggableNote />
                  <TreeView />
                </>
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </RootViewContextProvider>
      </Data>,
      {
        ...alice(),
        initialRoute: `/d/${parent.id}`,
      }
    );

    await screen.findByText("Parent");

    // Open filter popover
    const filterButtons = screen.getAllByLabelText("filter suggestions");
    fireEvent.click(filterButtons[0]);

    // Suggestions option should be visible
    await screen.findByText("Suggestions");
  });

  test("toggling off suggestions hides diff items from other users", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    const { publicKey: alicePK } = alice().user;
    const { publicKey: bobPK } = bob().user;

    // Alice creates Parent
    const parent = newNode("Parent", alicePK);
    const aliceRelations = newRelations(parent.id, List(), alicePK);

    const alicePlan = planUpsertRelations(
      planUpsertNode(createPlan(alice()), parent),
      aliceRelations
    );
    await execute({ ...alice(), plan: alicePlan });

    // Bob adds a child to the same parent
    const bobChild = newNode("Bob Suggestion", bobPK);
    const bobRelations = addRelationToRelations(
      newRelations(parent.id, List(), bobPK),
      bobChild.id
    );

    const bobPlan = planUpsertRelations(
      planUpsertNode(createPlan(bob()), bobChild),
      bobRelations
    );
    await execute({ ...bob(), plan: bobPlan });

    // Alice follows Bob
    await follow(alice, bobPK);

    renderWithTestData(
      <Data user={alice().user}>
        <RootViewContextProvider root={parent.id}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode>
                <>
                  <DraggableNote />
                  <TreeView />
                </>
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </RootViewContextProvider>
      </Data>,
      {
        ...alice(),
        initialRoute: `/d/${parent.id}`,
      }
    );

    await screen.findByText("Parent");

    // Bob's suggestion should be visible by default
    await screen.findByText("Bob Suggestion");

    // Open filter popover and toggle off Suggestions
    const filterButtons = screen.getAllByLabelText("filter suggestions");
    fireEvent.click(filterButtons[0]);
    fireEvent.click(await screen.findByText("Suggestions"));

    // Bob's suggestion should disappear
    await waitFor(() => {
      expect(screen.queryByText("Bob Suggestion")).toBeNull();
    });
  });

  test("suggestions filter state persists", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    const { publicKey: alicePK } = alice().user;
    const { publicKey: bobPK } = bob().user;

    // Alice creates Parent
    const parent = newNode("Parent", alicePK);
    const aliceRelations = newRelations(parent.id, List(), alicePK);

    const alicePlan = planUpsertRelations(
      planUpsertNode(createPlan(alice()), parent),
      aliceRelations
    );
    await execute({ ...alice(), plan: alicePlan });

    // Bob adds a child
    const bobChild = newNode("Bob Item", bobPK);
    const bobRelations = addRelationToRelations(
      newRelations(parent.id, List(), bobPK),
      bobChild.id
    );

    const bobPlan = planUpsertRelations(
      planUpsertNode(createPlan(bob()), bobChild),
      bobRelations
    );
    await execute({ ...bob(), plan: bobPlan });

    // Alice follows Bob
    await follow(alice, bobPK);

    renderWithTestData(
      <Data user={alice().user}>
        <RootViewContextProvider root={parent.id}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode>
                <>
                  <DraggableNote />
                  <TreeView />
                </>
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </RootViewContextProvider>
      </Data>,
      {
        ...alice(),
        initialRoute: `/d/${parent.id}`,
      }
    );

    await screen.findByText("Parent");
    await screen.findByText("Bob Item");

    // Toggle off Suggestions
    const filterButtons = screen.getAllByLabelText("filter suggestions");
    fireEvent.click(filterButtons[0]);
    fireEvent.click(await screen.findByText("Suggestions"));

    await waitFor(() => {
      expect(screen.queryByText("Bob Item")).toBeNull();
    });

    // Close popover by clicking outside
    fireEvent.click(document.body);

    // Bob's item should still be hidden (filter state persists)
    await waitFor(() => {
      expect(screen.queryByText("Bob Item")).toBeNull();
    });
  });
});

describe("Filter integration with RelevanceSelector", () => {
  test("marking item as not_relevant hides it when filter excludes not_relevant", async () => {
    const [alice] = setup([ALICE]);
    const db = await setupTestDB(alice(), [["Parent", ["Child1", "Child2"]]]);
    const parent = findNodeByText(db, "Parent") as KnowNode;

    renderWithTestData(
      <Data user={alice().user}>
        <RootViewContextProvider root={parent.id}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode>
                <>
                  <DraggableNote />
                  <TreeView />
                </>
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </RootViewContextProvider>
      </Data>,
      {
        ...alice(),
        initialRoute: `/d/${parent.id}`,
      }
    );

    await screen.findByText("Parent");
    await screen.findByText("Child1");
    await screen.findByText("Child2");

    // Mark Child1 as not relevant using RelevanceSelector
    fireEvent.click(screen.getByLabelText("mark Child1 as not relevant"));

    // Child1 should disappear (default filters exclude not_relevant)
    await waitFor(() => {
      expect(screen.queryByText("Child1")).toBeNull();
    });

    // Enable not_relevant filter - get the first filter button (parent's)
    const filterButtons = screen.getAllByLabelText("filter suggestions");
    fireEvent.click(filterButtons[0]);
    await screen.findByText("Not Relevant");
    fireEvent.click(screen.getByText("Not Relevant"));

    // Child1 should reappear
    await screen.findByText("Child1");
  });

  test("relevance change reflects in filter button appearance", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent", alicePK);
    const child = newNode("Child", alicePK);

    const relations = addRelationToRelations(
      newRelations(parent.id, List(), alicePK),
      child.id,
      ""
    );

    const plan = planUpsertRelations(
      planUpsertNode(planUpsertNode(createPlan(alice()), parent), child),
      relations
    );
    await execute({ ...alice(), plan });

    renderWithTestData(
      <Data user={alice().user}>
        <RootViewContextProvider root={parent.id}>
          <TemporaryViewProvider>
            <DND>
              <LoadNode>
                <>
                  <DraggableNote />
                  <TreeView />
                </>
              </LoadNode>
            </DND>
          </TemporaryViewProvider>
        </RootViewContextProvider>
      </Data>,
      {
        ...alice(),
        initialRoute: `/d/${parent.id}`,
      }
    );

    await screen.findByText("Parent");
    await screen.findByText("Child");

    // Child should have Relevant title initially
    expect(screen.getByTitle("Relevant")).toBeDefined();

    // Mark as not relevant
    fireEvent.click(screen.getByLabelText("mark Child as not relevant"));

    // Child disappears
    await waitFor(() => {
      expect(screen.queryByText("Child")).toBeNull();
    });

    // Enable not_relevant filter to see the child again
    // Get the first filter button (parent's)
    const filterButtons = screen.getAllByLabelText("filter suggestions");
    fireEvent.click(filterButtons[0]);
    fireEvent.click(await screen.findByText("Not Relevant"));

    // Child should reappear with Not Relevant title
    await screen.findByText("Child");
    expect(screen.getByTitle("Not Relevant")).toBeDefined();
  });
});
