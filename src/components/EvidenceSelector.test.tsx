import React from "react";
import { List } from "immutable";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  ALICE,
  findNodeByText,
  renderWithTestData,
  setup,
  setupTestDB,
} from "../utils.test";
import { newNode, addRelationToRelations, updateItemArgument } from "../connections";
import { createPlan, planUpsertNode, planUpsertRelations } from "../planner";
import { execute } from "../executor";
import Data from "../Data";
import { LoadNode } from "../dataQuery";
import { RootViewContextProvider, newRelations } from "../ViewContext";
import { TreeView } from "./TreeView";
import { DraggableNote } from "./Draggable";
import { TemporaryViewProvider } from "./TemporaryViewContext";
import { DND } from "../dnd";

// Integration tests for EvidenceSelector component
describe("EvidenceSelector", () => {
  test("shows evidence selector for child items", async () => {
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

    // Both children should have evidence selectors
    const evidenceButtons = screen.getAllByLabelText(/Evidence:/);
    expect(evidenceButtons.length).toBe(2);
  });

  test("clicking cycles through undefined -> confirms -> contra -> undefined", async () => {
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

    // Initial state: no evidence type
    let evidenceBtn = screen.getByLabelText(/Evidence: No evidence type/);
    expect(evidenceBtn).toBeDefined();

    // Click 1: undefined -> confirms
    fireEvent.click(evidenceBtn);
    await waitFor(() => {
      expect(screen.getByLabelText(/Evidence: Confirms/)).toBeDefined();
    });

    // Click 2: confirms -> contra
    evidenceBtn = screen.getByLabelText(/Evidence: Confirms/);
    fireEvent.click(evidenceBtn);
    await waitFor(() => {
      expect(screen.getByLabelText(/Evidence: Contradicts/)).toBeDefined();
    });

    // Click 3: contra -> undefined
    evidenceBtn = screen.getByLabelText(/Evidence: Contradicts/);
    fireEvent.click(evidenceBtn);
    await waitFor(() => {
      expect(screen.getByLabelText(/Evidence: No evidence type/)).toBeDefined();
    });
  });

  test("item with confirms argument shows green dot", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent", alicePK);
    const child = newNode("Child", alicePK);

    // Create relation with confirms argument
    const relations = addRelationToRelations(
      newRelations(parent.id, List(), alicePK),
      child.id,
      "", // relevance
      "confirms" // argument
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

    await screen.findByText("Child");

    // Evidence selector should show "Confirms"
    const evidenceBtn = screen.getByLabelText(/Evidence: Confirms/);
    expect(evidenceBtn).toBeDefined();
  });

  test("item with contra argument shows red dot", async () => {
    const [alice] = setup([ALICE]);
    const { publicKey: alicePK } = alice().user;

    const parent = newNode("Parent", alicePK);
    const child = newNode("Child", alicePK);

    // Create relation with contra argument
    const relations = addRelationToRelations(
      newRelations(parent.id, List(), alicePK),
      child.id,
      "", // relevance
      "contra" // argument
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

    await screen.findByText("Child");

    // Evidence selector should show "Contradicts"
    const evidenceBtn = screen.getByLabelText(/Evidence: Contradicts/);
    expect(evidenceBtn).toBeDefined();
  });

  test("does not show evidence selector for Referenced By items", async () => {
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

    // Referenced By items should NOT have evidence selectors
    const evidenceButtons = screen.queryAllByLabelText(/Evidence:/);
    expect(evidenceButtons.length).toBe(0);
  });

  test("evidence selector persists after setting", async () => {
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

    await screen.findByText("Child1");
    await screen.findByText("Child2");

    // Set Child1 to confirms
    const evidenceButtons = screen.getAllByLabelText(/Evidence: No evidence type/);
    fireEvent.click(evidenceButtons[0]);

    await waitFor(() => {
      expect(screen.getByLabelText(/Evidence: Confirms/)).toBeDefined();
    });

    // Child1 should show Confirms, Child2 should still show No evidence type
    expect(screen.getByLabelText(/Evidence: Confirms/)).toBeDefined();
    expect(screen.getByLabelText(/Evidence: No evidence type/)).toBeDefined();
  });
});

// Tests for updateItemArgument function
describe("updateItemArgument", () => {
  test("updates argument on existing item", () => {
    const relations: Relations = {
      items: List([
        { nodeID: "node1" as ID, relevance: "" as Relevance },
        { nodeID: "node2" as ID, relevance: "" as Relevance },
      ]),
      head: "head" as ID,
      context: List(),
      id: "rel1" as LongID,
      updated: Date.now(),
      author: "author" as PublicKey,
    };

    const updated = updateItemArgument(relations, 0, "confirms");
    expect(updated.items.get(0)?.argument).toBe("confirms");
    expect(updated.items.get(1)?.argument).toBeUndefined();
  });

  test("can set argument to undefined", () => {
    const relations: Relations = {
      items: List([
        { nodeID: "node1" as ID, relevance: "" as Relevance, argument: "confirms" as Argument },
      ]),
      head: "head" as ID,
      context: List(),
      id: "rel1" as LongID,
      updated: Date.now(),
      author: "author" as PublicKey,
    };

    const updated = updateItemArgument(relations, 0, undefined);
    expect(updated.items.get(0)?.argument).toBeUndefined();
  });

  test("returns unchanged relations for invalid index", () => {
    const relations: Relations = {
      items: List([
        { nodeID: "node1" as ID, relevance: "" as Relevance },
      ]),
      head: "head" as ID,
      context: List(),
      id: "rel1" as LongID,
      updated: Date.now(),
      author: "author" as PublicKey,
    };

    const updated = updateItemArgument(relations, 5, "confirms");
    expect(updated).toBe(relations);
  });
});
