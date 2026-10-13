# Own-service OAuth packaging integration candidate

Date: October 12, 2026 (Asia/Seoul).

Read [repository instructions](../../../AGENTS.md), [the canonical service analysis](../../service-analysis.md), [the portal design](../../plans/2026-10-12-own-official-oauth-portal.md), [the relay review](own-official-oauth-portal-relay-review.md) and [the UI/CLI author record](own-official-oauth-ui-cli.md) first. This is the root-assigned managed-only packaging increment. It does not modify the frozen daemon, relay or UI/public command candidates and is not actual authentication or full artifact acceptance.

## Source baseline and ownership

Initial baseline: root's reconciled main/native `sha256:a476a925b0304a9ce8b02d199228f2d80f9e6eb99c342c2569e2ceefa91c4230`. All three managed before hashes matched main at assignment. Only `packages/portal/package.json`'s files list, `scripts/verify-artifacts.mjs` and `test/portal-artifact-startup.test.ts` changed. No main/native source, source-control index, live runtime, Chrome, owner state/policy/grant/fence or real credential was changed by this agent. The separate fixture copied main source and overlaid these three owned paths. Root owns current combined integration and source fingerprint reconciliation.

Frozen manifest: `service/.cache/oauth-packaging/frozen-files.json`, SHA-256 `adb742f0c1806990e5f2331d25542ee60aa68a9c3a7ef2a27f4a06822ca6fca6`. Managed and copied-fixture hashes match. Original source bytes and before hashes are preserved at `service/.cache/oauth-packaging/before/` and `before.json`.

| Service-relative path | Before SHA-256 | Frozen SHA-256 |
| --- | --- | --- |
| `packages/portal/package.json` | `117b1e02db6798bf9197e722fd615f3519e6cc841ed37d4210e3eef47d91912b` | `ddb99eafe979d2319697f9bde91d01c4b3f4cf7f3e2a2baccfcb06ceff7767c8` |
| `scripts/verify-artifacts.mjs` | `f830be1f4b2a98992fa0baa66a7339ba96af2d6f026d7c76ecb97eb50d8fa86f` | `256ea98d106af460404c2e45c30aa7a67e5c25f18de29f47a51278351ef47360` |
| `test/portal-artifact-startup.test.ts` | `79bea84da156a81ce54ae342d26e2c1b45c6241aa1c5fa5d1cf921f7229cbdfd` | `7b31555201ebfe1b8ba817ff9102693f70eefc4faac10c9a44c6f034b0a7f55a` |

## Implemented packaging behavior

The portal package files authority now includes all four new public resources: `figma-auth-public.js`, `figma-auth-consent.html`, `figma-auth-consent.js` and `figma-auth-consent.css`. The existing archive packager already copies allowed flat web resources; its code is unchanged. The archive verifier explicitly requires all four, preserving existing required assets, dependencies, public CLI exports, checksums, forbidden-content checks, extracted package identity and startup checks.

The general archive pass still verifies raw archived file bytes and hashes before startup. The dynamic consent verifier additionally rereads the copied portable runtime's raw template and compares its archive hash/length **before any consent HTTP request**. It requires valid UTF-8, a bounded 32-KiB template and exactly one nonce marker in a nonce attribute. It requires direct `/figma-auth-consent.html` to return 404 and a query-bearing canonical path to return 404.

It then makes two query-free GETs to `/figma-auth-consent`. Each response must be HTTP 200, exactly the archived template with only its single marker replaced, and contain exactly one parsed 32-character Base64URL nonce. The second response must use a different nonce. Response bytes must match the exact substitution. Dedicated CSP must bind that nonce and permit only the exact official authorization destination in the form policy; HTML content type, no-store and **same-origin** referrer policy must match the relay's repaired native-Origin contract. Normal web assets retain their original HTTP raw-byte/hash/length checks. Bootstrap must still report unavailable service and the complete safe catalog must still validate.

Every fetch in the verifier now rejects redirects, including startup, standard assets, consent, bootstrap and catalog. It requests only its newly owned literal-loopback fixture origin, never submits a form or calls an auth action. No consent URL, callback parameter, OAuth state/code/token or daemon credential enters these requests or their output. The verifier does not execute the web JavaScript. Same-origin consent-document policy is intentionally distinct from the no-referrer handoff/callback policy; actual Chrome navigation remains a separate gate.

## Meaningful fail-before and final verification

New tests were executed before production changes. R1 retained **8 passed, 16 failed** of 24. In addition to the positive fixture's incompatibility with a protected dynamic template, the old verifier actually passed an archive missing consent HTML and actually passed a server exposing the raw template. Those are product gaps reproduced before repair, not hypothetical risks. Four missing-resource fixtures use internally matching archive manifests and checksum receipts; they now fail at the specific required-file check.

After implementation R2 passed **24/24**, zero skips. The initial tools typecheck found an unchecked regex match access; the optional access plus explicit nonce guard repaired it. Initial static `static-r2.json` retains typecheck exit two with lint/format exit zero. Final exact source R3 passed **24/24**, zero skips; tools no-emit typecheck, owned denied-warning lint and owned formatting all exited zero in `static-r3.json`. Final test receipt SHA-256 is `7ed5fc6e6536028f742eb45a3c85dcfc574c06c28aa55ffbaa46d9e1ca643b63`; static receipt SHA-256 is `298285f2cf953c3db0b4509344d1c925b1fda8e991d7cf7a967bfc2758a59ebe`. All earlier receipts are separately hashed in the manifest.

The 24 registrations retain the nine earlier portable startup/missing-asset/CLI-export checks and add fifteen checks for declared package resources, the four missing OAuth files, exposed template, malformed nonce, mismatched CSP, unarchived body, wrong referrer/cache, reused nonce, query exposure and missing/duplicate marker. Fixtures create and extract miniature real archives through the service's existing native packaging/checksum/verifier scripts, launch new isolated Node loopback portal processes and confirm teardown. They use synthetic compiled public CLI/MCP/portal entries, not this candidate's real built service. No package build or install was run. Existing packaging uses hermetic Git solely in temporary archive staging; the owner's Git repository and index were untouched. Third-party installed dependencies are read through native dependency junctions; private Vite/test output stays outside them. This is file/process separation, not an OS sandbox.

Repeat in `service/.cache/oauth-packaging/fixture/service`:

`node node_modules/vitest/vitest.mjs run --config .cache/focused.config.mjs --configLoader native --reporter=json --outputFile=.cache/packaging-independent.json`

`node node_modules/typescript/bin/tsc -p tsconfig.tools.json --noEmit`

Owned lint/format use installed `oxlint@1.80.0` and `oxfmt@0.65.0` binaries against these three manifest files only. No extra archive test file was needed.

## Risks, limits and continuation

This freezes the requested three-file packaging candidate for independent review. It does not count as combined actual built-server/package acceptance, native browser acceptance or a new whole-source pass. The verifier deliberately binds the current dedicated CSP and nonce/marker contract; future consent template/policy changes must update this explicit artifact check with corresponding evidence. Two distinct nonce samples detect a reused fixed value but cannot prove randomness quality.

Root must integrate exact daemon/relay/UI/packaging bytes, reconcile inventory/catalog/provenance and required Chrome census, then build/check actual package content and run the source-bound whole/artifact workflow with the recorded artifact epoch. Actual spawned-daemon control identity, Chrome native form/303/tab continuity, approved own-client registration/credentials/manual consent, authenticated official MCP tool access, full capture/parity and fresh frontend acceptance remain separate unfinished gates. Original unknown outcomes, deadlines and source/data authority are unchanged. Update the canonical service analysis after root's integration evidence; this report is the packaging handoff record.
