---
knowstr_doc_id: doc-attrs
editing: |
  Edit text freely. Never modify <!-- id:... --> comments.
  Never add <!-- id:... --> to new items. knowstr save will reject invented IDs.
  Markers: (!) relevant (?) maybe (~) little relevant (x) not relevant (+) confirms (-) contra. Combine: (-!) contra+relevant (-~) contra+little relevant
  Save changes with: knowstr save
---

# Houses <!-- id:u1 basedOn="a1" snapshot="snap_sha256_1111111111111111111111111111111111111111111111111111111111111111" -->

- Brick house <!-- id:u2 basedOn="a2" snapshot="snap_sha256_2222222222222222222222222222222222222222222222222222222222222222" -->
- Wooden house <!-- id:u3 basedOn="a3" -->
- Straw house <!-- id:u4 snapshot="garbage" -->
- Unknown attrs are preserved <!-- id:u5 knowstr_vote_id="v1" -->
- Multiple unknown attrs <!-- id:u6 basedOn="a6" knowstr_vote_id="v2" custom="x y" -->
