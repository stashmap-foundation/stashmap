<!-- ks:root=b229d79a-447c-43b8-af3d-d89ccaec4846 sourceAuthor=4e89370bea5fd8f0e2608371e373b41e620f9cd7bfb365494c8e8fc0a8af203c sourceRoot=4e89370bea5fd8f0e2608371e373b41e620f9cd7bfb365494c8e8fc0a8af203c_b229d79a-447c-43b8-af3d-d89ccaec4846 sourceRelation=4e89370bea5fd8f0e2608371e373b41e620f9cd7bfb365494c8e8fc0a8af203c_b229d79a-447c-43b8-af3d-d89ccaec4846 -->
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

# Done {b229d79a-447c-43b8-af3d-d89ccaec4846 semantic="11a6767d5674c7e45f7e00dc52576227"}
- Fix: Cap View Entries at ~200 to limit size of event {8d752d4d-329b-4644-9c24-0a0f83eca469 semantic="9d4a270bc217818f033625d766bfd0a2"}
- detect outgoing references (cref:<list>:<node> and cref:<list> ) as incoming references {eae329c2-c9a0-449c-973c-3fd34184412d semantic="5e6101150f2c83bfe438eab37f1bd92c"}
- Delete Stuff {d4299802-0422-4eb1-91bf-0fba5ba77f0a semantic="47f85570abaa5f92b9c01bf4a5d6ece0"}
  - Pressing "X" again to remove relation is inconsistent with other buttons and leads to actual deletion, when i want to make a relation "contains" again. {f7489a09-3048-4e61-a7b7-f4ae8f557f72 semantic="509a9443cd4e0e7f983f88a9bba1ceb3"}
  - Delete with "delete" Remove with "X" ? {5851c068-0c23-4a9b-8b7d-48ffa4633048 semantic="12cf4d49d254fecda1dd0c2016f5483f"}
  - Delete Nodes is unused code {dec5a32a-d541-42c0-86dc-f309666ed550 semantic="95870a243c97d876833d1801dd7ac866"}
  - X should untoggle "not relevant", remove from list with Backspace {ca594cb7-8b47-4e80-8215-2320df1a2077 semantic="1b3f58ff673f8117c735131bacd47777" basedOn="4e89370bea5fd8f0e2608371e373b41e620f9cd7bfb365494c8e8fc0a8af203c_1be0fe7e-3758-4a0f-8ea9-2e5f28e07e3d"}
    - Requires {27049afc-5c09-450c-848e-af26adc89b11 semantic="143f0330d2de85b96398c5d349eccda0" .not_relevant}
- Fix: Font of readonly (needs Fork) content is too faint {34e3d9e8-d9e2-499d-acf9-f47969eda61a semantic="da4e1fe7f2c8710d0ff2d67173102ed4"}
- Fix: Make fork panel same color as inline readonly {aaea240a-31a5-4bf3-99db-ca4a380c958b semantic="b7608c98e0791656d2b7f6acff96d424"}
- Fix: When I declare a list as "not relevant" I don't want to see suggestions from that list {cc7875b3-09c4-4b31-b34d-64c2541b4278 semantic="76d144fa31158c231ccb3aed3fbdfba6"}
  - First write a test to proof that this works {08ac6c28-c432-4b36-80e2-9f9c0ee7fd83 semantic="1c1c65ebf4e2583e9d9d59244f01edc4"}
- Back Button should work {548601ba-75a1-4edf-b98e-302d112e348b semantic="62675a1ab85fac2618c9487e14bcd3c3" .little_relevant}
- When removing something, delete everything below as well? {016ba1d7-e361-4e4b-bf41-7d6dc1acb6f5 semantic="ea2bf9df59544b650c5485e996eb2d8d" .little_relevant}
- Fix: Back button is not really a back button, it just brings you one breadcrumb up {34d3a6d5-3f16-4a3d-9ad1-ed5b3e162c80 semantic="4e65af4ca102671cf8d6cde131b2502c" .little_relevant}
- Change Icons {97920622-0c67-4901-8671-ef551b418b4c semantic="11cf95018751b64caa3e520653624ef8" .little_relevant}
- Fix: Rework broken links {b58327f0-3e9d-4ddb-9aae-3e74b936653b semantic="2a2b7da591ad6b375b5febe4296bc130" .little_relevant}
- Fix: Constantly Resetting View settings {b69b5dde-899b-4763-8119-22946f4b9217 semantic="7fd1a5de8873ae78a048249d4bb41c72" .little_relevant}
- Fix: Menu dialogues look terrible {82a8b6eb-651e-4ba5-aaae-841582ac3f31 semantic="697d99cb5d4b9343b4f651a873d38124" .not_relevant}
- Fix: Replace black button background with something solarized {2944f834-461e-4b31-b071-fc496fa58cf3 semantic="e5cffb7af9108b34ed398ad4bd6238c3" .not_relevant}
- Fix: Allow removal of not found node {1774d9f4-0747-495a-b53f-ad116670774d semantic="175ab104199c7748957fa993486f98b1" .not_relevant}
- Fix: Marking an incoming link as not relevant SHOULD NOT declare that link as "double linked" {22d604b2-5724-4e59-92d4-1f8bd0268c6e semantic="419a7d6cc27329e452014809fab676fc" .not_relevant}
- Fix: Don't show "Not relevant" links as "incoming references" {8eac5025-00b7-4ee7-9975-bae52580100b semantic="9e1357536b887609737096cc738be38b" .not_relevant}
- Fix: Move split screen and fullscreen Icon to right menu {2f3ebb65-b4bf-452f-837b-696391f6a69a semantic="db880c1e8cfb9844ecfeaa0a0bcc5b20" .not_relevant}
- Fix: Stop resetting view settings when panes change {21ecd208-94fa-4ad8-b21a-f15bdc89f817 semantic="ed8e2ebaf74c40cd1575815cbff62e8f" .not_relevant}
- Fix: Error Message when loading is wrong {fb2d2a31-3f01-4a91-b58f-bff4c003dc32 semantic="b65249714c2b5483f850dde4fac0b885" .not_relevant}
- Fix: Delete Text, so that node becomes empty should not leave back an empty node {908178d7-2b6a-49ad-9466-3346c5ff3b8f semantic="25cef77e5444b347f04c5743cc7abbb8" .not_relevant}
- Bring Markdown upload Back ( Test if it's created with two relations) {f5aba5e9-9614-4741-b976-9fbeeb1331b9 semantic="e0743b2f0a946fda97e4cfc72101dad3" .not_relevant}
- Fix: Empty Nodes have split pane and open in fullscreen buttons {3b656c28-5f53-4fe0-9a7b-a400f208ed39 semantic="1655376a838eac6f22031309d660c0eb" .not_relevant}
- FIx: Logut, still see old nodes and when i click on ~Logs, i see other users ~Logs as suggestions {559192fa-de09-42ce-9322-929886220e20 semantic="2dd7a0e20a285ba144c343412d3a3951" .not_relevant}
- Fix: Tab should work, no matter where the cursor position is {b2a57d66-1fee-43e3-92f7-919ddacb52ea semantic="133471f065c7aedefebd138943e76727" .not_relevant}
- Change Drag and Drop {9cb6d92a-d48d-451b-9182-2faeab592f37 semantic="9f499913871b1eef4591546f164b00df" .not_relevant}
  - Fix: Don't Deep Copy when dragging in same context {12c8c891-7da2-4a95-9fba-6fcd26e48ae6 semantic="3dd3157f2d0c4f7da1c6db8c5a54b0f4"}
  - Fix: Don't allow dragging a node into its own subtree ( or make a copy) {55714c23-ce12-4811-a0e1-5ed9234047ec semantic="760eb54d33247a9cb73e512e1428bf14"}
  - Fix: Cleanup after move {90ab1d90-5173-41c4-924e-495b83e57336 semantic="dbdd8744edbb517507e9f88a01759d71"}
  - Decide Indention {38ac3312-6564-4ad7-921f-0cda48951905 semantic="891a709217381cf1747104796eea685d"}
  - Fix: Cleanup after move (1) {cecea273-70fd-41ac-89f9-2922aae14359 semantic="c07025f7f27836a9345df3998e1ad50b" .not_relevant}
  - Fix: Don't Deep Copy when dragging in same context (1) {c9ef9704-5f1a-43a4-b4af-3f6d12941ae3 semantic="0f2241aee71344167caed87c78c93a25" .not_relevant}
  - Fix: Don't Deep Copy when dragging in same context (2) {2f3a6f05-4321-4a4d-bc29-8229fb1be1b0 semantic="60a385eea5fa2079bef641e8769a1bea" .not_relevant}
  - Fix: Don't Deep Copy when dragging in same context (3) {a24e515e-a477-4197-a4f4-1eec3ad01e14 semantic="91d10e83224d427698da54bb4babcb00" .not_relevant}
  - We need to change how drag and drop works, what we want is: {7a0a4183-5055-4155-8928-8b5d883439da semantic="696b9c45f81f3bfbe796f633acfb3961"}
  - Within pane it's always move {3dcbd3db-e4b7-4e73-87ce-95c9e78edb73 semantic="c3024a42d87267b338f8618cbc8a4f9c"}
  - Across panes, it's always copy ( with option to move with modifier key ) {b887a8c2-0bf1-4d13-ab97-5efd318be0b4 semantic="7dde4cb5e8d5f8eda807cf1b6e1fe4b7"}
  - But take Care: dnd a reference always creates a copy! Also when I press ALT+ to create a reference. {b20b5007-1920-434d-801e-6a4fa7b072c8 semantic="c1f2065899f71471f98a0d749fd707fc"}
  - We need a lot of tests for this, here are a few: {fa7802df-2381-49ec-ac59-7a9e11c3cb6d semantic="efcdd4a7f907b1e4ba92c55aed54f7d2"}
  - Same Pane: {1acf1520-1a94-49e3-a36f-35cffd5286e9 semantic="1c47a98e1acf635a0a3138bcfadf916b"}
  - Other Pane: {e0a2ed71-a5b0-49a0-9745-e559744749b4 semantic="cefd6a226ece21192888c647ccf4aec0"}
- Fix: We constantly show error messagess after a while on loading {f1f7ab39-a43c-47e6-9393-8970f6a358a4 semantic="6f28574fc6f7ce72515ffdf16c662ba2" .not_relevant}
- Allow accepting suggestions via argument selector {4a7c9fb4-a2e2-4867-910e-bc8276c4fc15 semantic="2cd04cf0885a96970f69dc2a1de6d97f" .not_relevant}
- Fix: inline Icons need to go into right menu {a1c01097-d502-40d4-b313-b161c4fbe052 semantic="9a8bcf4463a18b66dc3a3419904dd1de" .not_relevant}
- Fix: Relevance and Argument selector symbols are very different in style, especeially deselcted color {a419e8da-c3f0-47b4-a90b-3bc72bb02580 semantic="bc0219abfe85fcfa8d2c2adc59e3a388" .not_relevant}
- Fix: can't open link in anonymous browser: https://knowstr.com/r/4e89370bea5fd8f0e2608371e373b41e620f9cd7bfb365494c8e8fc0a8af203c_98926e73-b9d6-4b39-92a2-1ab17af7543b (or at least it's flaky) {ccfadf1b-5c0b-40dd-82f3-9eccdde6e4f3 semantic="0ba1e62a73427487d32e4fbd6002b84c" .not_relevant}
- Reference Counter is off {d1b36f39-5657-490a-8ea9-34118192a7ff semantic="4f4f781abd39db21512cee902611555e" .not_relevant}
- Fix: If I see something in browser tab A and then switch to browser tab B to type something, when i switch back to A all views collapse {fe62e948-e839-4d09-94e3-449907c9e59b semantic="92e5318193dbdc2d4a58075ae1dccccb"}

# Delete
