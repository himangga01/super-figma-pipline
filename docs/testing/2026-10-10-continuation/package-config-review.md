# Independent review: installed-package configuration evidence

Date: October 11, 2026 (Asia/Seoul), approximately 17:21 KST.

This bounded read-only review covers the six-file package-configuration increment described in [sample-generated-inputs.md](sample-generated-inputs.md). It is not whole-service verification, public preparation acceptance or C2/C3 runtime acceptance. The canonical authority remains [service-analysis.md](../../service-analysis.md), with [the continuation record](README.md) and [repository instructions](../../../AGENTS.md).

## Baseline and ownership

Review used the managed checkout `C:/Users/강지혜/.codex/worktrees/1be9/super-figma-pipline/service`. Its Git HEAD was independently observed as `22517932dc9b2cb974c177ec4eacb84d4b16e254`; the parent-aligned service source baseline was `6faae627...`. The latter identifies synchronized source content, not the managed checkout's Git commit. Four tracked files are modified and the new collector/test are untracked. The parent's later main/native whole-check activity is separate and is not evidence for this increment.

The following frozen hashes were independently computed before and after focused testing and remained unchanged:

| Managed service path | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/module-resolution.ts` | `fcebd307eb4f2c7b2aa25600918f80c028b72313b9b9f8fbf04d6389232c38e7` |
| `packages/mcp/src/portal/package-config-evidence.ts` | `ed7e3a05c19f96592d6c0aec1a4e1bf697c341d01acfbff8f8abb7061959b31e` |
| `packages/mcp/src/portal/service-graph.ts` | `1042e728abf21edee6ebc35cc0245ad582965981db06632ab07eb9d1602017ec` |
| `packages/mcp/test/portal/module-resolution.test.ts` | `94f8ab700f1f00cdf20ef93a74287821b96ac4dcd8687010fe55ebbf1fe301bd` |
| `packages/mcp/test/portal/package-config-evidence.test.ts` | `6a4857827ffa6812822b52c404c364d3bca906f4cdb1521c4b8a82f7a5fd4597` |
| `packages/mcp/test/portal/service-graph.test.ts` | `ac9d4495e463811513ff0ec26f978fa90be01e7e1005cd73aaac4b2c24cfc05d` |

The implementation agent owns those files. This reviewer changed only this main-checkout report. No production fix, integration, dependency install/rebuild, index/provenance edit or commit was performed. Synthetic test files were created only inside the managed checkout and removed with checked containment; existing dependency junctions and their targets were not modified.

## Purpose and implemented structure

The service derives a source dependency graph used by portal qualification and generation. Ordinary source inventory intentionally excludes installed dependencies. This increment provides a separate data-only route for TypeScript configuration inherited from installed packages, without treating dependency runtime code as captured repository source.

`capturePackageConfigEvidence` requires explicit native artifact authority, inventories the applicable package tree again, binds the source owner and npm lock entry, reads the manifest and contained JSONC closure through a bounded reader, and records package/configuration identities and hashes. The resulting frozen object has an in-process WeakMap admission; a serialized or shallow-copied receipt cannot recreate the admission. The pure resolver consumes only the admitted config map and its source binding. `analyzeServiceGraph` optionally captures this evidence and includes its hash in the graph source hash. Default callers still lack package inheritance authority.

The report correctly states that public orchestration does not yet supply the authority and no serialized public receipt contract exists. Its actual Epic result removes only the external-config issue, leaving four C2 issues; C3 remains at three. Those are implementer-run sample observations, not independently repeated runtime or portal results.

## Findings

### PC-1: Versioned `types` export conditions can select the wrong configuration with complete success

Priority: P1. Status: independently reproduced at the hashes above; sent to parent and implementation agent.

`exportsTarget` at `package-config-evidence.ts:128-136` recognizes only literal `types`, `require`, `node` and `default` conditions. It silently skips versioned TypeScript conditions such as `types@>=5.0` and then accepts a different default target. TypeScript's JSON configuration resolver recognizes the versioned condition.

Exact package export fixture:

```json
{
  "name": "@fixture/config",
  "version": "1.2.3",
  "exports": {
    "./typescript": {
      "types@>=5.0": "./special.json",
      "default": "./typescript.json"
    }
  }
}
```

The owner manifest declares version `1.2.3`; an npm v3 lock has the matching package record; an actual package-tree inventory supplies authority. Root `tsconfig.json` extends `@fixture/config/typescript`. `typescript.json` maps `dep` to `../../../ordinary.ts`; `special.json` maps it to `../../../special.ts`. Root `main.ts` imports `dep`, and both target sources exist.

The actual collector returned no issues, retained only `node_modules/@fixture/config/typescript.json`, and the service resolver returned `complete:true` with target `ordinary.ts`. Installed TypeScript 6.0.3, reading the same fixture with `getParsedCommandLineOfConfigFile` and `resolveModuleName`, returned no diagnostics and selected `special.ts` through `special.json`.

Do not silently treat a compiler-sensitive condition as an inactive condition. Either bind and implement the relevant compiler-version semantics or conservatively reject this unsupported map. The latter is sufficient for this bounded increment.

### PC-2: `typesVersions` is ignored when resolving package configuration subpaths

Priority: P1. Status: independently reproduced; sent to parent and implementation agent.

When there is no `exports` map, `capturePackage` at lines 347-352 constructs a literal subpath or uses the package's `tsconfig` field. It does not account for `typesVersions`, which can redirect the same TypeScript configuration import to another JSON file.

Using the same admitted fixture as PC-1, replace the package manifest's `exports` with:

```json
{
  "typesVersions": {
    "*": {
      "typescript": ["special.json"]
    }
  }
}
```

The service again captured `typescript.json`, reported no issues and resolved `ordinary.ts` with `complete:true`. The installed compiler selected `special.json` and resolved `special.ts` with no diagnostics. Correct byte and package identity checks do not repair a semantically wrong selection.

Keep unsupported compiler-sensitive mapping unresolved unless an explicitly compiler-bound selection adapter supplies the correct target. Do not accept a different literal JSON file merely because that file is present and hash-verified.

## Condition-set equivalence check

At the parent's request, the review additionally compared the actual `exportsTarget` implementation with the installed TypeScript JSON-config resolver on an in-memory filesystem. It did not assume fixed priority independent of object order.

| Conditional map case | Observed comparison |
| --- | --- |
| `types` before `require`, `node`, `default` | Both select `types`. |
| `require` before `types` | Both select `require`. |
| `node` before `types` | Both select `node`. |
| `default` before other active conditions | Both select `default`. |
| `import` followed by `require` | Both skip `import` and select `require` for this JSON-config lookup. |
| `browser` followed by `types` | Both skip `browser` and select `types`. |
| Nested `types` containing `require` and `default` | Both select nested `require`. |
| Nested `types` containing only unmatched `browser`, followed by outer default | Collector rejects; compiler falls through to default. This is conservative incompleteness, not false success. |

The installed compiler's `nodeNextJsonConfigResolver` and `getConditions` source was read as primary local evidence. These seven matching cases do not establish conformance for every conditional map or compiler version. PC-1 and PC-2 remain the actionable wrong-success findings.

## Authority, containment and evidence observations

- The opaque result is keyed by object identity in a WeakMap, with copied maps returned to consumers. A shallow copy of its public receipt does not gain access. Source binding includes the supplied source text and ordered inventory paths. The integrated graph reader independently verifies its text bytes against inventory hashes before capture.
- The collector parses `NativeArtifactAuthority`, requires exactly one applicable node-package-tree declaration, and compares a fresh `inventoryNativeArtifact` result to the admitted inventory. It then checks package-root directory identity and each captured manifest/config file's recorded hash, byte length, device/inode identity and link count. Configuration-byte mutation after the initial tree check is covered by the supplied regression.
- Owner manifest and lock bytes are reread against the source inventory. Package name/version and a supported declaration range must agree with the package manifest and lock entry. The integrity string is a bound lock fact, not independently verified tarball/signature evidence. The source evidence hash includes source inventory/binding, authority, package records, configuration bytes and target mapping.
- JSONC is parsed as data. No package/repository JavaScript is imported or executed by the collector. Package-local relative inheritance is contained; escaped, non-JSON, unsupported nested package inheritance and malformed/template-dependent configurations remain blocking. Partial rejected capture admits no successful config map.
- Paths originating in a package config remain package-relative in the resolver. Admitted JSONC does not add runtime `.ts` files from that package or excluded build outputs to source inventory. Required absent/unreadable inputs still fail.
- Array inheritance merges left to right, retaining parent-relative selector origins and effective baseUrl/path semantics. The existing cycle, depth, count, source-text and config-byte caps remain visible. The declared config limits do not constitute an OS sandbox or a guaranteed wall-clock deadline for inventorying an admitted tree.
- The graph's optional authority path changes its source hash using the captured evidence hash. Public preparation/freshness plumbing must recapture and revalidate this authority when eventually wired; an in-memory receipt is not a reusable serialized public authorization.

No additional concrete containment bypass or fabricated-receipt admission was reproduced in this bounded review. This is not a general adversarial audit of all native artifact machinery.

## Executed verification

Read the shared policy, project instructions, current canonical analysis and latest implementation record before review. The first source-loaded probe failed before fixture creation because the managed root cannot directly resolve `@sfp/ir`; the corrected probe used Node's SHA-256 for fixture authority values while importing the actual service functions. That setup error is not a service failure.

The two successful PC reproductions used actual files in uniquely named managed-checkout temporary directories, actual source inventory and artifact authority, the real collector/resolver, and installed TypeScript 6.0.3 as the oracle. The fixtures were removed after verifying resolved containment. No installed package was changed, no application configuration was executed, and no package was downloaded.

Focused verification ran from managed `service/packages/mcp`, with `TEMP` and `TMP` directed to the existing managed `.task-evidence` root, native config loading and cache disabled:

```text
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --configLoader native --no-cache --maxWorkers 1 test/portal/module-resolution.test.ts test/portal/package-config-evidence.test.ts test/portal/service-graph.test.ts
```

Result at **17:21:01 KST: 121/121 tests passed in three files**, no failures or skips. The two wrong-selection cases are outside that frozen suite. The implementation agent separately reported 169 related passes with one existing platform skip and passing typecheck/lint/format; those checks were not independently repeated here.

No whole check, build, Chrome operation, authenticated official endpoint, daemon change, main/native source integration, dependency write, commit or index/provenance update occurred. Tests execute with the Windows owner's permissions in the managed working copy; dependency junctions remain physically writable and were treated as read-only.

## Continuation and disposition

PC-1 and PC-2 remain open at this review snapshot. Add failing regressions for both version-sensitive mechanisms, preserve the ordinary condition-order cases, and prefer explicit unresolved results until compiler-sensitive lookup is supported. Freeze new hashes and recheck the exact adversarial cases before integration.

The parent owns integration, contract/provenance work, public authority reachability, renewed whole verification and eventual complete service/case acceptance. The implementation's current Epic four-issue/C3 three-issue results do not establish public acceptance. Keep source preparation, admitted package facts, runtime/compiler evidence and executed portal acceptance distinct.

## Independent repair recheck at 17:29 KST

The parent requested a read-only recheck after the [17:26 implementation repair](sample-generated-inputs.md). I reread the shared policy, current repository instructions, this report and the repair record. Only two of the original six reviewed files changed:

| Repaired managed service path | Final SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/package-config-evidence.ts` | `81bb308767849b3ba7b441e4caeed5c2ceea26ea9ec67ca777fb79d28d559419` |
| `packages/mcp/test/portal/package-config-evidence.test.ts` | `1c3273084d56bdd0c4219497de1ba848c9bbc4d23609e8cc8c04cbd593ad88e5` |

I independently rehashed all six paths before and after verification. The two hashes above and the other four original hashes remained unchanged throughout the recheck.

The new scan rejects a `typesVersions` field and any nested `types@...` export condition before selecting a configuration. It also rejects excessive scan depth/width. It does not claim to implement version-aware compiler selection. The opaque admission continues to withhold all captured config targets after rejection.

### Original reproductions and ordinary controls

I reran the original admitted-file fixtures using the actual collector/resolver and installed TypeScript 6.0.3. Both original compiler-sensitive cases now return `PACKAGE_CONFIG_COMPILER_SELECTION_UNSUPPORTED:tsconfig.json`, no captured configurations, no resolved targets and `complete:false`. The compiler still selects `special.ts` without diagnostics, confirming that the fixtures retain the original semantic distinction.

Four ordinary admitted-package controls remained valid and matched the compiler:

| Map order | Collector and compiler selection |
| --- | --- |
| `types` before default | `special.json`, resolving `special.ts`. |
| `require` before `types` | `typescript.json`, resolving `ordinary.ts`. |
| default before `types` | `typescript.json`, resolving `ordinary.ts`. |
| ignored `import` before `require` | `typescript.json`, resolving `ordinary.ts`. |

All four had no capture issues and complete service module results. A separate in-memory check of the exact new predicate rejected a nested version condition, 4,097 pending entries and a depth beyond the configured bound, while allowing an ordinary shallow condition map. These predicate checks establish the tested rejection behavior, not a wall-clock or heap-allocation guarantee.

### Focused verification and disposition

The same managed, cache-disabled three-file command recorded above ran at **17:29:08 KST** and passed **123/123 tests**, with no failures or skips. `TEMP` and `TMP` stayed under the managed `.task-evidence` root. Synthetic fixtures stayed in newly owned managed-checkout directories and were removed after checked containment. No production file, existing dependency, main/native service copy, Chrome session, whole check, index or provenance authority was changed by this reviewer.

**PC-1 and PC-2 are addressed for their reproduced cases at these frozen hashes.** No additional actionable defect was found in this bounded repair recheck. Unsupported compiler-sensitive maps now retain uncertainty rather than falsely asserting a different configuration. The implementation agent separately reports 171 related passes with one existing skip and unchanged actual Epic four-issue/C3 three-issue preparation results; those broader/sample runs were not independently repeated here.

Public authority routing, serialized evidence handling, compiler/plugin/runtime evidence, integration and renewed whole verification remain outstanding. The repaired source is not a claim of complete portal or runtime acceptance.

## Independent lazy-import delta review at 18:47 KST

The owner authorized main web portal integration, and the coordinator requested a brief independent review limited to the last lazy artifact-runtime import and two new fresh-process tests. This review read the prior PC-1/PC-2 findings and their 17:29 closure above, the [18:44 implementation record](sample-generated-inputs.md), and the frozen two-file source. The earlier package-selection review remains authoritative; this delta does not reopen or broaden its scope. No Superpowers skill or implementation edit was used for this requested review.

Source remains in managed checkout `C:/Users/강지혜/.codex/worktrees/1be9/super-figma-pipline/service`, at published HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254` with the existing uncommitted continuation changes. Independently checked frozen hashes:

| Path | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/package-config-evidence.ts` | `594a03189b6de2b532f16d1a2c18432493e8f65566df63655598797592d9355e` |
| `packages/mcp/test/portal/package-config-evidence.test.ts` | `d822bcfecb05293df3b527016ba7a7e9857702cec3de771fc3df8a2533132d3e` |

**Disposition: suitable to integrate at these hashes; no additional actionable defect was found in the bounded delta.** The fixed relative import now loads native artifact runtime code inside the already asynchronous, explicitly requested `capturePackageConfigEvidence` function. Ordinary in-memory resolution retains type-only artifact imports. The dynamic import cannot select a package/sample-controlled module, and explicit capture still performs the same authority schema validation, fresh artifact inventory and evidence checks. PC-1/PC-2's conservative compiler-sensitive rejection remains present and covered by the passing suite.

The two subprocess tests have distinct purposes. One initializes the actual CLI command module in a fresh Node process with a fixed managed `@sfp/shared` alias. It checks module initialization only and invokes no CLI action. The other intercepts resolution of the fixed native-artifacts module, fails on eager loading, and verifies that actual pure module resolution still completes. Both use the current Node executable without a shell, a fixed service working directory, cleared `NODE_OPTIONS`, a ten-second process timeout, bounded captured output and hidden Windows process startup. Their loader hooks select repository source consistently; they do not import or execute sample configuration or grant sample loader authority. The CLI initialization test alone does not prove that lazy loading fixed the earlier mixed-package-identity failure, and the implementation report correctly retains that distinction.

At **18:46:46 KST**, the reviewer independently ran all **13 package-config cases**, including both new subprocess tests and the existing PC-1/PC-2 cases. All passed, with zero failures and zero skips. The private reviewer-owned Vitest config reused the existing MCP settings, mapped only `@sfp/shared` to managed `packages/shared/src/index.ts`, placed cache outside service source and disabled it, and selected one worker:

```powershell
node node_modules/vitest/vitest.mjs run --config <reviewer-owned managed-mcp-vitest.mjs> --configLoader native --no-cache --maxWorkers 1 packages/mcp/test/portal/package-config-evidence.test.ts
```

The configuration is under the newly owned Windows temporary directory `sfp-package-delta-review-7192fd9a250349d9acfa2a167aca63a3`. Two-file scoped lint and formatting checks also passed. Both hashes were rechecked at 18:47:15 KST. No production, shared schema, dependency junction, Git index or provenance file was modified. No sample application, database, live daemon, user Chrome, whole build or whole-source/artifact verification was run by this delta review. The earlier independently passing managed-local source-open run is recorded separately in [the Chrome replacement review](chrome-replacement-review.md).

Integration must preserve a consistent physical workspace-package identity and complete the coordinator's current-source/package gates. Public package-authority routing, compiler/plugin/SSR-output evidence and complete C2/C3 portal acceptance remain outstanding as previously documented. This conclusion approves the reviewed local delta for integration; it does not claim complete service or runtime acceptance.
