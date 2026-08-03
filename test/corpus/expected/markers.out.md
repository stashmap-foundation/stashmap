---
knowstr_doc_id: doc-markers
editing: |
  Edit text freely. Never modify <!-- id:... --> comments.
  Never add <!-- id:... --> to new items. knowstr save will reject invented IDs.
  Markers: (!) relevant (?) maybe (~) little relevant (x) not relevant (+) confirms (-) contra. Combine: (-!) contra+relevant (-~) contra+little relevant
  Save changes with: knowstr save
---

# (!) Important heading <!-- id:u1 -->

(?) Maybe relevant paragraph. <!-- id:u2 -->

- (!) relevant row <!-- id:u3 -->
- (?) maybe relevant row <!-- id:u4 -->
- (~) little relevant row <!-- id:u5 -->
- (x) not relevant row <!-- id:u6 -->
- (+) confirming row <!-- id:u7 -->
- (-) contra row <!-- id:u8 -->
- (+!) confirming and relevant <!-- id:u9 -->
- (-~) contra and little relevant <!-- id:u10 -->
- plain row <!-- id:u11 -->
