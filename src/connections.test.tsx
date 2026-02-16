import { Map, List } from "immutable";
import {
  moveRelations,
  addRelationToRelations,
  bulkAddRelations,
  newNode,
  findRefsToNode,
  getRelationsNoReferencedBy,
  shortID,
  parseConcreteRefId,
  countRelationVotes,
  aggregateWeightedVotes,
  aggregateNegativeWeightedVotes,
  countRelevanceVoting,
} from "./connections";
import { ALICE, BOB, CAROL } from "./utils.test";
import { newRelations } from "./ViewContext";
import { newDB } from "./knowledge";

function sampleNodes(): {
  nodes: Map<ID, KnowNode>;
  relations: Relations;
  a: KnowNode;
  b: KnowNode;
  c: KnowNode;
  d: KnowNode;
  e: KnowNode;
} {
  const a = newNode("a");
  const b = newNode("b");
  const c = newNode("c");
  const d = newNode("c");
  const e = newNode("e");

  const relations = bulkAddRelations(
    newRelations(a.id, List(), ALICE.publicKey),
    [b.id, c.id, d.id, e.id]
  );

  const nodes = Map({
    [a.id]: a,
    [b.id]: b,
    [c.id]: c,
    [d.id]: d,
    [e.id]: e,
  });
  return { nodes, a, b, c, d, e, relations };
}

// Helper to extract nodeIDs from RelationItems for easier testing
function getNodeIDs(items: List<RelationItem>): List<LongID | ID> {
  return items.map((item) => item.nodeID);
}

test("Add new Connection", () => {
  const { b, c, d, e, relations } = sampleNodes();
  const n = newNode("hello");
  const updated = addRelationToRelations(relations, n.id);
  expect(getNodeIDs(updated.items)).toEqual(
    List([b.id, c.id, d.id, e.id, n.id])
  );
});

test("Position of new connection can be specified", () => {
  const { b, c, d, e, relations } = sampleNodes();
  const b0 = newNode("b0");
  expect(
    getNodeIDs(
      addRelationToRelations(relations, b0.id, undefined, undefined, 0).items
    )
  ).toEqual(List([b0.id, b.id, c.id, d.id, e.id]));
});

test("Reorder existing connections", () => {
  const { b, c, d, e, relations } = sampleNodes();
  expect(getNodeIDs(moveRelations(relations, [2], 0).items)).toEqual(
    List([d.id, b.id, c.id, e.id])
  );
});

test("findRefsToNode finds refs from multiple users", () => {
  const aliceDB = newDB();
  const bobsDB = newDB();
  const btc = newNode("Bitcoin");
  const money = newNode("Money");
  const crypto = newNode("Crypto");

  const moneyRelations = addRelationToRelations(
    newRelations(money.id, List(), ALICE.publicKey),
    btc.id
  );
  const cryptoRelations = addRelationToRelations(
    newRelations(crypto.id, List(), BOB.publicKey),
    btc.id
  );
  const dbs = Map({
    [ALICE.publicKey]: {
      ...aliceDB,
      relations: Map({ [shortID(moneyRelations.id)]: moneyRelations }),
      nodes: Map({ [btc.id]: btc, [money.id]: money }),
    },
    [BOB.publicKey]: {
      ...bobsDB,
      relations: Map({ [shortID(cryptoRelations.id)]: cryptoRelations }),
      nodes: Map({ [crypto.id]: crypto }),
    },
  }) as KnowledgeDBs;

  const refs = findRefsToNode(dbs, btc.id);
  expect(refs.size).toBe(2);
  expect(refs.every((r) => r.targetNode === shortID(btc.id))).toBe(true);
  const relationIDs = refs.map((r) => r.relationID).toSet();
  expect(relationIDs.has(moneyRelations.id)).toBe(true);
  expect(relationIDs.has(cryptoRelations.id)).toBe(true);
});

test("getRelationsNoReferencedBy resolves unscoped relation IDs across DBs", () => {
  const root = newNode("Root");
  const child = newNode("Child");
  const bobRelations = addRelationToRelations(
    newRelations(root.id, List(), BOB.publicKey),
    child.id
  );

  const dbs = Map({
    [ALICE.publicKey]: {
      ...newDB(),
      nodes: Map({ [root.id]: root }),
      relations: Map<string, Relations>(),
    },
    [BOB.publicKey]: {
      ...newDB(),
      nodes: Map({ [root.id]: root, [child.id]: child }),
      relations: Map({ [shortID(bobRelations.id)]: bobRelations }),
    },
  }) as KnowledgeDBs;

  const unscopedRelationID = shortID(bobRelations.id) as ID;
  const resolved = getRelationsNoReferencedBy(
    dbs,
    unscopedRelationID,
    ALICE.publicKey
  );

  expect(resolved?.id).toBe(bobRelations.id);
  expect(resolved?.author).toBe(BOB.publicKey);
});

test("parseConcreteRefId handles relation IDs containing colons", () => {
  const refWithoutTarget = "cref:pubkey_rel:legacy" as LongID;
  const parsedWithoutTarget = parseConcreteRefId(refWithoutTarget);
  expect(parsedWithoutTarget?.relationID).toBe("pubkey_rel:legacy");
  expect(parsedWithoutTarget?.targetNode).toBeUndefined();

  const targetNode = "0123456789abcdef0123456789abcdef" as ID;
  const refWithTarget = `cref:pubkey_rel:legacy:${targetNode}` as LongID;
  const parsedWithTarget = parseConcreteRefId(refWithTarget);
  expect(parsedWithTarget?.relationID).toBe("pubkey_rel:legacy");
  expect(parsedWithTarget?.targetNode).toBe(targetNode);
});

test("count relation votes", () => {
  const vote = newNode("VOTING");
  const optionA = newNode("A");
  const optionB = newNode("B");
  const optionC = newNode("C");
  const optionD = newNode("D");

  // Items with "confirms" argument for positive voting
  const aliceVotes = bulkAddRelations(
    newRelations(vote.id, List(), ALICE.publicKey),
    [optionA.id, optionB.id, optionC.id, optionD.id], // 5/11, 3/11, 2/11, 1/11 *10000
    undefined,
    "confirms"
  );
  const bobVotes = bulkAddRelations(
    newRelations(vote.id, List(), BOB.publicKey),
    [optionD.id, optionB.id, optionC.id, optionA.id], // 5/11, 3/11, 2/11, 1/11 *10000
    undefined,
    "confirms"
  );
  const carolVotes = bulkAddRelations(
    newRelations(vote.id, List(), CAROL.publicKey),
    [optionA.id, optionB.id, optionC.id], // 3/6, 2/6, 1/6 *10000
    undefined,
    "confirms"
  );

  expect(
    countRelationVotes(
      List([aliceVotes, bobVotes, carolVotes]),
      vote.id,
      "confirms"
    )
  ).toEqual(
    Map({
      [optionA.id]: 10454.545454545454, // 5/11+1/11+3/6 *10000
      [optionB.id]: 8787.878787878788, // 3/11+3/11+2/6 *10000
      [optionC.id]: 5303.030303030303, // 2/11+2/11+1/6 *10000
      [optionD.id]: 5454.545454545454, // 5/11+1/11 * 10000
    })
  );
});

// Helper to create RelationItem from nodeID with relevance and optional argument
function makeItem(
  nodeID: string,
  relevance?: Relevance,
  argument?: Argument
): RelationItem {
  return { nodeID: nodeID as LongID, relevance, argument };
}

test("aggregate weighted votes", () => {
  const alice = ["A", "B", "C", "D"].map((id) => makeItem(id, undefined));
  const bob = ["B", "C", "D", "A"].map((id) => makeItem(id, undefined));
  const carol = ["C", "A", "B"].map((id) => makeItem(id, undefined));
  const dan = ["D"].map((id) => makeItem(id, undefined));

  const listsOfVotes = List([
    { items: List(alice), weight: 20 },
    { items: List(bob), weight: 100 },
    { items: List(carol), weight: 10 },
    { items: List(dan), weight: 1 },
  ]);
  expect(aggregateWeightedVotes(listsOfVotes, "contains")).toEqual(
    Map({
      A: 21.515151515151512, // 5/11*20 + 1/11*100 + 2/6*10
      B: 52.57575757575757, // 3/11*20 + 5/11*100 + 1/6*10
      C: 35.90909090909091, // 2/11*20 + 3/11*100 + 3/6*10
      D: 21, // 20+1
    })
  );
});

test("aggregate negative weighted votes", () => {
  const alice = ["A", "B", "C", "D"].map((id) => makeItem(id, "not_relevant"));
  const bob = ["B", "C", "D", "A"].map((id) => makeItem(id, "not_relevant"));
  const carol = ["C", "A", "B"].map((id) => makeItem(id, "not_relevant"));
  const dan = ["D"].map((id) => makeItem(id, "not_relevant"));

  const listsOfVotes = List([
    { items: List(alice), weight: 20 },
    { items: List(bob), weight: 100 },
    { items: List(carol), weight: 10 },
    { items: List(dan), weight: 1 },
  ]);
  expect(aggregateNegativeWeightedVotes(listsOfVotes, "not_relevant")).toEqual(
    Map({
      A: -65,
      B: -65,
      C: -65,
      D: -60.5,
    })
  );
});

test("count relation votes and also aggregate negative weights", () => {
  const vote = newNode("VOTING");
  const optionA = newNode("A");
  const optionB = newNode("B");
  const optionC = newNode("C");
  const optionD = newNode("D");
  const optionE = newNode("E");
  const optionF = newNode("F");
  const optionG = newNode("G");

  // First Vote: multiple votes - types are now per-item
  const aliceVotes = bulkAddRelations(
    newRelations(vote.id, List(), ALICE.publicKey),
    [optionA.id, optionB.id, optionC.id, optionD.id], // 5/11, 3/11, 2/11, 1/11 *10000
    undefined
  );
  const bobVotes = bulkAddRelations(
    newRelations(vote.id, List(), BOB.publicKey),
    [optionD.id, optionB.id, optionC.id, optionA.id], // 1/2, 1/2, 1/2, 1/2 *10000
    "not_relevant"
  );
  const carolVotes = bulkAddRelations(
    newRelations(vote.id, List(), CAROL.publicKey),
    [optionA.id, optionB.id, optionC.id], // 3/6, 2/6, 1/6 *10000
    undefined
  );

  expect(
    countRelevanceVoting(List([aliceVotes, bobVotes, carolVotes]), vote.id)
  ).toEqual(
    Map({
      [optionA.id]: 4545.454545454544, // 5/11-1/2+3/6 *10000
      [optionB.id]: 1060.60606060606, // 3/11-1/2+2/6 *10000
      [optionC.id]: -1515.151515151515, // 2/11-1/2+1/6 *10000
      [optionD.id]: -4090.909090909091, // 1/11-1/2 * 10000
    })
  );

  // Second Vote: positive votes add up
  const secondVote = newNode("SECOND VOTING");
  const secondAliceVotes = bulkAddRelations(
    newRelations(secondVote.id, List(), ALICE.publicKey),
    [optionA.id, optionB.id, optionC.id, optionD.id, optionE.id], // 8/19, 5/19, 3/19, 2/19, 1/19 *10000
    undefined
  );
  const secondBobVotes = bulkAddRelations(
    newRelations(secondVote.id, List(), BOB.publicKey),
    [optionB.id, optionC.id, optionD.id], // 3/6, 2/6, 1/6 *10000
    undefined
  );
  expect(
    countRelevanceVoting(
      List([secondAliceVotes, secondBobVotes]),
      secondVote.id
    )
  ).toEqual(
    Map({
      [optionA.id]: 4210.526315789473, // 8/19 *10000
      [optionB.id]: 7631.578947368421, // 5/19+3/6 *10000
      [optionC.id]: 4912.2807017543855, // 3/19+2/6 *10000
      [optionD.id]: 2719.298245614035, // 2/19+1/6 *10000
      [optionE.id]: 526.3157894736842, // 1/19 *10000
    })
  );

  // Third Vote: negative votes always count -1/2
  const thirdVote = newNode("THIRD VOTING");
  const thirdAliceVotes = bulkAddRelations(
    newRelations(thirdVote.id, List(), ALICE.publicKey),
    [optionA.id, optionB.id, optionC.id],
    "not_relevant"
  );

  expect(countRelevanceVoting(List([thirdAliceVotes]), thirdVote.id)).toEqual(
    Map({
      [optionA.id]: -5000, // -1/2 *10000
      [optionB.id]: -5000, // -1/2 *10000
      [optionC.id]: -5000, // -1/2 *10000
    })
  );

  // Fourth Vote: positive votes are fibonacci-weighted sequence
  const fourthVote = newNode("FOURTH VOTING");
  const fourthAliceVotes = bulkAddRelations(
    newRelations(fourthVote.id, List(), ALICE.publicKey),
    [
      optionA.id,
      optionB.id,
      optionC.id,
      optionD.id,
      optionE.id,
      optionF.id,
      optionG.id,
    ], // 21/53, 13/53, 8/53, 5/53, 3/53, 2/53, 1/53 *10000
    undefined
  );

  expect(countRelevanceVoting(List([fourthAliceVotes]), fourthVote.id)).toEqual(
    Map({
      [optionA.id]: 3962.2641509433965, // 21/53 *10000
      [optionB.id]: 2452.830188679245, // 13/53 *10000
      [optionC.id]: 1509.433962264151, // 8/53 *10000
      [optionD.id]: 943.3962264150944, // 5/53 *10000
      [optionE.id]: 566.0377358490566, // 3/53 *10000
      [optionF.id]: 377.35849056603774, // 2/53 *10000
      [optionG.id]: 188.67924528301887, // 1/53 *10000
    })
  );

  // Fifth Vote: positive and negative votes cancel out
  const fifthVote = newNode("FIFTH VOTING");
  const fifthAliceVotes = bulkAddRelations(
    newRelations(fifthVote.id, List(), ALICE.publicKey),
    [optionA.id], // 1
    undefined
  );
  const fifthBobVotes = bulkAddRelations(
    newRelations(fifthVote.id, List(), BOB.publicKey),
    [optionA.id], // -1/2,
    "not_relevant"
  );
  const fifthCarolVotes = bulkAddRelations(
    newRelations(fifthVote.id, List(), CAROL.publicKey),
    [optionA.id], // -1/2,
    "not_relevant"
  );
  expect(
    countRelevanceVoting(
      List([fifthAliceVotes, fifthBobVotes, fifthCarolVotes]),
      fifthVote.id
    )
  ).toEqual(
    Map({
      [optionA.id]: 0, // 1-1/2-1/2
    })
  );
});
