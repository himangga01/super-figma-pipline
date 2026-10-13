# Independent web portal packaging review

Review date: October 11, 2026 (Asia/Seoul).

**Disposition: no actionable defect established in the reviewed packaging increment.** The independent fixture run passed five cases, and a later native run passed those five plus the current actual artifact-content/runtime case. This is a bounded distribution review, not a whole-service, fresh npm installation or Figma-to-frontend acceptance result.

This review reuses [the packaging implementation record](packaging.md), [the portal integration record](README.md), [the canonical service analysis](../../service-analysis.md) and [the repository instructions](../../../AGENTS.md). Shared analysis policy and the existing implementation were read before the source review. The coordinator owns integration, release metadata, whole checks and live source/runtime operations.

## Source identity and scope

The six files were first reviewed in `C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service`. After the coordinator copied them, this reviewer independently rehashed the native validation copy at `C:/2026_project/super-figma-pipline/.worktrees/baseline/service`. Every hash matched the implementer's frozen identity below. The published main baseline remains `22517932dc9b2cb974c177ec4eacb84d4b16e254` with authorized uncommitted integration work. These six hashes identify the reviewed increment, not a new whole-source fingerprint.

| Path relative to `service` | Reviewed SHA-256 |
| --- | --- |
| `scripts/package-artifacts.mjs` | `370ddd10917125df1ba8a83a3136ec97fbd594d04437b462c3290c3014825f27` |
| `scripts/verify-artifacts.mjs` | `8b1b3b3b1717dac547cc15fede9b9e5f12a02e35561235146476101f74edd0df` |
| `scripts/generate-checksums.mjs` | `19d5d0d0cc962f1a6d06cca3a3a79b1d851137414a9d094379f3d17d87494e83` |
| `test/artifact-contents.test.ts` | `d81e57e7b59fb479c03b7647dcf7d5065fbce962f416131a553f20e49d49fbff` |
| `test/package-artifacts-hermetic.test.ts` | `929b79e8ad891f678f1d9ef42ca619e4ce789ee44feb0f5a7b353aaa48985adc` |
| `test/portal-artifact-startup.test.ts` | `0a57ddffc549efcb657e8589c9902d069491e8efa5cc5d06110bb3a34c85b7bc` |

Adjacent release helpers, source package manifests, the portal's runtime entry/control adapter, CLI public library entry and built dependency references were inspected for context. This reviewer changed no production, test, package, dependency, index or generated metadata file. Only this report was written.

## Reviewed behavior

- Distribution adds `portal.tgz` to the existing MCP, CLI and plugin artifacts. Portal staging includes built server output, public flat web assets and shared release documents. Test/spec assets and source maps are excluded. The portal's CLI selector is the actual CLI version, including the fixture's intentionally different portal version. Bundled internal shared/IR dependencies are removed from staged metadata.
- The checksum verifier requires exactly the manifest and four expected archive names. Archive bytes, declared sizes, contained file sets and every contained file digest are checked. Required release documents, plugin entries and the portal entry/five current browser assets are enforced. A self-consistent receipt cannot make a missing required CSS file acceptable.
- Runtime staging copies the three extracted `@sfp` packages into a new temporary `node_modules/@sfp` tree. It checks package identity, portal-to-CLI and CLI-to-MCP version bindings, the portal executable entry and the public CLI library entry. The child explicitly resolves/imports that extracted public CLI library and requires its `ControlClient` export before starting the extracted portal.
- Third-party runtime dependencies are resolved from the corresponding builder package's installed dependencies and linked under the extracted package. This avoids using workspace source for the three own packages. It intentionally uses the builder installation for third-party packages and their transitives. The startup fixture's CLI imports its extracted MCP package; actual portal bootstrap verifies its real extracted CLI integration. It does not start or functionally exercise a packaged MCP daemon.
- The child receives fresh disposable state roots and a reduced environment. Its control endpoint is an owned loopback server returning HTTP 503, so bootstrap must report the real unavailable state. Owner daemon state, credentials and Figma Chrome are not used. The verifier serves and hashes the actual packaged web bytes over HTTP.
- Temporary roots come from `mkdtemp`; archive extraction, copied packages and runtime state stay beneath those allocated roots. Cleanup targets those roots rather than caller-selected paths. Third-party dependency links are filesystem aliases under the owner account, not enforced read-only mounts. The intended operations read their targets and remove the temporary links/tree afterward.
- Startup and HTTP reads have bounded waits. The verifier drains child output, terminates only its spawned child, escalates if necessary and requires confirmed exit before success. It then closes the synthetic endpoint and removes the owned temporary tree. This is process cleanup for the packaging smoke, not a claim of hostile-code containment or general child-process-tree isolation.

The existing archive path/content checks and hermetic Git staging remain in use. The adversarial Git fixture verifies byte-identical archives, no executed hostile hooks/signers and an unchanged decoy repository. There was no need to weaken those checks for the fourth artifact.

## Independently executed checks

| Start time, KST | Scope | Result |
| --- | --- | --- |
| 19:02:58 | Managed frozen hermetic packaging and startup fixtures | 2 files, 5 passed, zero failed, zero skipped; 13.10 seconds. |
| 19:03:25 | Copied native fixtures plus current actual `artifact-contents` test | 3 files, 6 passed, zero failed, zero skipped; 17.60 seconds. |

```text
# Managed service, before the native copy was ready:
node node_modules/vitest/vitest.mjs run --config ../.task-evidence/artifact-vitest.mjs --configLoader native --no-cache --maxWorkers 1 test/package-artifacts-hermetic.test.ts test/portal-artifact-startup.test.ts

# Native service, after the coordinator copied the exact six files and rebuilt artifacts:
node node_modules/vitest/vitest.mjs run --project root --no-cache --maxWorkers 1 test/package-artifacts-hermetic.test.ts test/portal-artifact-startup.test.ts test/artifact-contents.test.ts
```

The five fixture cases cover hermetic Git configuration, successful portable startup with all five assets, missing required assets despite matching receipts, and a missing public CLI export. The sixth case runs the actual current archive verifier, including real extracted portal startup, asset hashes and unavailable-service bootstrap. This review executed that actual-artifact case independently rather than relying only on the coordinator's prior reported pass.

The actual archive snapshot independently hashed after the passing native run was:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `artifact-manifest.v1.json` | 14,288 | `7ea2757c6bbfc36ed772c919b3e0acc00a28270d7372b215754e1008bf668eb2` |
| `cli.tgz` | 836,490 | `7bcce546d61cc3f0e8978620116e5ad90baf733e96ddb561cc2772a773205d49` |
| `mcp.tgz` | 935,331 | `397ac7c9cf03790b88d36bc21d34bb0eae4e9725b0170b2e7e63d94769d9db54` |
| `plugin.zip` | 274,130 | `dbd62c8dbc7a2bce4daa730a6365752fb7f54ee84fe9edd4f88d50db18eb3a7a` |
| `portal.tgz` | 148,303 | `2c3050c164cb56e4119adfd6bcea230717aa1c4e98525d9041c4f864458ce5bd` |

Later regenerated artifacts need their own matching receipt; this snapshot must not stand in for changed bytes.

## Verification limits and continuation

The runtime smoke requires the builder's installed third-party dependencies. It is not an isolated `npm install` resolution test, an offline dependency-vendoring test or proof that a fresh machine has all platform-specific runtime prerequisites. Version resolution of every transitive package is not independently re-established by these links. These limits are stated in the implementation report and are consistent with the actual executed path.

This reviewer performed no install, build, source Chrome control, daemon restart, external connector/browser substitution, Superpowers use, Docker operation, commit or whole-suite run. Native tests execute under the current Windows owner, not an OS sandbox. The coordinator must bind its fresh whole/source/artifact gates to the integrated final source and complete the remaining real portal/backend and Figma workflow acceptance separately. No scoped finding blocks that next verification step.
