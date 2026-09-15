# Annotation rollback correction

Status: Fixed and frozen for independent rereview. Three files changed from the initial 16-file submission; original evidence remains preserved.

Main independently reproduced both review findings with the unchanged disabled diagnostic at 09:10:15: two tests passed assertions demonstrating the defects. The previous generic property inverse could overwrite a concurrent edit after a stale-preimage rejection and could claim restoration despite an ignored host setter.

The annotation writer now retains private WeakMap outcomes for its actual successful result or thrown error. Each outcome records the node identity, exact immediate pre-write snapshot and observed post-write state. Nothing is added to public mutation results or caller arguments. Failures before attempting the write have no outcome and no annotation effect to undo.

The specialized batch inverse uses these actual outcomes. A preflight rejection leaves concurrent annotations untouched. A real write is restored only when the current state still equals its observed postimage; a later different value yields an explicit rollback conflict. Restoration is read back and compared with the immediate preimage. Missing/unreadable nodes, unknown postimages, unverified successful results or ignored restoration cannot be reported as clean rollback. A setter that changes the value and then throws is handled through its retained error outcome. Repeated writes unwind through their actual intermediate preimages rather than one shared initial snapshot.

The generic batch interface passes the failing handler's error as an optional inverse argument. Existing inverses ignore this new optional argument; their behavior was not otherwise changed. Failed annotation restoration propagates through the existing BATCH_PARTIAL_CHANGE reporting. Original currentness and owner/operation authority remain unchanged. This is optimistic property comparison under the existing service execution model, not an atomic transaction or an ABA guarantee.

## Validation

- Main diagnostic reproduction: 2 cases passed, 524 ms, before correction.
- Final six-file annotation/read/batch/policy suite: 74 tests passed, 4.08 seconds, September 15 at 09:12:53. This includes five new regressions for stale preimage/concurrent edit preservation, ignored rollback, later concurrent edit conflict, two successive annotation writes and a mutating-then-throwing setter.
- Plugin `vue-tsc --noEmit -p packages/plugin/tsconfig.json`: passed.
- Three changed-file lint/format: passed.

All validation uses the native separate working copy and actual plugin handler/batch implementations with controlled Figma object fixtures. No live Figma document, browser, daemon, dependency, main source, Git index, commit or push was changed. The final full 16-path manifest retains original main preimages; the three-path fix manifest also records each pre-fix hash. Generated contracts and higher-level conversion remain later integration work.
