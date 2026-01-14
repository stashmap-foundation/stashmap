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
import { newNode, addRelationToRelations, itemMatchesType } from "../connections";
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
import {
  relevanceToLevel,
  levelToRelevance,
  RELEVANCE_LABELS,
} from "./useUpdateRelevance";

// Unit tests for helper functions
describe("relevanceToLevel", () => {
  test("maps empty string (relevant) to level 3", () => {
    expect(relevanceToLevel("")).toBe(3);
  });

  test("maps maybe_relevant to level 2", () => {
    expect(relevanceToLevel("maybe_relevant")).toBe(2);
  });

  test("maps little_relevant to level 1", () => {
    expect(relevanceToLevel("little_relevant")).toBe(1);
  });

  test("maps not_relevant to level 0", () => {
    expect(relevanceToLevel("not_relevant")).toBe(0);
  });

  test("defaults to level 3 for unknown values", () => {
    expect(relevanceToLevel("unknown" as Relevance)).toBe(3);
  });
});

describe("levelToRelevance", () => {
  test("maps level 3 to empty string (relevant)", () => {
    expect(levelToRelevance(3)).toBe("");
  });

  test("maps level 2 to maybe_relevant", () => {
    expect(levelToRelevance(2)).toBe("maybe_relevant");
  });

  test("maps level 1 to little_relevant", () => {
    expect(levelToRelevance(1)).toBe("little_relevant");
  });

  test("maps level 0 to not_relevant", () => {
    expect(levelToRelevance(0)).toBe("not_relevant");
  });

  test("defaults to empty string for unknown levels", () => {
    expect(levelToRelevance(5)).toBe("");
    expect(levelToRelevance(-1)).toBe("");
  });
});

describe("RELEVANCE_LABELS", () => {
  test("has correct labels for all levels", () => {
    expect(RELEVANCE_LABELS[0]).toBe("Not Relevant");
    expect(RELEVANCE_LABELS[1]).toBe("Little Relevant");
    expect(RELEVANCE_LABELS[2]).toBe("Maybe Relevant");
    expect(RELEVANCE_LABELS[3]).toBe("Relevant");
  });
});

describe("itemMatchesType", () => {
  test("matches relevant items with empty string filter", () => {
    const item: RelationItem = { nodeID: "test" as ID, relevance: "" };
    expect(itemMatchesType(item, "")).toBe(true);
    expect(itemMatchesType(item, "maybe_relevant")).toBe(false);
  });

  test("matches maybe_relevant items", () => {
    const item: RelationItem = { nodeID: "test" as ID, relevance: "maybe_relevant" };
    expect(itemMatchesType(item, "maybe_relevant")).toBe(true);
    expect(itemMatchesType(item, "")).toBe(false);
  });

  test("matches little_relevant items", () => {
    const item: RelationItem = { nodeID: "test" as ID, relevance: "little_relevant" };
    expect(itemMatchesType(item, "little_relevant")).toBe(true);
    expect(itemMatchesType(item, "")).toBe(false);
  });

  test("matches not_relevant items", () => {
    const item: RelationItem = { nodeID: "test" as ID, relevance: "not_relevant" };
    expect(itemMatchesType(item, "not_relevant")).toBe(true);
    expect(itemMatchesType(item, "")).toBe(false);
  });

  test("defaults undefined relevance to empty string (relevant)", () => {
    // Using 'as' to simulate legacy items without relevance set
    const item = { nodeID: "test" as ID } as RelationItem;
    expect(itemMatchesType(item, "")).toBe(true);
    expect(itemMatchesType(item, "not_relevant")).toBe(false);
  });

  test("matches argument types correctly", () => {
    const confirmItem: RelationItem = { nodeID: "test" as ID, relevance: "", argument: "confirms" };
    const contraItem: RelationItem = { nodeID: "test" as ID, relevance: "", argument: "contra" };

    expect(itemMatchesType(confirmItem, "confirms")).toBe(true);
    expect(itemMatchesType(confirmItem, "contra")).toBe(false);
    expect(itemMatchesType(contraItem, "contra")).toBe(true);
    expect(itemMatchesType(contraItem, "confirms")).toBe(false);
  });
});

// Integration tests for RelevanceSelector component
describe("RelevanceSelector", () => {
  test("shows relevance selector for child items", async () => {
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

    // Both children should have relevance selectors
    const relevanceButtons = screen.getAllByLabelText(/mark .* as not relevant/);
    expect(relevanceButtons.length).toBe(2);
  });

  test("does not show relevance selector for Referenced By items", async () => {
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
    fireEvent.click(screen.getByLabelText("show references to Bitcoin"));
    await screen.findByText(/Money/);

    // Referenced By items should NOT have relevance selectors
    const relevanceButtons = screen.queryAllByLabelText(/mark .* as not relevant/);
    expect(relevanceButtons.length).toBe(0);
  });

  test("clicking X marks item as not relevant and hides it", async () => {
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

    // Click the X button to mark Child1 as not relevant
    const markNotRelevantBtn = screen.getByLabelText("mark Child1 as not relevant");
    fireEvent.click(markNotRelevantBtn);

    // Child1 should be hidden (default filters exclude not_relevant)
    await waitFor(() => {
      expect(screen.queryByText("Child1")).toBeNull();
    });

    // Child2 should still be visible
    expect(screen.getByText("Child2")).toBeDefined();
  });

  test("item with default relevance shows all blue dots", async () => {
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

    await screen.findByText("Child");

    // The relevance selector should exist and show "Relevant" title (all dots filled)
    const selector = screen.getByTitle("Relevant");
    expect(selector).toBeDefined();
  });
});

// Tests for relevance filtering
describe("Relevance filtering", () => {
  test("default filters show relevant and maybe_relevant items", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent", alicePK);
    const relevant = newNode("Relevant Item", alicePK);
    const maybeRelevant = newNode("Maybe Relevant Item", alicePK);
    const littleRelevant = newNode("Little Relevant Item", alicePK);
    const notRelevant = newNode("Not Relevant Item", alicePK);

    // Create relations with different relevance levels
    let relations = newRelations(parent.id, List(), alicePK);
    relations = addRelationToRelations(relations, relevant.id, "");
    relations = addRelationToRelations(relations, maybeRelevant.id, "maybe_relevant");
    relations = addRelationToRelations(relations, littleRelevant.id, "little_relevant");
    relations = addRelationToRelations(relations, notRelevant.id, "not_relevant");

    const plan = planUpsertRelations(
      planUpsertNode(
        planUpsertNode(
          planUpsertNode(
            planUpsertNode(
              planUpsertNode(createPlan(alice()), parent),
              relevant
            ),
            maybeRelevant
          ),
          littleRelevant
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

    // Default filters include "" (relevant) and "maybe_relevant"
    // but exclude "little_relevant" and "not_relevant"
    expect(screen.getByText("Relevant Item")).toBeDefined();
    expect(screen.getByText("Maybe Relevant Item")).toBeDefined();
    expect(screen.queryByText("Little Relevant Item")).toBeNull();
    expect(screen.queryByText("Not Relevant Item")).toBeNull();
  });

  test("changing relevance updates item visibility", async () => {
    const [alice] = setup([ALICE]);
    const db = await setupTestDB(alice(), [["Parent", ["Child1", "Child2", "Child3"]]]);
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
    await screen.findByText("Child3");

    // Mark Child1 as not relevant
    fireEvent.click(screen.getByLabelText("mark Child1 as not relevant"));
    await waitFor(() => {
      expect(screen.queryByText("Child1")).toBeNull();
    });

    // Mark Child2 as not relevant
    fireEvent.click(screen.getByLabelText("mark Child2 as not relevant"));
    await waitFor(() => {
      expect(screen.queryByText("Child2")).toBeNull();
    });

    // Child3 should still be visible
    expect(screen.getByText("Child3")).toBeDefined();
  });

  test("items without explicit relevance default to relevant", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent", alicePK);
    const child = newNode("Child", alicePK);

    // Create relation WITHOUT setting relevance (should default to relevant)
    const relations = addRelationToRelations(
      newRelations(parent.id, List(), alicePK),
      child.id
      // Note: not passing relevance parameter
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

    // Child should be visible (default relevance is "" which is included in default filters)
    expect(screen.getByText("Child")).toBeDefined();

    // Relevance selector should show "Relevant" title
    const selector = screen.getByTitle("Relevant");
    expect(selector).toBeDefined();
  });
});

// Tests for diff item relevance selection
describe("Diff item relevance selection", () => {
  test("diff item shows RelevanceSelector with no dots selected", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    const { publicKey: alicePK } = alice().user;
    const { publicKey: bobPK } = bob().user;

    // Alice creates Parent
    const parent = newNode("Parent", alicePK);
    const aliceChild = newNode("Alice Child", alicePK);

    const aliceRelations = addRelationToRelations(
      newRelations(parent.id, List(), alicePK),
      aliceChild.id
    );

    const alicePlan = planUpsertRelations(
      planUpsertNode(planUpsertNode(createPlan(alice()), parent), aliceChild),
      aliceRelations
    );
    await execute({ ...alice(), plan: alicePlan });

    // Bob adds a different child to the same parent
    const bobChild = newNode("Bob Child", bobPK);
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
    await screen.findByText("Alice Child");

    // Bob's child should appear as a diff item
    await screen.findByText("Bob Child");

    // Diff item should have a relevance selector with "Set relevance" title
    // (indicating no dots selected)
    const diffSelector = screen.getByTitle("Set relevance");
    expect(diffSelector).toBeDefined();
  });

  test("clicking dot on diff item accepts it with that relevance", async () => {
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
    const bobChild = newNode("Bob Child", bobPK);
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
    await screen.findByText("Bob Child");

    // Accept the diff item as "relevant" by clicking the third dot
    const acceptButton = screen.getByLabelText("accept Bob Child as relevant");
    fireEvent.click(acceptButton);

    // After accepting, it should no longer be a diff item
    // It should now show "Relevant" title (indicating it's now in Alice's list)
    await waitFor(() => {
      expect(screen.getByTitle("Relevant")).toBeDefined();
    });
  });

  test("clicking X on diff item declines it as not relevant", async () => {
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
    const bobChild = newNode("Bob Child", bobPK);
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
    await screen.findByText("Bob Child");

    // Decline the diff item by clicking X
    const declineButton = screen.getByLabelText("decline Bob Child");
    fireEvent.click(declineButton);

    // After declining, it should disappear (default filters exclude not_relevant)
    await waitFor(() => {
      expect(screen.queryByText("Bob Child")).toBeNull();
    });
  });
});

// Tests for removing items from list
describe("Remove from list", () => {
  test("not relevant item shows 'remove from list' aria-label", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent", alicePK);
    const child = newNode("Child", alicePK);

    // Create relation with not_relevant status
    const relations = addRelationToRelations(
      newRelations(parent.id, List(), alicePK),
      child.id,
      "not_relevant"
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

    // Enable not_relevant filter to see the child
    fireEvent.click(screen.getByLabelText("filter Parent"));
    fireEvent.click(await screen.findByText("Not Relevant"));

    // Child should now be visible
    await screen.findByText("Child");

    // The X button should now say "remove from list" instead of "mark as not relevant"
    const removeBtn = screen.getByLabelText("remove Child from list");
    expect(removeBtn).toBeDefined();
  });

  test("clicking X on not relevant item removes it completely from list", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent", alicePK);
    const child1 = newNode("Child1", alicePK);
    const child2 = newNode("Child2", alicePK);

    // Create relations - Child1 is not_relevant, Child2 is relevant
    let relations = newRelations(parent.id, List(), alicePK);
    relations = addRelationToRelations(relations, child1.id, "not_relevant");
    relations = addRelationToRelations(relations, child2.id, "");

    const plan = planUpsertRelations(
      planUpsertNode(
        planUpsertNode(planUpsertNode(createPlan(alice()), parent), child1),
        child2
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
    await screen.findByText("Child2");

    // Enable not_relevant filter to see Child1
    fireEvent.click(screen.getByLabelText("filter Parent"));
    fireEvent.click(await screen.findByText("Not Relevant"));

    // Child1 should now be visible
    await screen.findByText("Child1");

    // Click the remove button to completely remove Child1
    fireEvent.click(screen.getByLabelText("remove Child1 from list"));

    // Child1 should disappear completely
    await waitFor(() => {
      expect(screen.queryByText("Child1")).toBeNull();
    });

    // Child2 should still be visible
    expect(screen.getByText("Child2")).toBeDefined();

    // Even with not_relevant filter enabled, Child1 should not reappear
    // (because it was removed from the list, not just hidden)
    expect(screen.queryByText("Child1")).toBeNull();
  });

  test("two-step deletion: first mark as not relevant, then remove", async () => {
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
    await screen.findByText("Child");

    // Step 1: Mark as not relevant
    fireEvent.click(screen.getByLabelText("mark Child as not relevant"));

    // Child should be hidden
    await waitFor(() => {
      expect(screen.queryByText("Child")).toBeNull();
    });

    // Enable not_relevant filter to see the child again
    fireEvent.click(screen.getByLabelText("filter Parent"));
    fireEvent.click(await screen.findByText("Not Relevant"));

    // Child should reappear
    await screen.findByText("Child");

    // Now the X button should say "remove from list"
    const removeBtn = screen.getByLabelText("remove Child from list");
    expect(removeBtn).toBeDefined();

    // Step 2: Remove from list completely
    fireEvent.click(removeBtn);

    // Child should be completely gone
    await waitFor(() => {
      expect(screen.queryByText("Child")).toBeNull();
    });

    // Even with not_relevant filter still enabled, Child should not reappear
    expect(screen.queryByText("Child")).toBeNull();
  });
});

describe("Relation lookup consistency (regression)", () => {
  test("setting relevance to little_relevant hides item from default filter", async () => {
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
    await screen.findByText("Child");

    // Click the first dot to set relevance to "little_relevant"
    // This should hide the item since default filters exclude little_relevant
    const firstDot = screen.getByLabelText("set Child to little relevant");
    fireEvent.click(firstDot);

    // The item should disappear because:
    // 1. The relevance was actually written (not silently ignored)
    // 2. Default filters exclude "little_relevant"
    await waitFor(() => {
      expect(screen.queryByText("Child")).toBeNull();
    });

    // Now enable little_relevant filter to verify the item still exists
    fireEvent.click(screen.getByLabelText("filter Parent"));
    fireEvent.click(await screen.findByText("Little Relevant"));

    // Child should reappear, confirming the relevance was properly saved
    await screen.findByText("Child");

    // And it should show the correct relevance (1 dot = little relevant)
    const selector = screen.getByTitle("Little Relevant");
    expect(selector).toBeDefined();
  });

  test("setting relevance persists correctly on item accessed via nodeIndex", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent", alicePK);
    const child = newNode("Child", alicePK);

    // Add the same child twice to create duplicate nodeIDs with different indices
    let relations = newRelations(parent.id, List(), alicePK);
    relations = addRelationToRelations(relations, child.id, "");
    relations = addRelationToRelations(relations, child.id, "");

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

    // Both instances of Child should be visible
    const childElements = screen.getAllByText("Child");
    expect(childElements.length).toBe(2);

    // Mark the first Child as not relevant
    const markNotRelevantBtns = screen.getAllByLabelText(/mark Child as not relevant/);
    fireEvent.click(markNotRelevantBtns[0]);

    // Only ONE Child should disappear (the one we clicked), not both
    await waitFor(() => {
      const remaining = screen.getAllByText("Child");
      expect(remaining.length).toBe(1);
    });
  });
});

// Tests for multi-user relevance scenarios
describe("Multi-user relevance", () => {
  test("each user can set different relevance for same item", async () => {
    const [alice, bob] = setup([ALICE, BOB]);
    const { publicKey: alicePK } = alice().user;
    const { publicKey: bobPK } = bob().user;

    // Alice creates Parent -> Child
    const parent = newNode("Parent", alicePK);
    const child = newNode("Child", alicePK);

    // Alice marks Child as relevant (default)
    const aliceRelations = addRelationToRelations(
      newRelations(parent.id, List(), alicePK),
      child.id,
      "" // relevant
    );

    const alicePlan = planUpsertRelations(
      planUpsertNode(planUpsertNode(createPlan(alice()), parent), child),
      aliceRelations
    );
    await execute({ ...alice(), plan: alicePlan });

    // Bob marks the same Child as not_relevant in his version
    const bobRelations = addRelationToRelations(
      newRelations(parent.id, List(), bobPK),
      child.id,
      "not_relevant"
    );

    const bobPlan = planUpsertRelations(createPlan(bob()), bobRelations);
    await execute({ ...bob(), plan: bobPlan });

    // Alice follows Bob
    await follow(alice, bobPK);

    // When Alice views, she should see her own relevance setting (relevant)
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

    // Child should be visible because Alice's relevance is "" (relevant)
    expect(screen.getByText("Child")).toBeDefined();
  });
});
