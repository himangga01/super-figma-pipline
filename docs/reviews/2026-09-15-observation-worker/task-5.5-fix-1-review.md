# Task 5.5 main fix review

Verdict: Scoped PASS after correcting both independently reproduced findings. This is a task review, not either final whole-code review round or live Figma acceptance.

All 29 current source hashes and original main preimages matched the final manifest before the independent run. Main reviewed the source interaction/observation identities, actual prepared native command path, dedicated worker/channel, listener ownership, receipt consumption and both corrected boundaries.

R1 is corrected: authoritative temporal records reside in a private JSHandle-held closure, not a candidate-writable window property. The actual static-page injection now fails with INTERACTION_TEMPORAL_OBSERVATION_REQUIRED. Genuine visible motion retains independent samples and elapsed completion time; dissolve requires changed observed opacity. Handles and scheduled frames are disposed on both outcomes. This is bounded browser behavior verification, not an arbitrary same-account or browser-engine compromise isolation claim.

R2 is corrected: both pipe directions use the same fixed-capacity byte decoder and fatal UTF-8 conversion only after a complete frame. It preserves split Korean/emoji, rejects malformed UTF-8 and extra/truncated bytes, and bounds hello/configuration/receipt separately. The parent waits for clean EOF before accepting a receipt, rather than trusting a partially received object. The decoder has fixed allocated capacity and linear chunk processing.

The actual native path admits exact worker/server/browser inputs before execution, launches them under the owned Windows Job, checks the direct server child owns the configured listener before and after assertions, ignores candidate stdout as authority, and passes the authenticated receipt through the existing source/module/output/resource/current-capture checks. Machine-wide listener output is not published. Existing directory lease helper and listener capabilities remain exact command/executable matches. Capture/raw asset records remain unchanged.

## Main validation

    node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/preview-channel.test.ts packages/mcp/test/portal/preview-interactions.test.ts packages/mcp/test/portal/preview-native.test.ts packages/mcp/test/portal/interaction-evidence.test.ts packages/mcp/test/portal/observation-manifest.test.ts packages/mcp/test/portal/preview-listener.test.ts packages/mcp/test/portal/preview-lease.test.ts --maxWorkers=1

Result: 7 files, 18 tests passed, 108.32 seconds; started September 15 at 08:59:47. This includes actual local Firefox, current validator build into a task-owned directory, NativeWork positive, forged stdout and unrelated existing-listener negatives, source interactions/motion and strict channel handling. It does not access the user's Chrome or Figma document. Existing compatibility/module-fence results and the earlier non-reproduced host startup failure remain in the implementation report.

The final 29-path allowlist is approved for hash-guarded integration. Task 6D may then consume its coordinator/shared/IR interfaces, and Task 6E must add actual recipe consumption; this review does not treat interaction screenshots as proof of all token/component/asset use. Live current-service C4/C2/C3 tests, portable capture, generated metadata, full source verification, final critical review rounds and authorized main push remain outstanding.
