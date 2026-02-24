import { Map, List } from "immutable";
import {
  bulkAddRelations,
  newNode,
  shortID,
  findRefsToNode,
  VERSIONS_NODE_ID,
  addRelationToRelations,
} from "./connections";
import { ALICE, BOB } from "./utils.test";
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
        nodes: Map({
          [myNotes.id]: myNotes,
          [stuff.id]: stuff,
          [child1.id]: child1,
        }),
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
        nodes: Map({ [myNotes.id]: myNotes, [stuff.id]: stuff }),
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
        nodes: Map({
          [myNotes.id]: myNotes,
          [stuff.id]: stuff,
          [child1.id]: child1,
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

  test("~Versions HEAD case: version resolves to grandparent with targetNode", () => {
    // My Notes → Stuff → ~Versions → [Stuff v2]
    // StuffV2 is a version of Stuff → resolves to cref:myNotesRel:Stuff
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const stuffV2 = newNode("Stuff v2");

    const myNotesRelation = addRelationToRelations(
      newRelations(myNotes.id, List(), ALICE.publicKey),
      stuff.id
    );
    const stuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        ALICE.publicKey
      ),
      [newNode("child").id]
    );
    const versionsRelations = addRelationToRelations(
      newRelations(
        VERSIONS_NODE_ID,
        List([shortID(myNotes.id), shortID(stuff.id)] as ID[]),
        ALICE.publicKey
      ),
      stuffV2.id
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(myNotesRelation.id)]: myNotesRelation,
          [shortID(stuffRelations.id)]: stuffRelations,
          [shortID(versionsRelations.id)]: versionsRelations,
        }),
        nodes: Map({
          [myNotes.id]: myNotes,
          [stuff.id]: stuff,
          [stuffV2.id]: stuffV2,
        }),
      },
    }) as KnowledgeDBs;

    const refs = findRefsToNode(dbs, stuffV2.id);
    expect(refs.size).toBe(1);
    expect(refs.first()!.relationID).toBe(myNotesRelation.id);
    expect(refs.first()!.targetNode).toBe(shortID(stuff.id));
    expect(refs.first()!.context.toArray()).toEqual([shortID(myNotes.id)]);
  });

  test("~Versions IN case: child of version resolves to grandparent with targetNode", () => {
    // My Notes → Stuff → ~Versions → SomeVersion → [SomeChild]
    // SomeChild is in a version relation → resolves to cref:myNotesRel:Stuff
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const someVersion = newNode("Some Version");
    const someChild = newNode("Some Child");

    const myNotesRelation = addRelationToRelations(
      newRelations(myNotes.id, List(), ALICE.publicKey),
      stuff.id
    );
    const stuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        ALICE.publicKey
      ),
      [newNode("other").id]
    );
    const versionRelation = addRelationToRelations(
      newRelations(
        someVersion.id,
        List([
          shortID(myNotes.id),
          shortID(stuff.id),
          VERSIONS_NODE_ID,
        ] as ID[]),
        ALICE.publicKey
      ),
      someChild.id
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(myNotesRelation.id)]: myNotesRelation,
          [shortID(stuffRelations.id)]: stuffRelations,
          [shortID(versionRelation.id)]: versionRelation,
        }),
        nodes: Map({
          [myNotes.id]: myNotes,
          [stuff.id]: stuff,
          [someVersion.id]: someVersion,
          [someChild.id]: someChild,
        }),
      },
    }) as KnowledgeDBs;

    const refs = findRefsToNode(dbs, someChild.id);
    expect(refs.size).toBe(1);
    expect(refs.first()!.relationID).toBe(myNotesRelation.id);
    expect(refs.first()!.targetNode).toBe(shortID(stuff.id));
    expect(refs.first()!.context.toArray()).toEqual([shortID(myNotes.id)]);
  });

  test("~Versions at root level: version resolves to HEAD ref (occurrence)", () => {
    // Stuff → ~Versions → [StuffV2]
    // Stuff is root-level, no grandparent → HEAD ref
    const stuff = newNode("Stuff");
    const stuffV2 = newNode("Stuff v2");

    const stuffRelation = bulkAddRelations(
      newRelations(stuff.id, List(), ALICE.publicKey),
      [newNode("child").id]
    );
    const versionsRelations = addRelationToRelations(
      newRelations(
        VERSIONS_NODE_ID,
        List([shortID(stuff.id)] as ID[]),
        ALICE.publicKey
      ),
      stuffV2.id
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(stuffRelation.id)]: stuffRelation,
          [shortID(versionsRelations.id)]: versionsRelations,
        }),
        nodes: Map({
          [stuff.id]: stuff,
          [stuffV2.id]: stuffV2,
        }),
      },
    }) as KnowledgeDBs;

    const refs = findRefsToNode(dbs, stuffV2.id);
    expect(refs.size).toBe(1);
    expect(refs.first()!.relationID).toBe(stuffRelation.id);
    expect(refs.first()!.targetNode).toBeUndefined();
    expect(refs.first()!.context.toArray()).toEqual([]);
  });

  test("dedup: same relation via direct and ~Versions path", () => {
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const stuffV2 = newNode("Stuff v2");
    const child = newNode("Child");

    const myNotesRelation = addRelationToRelations(
      newRelations(myNotes.id, List(), BOB.publicKey),
      stuff.id
    );
    const stuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        BOB.publicKey
      ),
      [child.id]
    );
    const versionsRelations = addRelationToRelations(
      newRelations(
        VERSIONS_NODE_ID,
        List([shortID(myNotes.id), shortID(stuff.id)] as ID[]),
        BOB.publicKey
      ),
      stuffV2.id
    );

    const dbs = Map({
      [BOB.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(myNotesRelation.id)]: myNotesRelation,
          [shortID(stuffRelations.id)]: stuffRelations,
          [shortID(versionsRelations.id)]: versionsRelations,
        }),
        nodes: Map({
          [myNotes.id]: myNotes,
          [stuff.id]: stuff,
          [stuffV2.id]: stuffV2,
        }),
      },
    }) as KnowledgeDBs;

    const refs = findRefsToNode(dbs, stuffV2.id);
    expect(refs.size).toBe(1);
    expect(refs.first()!.relationID).toBe(myNotesRelation.id);
    expect(refs.first()!.targetNode).toBe(shortID(stuff.id));
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
        nodes: Map({
          [myNotes.id]: myNotes,
          [work.id]: work,
          [stuff.id]: stuff,
        }),
      },
    }) as KnowledgeDBs;

    const refs = findRefsToNode(dbs, stuff.id);
    expect(refs.size).toBe(2);
    expect(refs.every((r) => r.targetNode === stuff.id)).toBe(true);
  });

  test("~Versions with multiple version nodes resolve to same grandparent", () => {
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const stuffV1 = newNode("Stuff version 1");
    const stuffV2 = newNode("Stuff version 2");
    const child = newNode("Child");

    const myNotesRelation = addRelationToRelations(
      newRelations(myNotes.id, List(), ALICE.publicKey),
      stuff.id
    );
    const stuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        ALICE.publicKey
      ),
      [child.id]
    );
    const versionsRelations = bulkAddRelations(
      newRelations(
        VERSIONS_NODE_ID,
        List([shortID(myNotes.id), shortID(stuff.id)] as ID[]),
        ALICE.publicKey
      ),
      [stuffV1.id, stuffV2.id]
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(myNotesRelation.id)]: myNotesRelation,
          [shortID(stuffRelations.id)]: stuffRelations,
          [shortID(versionsRelations.id)]: versionsRelations,
        }),
        nodes: Map({
          [myNotes.id]: myNotes,
          [stuff.id]: stuff,
          [stuffV1.id]: stuffV1,
          [stuffV2.id]: stuffV2,
        }),
      },
    }) as KnowledgeDBs;

    const refsV1 = findRefsToNode(dbs, stuffV1.id);
    expect(refsV1.size).toBe(1);
    expect(refsV1.first()!.relationID).toBe(myNotesRelation.id);
    expect(refsV1.first()!.targetNode).toBe(shortID(stuff.id));

    const refsV2 = findRefsToNode(dbs, stuffV2.id);
    expect(refsV2.size).toBe(1);
    expect(refsV2.first()!.relationID).toBe(myNotesRelation.id);
    expect(refsV2.first()!.targetNode).toBe(shortID(stuff.id));
  });
});
