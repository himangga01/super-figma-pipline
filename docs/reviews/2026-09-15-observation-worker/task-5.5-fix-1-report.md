# Task 5.5 review fix 1

Status: fixed and frozen for controller rereview. Six files differ from the initial 29-file submission. No main source integration, Git mutation, live Figma/Chrome interaction, dependency change or primary build occurred.

## Accepted findings

- R1: A candidate page could overwrite window.__sfpMotion with fabricated timing/state records and make a static overlay appear to pass temporal validation. The controller's actual Firefox diagnostic proved this.
- R2: Independently decoding each socket chunk replaced split Korean UTF-8 bytes with replacement characters. An authenticated receipt could therefore be silently changed and accepted.

## Corrections

Motion records now remain in a private browser closure referenced only by a validator-owned JSHandle created before the action. Nothing authoritative is published on window. The closure captures observation methods before actions, retains actual browser style/position samples and completion time, and returns them through its private handle. DISSOLVE additionally requires an actual opacity change. Frames and the handle are disposed on success and failure. The exact static-page/global-array injection now fails, while genuine measured motion still passes.

Both pipe directions use one strict byte-framing implementation. It retains partial UTF-8 bytes, decodes each complete LF-delimited frame with a fatal decoder, enforces actual byte limits, rejects malformed/overlong UTF-8, incomplete frames, extra frames and trailing bytes, and preserves Korean/emoji data exactly. Hello is bounded to 1 KiB and configuration/receipt frames to 4 MiB. The parent now waits up to one second for a clean receipt EOF after the owned command finishes; a received object alone does not finish the protocol.

## Validation

- preview-channel plus preview-interactions: 8 passed, 23.36 seconds. Includes the controller's actual static-page injection shape, genuine motion and state/form cases, authenticated split Korean/emoji receipt, malformed UTF-8, trailing data and byte-by-byte worker configuration decoding.
- Actual NativeWork prepared worker: 1 passed, 60.37 seconds, covering current validator build, real browser, clean receipt EOF, fake stdout rejection and unrelated listener rejection.
- Final motion-method capture refinement: 2 selected passed, 2 filtered, 9.40 seconds. Genuine visible motion remains measured; fabricated window records remain rejected.
- Final channel tests: 4 passed, 1.15 seconds.
- Owned oxlint --deny-warnings and oxfmt --check passed. The final full MCP typecheck passed after the controller corrected a concurrent plugin-registry test import. The intermediate ambient-type output was reported and was not corrected by changing this task.

## Retained evidence

Initial source and review artifacts: task-5.5-initial-sources/, task-5.5-initial-owned-files.json, task-5.5-initial-report.md, task-5.5-initial-review.diff. Controller diagnostics remain unmodified as disabled files in the separate working copy. Test logs are .cache/task55-fix1-focused.log, .cache/task55-fix1-native.log and .cache/task55-fix1-motion-final.log; these are excluded from source integration.

The full integration manifest is task-5.5-owned-files.json and retains main-tree preimages. The delta manifest below uses initial-submission hashes as its preimages.

| Path | SHA-256 |
| --- | --- |
| packages/mcp/src/portal/preview-interactions.ts | 1efc25f23264c075c8149f660a485b1816c86f56094e474f988689516f451e9f |
| packages/mcp/src/portal/preview-worker.ts | 0b37edef97170849cc5af853b7d14787a497eb2ac426981790788f4656b0f1ae |
| packages/mcp/src/portal/preview-channel.ts | 329777d89f735e147410104ae6bddb1081a9fc1183bf4004e9b3c2a4ee5607f5 |
| packages/mcp/src/portal/native-runner.ts | 5b176ddcf63e28f192788cc56963bd8083800ce8f7578cdbdc4bdeb442656d60 |
| packages/mcp/test/portal/preview-channel.test.ts | b339ee8f818885ffa008ca9b067a72c9436cf5c3d0c68928214f6a42bc9d0576 |
| packages/mcp/test/portal/preview-interactions.test.ts | df41bc6466d6cb83531fe6d113715d895c4b60a47e12958ac8dfd65b307b0898 |
