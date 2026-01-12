import { Map, List } from "immutable";
import {
  moveRelations,
  addRelationToRelations,
  bulkAddRelations,
  newNode,
  getReferencedByRelations,
  shortID,
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
  const a = newNode("a", ALICE.publicKey);
  const b = newNode("b", ALICE.publicKey);
  const c = newNode("c", ALICE.publicKey);
  const d = newNode("c", ALICE.publicKey);
  const e = newNode("e", ALICE.publicKey);

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
  const n = newNode("hello", ALICE.publicKey);
  const updated = addRelationToRelations(relations, n.id);
  expect(getNodeIDs(updated.items)).toEqual(
    List([b.id, c.id, d.id, e.id, n.id])
  );
});

test("Position of new connection can be specified", () => {
  const { b, c, d, e, relations } = sampleNodes();
  const b0 = newNode("b0", ALICE.publicKey);
  expect(
    getNodeIDs(addRelationToRelations(relations, b0.id, List([""]), 0).items)
  ).toEqual(List([b0.id, b.id, c.id, d.id, e.id]));
});

test("Reorder existing connections", () => {
  const { b, c, d, e, relations } = sampleNodes();
  expect(getNodeIDs(moveRelations(relations, [2], 0).items)).toEqual(
    List([d.id, b.id, c.id, e.id])
  );
});

test("get referenced by relations", () => {
  const aliceDB = newDB();
  const bobsDB = newDB();
  const btc = newNode("Bitcoin", ALICE.publicKey);
  const money = newNode("Money", ALICE.publicKey);
  const crypto = newNode("Crypto", BOB.publicKey);

  const moneyRelations = addRelationToRelations(
    newRelations(money.id, List(), ALICE.publicKey),
    btc.id
  );
  const cryptoRelations = addRelationToRelations(
    newRelations(crypto.id, List(), BOB.publicKey),
    btc.id
  );
  const aliceDBWithRelations = {
    ...aliceDB,
    relations: Map({ [money.id]: moneyRelations }),
    nodes: Map({ [btc.id]: btc, [money.id]: money }),
  };
  const bobDBWithRelations = {
    ...bobsDB,
    relations: Map({ [crypto.id]: cryptoRelations }),
    nodes: Map({ [crypto.id]: crypto }),
  };
  const dbs = Map({
    [ALICE.publicKey]: aliceDBWithRelations,
    [BOB.publicKey]: bobDBWithRelations,
  });

  const referencedBy = getReferencedByRelations(
    dbs as KnowledgeDBs,
    ALICE.publicKey,
    btc.id
  );
  expect(getNodeIDs(referencedBy?.items || List())).toEqual(
    List([shortID(money.id), shortID(crypto.id)])
  );
});

test("count relation votes", () => {
  const vote = newNode("VOTING", ALICE.publicKey);
  const optionA = newNode("A", ALICE.publicKey);
  const optionB = newNode("B", ALICE.publicKey);
  const optionC = newNode("C", ALICE.publicKey);
  const optionD = newNode("D", ALICE.publicKey);

  // Types are now per-item, use List(["PRO"]) for the type
  const aliceVotes = bulkAddRelations(
    newRelations(vote.id, List(), ALICE.publicKey),
    [optionA.id, optionB.id, optionC.id, optionD.id], // 5/11, 3/11, 2/11, 1/11 *10000
    List(["PRO"])
  );
  const bobVotes = bulkAddRelations(
    newRelations(vote.id, List(), BOB.publicKey),
    [optionD.id, optionB.id, optionC.id, optionA.id], // 5/11, 3/11, 2/11, 1/11 *10000
    List(["PRO"])
  );
  const carolVotes = bulkAddRelations(
    newRelations(vote.id, List(), CAROL.publicKey),
    [optionA.id, optionB.id, optionC.id], // 3/6, 2/6, 1/6 *10000
    List(["PRO"])
  );

  expect(
    countRelationVotes(List([aliceVotes, bobVotes, carolVotes]), vote.id, "PRO")
  ).toEqual(
    Map({
      [optionA.id]: 10454.545454545454, // 5/11+1/11+3/6 *10000
      [optionB.id]: 8787.878787878788, // 3/11+3/11+2/6 *10000
      [optionC.id]: 5303.030303030303, // 2/11+2/11+1/6 *10000
      [optionD.id]: 5454.545454545454, // 5/11+1/11 * 10000
    })
  );
});

// Helper to create RelationItem from nodeID with type
function makeItem(nodeID: string, type: string = ""): RelationItem {
  return { nodeID: nodeID as LongID, types: List([type]) };
}

test("aggregate weighted votes", () => {
  const alice = ["A", "B", "C", "D"].map((id) => makeItem(id, ""));
  const bob = ["B", "C", "D", "A"].map((id) => makeItem(id, ""));
  const carol = ["C", "A", "B"].map((id) => makeItem(id, ""));
  const dan = ["D"].map((id) => makeItem(id, ""));

  const listsOfVotes = List([
    { items: List(alice), weight: 20 },
    { items: List(bob), weight: 100 },
    { items: List(carol), weight: 10 },
    { items: List(dan), weight: 1 },
  ]);
  expect(aggregateWeightedVotes(listsOfVotes, "")).toEqual(
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
  const vote = newNode("VOTING", ALICE.publicKey);
  const optionA = newNode("A", ALICE.publicKey);
  const optionB = newNode("B", ALICE.publicKey);
  const optionC = newNode("C", ALICE.publicKey);
  const optionD = newNode("D", ALICE.publicKey);
  const optionE = newNode("E", ALICE.publicKey);
  const optionF = newNode("F", ALICE.publicKey);
  const optionG = newNode("G", ALICE.publicKey);

  // First Vote: multiple votes - types are now per-item
  const aliceVotes = bulkAddRelations(
    newRelations(vote.id, List(), ALICE.publicKey),
    [optionA.id, optionB.id, optionC.id, optionD.id], // 5/11, 3/11, 2/11, 1/11 *10000
    List([""])
  );
  const bobVotes = bulkAddRelations(
    newRelations(vote.id, List(), BOB.publicKey),
    [optionD.id, optionB.id, optionC.id, optionA.id], // 1/2, 1/2, 1/2, 1/2 *10000
    List(["not_relevant"])
  );
  const carolVotes = bulkAddRelations(
    newRelations(vote.id, List(), CAROL.publicKey),
    [optionA.id, optionB.id, optionC.id], // 3/6, 2/6, 1/6 *10000
    List([""])
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
  const secondVote = newNode("SECOND VOTING", ALICE.publicKey);
  const secondAliceVotes = bulkAddRelations(
    newRelations(secondVote.id, List(), ALICE.publicKey),
    [optionA.id, optionB.id, optionC.id, optionD.id, optionE.id], // 8/19, 5/19, 3/19, 2/19, 1/19 *10000
    List([""])
  );
  const secondBobVotes = bulkAddRelations(
    newRelations(secondVote.id, List(), BOB.publicKey),
    [optionB.id, optionC.id, optionD.id], // 3/6, 2/6, 1/6 *10000
    List([""])
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
  const thirdVote = newNode("THIRD VOTING", ALICE.publicKey);
  const thirdAliceVotes = bulkAddRelations(
    newRelations(thirdVote.id, List(), ALICE.publicKey),
    [optionA.id, optionB.id, optionC.id],
    List(["not_relevant"])
  );

  expect(countRelevanceVoting(List([thirdAliceVotes]), thirdVote.id)).toEqual(
    Map({
      [optionA.id]: -5000, // -1/2 *10000
      [optionB.id]: -5000, // -1/2 *10000
      [optionC.id]: -5000, // -1/2 *10000
    })
  );

  // Fourth Vote: positive votes are fibonacci-weighted sequence
  const fourthVote = newNode("FOURTH VOTING", ALICE.publicKey);
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
    List([""])
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
  const fifthVote = newNode("FIFTH VOTING", ALICE.publicKey);
  const fifthAliceVotes = bulkAddRelations(
    newRelations(fifthVote.id, List(), ALICE.publicKey),
    [optionA.id], // 1
    List([""])
  );
  const fifthBobVotes = bulkAddRelations(
    newRelations(fifthVote.id, List(), BOB.publicKey),
    [optionA.id], // -1/2,
    List(["not_relevant"])
  );
  const fifthCarolVotes = bulkAddRelations(
    newRelations(fifthVote.id, List(), CAROL.publicKey),
    [optionA.id], // -1/2,
    List(["not_relevant"])
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
