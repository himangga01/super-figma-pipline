# Static review of the one-time QA egress revocation helper

Date: October 12, 2026, Asia/Seoul.

Scope: **static inspection only**. The reviewer did not execute the helper, start or stop a process, query a live endpoint, read credentials, change policy or resolve a job. The production service remained frozen while the parent's whole check was active. This record follows [repository instructions](../../../AGENTS.md), [canonical analysis](../../service-analysis.md), [the DELETE repair](delete-nonce-transport-repair.md) and its independent review.

## Reviewed preparation

The helper is the private native file `.worktrees/baseline/service/.cache/revoke-qa-egress-approved-20261012.mjs`. The initially supplied hash `4eee0ba1...` was superseded before review by the author's corrected hash `3d13813e40aa395f3025017bc2fb6308e0c192cb33830db073c8ab295d372f8f`, which the reviewer read and verified. The correction temporarily binds the caller's `LOCALAPPDATA` to the same QA state authority used by its explicitly configured public client.

The intended action is a new, explicitly approved revocation of one exact grant in the stopped owned QA state. It is not a replay or resolution of original job `acb94a6b-bca0-4759-8234-a0c48cffe46f`. The parent will ask the owner for approval only after the concrete helper and build binding have been reviewed. An `--owner-approved` command-line flag is a procedural assertion and is not itself owner authorization.

The inspected preparation checks the Windows native working directory, helper bytes, Node executable hash, an exact complete CLI/MCP `dist` file list and hashes, the build identity, the QA/state paths, the specific persisted grant bytes/hash/expiry, the original runtime/stopped-daemon receipt, and the original public/persisted unknown job fields. A port-free preflight occurs before spawning. An exclusive intent ledger prevents silently rerunning the same helper after any consumed intent.

The mutation path contains one fixed `executeServiceFeature(client, 'egress.reset', {})` call, with no target or workspace and with unexpected tool invocation forbidden. The repaired public client never retries this mutation; ordinary bounded GET retry remains allowed. Afterward, the helper intends to check public and persisted fail-closed state plus the unchanged original unknown job. It drains child diagnostics rather than recording credential-bearing output and only calls process-stop methods on its own `ChildProcess` object.

## Requested corrections before approval

Two bounded static findings were sent to the author and parent:

1. Cleanup initially cleared the watchdog and removed signal handlers before unguarded child `kill` calls. A thrown kill/error event could skip later stream cleanup, environment restoration, the final receipt and ledger close. The requested correction is independently guarded owned-stop attempts with unconditional inner-finally resource restoration and an explicit stop-unconfirmed disposition when necessary.
2. A successful health result could skip the readiness loop's own-child checks. The preflight port-free check and later public build/state checks do not establish that the listener still belongs to the newly spawned child if another process wins the intervening port race. The requested correction is a fixed read-only check of port 3057's owning PID, equal to the recorded child PID, plus current child-liveness checks before the reset. No other process may be terminated or adopted.

These findings do not authorize execution or any production change. The final reviewed hash and disposition will be appended after the author freezes the private helper corrections. This static review cannot demonstrate that startup, the reset or cleanup has actually succeeded. Hash/path checks also do not create an operating-system sandbox or replace the required owner approval.

## SOL continuation and corrected candidate

The owner requested that the interrupted reviewer stop and the work continue with SOL. The successor first verified that the native helper still had hash `3d13813e40aa395f3025017bc2fb6308e0c192cb33830db073c8ab295d372f8f`; no partial reviewer edits were present. The earlier findings above remain historical review evidence. The successor implemented the corrections itself, so the following is an implementation and bounded preparation-verification record, not an independent approval of its own changes.

The frozen corrected candidate is **`f4e4ed71121cadd159f62d2ed35fee37752841ae0141a1b5ca014c395b5f62e7`** at the same private native path. The coordinator must independently review these bytes and bind the actual complete build/Node/manifest hashes before asking for owner approval. The [preparation record](approval-recovery-preparation.md) now uses only this current candidate in its illustrative manifest.

The correction for finding 1 adds a separate `stopOwnedDaemon` function that guards each owned TERM/KILL attempt and bounded wait. The watchdog and signal handlers remain installed through stop attempts. An inner `finally` independently attempts stream cleanup, caller `LOCALAPPDATA` restoration, the final safe receipt and ledger close. An unconfirmed exit becomes `OWNED_DAEMON_STOP_UNCONFIRMED`; final receipt metadata is also emitted on failure, and record/close errors cannot produce a clean success claim. The first intent append now occurs inside the same cleanup-protected execution scope. Only the recorded spawned daemon object is used for stop attempts.

The correction for finding 2 checks child liveness before and after each readiness observation, including successful health. A fixed read-only PowerShell query through `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` observes listening port 3057 before credentials and immediately before the single mutation. It has a five-second timeout, eight-KiB maximum output and no shell interpolation of dynamic values. The returned PID array must be nonempty and valid; every PID must equal the spawned child's PID. Child liveness is checked around the observation. A foreign listener is rejected without adoption, restart or termination. The observation cannot make process identity or grant checks atomic with a later public request, and it does not create an OS sandbox.

Baseline: main remained on `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with existing substantial uncommitted integration work. The coordinator reported native/main source `sha256:34438b61c97077cbeed2fbfb3c1ce564ef5176ba3df4506f7d17d0de0874464c` and active whole attempt `442c1de3-d50c-4b2b-97a8-5d303b71bfb1`. The successor checked the helper bytes and affected native client source, but did not rerun the full fingerprint, whole check or transport suite. No production service file, Git index, live runtime, port, state, policy or original unknown job was changed by this scope.

Verification executed in this continuation:

- `node --check .worktrees/baseline/service/.cache/revoke-qa-egress-approved-20261012.mjs`: passed; parser only.
- SHA-256 of that file: matched the corrected candidate above.
- Twenty-six isolated mocked checks: **26 passed, zero failed**. Only extracted stop/listener/final-cleanup code was evaluated. The checks mocked every ChildProcess, listener query, environment, receipt and ledger. They covered thrown/false TERM and KILL, wait errors, invalid/foreign/mixed listeners, dead child, present/absent caller environment restoration, throwing stream cleanup, failing receipt append, failing ledger close and simultaneous cleanup failures.

No real Windows listener query, child daemon, endpoint call, credential read, public mutation or policy write occurred. These checks establish bounded mocked error behavior only. The helper remains unexecuted; actual readiness, successful revocation, public/persisted fail-closed state and process closure remain unverified. Original job `acb94a6b-bca0-4759-8234-a0c48cffe46f` remains unknown. No new open product question is decided by this recovery preparation. The next action is the coordinator's independent final review and exact manifest binding, followed by a separate explicit owner decision; existing Chrome approval does not authorize this recovery.

## Coordinator's independent static closure and build binding

On October 12, after the current whole/artifact checks passed, the coordinator independently read the complete corrected helper and verified hash `f4e4ed71121cadd159f62d2ed35fee37752841ae0141a1b5ca014c395b5f62e7`. The fixed listener query contains no interpolated inputs, is bounded to five seconds/eight KiB, requires a nonempty integer PID array and compares every PID to the still-live spawned child. The same check runs before credential acquisition and immediately before the single fixed reset. Cleanup independently guards both stop attempts and retains watchdog/signal handling through them; its inner cleanup attempts environment restoration and final receipts even after stop/write failures. The two reproduced static findings are closed within this preparation scope. The coordinator did not execute the helper or either old mutation.

The exact build binding is the private native `.cache/qa-egress-revocation-binding-34438-20261012.json`, SHA-256 **`8533fb5e4eff1610e5f45430db30f2de03e5ea9f1d612662d6bdc340facde17d`**. It binds the reviewed helper, installed Node binary and all seventeen current MCP/CLI distribution files. Its source is `sha256:34438b61c97077cbeed2fbfb3c1ce564ef5176ba3df4506f7d17d0de0874464c`, whole attempt `442c1de3-d50c-4b2b-97a8-5d303b71bfb1`, with 5,283 passes and the separately passing artifact check. The daemon build identity is `sha256:6fa95132070fa1c4b3a55a356bd40ec237472333b2f3540eecb9e21ddf64df1e`.

This makes the proposed action concrete and reviewable, but supplies no owner approval and no executed revocation proof. Any artifact mismatch must stop the helper before startup. Keep the old state stopped until the owner expressly authorizes this new recovery or its grant expires. The current Chrome and active validation portal are outside the helper's permitted process/state scope.

## Executed owner-approved recovery, 01:32 KST

The coordinator presented the concrete one-time action and the repository's unknown-operation restriction to the owner. The owner's subsequent `허용` response approved this recovery separately from Chrome control. The exact bound helper above was then invoked once with its explicit approval flag and binding hash. It exited **zero**.

The exclusive receipt records intent at `2026-10-11T16:32:38.587Z`, owned daemon PID **37280**, the new fixed public reset intent at `16:32:44.193Z`, and confirmed public/persisted fail-closed state at `16:32:45.518Z`. The revoked grant hash was `264161ee...`; the new fail-closed config hash was `70e762f99890c9c1e8011ac3473cc1a908aecebb2a3356f6527e76fbf0062f5f`. Original job `acb94a6b-bca0-4759-8234-a0c48cffe46f` remained unknown and its retained core stayed unchanged.

The final receipt at `16:32:45.544Z` records `new-reset-confirmed-original-still-unknown`, the owned daemon stopped, and empty stop/cleanup error lists. A subsequent read-only OS check found no listener on port 3057. Chrome 9932 and current validation daemon/portal 42576/42792 remained running. The helper did not operate the original primary daemon or portal.

The private durable ledger is `.worktrees/baseline/service/.cache/revoke-qa-egress-approved-20261012.intent.ndjson`. Its exclusive intent is consumed: **do not rerun this helper**. This is proof of the newly approved revocation and its cleanup, not proof that the older reset succeeded or failed before dispatch. The old QA state retains its unknown-job fence and is not the active validation environment.
