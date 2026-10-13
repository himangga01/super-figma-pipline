# R70 provenance preparation

Date: October 14, 2026, Asia/Seoul. Preparation only, with no helper mode execution, source/metadata mutation, build or Git staging. Current historical Main/native baseline is source a28; its scoped build and published report remain unchanged. Actual integration source is still pending from Root.

Prepared helpers are in `.worktrees/_cache/r70-provenance-preparation-20261014`. Their frozen manifest `frozen-helpers.json` hashes to `cc0c43b3ff020d8f83471561fae12fb4411e765b67d2cae059e468f71dcb3185`.

| Helper | SHA-256 |
| --- | --- |
| `reconcile-final-r70.mjs` | `1f3fe467ee61d2aee664c16dae869e01a11084bfd6a7a852344e2e3e8a89285a` |
| `run-final-r70.mjs` | `a6a846b9f724b6d774120e8ce5b0623503be4cc633045671a3248e0548f046a4` |
| `sync-final-r70.mjs` | `34291a6de898c84d16389b274ecf406b401614d0f0d0395f6a70cbaa7ecfaea6` |

The actual final R69 predecessor shadow `.worktrees/baseline/service/.cache/review-20261014-r69.index` was read and hashes to `a71abea0cb3fcfe70fc06a631f2bc6d255a4ffcec9a7813e67f57feeaf058008`. The new helper pins that predecessor and refuses reuse of its new R70 index or review record. R69 consumed helpers are not replayed.

This is a name/pin/reason adaptation of the reviewed R69 algorithm. The new reason is 407 characters and its nonempty/512-character check executes before effects. Strict config path/hash validation, exact Main/native source equality, owner index `ecc1808ab3e14fa2e8c233ae1fc1c91e0a33b5b2e383a7270f1bc3068997e675`, and `GIT_OPTIONAL_LOCKS=0` remain. The two intended candidate paths are `packages/mcp/src/portal/module-resolution.ts` and new `packages/mcp/test/portal/generated-route-alias-runtime.test.ts` from [the isolated guard record](generated-route-alias-runtime-guard-20261014.md). The final executable config must include actual pending paths relative to R69, including the existing authority-class and portal-package rows required by the reviewed algorithm, and actual integrated source/hash values. No future fingerprint has been invented.

Five provenance commands retain their reviewed order: update forks, stage three derived authorities in the shadow, write the change manifest, stage four authority/manifest files in the shadow, and verify. New logs/input/receipt names use R70. Metadata sync retains backups, byte checks and final Main/native fingerprint equality; its inherited plain-write behavior remains a reversible derived-metadata protection limit. It does not update the owner index.

All three helpers passed `node --check`. No actual provenance command, check suite, build, runtime or live acceptance ran. Root and the independent reviewer must approve the exact final config after runtime finalization and source integration before execution. New source evidence must be separated from the already closed a28 release.

## Actual post-integration config

Root reported runtime finalizer success and exact two-file Main/native integration. Read-only fingerprint checks observed both trees at `sha256:8d6b9c24ba0f0f2944082456f0db2fd5d8c5f152481d1d9def2865926d4b93be`; the owner index remained ECC. Read-only Git inspection with the actual final R69 shadow and `GIT_OPTIONAL_LOCKS=0` found exactly the resolver and new test pending. Existing R69 shadow bytes matched the predecessor pin above.

The executable config `.worktrees/_cache/r70-provenance-preparation-20261014/inputs-r70-source-8d6b-final-20261014.json` hashes to `776eb5885deeef63a5f728e2f725e15eb92fba8f160b0221d5679c66849c2962`. Its four exact rows are the existing authority-class record (`21692da126ade2ab0cde2588d3dcd232e2d5d11b80466f4c60a18e346fd00e88`), resolver (`3b96c00ef17fb0d74ca437be20fc291b73c145ec549d61727a77a698687a63c6`), new test (`f8b46a075c4e372542fb2675aafed661d65003777fb631cd083f3a6dd59c93a0`) and portal package (`ddb99eafe979d2319697f9bde91d01c4b3f4cf7f3e2a2baccfcb06ceff7767c8`). Preparation wrote only this new cache config. Actual reconciliation, provenance commands and sync remain Root-owned and require the final config read approval. Runtime and compiled disk artifacts remain on a28/0c4 at this preparation point.

## Authorized actual execution

Root read the exact config, approved the independently reviewed templates, and explicitly authorized one distinct R70 reconciliation, five-command run and six-file metadata sync. All approved helper/config hashes were checked before execution. Reconciliation exited zero and registered four pending paths. Each of the five commands exited zero, with actual run session 8065. The updater reported 290 changes and 178 forks; the final verified manifest reports 287 semantic changes and four derived authorities. These are different outputs and are preserved without conflation.

Metadata sync exited zero and verified equal final Main/native source `sha256:e96f37b95100645fcfbb8317683c655556219ef920d8c8adf85968914cb2b0f5`, with the owner index unchanged. [The actual portable sync receipt](final-scoped-r70-provenance-20261014.json) hashes to `06d2a01471a525c593050ee2e4bd4944c020d1dec6773b989b9ff99eaa505a0d`. Per-command actual logs and hashes are recorded in local-only `.worktrees/baseline/service/.cache/final-r70-provenance-commands.json`. The previous R69 shadow and receipts remain preserved. No failed step was replayed.

No functional test, whole check, package build, compiled artifact, runtime or live acceptance action ran during this metadata closure. The final e96 source has no new build/publication/deployment claim in this receipt; the earlier a28 release remains historical source-bound evidence. Root owns subsequent decisions and canonical report updates.

## Subsequent authorized owned-copy closure

Root separately authorized affected offline code/build closure in the existing isolated guard copy. Its six metadata files were copied from the exact sync receipt and hash-verified. The initial fingerprint comparison refused the additional owned `service/alias-review.config.mjs`; read-only path comparison identified that single extra file. Moving that closed-test configuration to the owned parent preserved its bytes and yielded the exact e96 source fingerprint using the read-only R70 shadow. Main/native source remained unchanged.

The owned offline provenance check passed once. The first generated-catalog check failed because the owned portal lacked dependency resolution; adding only its own portal dependency junction allowed the failed check to pass. No catalog bytes were rewritten. [The initial receipt](r70-owned-code-build-closure-20261014.json), SHA `42efdf3f94320d58d24266fe1d0e0b2bcb37f29be7e55e83a50831eaae061f01`, and [the corrected-check/build attempt](r70-owned-code-build-closure-r2-20261014.json), SHA `d6bab545e4f50b6df734c23cb99287c1328921068bdfa489d6280a560d2b1fd8`, preserve the failed setup and subsequent results. The owned verifier lacks a physical `.git` entry in its parent, so its optional parent-fork HEAD comparison is skipped by the normal verifier; this bounded offline result does not replace the already executed R70 shadow verification.

The affected MCP build bundled 16 files successfully but its package pack phase failed because pnpm was absent from PATH. That failed aggregate remains failed. Root authorized only component continuation: the existing reviewed `.worktrees/_cache/bin` shim was prepended with Corepack networking disabled, the same pnpm pack destination/ignore-scripts semantics were used, and publint received the resulting tarball through its actual API. Publint returned zero messages. The 16 compiled file hashes were checked before and after this continuation and remained unchanged; bundling and all passing checks were not repeated. Only then was `build-info.json` generated with the unchanged build-server epoch/identity formula.

[The component-resume receipt](r70-owned-mcp-component-resume-20261014.json), SHA `8abe94c572a0b4fbce78a751b8e4ce95d68a17de9e4d6fca3ac5ce528ea2db42`, binds the preserved compiled bytes, packed tarball and build-info bytes. Its owned MCP identity is `sha256:cf241705ac5ff3d6493bfaf25a3a5dc212d1724777247a6fb4a8042d924eb5a8`, with build ID `1791202532000`. This is an affected MCP component closure, not a full eight-command package release, archive/artifact acceptance, deployment or new scoped publication. Native QA DIST and running a28/0c4 processes were not modified. Types, functional cases, whole checks, Chrome and runtime actions remained closed or unexecuted.
