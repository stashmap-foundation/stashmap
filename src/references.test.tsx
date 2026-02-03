import { Map, List } from "immutable";
import {
  bulkAddRelations,
  newNode,
  getReferencedByRelations,
  shortID,
  parseConcreteRefId,
  parseAbstractRefId,
  getRelationsNoReferencedBy,
  getConcreteRefs,
  isConcreteRefId,
  isAbstractRefId,
  VERSIONS_NODE_ID,
  addRelationToRelations,
} from "./connections";
import { ALICE, BOB, CAROL } from "./utils.test";
import { newRelations } from "./ViewContext";
import { newDB } from "./knowledge";

// =============================================================================
// REFERENCE BUILDING TESTS
// =============================================================================
// These tests verify that getReferencedByRelations correctly finds and groups
// references to a node, handling various scenarios including ~Versions.

describe("getConcreteRefs", () => {
  test("HEAD ref: node is head of a relation with children", () => {
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const child1 = newNode("Child 1");

    // My Notes → Stuff (Stuff is HEAD, has children)
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

    const refs = getConcreteRefs(dbs, stuff.id);
    expect(refs.size).toBe(1);
    expect(refs.first()!.isInItems).toBe(false);
    expect(refs.first()!.relationID).toBe(stuffRelations.id);
  });

  test("IN ref: node is in items of a relation", () => {
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");

    // My Notes has Stuff in its items
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

    const refs = getConcreteRefs(dbs, stuff.id);
    expect(refs.size).toBe(1);
    expect(refs.first()!.isInItems).toBe(true);
    expect(refs.first()!.relationID).toBe(myNotesRelations.id);
  });

  test("HEAD takes priority over IN for same context", () => {
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const child1 = newNode("Child 1");

    // My Notes → Stuff (IN ref)
    const myNotesRelations = addRelationToRelations(
      newRelations(myNotes.id, List(), ALICE.publicKey),
      stuff.id
    );
    // Stuff has children at context [My Notes] (HEAD ref)
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

    const refs = getConcreteRefs(dbs, stuff.id);
    // Should only get HEAD ref, not IN ref (HEAD takes priority)
    expect(refs.size).toBe(1);
    expect(refs.first()!.isInItems).toBe(false);
    expect(refs.first()!.relationID).toBe(stuffRelations.id);
  });

  test("~Versions HEAD case: version node in ~Versions items resolves to parent", () => {
    // Setup: My Notes → Stuff → ~Versions → [Stuff v2]
    // Looking for refs to "Stuff v2" should find My Notes → Stuff, NOT ~Versions
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const stuffV2 = newNode("Stuff v2"); // A version of Stuff

    // My Notes → Stuff
    const stuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        ALICE.publicKey
      ),
      [newNode("child").id]
    );
    // ~Versions relation under Stuff: head=~Versions, context=[My Notes, Stuff], items=[Stuff v2]
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

    const refs = getConcreteRefs(dbs, stuffV2.id);
    // Should resolve to the parent (Stuff) relation, not ~Versions
    expect(refs.size).toBe(1);
    expect(refs.first()!.relationID).toBe(stuffRelations.id);
    expect(refs.first()!.isInItems).toBe(false); // Becomes a HEAD ref to parent
    expect(refs.first()!.context.toArray()).toEqual([shortID(myNotes.id)]);
  });

  test("~Versions IN case: node in items of relation with ~Versions in context resolves to grandparent", () => {
    // Setup: My Notes → Stuff → ~Versions → [SomeChild as item, with SomeChild having children]
    // context=[My Notes, Stuff, ~Versions], head=SomeVersion, items contain SomeChild
    // Looking for refs to SomeChild should resolve to: context=[My Notes], head=Stuff
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const someVersion = newNode("Some Version");
    const someChild = newNode("Some Child");

    // Parent relation: My Notes → Stuff (with children)
    const stuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        ALICE.publicKey
      ),
      [newNode("other").id]
    );
    // Relation with ~Versions in context, someChild is IN items
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

    const refs = getConcreteRefs(dbs, someChild.id);
    // Should resolve to Stuff (the grandparent)
    expect(refs.size).toBe(1);
    expect(refs.first()!.relationID).toBe(stuffRelations.id);
    expect(refs.first()!.isInItems).toBe(false);
    expect(refs.first()!.context.toArray()).toEqual([shortID(myNotes.id)]);
  });

  test("deduplication: same relation reached via direct and ~Versions path", () => {
    // Bob has: My Notes → Stuff (direct HEAD ref)
    // Bob also has: My Notes → Stuff → ~Versions → [Stuff v2]
    // When looking for refs to Stuff, the ~Versions path also resolves to My Notes → Stuff
    // Should only see ONE ref, not two!
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const stuffV2 = newNode("Stuff v2");
    const child = newNode("Child");

    // Direct relation: My Notes → Stuff with children
    const stuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        BOB.publicKey
      ),
      [child.id]
    );
    // ~Versions relation that would also resolve to stuffRelations
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

    // Looking for refs to stuffV2 (the version node)
    const refs = getConcreteRefs(dbs, stuffV2.id);
    // Should only get ONE ref (deduplicated)
    expect(refs.size).toBe(1);
    expect(refs.first()!.relationID).toBe(stuffRelations.id);
  });
});

describe("getReferencedByRelations grouping", () => {
  test("single ref per context becomes concrete ref", () => {
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

    const referencedBy = getReferencedByRelations(
      dbs,
      ALICE.publicKey,
      stuff.id
    );
    expect(referencedBy?.items.size).toBe(1);
    const firstItem = referencedBy!.items.first();
    const refId = firstItem!.nodeID;
    expect(isConcreteRefId(refId)).toBe(true);
  });

  test("multiple refs same context (different authors) becomes abstract ref", () => {
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");

    const aliceRelations = addRelationToRelations(
      newRelations(myNotes.id, List(), ALICE.publicKey),
      stuff.id
    );
    const bobRelations = addRelationToRelations(
      newRelations(myNotes.id, List(), BOB.publicKey),
      stuff.id
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({ [shortID(aliceRelations.id)]: aliceRelations }),
        nodes: Map({ [myNotes.id]: myNotes, [stuff.id]: stuff }),
      },
      [BOB.publicKey]: {
        ...newDB(),
        relations: Map({ [shortID(bobRelations.id)]: bobRelations }),
        nodes: Map({ [myNotes.id]: myNotes }),
      },
    }) as KnowledgeDBs;

    const referencedBy = getReferencedByRelations(
      dbs,
      ALICE.publicKey,
      stuff.id
    );
    expect(referencedBy?.items.size).toBe(1);
    const firstItem = referencedBy!.items.first();
    const refId = firstItem!.nodeID;
    expect(isAbstractRefId(refId)).toBe(true);
    // Should be ref:myNotes:stuff
    const parsed = parseAbstractRefId(refId);
    expect(parsed?.targetNode).toBe(shortID(stuff.id));
    expect(parsed?.targetContext.last()).toBe(shortID(myNotes.id));
  });

  test("different contexts become separate refs", () => {
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

    const referencedBy = getReferencedByRelations(
      dbs,
      ALICE.publicKey,
      stuff.id
    );
    // Should get 2 separate refs (different contexts)
    expect(referencedBy?.items.size).toBe(2);
    // Both should be concrete refs (single ref per context)
    expect(
      referencedBy?.items.every((item) => isConcreteRefId(item.nodeID))
    ).toBe(true);
  });

  test("Alice and Bob same list, Bob also has ~Versions - only 2 refs total", () => {
    // This is the bug case:
    // Alice: My Notes → Stuff (1 ref)
    // Bob: My Notes → Stuff (1 ref) + My Notes → Stuff → ~Versions → [Stuff v2]
    // The ~Versions should resolve to Bob's My Notes → Stuff
    // After dedup, Bob contributes only 1 ref
    // Total: 2 refs (Alice + Bob) grouped into abstract ref
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const stuffV2 = newNode("Stuff v2");
    const child = newNode("Child");

    // Alice's relation
    const aliceStuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        ALICE.publicKey
      ),
      [child.id]
    );
    // Bob's direct relation
    const bobStuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        BOB.publicKey
      ),
      [child.id]
    );
    // Bob's ~Versions relation (resolves to bobStuffRelations)
    const bobVersionsRelations = addRelationToRelations(
      newRelations(
        VERSIONS_NODE_ID,
        List([shortID(myNotes.id), shortID(stuff.id)] as ID[]),
        BOB.publicKey
      ),
      stuffV2.id
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(aliceStuffRelations.id)]: aliceStuffRelations,
        }),
        nodes: Map({ [myNotes.id]: myNotes, [stuff.id]: stuff }),
      },
      [BOB.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(bobStuffRelations.id)]: bobStuffRelations,
          [shortID(bobVersionsRelations.id)]: bobVersionsRelations,
        }),
        nodes: Map({
          [myNotes.id]: myNotes,
          [stuff.id]: stuff,
          [stuffV2.id]: stuffV2,
        }),
      },
    }) as KnowledgeDBs;

    // Looking for refs to Stuff
    const referencedBy = getReferencedByRelations(
      dbs,
      ALICE.publicKey,
      stuff.id
    );
    // Should be 1 abstract ref (Alice and Bob in same context [My Notes])
    expect(referencedBy?.items.size).toBe(1);
    const firstItem = referencedBy!.items.first();
    expect(isAbstractRefId(firstItem!.nodeID)).toBe(true);
  });

  test("Alice and Bob same list, Bob also has ~Versions - version node refs", () => {
    // Looking for refs to stuffV2 (the version node)
    // Should only find 1 ref from Bob (via ~Versions → parent)
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const stuffV2 = newNode("Stuff v2");
    const child = newNode("Child");

    // Alice's relation (doesn't have stuffV2)
    const aliceStuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        ALICE.publicKey
      ),
      [child.id]
    );
    // Bob's direct relation
    const bobStuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        BOB.publicKey
      ),
      [child.id]
    );
    // Bob's ~Versions relation containing stuffV2
    const bobVersionsRelations = addRelationToRelations(
      newRelations(
        VERSIONS_NODE_ID,
        List([shortID(myNotes.id), shortID(stuff.id)] as ID[]),
        BOB.publicKey
      ),
      stuffV2.id
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(aliceStuffRelations.id)]: aliceStuffRelations,
        }),
        nodes: Map({ [myNotes.id]: myNotes, [stuff.id]: stuff }),
      },
      [BOB.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(bobStuffRelations.id)]: bobStuffRelations,
          [shortID(bobVersionsRelations.id)]: bobVersionsRelations,
        }),
        nodes: Map({
          [myNotes.id]: myNotes,
          [stuff.id]: stuff,
          [stuffV2.id]: stuffV2,
        }),
      },
    }) as KnowledgeDBs;

    // Looking for refs to stuffV2
    const referencedBy = getReferencedByRelations(
      dbs,
      ALICE.publicKey,
      stuffV2.id
    );
    // Should be 1 concrete ref (only Bob has stuffV2 via ~Versions)
    expect(referencedBy?.items.size).toBe(1);
    const firstItem = referencedBy!.items.first();
    expect(isConcreteRefId(firstItem!.nodeID)).toBe(true);
    // Should point to bobStuffRelations (the parent)
    const parsed = parseConcreteRefId(firstItem!.nodeID);
    expect(parsed?.relationID).toBe(bobStuffRelations.id);
  });

  test("three users same context - one abstract ref", () => {
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");

    const aliceRelations = addRelationToRelations(
      newRelations(myNotes.id, List(), ALICE.publicKey),
      stuff.id
    );
    const bobRelations = addRelationToRelations(
      newRelations(myNotes.id, List(), BOB.publicKey),
      stuff.id
    );
    const carolRelations = addRelationToRelations(
      newRelations(myNotes.id, List(), CAROL.publicKey),
      stuff.id
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({ [shortID(aliceRelations.id)]: aliceRelations }),
        nodes: Map({ [myNotes.id]: myNotes, [stuff.id]: stuff }),
      },
      [BOB.publicKey]: {
        ...newDB(),
        relations: Map({ [shortID(bobRelations.id)]: bobRelations }),
        nodes: Map({ [myNotes.id]: myNotes }),
      },
      [CAROL.publicKey]: {
        ...newDB(),
        relations: Map({ [shortID(carolRelations.id)]: carolRelations }),
        nodes: Map({ [myNotes.id]: myNotes }),
      },
    }) as KnowledgeDBs;

    const referencedBy = getReferencedByRelations(
      dbs,
      ALICE.publicKey,
      stuff.id
    );
    expect(referencedBy?.items.size).toBe(1);
    const firstItem = referencedBy!.items.first();
    expect(isAbstractRefId(firstItem!.nodeID)).toBe(true);
  });

  test("nested context refs", () => {
    // My Notes → Projects → Stuff
    const myNotes = newNode("My Notes");
    const projects = newNode("Projects");
    const stuff = newNode("Stuff");

    // Projects has Stuff as child, context is [My Notes]
    const projectsRelations = addRelationToRelations(
      newRelations(
        projects.id,
        List([shortID(myNotes.id)] as ID[]),
        ALICE.publicKey
      ),
      stuff.id
    );

    const dbs = Map({
      [ALICE.publicKey]: {
        ...newDB(),
        relations: Map({ [shortID(projectsRelations.id)]: projectsRelations }),
        nodes: Map({
          [myNotes.id]: myNotes,
          [projects.id]: projects,
          [stuff.id]: stuff,
        }),
      },
    }) as KnowledgeDBs;

    const referencedBy = getReferencedByRelations(
      dbs,
      ALICE.publicKey,
      stuff.id
    );
    expect(referencedBy?.items.size).toBe(1);
    // Context should be [My Notes, Projects]
    const firstItem = referencedBy!.items.first();
    const parsed = parseConcreteRefId(firstItem!.nodeID);
    const rel = getRelationsNoReferencedBy(
      dbs,
      parsed?.relationID,
      ALICE.publicKey
    );
    expect(rel?.context.toArray()).toEqual([shortID(myNotes.id)]);
    expect(rel?.head).toBe(shortID(projects.id));
  });

  test("mixed HEAD and IN refs from same user - HEAD wins", () => {
    // Bob has: My Notes → Stuff (IN) AND Stuff has children at [My Notes] (HEAD)
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const child = newNode("Child");

    // IN ref: My Notes contains Stuff
    const myNotesRelations = addRelationToRelations(
      newRelations(myNotes.id, List(), BOB.publicKey),
      stuff.id
    );
    // HEAD ref: Stuff has children at context [My Notes]
    const stuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        BOB.publicKey
      ),
      [child.id]
    );

    const dbs = Map({
      [BOB.publicKey]: {
        ...newDB(),
        relations: Map({
          [shortID(myNotesRelations.id)]: myNotesRelations,
          [shortID(stuffRelations.id)]: stuffRelations,
        }),
        nodes: Map({
          [myNotes.id]: myNotes,
          [stuff.id]: stuff,
          [child.id]: child,
        }),
      },
    }) as KnowledgeDBs;

    const referencedBy = getReferencedByRelations(
      dbs,
      ALICE.publicKey,
      stuff.id
    );
    // Should only get 1 ref (HEAD wins over IN)
    expect(referencedBy?.items.size).toBe(1);
    const firstItem = referencedBy!.items.first();
    const parsed = parseConcreteRefId(firstItem!.nodeID);
    expect(parsed?.relationID).toBe(stuffRelations.id);
  });

  test("~Versions with multiple version nodes - each gets separate ref to same parent", () => {
    const myNotes = newNode("My Notes");
    const stuff = newNode("Stuff");
    const stuffV1 = newNode("Stuff version 1");
    const stuffV2 = newNode("Stuff version 2");
    const child = newNode("Child");

    // Parent relation
    const stuffRelations = bulkAddRelations(
      newRelations(
        stuff.id,
        List([shortID(myNotes.id)] as ID[]),
        ALICE.publicKey
      ),
      [child.id]
    );
    // ~Versions with multiple versions
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

    // Refs to stuffV1
    const refsV1 = getReferencedByRelations(dbs, ALICE.publicKey, stuffV1.id);
    expect(refsV1?.items.size).toBe(1);
    const v1FirstItem = refsV1!.items.first();
    expect(parseConcreteRefId(v1FirstItem!.nodeID)?.relationID).toBe(
      stuffRelations.id
    );

    // Refs to stuffV2
    const refsV2 = getReferencedByRelations(dbs, ALICE.publicKey, stuffV2.id);
    expect(refsV2?.items.size).toBe(1);
    const v2FirstItem = refsV2!.items.first();
    expect(parseConcreteRefId(v2FirstItem!.nodeID)?.relationID).toBe(
      stuffRelations.id
    );
  });
});
