<!-- ks:root=686e97e5-8f6a-4eee-af03-20715f10986a sourceAuthor=4e89370bea5fd8f0e2608371e373b41e620f9cd7bfb365494c8e8fc0a8af203c sourceRoot=4e89370bea5fd8f0e2608371e373b41e620f9cd7bfb365494c8e8fc0a8af203c_686e97e5-8f6a-4eee-af03-20715f10986a sourceRelation=4e89370bea5fd8f0e2608371e373b41e620f9cd7bfb365494c8e8fc0a8af203c_686e97e5-8f6a-4eee-af03-20715f10986a -->
<!-- ks:editing
Markers:
- (!) relevant
- (?) maybe_relevant
- (~) little_relevant
- (x) not_relevant
- (+) confirms
- (-) contra

Rules:
- Preserve existing ks:id marker lines when moving or renaming rows.
- Never invent ks:id markers for new rows; write new rows as plain markdown without ks:id.
- Never edit ks metadata lines by hand.
- To delete, move the row with its marker into the final "# Delete" root.
- Keep "# Delete" as the last root.
- push will reject lost, duplicated, or invented markers.
-->

# Bugs {686e97e5-8f6a-4eee-af03-20715f10986a semantic="ff7c5467ce496637e5ba10662b7a90cd"}
- Fix: If I see something in browser tab A and then switch to browser tab B to type something, when i switch back to A all views collapse {fe62e948-e839-4d09-94e3-449907c9e59b semantic="92e5318193dbdc2d4a58075ae1dccccb"}
- Fix: If I create a new line, then select "contradicts" and click (unnecessary) back into the text, the text field closes {492cc41b-7f90-46fa-a36d-31e8b5dc29f1 semantic="65ed9624f1d619fa314259673a8083ed"}
- Fix: Don't show original occurrence (basedOn) if quote is unchanged {b4de6739-7c0e-46e8-b080-11908c58537b semantic="bcaa5c5df231ab865fcb9c09a78f7e8e"}
  - Or: remove content from occurances if unchanged {62a75f66-c080-4c8a-bee8-0577b025cbab semantic="de530d647dfeb1d73a8256d7b7f4c1f3"}
- Fix: Panes don't survive reload {4b315a3d-3f06-43b0-919e-1d1ccf10cfce semantic="7615e8459444070603209357e969b9c4"}
- Fix: Can't delete root node! {0200e48c-b5f8-4475-8da0-9448dd89796b semantic="dde65342c0de6a74349132ba1253c983"}
- Fix: Moving {6fe42079-384e-4d33-9365-2129fab49754 semantic="4cdcba52aba67105d0ab1e53195d2124"}
- Fix: Make text in readonly mode blue {9980a292-e5ad-4811-a786-fc1ee327b19a semantic="03a9de329b1c1086ea42f68b9c151d55"}
- Fix: UI jumps around {390ee23b-d15d-4028-9cf7-e859f50460b8 semantic="57856bf76c3bc874329ee2de7e8d8a7a"}
- Fix: expanding a long text scrolls it down to the bottom {0fca688d-ee21-4e27-b6d5-5a324fda3ecc semantic="3055929fc56d6b11da7a59f9b691e0b1"}
- Fix: Draft is lost when window resizes or switches while user is typing {af728e48-6658-438f-9511-74c11a4e7294 semantic="2a26a743bd7fbbe1c7495edb16aa57a7"}
- Fix: Spacing between Cancel and Follow buttons {f1764ed2-cf21-4ef3-b718-8ffabcfa0d04 semantic="053bb384632a66d051691bf7c671a816"}
- Fix: Rename Back button to Cancel {abbccd62-3661-4619-860a-aca3439eef57 semantic="40a377d18e2f52c8b6a4f636d1a44cf0"}
- Fix: Reloading browser on a ~Search page shows Loading... in breadcrumb {61dad9ea-9f8b-4ef6-a89b-adafa8baac3c semantic="af29ee0da69a6732b2c81e6e8d96a28e"}
- Fix: Root Nodes not in search? {050377a9-d35b-40fc-8be3-9ef13d2a5c1c semantic="3b3fa8266624e491d26eb57e0f9feff0"}
- Fix: Clicking a standalone search result navigates to broken /search?==/<node> URL {99e41cd8-db4e-4536-93ff-238c9122f76e semantic="ac3f666df69dc01703f4d19cf2cf4941"}
- Fix: Stale relay list due to incorrect state handling {75db689f-ac0d-486c-ac39-c91559685b44 semantic="794f7c695eeba414889a10fb0d111350"}
- Fix: Cap View Entries at ~200 to limit size of event {8d752d4d-329b-4644-9c24-0a0f83eca469 semantic="9d4a270bc217818f033625d766bfd0a2"}
- Fix: Drag and drop grabbing on the very left doesn't allow indentation {75710a68-e795-461f-b7e1-611a29827996 semantic="f218b9b111c0017a83e9b3673336dff2"}
- Fix: Same Node twice in the list is causing chaos {f90d72e9-20df-4ddf-ac36-a262dfd0c2f1 semantic="1bd53eede47128d2a26b96aa160fbe33"}
  - !Damn it, does index need to be in context like with view path?! Same node on the same level causes issues, but is a usecase with renaming. Either add index to context or prevent same node on same level. ( We could maybe just name a duplicate node "Node (1)" automatically and add a Version to "Node"?) {4ce6b71d-5ee7-436a-9733-1fcf03b878cd semantic="e1a5949280bf48bca5d4d43a6f46344d"}

# Delete
