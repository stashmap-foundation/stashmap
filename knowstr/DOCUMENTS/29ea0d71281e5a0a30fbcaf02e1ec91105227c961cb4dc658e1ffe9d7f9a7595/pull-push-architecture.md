<!-- ks:root=3dbac382-12f7-4c90-a2d6-e94a853f56b4 sourceAuthor=29ea0d71281e5a0a30fbcaf02e1ec91105227c961cb4dc658e1ffe9d7f9a7595 sourceRoot=29ea0d71281e5a0a30fbcaf02e1ec91105227c961cb4dc658e1ffe9d7f9a7595_3dbac382-12f7-4c90-a2d6-e94a853f56b4 sourceRelation=29ea0d71281e5a0a30fbcaf02e1ec91105227c961cb4dc658e1ffe9d7f9a7595_3dbac382-12f7-4c90-a2d6-e94a853f56b4 -->
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

# Pull/Push Architecture {3dbac382-12f7-4c90-a2d6-e94a853f56b4}
- Filesystem is the source of truth, no manifest or sync-state file {51925f14-2b1b-420d-9b07-3aa3bdbb1f44}
- Three-way comparison: relay state vs baseline vs workspace {066d431d-fe88-4947-9eba-cc4d27efba36}
- Baselines keyed by dTag for stable identity {e419b387-9b99-41ab-b377-571d6ee9b39d}
- Workspace files named by title for human readability {d96d6d30-c4cc-4ed1-bb15-941e8300bdaf}
- Change detection uses content comparison {289516e3-ebbe-4ac7-a545-8cbd58fbec9e}
- Full pull every time, no incremental state {bd0f8800-5916-4f48-877c-77d61ab15d3d}
  - Pull {8fdf01ab-3698-406a-a2bb-a92c0d5e329a}
    - Query relays for contacts, derive author list {3f1c8192-178b-411a-ad27-fc3958298937}
    - Query relays for all documents and deletes per author {1ec86f4b-27e8-4413-a4ae-4be246d4ef24}
    - Compare each event against baseline {651e4d89-72b6-46be-ae92-8e019de9d3f8}
      - No baseline means new document, write workspace and baseline {9e3384c0-053f-4c7c-a1b1-75de51fc9ebb}
      - Baseline matches relay means skip {d2325c2b-eb9a-49a3-9ae7-4bfa0e2824b0}
      - Baseline differs and workspace not locally edited means update both {7312a460-635c-42fd-8706-d5e50c7455c3}
      - Baseline differs and workspace locally edited means skip to preserve edits {dc80da59-8a18-4201-a019-4e22b79a5303}
    - Delete events remove baseline and workspace unless locally edited {63f3b44e-17df-4177-b8eb-a87ae60bc25c}
    - Remove author directories not in contact list {721c8ec4-d108-441a-8b03-af576153e80a}
  - Push {556d67b8-2d95-42e2-b409-899b3e4f7a79}
    - Scan DOCUMENTS for markdown files {8727fb13-2a98-4799-89d6-74d56edb9ab1}
    - Extract dTag from editing header {6054c8d6-e103-4280-8355-51c12da99860}
    - Compare against baseline {b333925b-8721-4bfa-af03-1a67756fe53f}
      - No baseline means new document, validate no UUID markers exist {cff5af8d-1747-4ac5-af8f-50f76f392786}
      - Baseline differs means edited, validate marker integrity {4c0e8d54-4345-4c09-ab74-753acfe22a78}
    - Build and publish Nostr events {6d0b7110-dd47-4b31-bf73-cc1c9b33217d}
    - Update baseline on successful publish {6e5f37fb-ddab-4bef-955c-d5711c30f8ce}
  - Filesystem layout {52bb806c-5615-4fe7-ad38-f9f4c42c1703}
    - DOCUMENTS/{author}/{title}.md is the human-readable editable file {497b56cc-29dd-4eae-81ba-7cee27f04bb0}
    - .knowstr/base/{author}/{dTag}.md is the stable system-managed baseline {e75cb472-fd57-45b5-b216-a36d92dad2c8}
    - .knowstr/profile.json holds pubkey, relays, and nsec_file path {7ade5dab-44ac-483f-83b3-c9edfaca3a1b}

# Delete
