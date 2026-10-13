# Explicit stopped R4 continuation

Prepared October 14, 2026, Asia/Seoul. This directory carries exact reviewed code and its hash-bound freeze. It does not carry protected runtime state, authority receipts, credential values or raw classified link targets. Root owns approval; `official_oauth_backend_sol` is the only runtime/API/Chrome controller.

The selected service source remains `sha256:d722c32152149464c961c660622a95e3da603eb00f291e28b15c024507bcd87d`. The original R4 helper failed `INVENTORY_LINK_REFUSED` after the old processes stopped and before backup or new runtime startup. Its actual intent remains failed and immutable. The observed cause was 670 legitimate relative Windows directory symbolic links in one owned compiler workspace: 648 beneath `node_modules`, 22 beneath `source/node_modules`, with no outside or broken target. Ordinary inventory correctly refused them under its original no-link policy.

## Exact reviewed files

- [Freeze](continuation-freeze.json), SHA-256 `00b79b5ca1fd14f1a2510c32274ac3670b63e6877ad34aa24b9ccb1ffd8f1a16`.
- [Continuation](replacement-continuation.mjs), SHA-256 `f7e1fe2532976b3868c27ff6334bffc88f27d271e07f75055a0a59f6a9a3e5b7`.
- [Exact link inventory/copy](inventory-links.mjs), SHA-256 `1a5d31373c33a422a7a13a95b0ecd94c54bfcd23ed999d1afdf5e02eef33eeeb`.
- [Unchanged scoped gates](scoped-gates.mjs), SHA-256 `bdd7995867aca9f7d2457274ee4debdfa01218f1287d10d2be168c137142b558`.
- [Portable index](evidence-index.json), including hashes of the local-only original intent and classification proofs.
- [Independent review](../qa-r4-link-continuation-independent-20261014.md) and [implementation/failure analysis](../qa-r4-inventory-readonly-review-20261014.md).

The original unexecuted R1 freeze and exact primary bytes are preserved separately. The portable files here equal the separately prepared R2 bytes; copying them did not execute a mode or modify the actual original R4 helper/intent.

## Guarded sequence and limits

`preflight-stopped-only` validates the exact failed intent, old process/child and listener absence, untouched process identities, retained stopped bytes, published source/build/package closure, previously sealed current CLI grant and all 670 classified link identities. It hashes the full regular-file inventory under the 250,000-entry/120-second bound and emits a stdout summary before any writes. Root authorized only the sole controller's actual read-only preflight at this preparation point; its result must be reviewed separately.

`continue-stopped-once` is a separate one-use execution. It allocates a new intent and never replays the original preflight/stop or rewrites the failed intent. Every accepted link must appear in the exact authenticated local classification, match directory `SymbolicLink` type/attributes, device/inode, raw relative target hash and canonical target hash, and stay in the same owned compiler workspace. Unknown, outside, broken or changed links remain rejected. No traversal occurs through link nodes.

Backup copies and hashes ordinary files first, exclusively creates each destination and flushes the held destination file descriptor after verifying its named identity. The existing recursive private ACL verifier runs before symbolic links are added. It then creates the original raw relative directory symlink topology within the mapped copied workspace and compares the complete destination inventory and unchanged source inventory. Copied links have new identities; no filesystem-link byte identity is claimed. The existing reviewed start/postcheck code is reused only after these checks. Original grant/run deadlines, unknown outcomes and explicit nonconfirmation of browser cleanup remain preserved.

The owned synthetic Windows topology positive passed after correcting an initial fixture separator expectation. The failed positive alone reran. Earlier wrong-intent/policy negatives stayed closed, and a new classification-binding case passed after the independent review's type/metadata correction. The two production review corrections were per-file durable flush and actual consumption of classified link metadata. No old helper test cohort, full suite, whole pipeline, Source/browser workflow or actual runtime mode was executed by the author.

These files require the owner's existing protected R4 records at their exact local paths. A fresh clone cannot reconstruct or renew that authority from this directory. Actual backup completion, runtime startup, postchecks and frontend/source acceptance remain separate evidence. Read [AGENTS.md](../../../../AGENTS.md) and the independent review before any continuation; Root must approve the concrete actual preflight result before execution.
