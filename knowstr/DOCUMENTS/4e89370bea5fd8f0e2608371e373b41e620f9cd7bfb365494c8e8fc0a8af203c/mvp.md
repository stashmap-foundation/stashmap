<!-- ks:root=c111d4d6-fe3c-4f73-8a95-d43ede243bcd sourceAuthor=4e89370bea5fd8f0e2608371e373b41e620f9cd7bfb365494c8e8fc0a8af203c sourceRoot=4e89370bea5fd8f0e2608371e373b41e620f9cd7bfb365494c8e8fc0a8af203c_c111d4d6-fe3c-4f73-8a95-d43ede243bcd sourceRelation=4e89370bea5fd8f0e2608371e373b41e620f9cd7bfb365494c8e8fc0a8af203c_c111d4d6-fe3c-4f73-8a95-d43ede243bcd -->
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

# MVP {c111d4d6-fe3c-4f73-8a95-d43ede243bcd context="e84eea0dbf36b09e245f6d434a4e2169"}
- Resolve ~Versions when creating Incoming References, so the incoming references are complete! {308dee58-f5dc-4c15-b357-b3564d02b0c5}
- Collect References at node query level {f58ddb31-6f5f-4185-b169-2755eb8b543c}
- Resolve ~Versions when looking for incoming references and suggestions {6f331d7a-77c3-4907-92b6-e6e393abe9c6 .not_relevant}
- Shall we not show suggestions if they occur anywhere in the visible tree? {84c150b7-203a-4e34-9c26-efd9a4eefbfe}
- When Uploading multiple Markdowns, don't create a markdown container containing the uploads. Create a container containing Links to the uploads! {977e13df-c43a-4422-b647-9da519ce17d4}
  - Same for Paste many nodes {71e9ab3d-3644-44d9-ab67-734315c4e25e}
  - Don't Upload Markdown twice {a3a810e7-00b2-4d0d-a285-04969a2bdd12}
- Delete Stuff {b68f391c-e985-4bf6-9b10-1d57a848ae13 .not_relevant basedOn="8cab35328084b1e19aa00651f310e109da189d699f97ac0bc501061bf6913b1c_eb05f507-48cd-4943-9829-5f2fb530503a"}
  - Pressing "X" again to remove relation is inconsistent with other buttons and leads to actual deletion, when i want to make a relation "contains" again. {513f54af-0d64-42c9-badd-cb2187c15b34}
  - Delete with "delete" Remove with "X" ? {47e8cc16-62c2-47f8-aa80-b080030ad169}
  - Delete Nodes is unused code {2b9de69c-271b-4249-9eef-f41096fc64cd}
  - X should untoggle "not relevant", remove from list with Backspace {7d0a19b3-32d6-4065-8dff-dbd0c3d233b7 basedOn="8cab35328084b1e19aa00651f310e109da189d699f97ac0bc501061bf6913b1c_ca594cb7-8b47-4e80-8215-2320df1a2077"}
    - Requires {99fb61c8-9a19-42b2-a361-a5df291753c6 .not_relevant basedOn="8cab35328084b1e19aa00651f310e109da189d699f97ac0bc501061bf6913b1c_9321056d-8b1e-4d1b-ae86-62f0daafc0f4"}
- detect outgoing references (cref:<list>:<node> and cref:<list> ) as incoming references {9203efcd-ab2d-478c-a3be-332a3c8e613a .not_relevant}
- Fix: Nodes which are IN ~Versions dont have incoming references when in search {03d77394-bb11-4404-9b43-5dabb6fc28ae .not_relevant basedOn="8cab35328084b1e19aa00651f310e109da189d699f97ac0bc501061bf6913b1c_e9a0718e-7b60-4c30-9134-55d5b1332478"}
  - Search: "Schicht" with current data set {cedcaff1-218b-4bd1-a78a-f5a8c6887d65}
- [Knowstr / MVP](#8cab35328084b1e19aa00651f310e109da189d699f97ac0bc501061bf6913b1c_b5945cb3-b40f-477e-906a-f141d1df41df) {.not_relevant}

# Delete
