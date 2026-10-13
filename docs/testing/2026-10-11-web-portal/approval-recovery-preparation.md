# Owned QA egress revocation: approval-only recovery preparation

Date: October 12, 2026 (Asia/Seoul). This preparation follows the latest [retained-tab execution record](retained-tab-live-qa.md), [canonical analysis](../../service-analysis.md), shared analysis policy and [repository instructions](../../../AGENTS.md). The coordinator owns the approval question, build binding and any later execution. **The helper has not been executed. No process was started, no public endpoint was called and no policy was changed by this worker.**

## Incident and intended action

The distinct owned QA instance under `.worktrees/_cache/portal-functions-repaired-20261012` temporarily allowed four model-data classes for two public diagnostic calls. Its subsequent public `egress.reset` failed with HTTP 500 / ECONNRESET. Portal job `acb94a6b-bca0-4759-8234-a0c48cffe46f` remains unknown. The coordinator stopped only QA daemon 36480 at 00:39:56, preserving portal 35756, Chrome 9932 and all original primary processes. That stopped execution environment has a persisted grant, not a verified revocation.

Read-only preparation confirmed the retained policy envelope contains config hash `sha256:264161ee751a8bbcdbbdb750312c46e9d642a5267b37c22e11761b47b46468db`, configured at `2026-10-11T15:35:51.141Z`, expiring at `2026-10-11T23:35:51.141Z` (08:35:51.141 KST on October 12). The exact policy-file byte hash is `sha256:bc8058c94de37fcf1bf33ef92d95b3152001c18f120a8dbcd8c90335c721531a`. No policy body, consent identifier, grant copy or authentication material was saved in this report or a separate recovery state.

The proposed owner-approved action is a **new, independent administrative revocation** of that exact QA grant. It temporarily starts only the owned QA daemon on 3057, executes public `egress.reset` once, confirms fail-closed state and stops only the child it created. It does not replay, inspect-to-resolve, cancel or rewrite the original unknown job. A later default policy is evidence of the new revocation only and cannot settle the original attempt.

Primary portal restart remains separately blocked/unapproved. This helper does not stop or restart primary portal 41368, primary daemon 41108, retained QA portal 35756, Chrome 9932, the separate 3056 instance or any source Figma session.

## Concrete helper and review binding

Prepared native private file:

`C:/2026_project/super-figma-pipline/.worktrees/baseline/service/.cache/revoke-qa-egress-approved-20261012.mjs`

Frozen corrected candidate SHA-256: **`f4e4ed71121cadd159f62d2ed35fee37752841ae0141a1b5ca014c395b5f62e7`**. This supersedes `3d13813e40aa395f3025017bc2fb6308e0c192cb33830db073c8ab295d372f8f` after the October 12 SOL continuation repaired the two recorded static findings. The coordinator's independent final review and manifest binding remain pending; this hash is not owner approval.

The helper requires a coordinator-created, separately hash-bound manifest after the reviewed DELETE repair is built. The manifest must contain the following metadata and a complete inventory of every regular file under both native `packages/mcp/dist` and `packages/cli/dist`:

```json
{
  "schema": "sfp.qa-egress-revocation-binding.v1",
  "nativeRoot": "C:/2026_project/super-figma-pipline/.worktrees/baseline/service",
  "stateRoot": "C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-functions-repaired-20261012/appdata/SuperFigmaPipeline",
  "oldJobId": "acb94a6b-bca0-4759-8234-a0c48cffe46f",
  "grantConfigHash": "sha256:264161ee751a8bbcdbbdb750312c46e9d642a5267b37c22e11761b47b46468db",
  "helperHash": "sha256:f4e4ed71121cadd159f62d2ed35fee37752841ae0141a1b5ca014c395b5f62e7",
  "deleteRepairReviewed": true,
  "nodeExecutableHash": "sha256:<coordinator binds the actual Node binary>",
  "buildIdentityHash": "sha256:<coordinator binds the reviewed build-info identity>",
  "artifacts": [
    { "path": "packages/mcp/dist/daemon-entry.mjs", "hash": "sha256:<actual file hash>" },
    { "path": "packages/cli/dist/library.mjs", "hash": "sha256:<actual file hash>" }
  ]
}
```

The example deliberately omits remaining artifact rows and uses invalid placeholders for unbound hashes. **It is not executable approval material.** The helper rejects an incomplete, duplicate, linked, changed or out-of-scope artifact closure, a different Node executable or a build-info identity mismatch. It rechecks the complete closure before the reset. It does not assume that a CLI-only change must alter the MCP build identity; actual reviewed bytes are bound independently.

The coordinator reported that the nonce-only DELETE repair was integrated and independently checked in 43 cases. The helper uses the compiled public CLI library so actual execution must bind the freshly built corrected client rather than a stale artifact. This worker did not rerun those transport tests or certify the new build. A whole pass is not required to prepare this file; the coordinator retains the appropriate source/build/review gate before execution.

Only after explicit owner approval and review of the final manifest, the concrete command is:

```powershell
# Working directory: .worktrees/baseline/service
node .cache/revoke-qa-egress-approved-20261012.mjs --owner-approved --binding <absolute-reviewed-manifest-path> --binding-hash sha256:<exact-reviewed-manifest-hash>
```

`--owner-approved` is an explicit execution guard, not cryptographic proof of owner permission. The coordinator must obtain the actual owner response before invoking the command. No preparation command automatically fills or asserts that approval.

## Preflight, single effect and cleanup

Before starting anything, the helper checks:

1. The exact native Windows working directory, self hash, Node binary and complete reviewed compiled artifact closure.
2. Canonical nonlinked QA/appdata/state/portal-state paths, the original runtime receipt and the recorded stop of only daemon 36480.
3. Exact policy-file bytes/config hash/expiry, with an unexpired grant. A changed or expired grant aborts preparation for execution without starting the daemon.
4. Read-only public `GET http://127.0.0.1:4313/api/service/jobs/acb94a6b-bca0-4759-8234-a0c48cffe46f`. The full immutable job core must match its persisted row, including unknown status, type/name, empty-argument hash, null workspace, no target, original timestamps, zero tool operations and original error code. If that endpoint is absent, unreadable, malformed or different, no daemon starts.
5. Port 3057 is free. An existing listener is neither reused nor stopped.

It then creates an exclusive, append-only private intent file `.cache/revoke-qa-egress-approved-20261012.intent.ndjson`. This consumes the helper's one-time use even if a subsequent startup or dispatch fails. The file contains safe hashes, stage/status and owned PID only. It is outside service state; it contains no credentials, raw grant, lease or nonce. A second invocation cannot overwrite it. Any later recovery requires a separate review and authorization rather than deleting the intent or retrying.

The new child runs only the fixed native `packages/mcp/dist/daemon-entry.mjs`, with its own exact QA `LOCALAPPDATA`, state root and port. A minimal Windows environment allowlist excludes inherited source-browser and official-MCP credential configuration. The caller temporarily pins its own `LOCALAPPDATA` too, because `createStatePermissions` derives its expected state root from that variable even when ControlClient has an explicit root. It restores the caller variable in final cleanup.

Startup/readiness is bounded, and child liveness is checked before and after every health observation, including successful health. Before reading credentials and again immediately before the one reset, the helper runs a fixed read-only Windows PowerShell `Get-NetTCPConnection` query for listening port 3057. The query is limited to five seconds and eight KiB of output. It rejects a missing, malformed, foreign or mixed-PID listener result; every observed listener must belong to the exact spawned child PID, and that child must still be alive before and after the query. It never adopts or terminates another listener. The fixed OS query is a transient observation subprocess, not another service daemon; it has not been executed during preparation.

The helper checks leader role, exact build identity, zero paired plugins and no requested Chrome connection. The authenticated ControlClient is fenced by the new generation's credential-continuity hash. Public egress status and exact policy-file bytes must still identify the pinned grant; the old public job must still match. No Chrome, design collection, tool invocation, model request or arbitrary administrative feature is dispatched.

One pre-dispatch intent is flushed, then `executeServiceFeature(client, 'egress.reset', {}, ...)` is called **exactly once**, with null workspace and no Figma target. The fixed adapter obtains the new administrative nonce and sends the corrected header-only DELETE. Both mutation requests retain the transport's no-retry behavior. The original portal unknown-write fence remains in place; this explicitly approved recovery uses the public administrative client without creating, altering or bypassing a new ordinary portal job.

The coordinator explicitly accepted the existing authenticated GET transport's single transient read retry and bounded readiness observations. This does not permit POST/DELETE replay. On a reset error or unconfirmed response, the helper records a new unconfirmed outcome, stops its daemon and does not retry.

Success requires the actual reset result and a subsequent authenticated status to identify the default fail-closed hash, `unknown-fail-closed`, empty data classes and null configured/expiry timestamps. The stored policy must also contain the default configuration, and the old public job core must remain unchanged/unknown. The helper does not directly delete or rewrite policy/job/state files. Daemon startup and the public reset legitimately write their own service authentication/audit/nonce/config state.

A 120-second watchdog and SIGINT/SIGTERM handling abort the recovery and terminate only its own daemon ChildProcess. They remain installed until final owned-stop attempts finish. TERM and KILL exceptions/false returns are independently guarded, with a bounded wait after each attempt. A throwing stop attempt cannot skip stream cleanup, caller environment restoration, the sanitized final receipt or intent-ledger close. Each resource operation is independently guarded; receipt/ledger failures remain failures. An unconfirmed daemon stop receives the explicit `OWNED_DAEMON_STOP_UNCONFIRMED` disposition. The helper emits sanitized final receipt metadata even on failure and never interprets kill-request acceptance alone as confirmed exit. There is no generic PID/name/port kill and no original-process restart. A process crash or external force-kill is not a Windows Job sandbox guarantee; this remains a same-owner native recovery, and the coordinator must preserve the private PID/intent evidence if closure is unconfirmed.

The QA state is reserved for this recovery, not ordinary concurrent testing. The public reset performs its own config CAS; it does not expose a caller-supplied original-grant hash. The helper therefore checks the exact grant immediately before dispatch, but does not claim an atomic exclusion of another same-owner external configuration action between that check and the public reset. No concurrent writer is authorized for this owned state.

## Actual preparation verification and remaining authority

This worker executed only filesystem/source inspection, sanitized metadata extraction and syntax parsing:

```powershell
# Parser only; does not evaluate the helper, import the CLI library, query an endpoint or spawn a child.
node --check .cache/revoke-qa-egress-approved-20261012.mjs
```

Syntax parsing passed. Earlier preparation hashes were superseded before review to add the exact caller `LOCALAPPDATA` binding and remove an unsupported assumption that the MCP identity must change for a CLI-only repair. The `3d13813e...` review then identified cleanup-exception and listener-ownership gaps. That reviewer was interrupted at the owner's request to continue with SOL; it did not independently certify the corrected helper. The final corrected hash above is the sole current review candidate.

The SOL continuation independently confirmed the starting helper hash, read the existing reports and reviewed the current native client source. Main HEAD remained `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with the substantial existing uncommitted integration work preserved. The coordinator's reported production/native source baseline was `sha256:34438b61c97077cbeed2fbfb3c1ce564ef5176ba3df4506f7d17d0de0874464c`; this worker did not recompute the full service fingerprint or rerun the active whole check. Only this ignored private helper and the two recovery reports were edited.

After the corrections, syntax parsing passed again and **26 isolated mocked checks passed, zero failed**. They evaluated only extracted stop/listener/final-cleanup code in a fresh JavaScript context, with mock ChildProcess, query callback, environment, ledger and receipt objects. They covered TERM/KILL throws and false returns, wait errors, foreign/mixed/absent/malformed listener results, dead-child rejection, restoration of present/absent caller `LOCALAPPDATA`, stream cleanup failures, receipt failures and ledger-close failures. The checks did not evaluate the helper's top level, import the CLI library, run the real Windows listener query, open a port, spawn a daemon, contact an endpoint, read credentials or mutate any service state. These are preparation failure-path checks, not an executed revocation or startup/cleanup acceptance.

No public-job reachability, startup, authentication, nonce issuance, reset response, persisted revocation or cleanup outcome has been executed by this worker. Independent static review, final build/manifest hash binding and the explicit owner response remain required before execution. The original grant remains persisted, its daemon remains stopped, and the original reset remains unknown at this preparation checkpoint.
