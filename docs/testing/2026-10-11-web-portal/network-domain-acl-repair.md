# Actual domain mutation failure and Windows ACL repair

Dates: October 11 and 12, 2026, Asia/Seoul. This work follows the [repository instructions](../../../AGENTS.md), [canonical analysis](../../service-analysis.md), and [service function review](service-functions-review.md). It was authored in managed `4d3e/service`, synchronized from the exact native baseline before editing. The coordinator retains main/native integration, build, provenance and production process ownership.

## Actual failure

The coordinator ran the full function UI against a distinct, explicitly owned daemon on port 3056 and portal on 4312, reusing the retained visible Chrome tab. The actual receipt at `.worktrees/_cache/portal-functions-native-20261011/evidence/all-functions/2026-10-11T14-23-45-515Z-08f0fd69-e1c0-4a67-a729-3d4236ff71f4/result.json` records all **128 tool plus 58 feature entries** reachable and previewed. The requested safe read functions completed, and the official MCP probe truthfully returned `FIGMA_MCP_AUTH_REQUIRED`, with no full-capture acceptance.

The explicitly confirmed `network.add` for the previously absent `portal-acceptance.example.com` failed with `REMOTE_DOMAIN_CONFIG_INVALID`. Job `6a6ae48f-717b-4f5b-a680-0e3d04bc4fef` remains `unknown`, with composite execution proof and no retained operation IDs. The original/current domain registry was observed empty. Neither that snapshot nor the runner's `restored:true` field proves the original operation's terminal effect. The latter field only reflects observed absence in this failed attempt. **No original job status, fence, daemon state or domain registry was changed by this reviewer.**

## Root cause and genuine reproduction

`RemoteDomainConfigStore.commit` created a new temporary file with mode `0600`, wrote it, then called `verifyRetainedIdentity`, which invokes the real permission authority. On Windows, the mode argument does not create a protected, explicit DACL. The temporary inherited its parent permissions, but `createStatePermissions` correctly rejects unprotected inheritance and inherited ACEs. The store secured the network directory but never secured the newly created file. Its existing Windows unit adapter intentionally bypassed real ACL enforcement, so the ordinary store fixtures missed this integration defect.

A private regression used a new owned temporary product state and the **actual Windows permission authority**, without any daemon or UI operation. It reproduced the failure at **23:32:32 KST**:

- Outer error: `REMOTE_DOMAIN_CONFIG_INVALID`, "retained remote domain path cannot be verified".
- Cause: `STATE_ACL_INSECURE`, "state DACL inheritance is not protected".
- Authorization callback: 1; prepared-generation hook: 0; owned cleanup hook: 1; remaining network files: none.

The original failed test receipt remains managed `.cache/network-acl-review-red.json`. The detailed cause above was read from `.cache/network-acl-review-evidence.json` during that run; the scratch snapshot was subsequently replaced by the first green fixture run, so this report preserves the observed error chain and counters. The controlled fixture's failure stage does not retroactively create a missing original receipt for the real unknown job. The root cause is permission preparation, not the FQDN or actor schema.

## Repair and replacement-race protection

The store now retains the exclusively created file's original handle and physical identity, verifies its logical/capability paths and retained directory authority, and secures it **before writing any bytes**. On Unix, the mode is applied through the original descriptor. On Windows, a native lease pins the exact regular file before path-based ACL operations; the lease identity must match the original handle, and physical/permission identities are checked again around securing. The temporary-file lease is released before the existing publication rename. Existing checksums, audit format, nonce order, prepared/committed boundaries and unknown-outcome classification remain intact.

An initial attempt to reuse the existing metadata-only native lease revealed a second defect: `CreateFileW` with desired access zero did not prevent another process renaming a regular file, even though delete sharing was omitted. The new adversarial test genuinely failed. An independent new-file probe confirmed a read handle with read/write sharing rejects that same Node rename with `EBUSY`.

With the coordinator's explicit expanded ownership, `atomic-file.ts` now preserves the old directory path and reopens **regular files only** with `GENERIC_READ` and the same read/write sharing, without delete sharing. Both native handles' volume/file identities must agree before the lease is returned. If a replacement wins before securing, no ACL grant is applied to it and neither foreign data nor the displaced original is deleted. If replacement is attempted during the ACL phase, the Windows read lease blocks the rename. Permission rejection before publication cleans only a still-owned empty temporary. Later recovery/rename/cleanup race checks remain active.

The preexisting external-swap test now distinguishes a blocked swap with safe cleanup from a successful swap with both inodes retained. It still requires the operation to fail and verifies the correct preserved files; the change does not waive a replacement race.

## Verification

The real permission fixture passed after the fix. Persistent tests additionally verify real-platform add, reopen and remove; protected permissions on the published state; zero temporary bytes at Windows ACL admission; replacement before ACL; replacement during ACL; and cleanup of a still-owned empty file on permission failure.

The final related command began at **23:52:30 KST** and completed in 105.81 seconds: **152 passed, zero failed, two existing skips**, across six files:

- Remote-domain store: 46 passed; the existing Unix-mode-widening case is skipped on Windows.
- Windows lease broker: 40 passed; the existing opt-in 1,000-lease soak was not enabled.
- Atomic-file base/remediation: 23 plus 13 passed.
- Native module fence: 28 passed.
- Preview lease/fence integration: 2 passed, including rejection of altered scripts/flags/executables and acceptance of the exact current encoded helper on a Korean directory.

The machine-readable receipt is managed `.cache/network-acl-final-related.json`. MCP TypeScript, scoped lint and formatting passed. No dependencies were installed, no browser was opened, and no running service was restarted. The private fixture directories are separate owned files under the same Windows owner, not an OS sandbox.

## Exact source and artifact-authority impact

| Owned path relative to `service/` | Frozen SHA-256 |
| --- | --- |
| `packages/mcp/src/network/remote-domain-config-store.ts` | `46dbb3f7115e0c0bef7eab25812fe602e88dab5a5861b31fe9fa2f7f636254a7` |
| `packages/mcp/test/network/remote-domain-config.test.ts` | `f5bca1acfc559b2078ecba105335f895e6e9220ee5ecf5a787dc266f8a357799` |
| `packages/mcp/src/fs/atomic-file.ts` | `f5f25f079c4c3dc823c32069164d26a1b55fb4d4f8712ea85b17096b1e893a70` |

Native baseline hashes remained unchanged after authoring: store `e966c34360ad4ced9625302a349252155d26714833f7f42b6423f319e26e0b99`; atomic-file `b721c00872f6a5ce6579d1cb8e573e0fef7757cfc89770d80d2af0103bc394d4`. The shared real permission authority was unchanged at `60e1a218a82a9efa012c1b3b009cfa6ce161749d75ae29d505296f59a7e3df93`.

The encoded PowerShell helper bytes changed. `native-artifacts.ts` obtains the exact invocation from `windowsDirectoryLeaseInvocation` and includes its arguments in `artifactAuthority.directoryLease`; the native module fence compares those exact approved arguments. No fence code or allowlist was weakened. **Previously prepared profiles bind the old helper arguments and need fresh preparation/authority after integration.** The exact-invocation acceptance and altered-invocation rejection tests passed on the new helper.

Independent adversarial review of the three frozen files was requested. The coordinator will build and validate the fixed write in a **different fresh owned QA state**, preserving the original unknown job and its state. That future actual UI mutation is not yet claimed here. A new successful isolated test must not be presented as resolution or replay of the earlier unknown operation.

## October 12 independent review closure

The independent reviewer reran the six related suites with **152 passed, zero failed and the same two existing skips**. Separate direct native probes confirmed that the new regular-file read lease denies file rename, permits writes through the original held handle, and permits rename after release while preserving identity. In the actual ACL-shaped scenario, the original ordinary file handle plus the read lease also blocked renaming the parent network directory during the grant window. No further actionable scoped issue was established.

A separate probe showed that the unchanged **metadata-only directory lease alone is not a standalone no-rename guarantee** on this host. This repair does not claim otherwise or silently change directory behavior. The newly created file's read lease provides the relevant ACL-target protection; directory identities are additionally verified before and after. That distinction is retained as a filesystem protection limit, not hidden by the positive domain tests. Main/native integration and actual fresh-state mutation acceptance remain coordinator-owned.
