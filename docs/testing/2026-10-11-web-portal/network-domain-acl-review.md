# Independent Windows domain-store ACL review

Date: October 11–12, 2026, Asia/Seoul.

Disposition: the three frozen repair files are clear for the parent's integration and fresh owned QA rerun. The original unresolved production job remains unresolved. This review changed no implementation, production state, nonce, registry or running service.

## Scope and baseline

Read [the implementation record](network-domain-acl-repair.md), [canonical analysis](../../service-analysis.md) and [repository instructions](../../../AGENTS.md) before reusing this result. The parent requested independent adversarial review of the new-file ACL preparation and the native lease helper. Tests ran in managed `4d3e/service` with existing native tools and new owned Windows temporary paths. The prior whole-source failure and real failed network job are preserved in the implementation record.

Exact hashes verified after independent execution:

| File | SHA-256 |
| --- | --- |
| `packages/mcp/src/network/remote-domain-config-store.ts` | `46dbb3f7115e0c0bef7eab25812fe602e88dab5a5861b31fe9fa2f7f636254a7` |
| `packages/mcp/test/network/remote-domain-config.test.ts` | `f5bca1acfc559b2078ecba105335f895e6e9220ee5ecf5a787dc266f8a357799` |
| `packages/mcp/src/fs/atomic-file.ts` | `f5f25f079c4c3dc823c32069164d26a1b55fb4d4f8712ea85b17096b1e893a70` |

## Established protections

The store retains the exclusively created file's original handle and physical identity. It checks the descriptor, logical path, capability path and directory authority before permission changes. On Windows, the new regular-file lease must match the original volume/file identity. The permission authority then secures the empty file, with subsequent physical and protected-permission checks against the original retained identity. Payload bytes are written only afterward. The lease is released before the existing publication rename, while subsequent identity/checksum and outcome checks remain in place.

The helper first opens its existing metadata handle. For a regular file it additionally opens a `GENERIC_READ` handle with read/write sharing and no delete sharing, compares both identities, and returns only the guarded handle. A mismatch or failed reopen disposes acquired handles and rejects. Directory handling remains unchanged. The diff does not alter authorization order, nonce consumption, generation/checksum calculation, commit boundaries or unknown-outcome handling.

The six existing/expanded related suites independently passed **152 cases, zero failed, two existing skips**. The skipped cases are the Unix-mode-widening case on Windows and the opt-in 1,000-lease soak. They are not two operating-system skips. Receipt: managed `packages/mcp/.cache/network-acl-independent-related.json`.

This run includes real Windows permission-authority add/reopen/remove, empty-file permission admission, replacement attempts before and during ACL work, cleanup refusal for foreign identity, ordinary atomic publication, lease-broker behavior, and native artifact/module-fence checks. The command used the existing `.cache/figma-settings-mcp-vitest.mjs` source-alias configuration and the exact six files named in the implementation record. No dependencies were installed.

## Additional native adversarial probes

The reviewer independently used the actual helper on owned Windows files:

1. A regular file could not be renamed while its lease was held. The original retained file handle could still write and sync. After releasing the lease, rename succeeded and device, inode and creation-time identity matched the original handle.
2. With the original ordinary file handle and its new lease held, renaming the containing network directory was also denied. This is the relevant ancestor-rename window for path-based ACL operations; the target cannot be redirected by moving its parent during that phase.
3. The unchanged metadata-only directory lease is **not itself a physical no-rename guarantee** on this Windows host. A directory rename can succeed, and the public retained-directory authority's explicit identity verification then rejects the moved path. The repair does not change that pre-existing behavior.

The initial private directory probe incorrectly expected physical denial from the metadata-only lease and failed; a second probe confirmed the same with retained-directory authority. Those results remain in `packages/mcp/.cache/network-lease-independent.json` and `network-lease-independent-final.json`. They were reported immediately instead of being silently converted into a pass. The separate exact ACL-shaped ancestor probe passed in `network-lease-parent-independent.json`. The final three-case probe records the actual directory identity-detection behavior, with **3/3 passed** in `network-lease-independent-observed.json`.

The directory observation does not expose a replacement grant in this new ACL path: the actual ordinary-file lease blocks the ancestor rename before the path-based grant. No broader directory-lock rewrite was authorized or performed. The evidence must not be restated as a blanket physical pinning claim for metadata-only directory handles.

## Integration limits

Changing the encoded helper changes the approved native invocation bytes. Existing prepared validation profiles that bind the old helper require fresh preparation; the unchanged module fence correctly compares exact arguments. Fixture success does not update a profile or resolve the old unknown network job.

No further actionable defect was established within this repair's scope. The parent must integrate the exact three files, regenerate source authority, rerun current-source gates and execute a new explicitly approved network operation in a fresh owned QA state. A current empty registry or a later successful mutation cannot supply missing terminal evidence for the original unresolved composite job.
