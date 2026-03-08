import { Map, List } from "immutable";
import {
  bulkAddRelations,
  newNode,
  shortID,
  findRefsToNode,
  addRelationToRelations,
} from "./connections";
import { ALICE } from "./utils.test";
import { newRelations } from "./ViewContext";
import { newDB } from "./knowledge";

describe("findRefsToNode", () => {
  test("HEAD ref: node is head of a relation with children", () => {
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const child1 = newNode("Child 1");

    const stuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        ALICE.publicKey
      ),
      [child1.id]
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({ [shortID(stuffRelations.id)]: stuffRelations }),
      },
    }) as KnowledgeDBs;

    const refs = findRefsToNode(dbs, stuff.id);
    expect(refs.size).toBe(1);
    expect(refs.first()!.targetNode).toBeUndefined();
    expect(refs.first()!.relationID).toBe(stuffRelations.id);
  });

  test("IN ref: node is in items of a relation", () => {
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");

    const myNotesRelations = addRelationToRelations(
      newRelations(myNotes.id, List(), ALICE.publicKey),
      stuff.id
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({ [shortID(myNotesRelations.id)]: myNotesRelations }),
      },
    }) as KnowledgeDBs;

    const refs = findRefsToNode(dbs, stuff.id);
    expect(refs.size).toBe(1);
    expect(refs.first()!.targetNode).toBe(stuff.id);
    expect(refs.first()!.relationID).toBe(myNotesRelations.id);
  });

  test("both HEAD and IN refs returned for same context", () => {
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const child1 = newNode("Child 1");

    const myNotesRelations = addRelationToRelations(
      newRelations(myNotes.id, List(), ALICE.publicKey),
      stuff.id
    );
    const stuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        ALICE.publicKey
      ),
      [child1.id]
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(myNotesRelations.id)]: myNotesRelations,
          [shortID(stuffRelations.id)]: stuffRelations,
        }),
      },
    }) as KnowledgeDBs;

    const refs = findRefsToNode(dbs, stuff.id);
    expect(refs.size).toBe(2);
    const headRef = refs.find((r) => !r.targetNode);
    const inRef = refs.find((r) => !!r.targetNode);
    expect(headRef!.relationID).toBe(stuffRelations.id);
    expect(inRef!.relationID).toBe(myNotesRelations.id);
  });

  test("multiple refs from different contexts", () => {
    const myNotes = newNode("My Notes");
    const work = newNode("Work");
    const stuff = newNode("Stuff");

    const myNotesRelations = addRelationToRelations(
      newRelations(myNotes.id, List(), ALICE.publicKey),
      stuff.id
    );
    const workRelations = addRelationToRelations(
      newRelations(work.id, List(), ALICE.publicKey),
      stuff.id
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(myNotesRelations.id)]: myNotesRelations,
          [shortID(workRelations.id)]: workRelations,
        }),
      },
    }) as KnowledgeDBs;

    const refs = findRefsToNode(dbs, stuff.id);
    expect(refs.size).toBe(2);
    expect(refs.every((r) => r.targetNode === stuff.id)).toBe(true);
  });

});
