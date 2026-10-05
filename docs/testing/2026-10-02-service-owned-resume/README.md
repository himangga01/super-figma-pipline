# Service-owned Chrome acceptance restart

Date: October 2, 2026 (Asia/Seoul).

## Authoritative test route

The owner prohibited Codex browser control, CUA, the in-app browser and external Codex connectors for service tests. Every acquisition, official MCP call, generation and acceptance step must exercise the service's own implementation. Earlier external-tool observations remain historical supplemental evidence and do not satisfy these gates. The rule is recorded in the root `AGENTS.md` and the separate working copy.

The Codex-created CDD tab was closed. Subsequent browser attempts use the service CLI or daemon exclusively. Browser security settings and connection approvals remain user actions.

## Implemented repairs

- `chrome-open --url` and `chrome-inspect --open --url` reuse a unique matching tab or open the requested Figma source through Playwright in the authorized existing Google Chrome. The default remains attach-only. Ambiguous tabs or contexts are rejected; unrelated tabs and source profiles are preserved. Failed navigation closes only the newly created tab.
- CLI connection waits honor the requested bounded wait, up to five minutes. A timed-out connection with a recorded successful WebSocket handshake has a distinct initialization error instead of always requesting Chrome setup again.
- Real `portal plan` initially failed with `INTERNAL_ERROR`; its operation record reported `APPROVAL_CHANNEL_UNAVAILABLE`. The portal approval label concatenated long resource identities and exceeded the 256-character prompt schema. The label now has a bounded display and a digest of the complete target/resource scope. The same live CLI path then produced and accepted the owner-control prompt without a Desktop plugin.

## Executed checks

The main and separate working-copy service fingerprints after bounded provenance reconciliation both equal `sha256:4e3351b5e7584a36e0975eb35822bfd0c7f1a13fffd3aa9384ef2a6b6a973593`. The focused test execution preceded metadata reconciliation at `sha256:97f7a75e7269d6421c435acc085cd5b8007e0831c9826dae9d1cff6799e8eba5`; implementation and test bytes did not change during reconciliation.

The [focused report](focused-tests.json) records 39 passed tests, zero failures and zero skips across six files. This includes installed Google Chrome opening a fixture source through the production API, preserving unrelated tabs, detaching without closing source tabs, reconnecting, official-MCP CLI regression checks and authenticated approval routing. Fixture responses are not live Figma capture evidence. CLI and MCP typechecks, scoped lint, and CLI/MCP builds passed. Bounded provenance reconciliation and the offline upstream-lock verifier passed, retaining 178 forks and three upstream pins. The main Git index SHA-256 remained `21422fbf6f8d745a73347c7730c598f9b51e9862ce92b3da8fbb96158c135cb3`; reconciliation used a separate index. Full source/package gates have not been rerun for this new snapshot; the earlier M15 full result belongs to its earlier fingerprint.

## Native environment and live status

The initial default-state daemon launch failed `STATE_ACL_INVALID`. A read-only production probe showed that this Codex Windows process resolved the logical product-state directory into the application's package `LocalCache` while the Windows ACL worker reported the logical path. The default packaged-host startup remains unresolved; it is not described as a repaired permission guard.

For the requested separate native test environment, the daemon and CLI explicitly use `LOCALAPPDATA=C:/2026_project/super-figma-pipline/.worktrees/_cache/cdd-native-appdata`. The source Chrome profile is explicitly bound to the existing user Chrome directory through `SFP_CHROME_USER_DATA_DIR`. No ACL or reparse validation was disabled. The daemon started on loopback port 3055. This native working copy shares the owner's filesystem, processes and network and is not an OS sandbox.

The C4 request is `.worktrees/_cache/cdd-service-plan-2026-10-02.json`, with no references and target `cdd-chrome-frontend` under `.worktrees/_cache/cdd-service-outputs`. After registering that explicit workspace and the service's bounded design/code egress configuration, the public CLI advanced to `dispatched`.

The [service status](service-status.json) is an intermediate observation of `browserConnection: awaiting-browser`; the [operation records](operation-status.json) preserve the prior admission failures and the request while dispatched. The terminal plan result was `sfp_portal1_3ea89d26270eec262cfda7749e3775f7`, with `design.complete: false`, `liveVerified: false` and `captureFailure: { code: CHROME_CONNECTION_REQUIRED, stage: connection, elapsedMs: 300010 }`. The planning operation settled successfully as an incomplete plan; capture did not pass.

Standalone service Chrome attempts timed out; loopback HTTP discovery also failed. The installed Playwright source uses `/devtools/browser` for channel discovery while this service preserves the record's browser-ID path. A direct service CLI attempt with the fixed path also timed out, so endpoint compatibility is not established as the cause and no speculative endpoint repair was applied. The owner has reported enabling debugging and allowing requests; the failed handshake does not prove that the owner omitted either step. The owned daemon and all connection attempts were stopped after these bounded attempts. No new source browser or alternate profile was launched.

No complete production capture, new frontend generation, visual acceptance, application or applied-target acceptance has completed in this restart. Official service OAuth reads and the independent official-MCP portal path remain outstanding. The additional eCommerce test remains conditional on the preceding implementation/case/review gates.
