# Retryable readiness and Chrome reconnection evidence

Date: October 2, 2026. Remediation plan: M10, findings F22 and F29. Source baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3` plus authorized working-tree changes. Final source/provenance sealing remains pending.

The lazy control handler and optional lazy leader boundary evict a failed attempt only after it settles, while successful initialization remains shared. Every subsequent explicit retry reruns the existing initialization checks. Persistent integrity failure remains rejected. The existing generation runtime registry already had failure eviction and its generation fences were preserved. A control rejection no longer prevents the handler from adopting a runtime later initialized through the MCP boundary.

Authenticated `GET /control/readiness` reports bounded `control-runtime` readiness after actual initialization: HTTP 200 for ready, HTTP 503 for not ready. It reveals no private error details. Existing leader authentication, origin checks and generation verification run before this boundary. Public `/ping` continues to report liveness independently.

The existing Chrome owner retires a terminal remote and its stale Playwright connection before the next explicit capture creates a fresh transport. The replacement uses fresh local credentials and a newly discovered remote endpoint. Healthy pending permission requests and missing-tab recovery retain their existing generation. Disconnect does not retry an outstanding command. The failed transport closes unanswered calls with an explicit unknown-outcome indication; it does not manufacture a successful or no-effect result.

## Executed verification

Validation ran natively in `C:/2026_project/super-figma-pipline/.worktrees/baseline/service`, using Node `v24.21.0` and `.worktrees/_cache/bin/pnpm.CMD --config.verify-deps-before-run=false`.

- Control/runtime regressions reproduced six failures before the repair, then 107 tests passed in their two files.
- Chrome owner regressions reproduced two failures before the repair, then all 17 browser-session tests passed.
- The loopback transport fixture passed all six tests, including fresh credentials, old-generation rejection and a dispatched unanswered effect that was never replayed.
- The native HTTP leader fixture passed all 25 tests, including public liveness during control failure and rejection of unauthenticated, foreign-generation and browser-origin readiness requests before initialization.
- A real installed Google Chrome restart test passed using `channel: 'chrome'`, the installed executable and an isolated temporary profile. With the pre-fix owner restored temporarily, its second attachment reproduced HTTP 401 from the failed transport. Restoring the repair made it pass. The same owner object survived both browser processes. The fixture intercepted its synthetic Figma URL; this is real Chrome lifecycle evidence, not live Figma or generated target-service acceptance.
- The combined six M10 files passed all 156 tests. Scoped lint and formatting passed after repairing a test cleanup/type issue. CLI/MCP package typechecks still report moving-source errors outside M10: `PortalNextResult` is missing from the shared export in `portal/design-evidence.ts`, and two implicit-any parameters occur in `portal/design-evidence.test.ts`. These are retained integration findings, not a clean package typecheck claim.

The Chrome suite registry retains all six previous files and adds the native reconnect file. Its launcher coverage recognizes persistent-context Chrome launches. A combined M10 plus census run passed 167 cases and rejected one census CLI fixture with `TEST_SCOPE_SOURCE_CHANGED` while baseline source edits continued. The source binding remains enforced; repeat that gate after stabilization.

The tests use actual native HTTP/WebSocket connections and an owned installed Chrome process where stated. Browser-owner unit tests substitute Playwright and transport adapters to control lifecycle boundaries. Same-owner filesystem/process/network privileges remain shared; there is no operating-system sandbox. No Docker, install, main-index staging, commit or push occurred in this lane. Final integrated full-suite, authority and release acceptance remain pending.
