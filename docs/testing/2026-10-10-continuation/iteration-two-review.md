# Independent review of iteration-two bounded changes

Date: October 11, 2026 (Asia/Seoul), from approximately 16:08 KST.

Scope: the empty native-variable marker repair, TypeScript extension/Vite CSS URL resolution, and recorded-fact/asset comparison plus `chrome-compare-reads` wiring. This review explicitly excludes the page-API reader and its portal integration. It is not either final whole-service acceptance review. The canonical authority remains [service-analysis.md](../../service-analysis.md), with [repository instructions](../../../AGENTS.md) and [the continuation record](README.md).

## Baseline and evidence read

Read the shared analysis policy, current project instructions and canonical report, [native-remaining-fields.md](native-remaining-fields.md), and [sample-generated-inputs.md](sample-generated-inputs.md). Main/native's previously integrated `sha256:18525cdc247a1a314f02496edb563f0a0b629ca6f098aa554ae5e7f729bb2ee3` passed whole check `b61a1d7a...` with 4,894 passes, zero failures, 20 existing skips, 39 required Chrome cases and a separate artifact pass. These subsequent native changes are not covered by that checkpoint. Published main remains `22517932dc9b2cb974c177ec4eacb84d4b16e254`; the native copy is detached at `6459363354f52940b4c67e399b9e735d7332d4dc`, with accumulated authorized changes.

Initial reviewed hashes, independently computed in `.worktrees/baseline/service`:

| File | SHA-256 |
| --- | --- |
| `packages/cli/src/figma-native-metadata.ts` | `b1f813586ae945ef4af40afefaeb442358cc9760dcf43a189b516ef69ce83c81` |
| `packages/cli/test/figma-native-metadata.test.ts` | `e095dae2a41274d3ca097a6ee9b5e4888fa5478275a375c6291a4a16c02623c9` |
| `packages/mcp/src/portal/module-resolution.ts` | `d639289cff625c2f3745c9f2a77ed253657ee245b81ac14f2c1372ac5c1c1dcb` |
| `packages/mcp/test/portal/module-resolution.test.ts` | `ee7aac2ab3ff64ab18d1f9d52acb53d86360828db2bb6d91ee753fe5dbd268fc` |
| `packages/cli/src/capture-fact-comparison.ts` | `17e9a5aa6f6af2a952d3ab6a199d8b4cd6967bf4916affa8dd4e457a97d7ba8a` |
| `packages/cli/test/capture-fact-comparison.test.ts` | `92f82d465a765038415ebe9ed3190058c39ea6d0f3df756b221bd7de6d267dc1` |
| `packages/cli/src/commands.ts` | `b20372a2038e1bc012e52715a3f4e4d28586667fd0c4745720964db91589946e` |

The parent owns comparator/CLI changes and the implementation agents own the other two scopes. This reviewer did not modify production files, tests, provenance or the index. Repairs after these findings require new hashes and verification below.

## Findings

### I2-1: URL node scope is not checked against the snapshot's claimed scope

Priority: P1. Status: independently reproduced at the initial comparator hash; sent to parent.

`snapshot` parses `requestedUrl` but validates its node ID only syntactically through `parseFigmaTarget`. `compareCaptureFacts` compares URL file keys and the snapshots' internal identity fields, while excluding `requestedUrl` from the compared facts. It never checks each URL's node against that snapshot's `requestedNodeId`.

Two otherwise identical valid snapshots claimed `requestedNodeId`, `pageId` and `scopeNodeId` equal to `0:1`. One URL selected `0-1`; the other's URL selected `99-99` in the same file. The comparator returned `inputsReportComplete: true`, `observedFactsEqual: true`, `differenceCount: 0`, and scope `0:1`. Snapshot hashes differed, but fact hashes matched. This is a false same-scope comparison, even though `fullCaptureAccepted` correctly remained false.

Require URL node identity to match the snapshot's requested scope, and validate applicable requested/scope/page invariants before comparison. Reject absent or contradictory scope evidence rather than relying on two internally matching claims.

### I2-2: Arbitrary Vite plugins can redirect a CSS URL that the resolver marks resolved

Priority: P1. Status: independently reproduced against both service and installed Vite; sent to module implementation agent and parent.

The new CSS branch recognizes a supported top-level exported config object but accepts any `plugins` value. An enabled plugin can change module resolution or configuration even when the top-level object has no `root` or `resolve` property.

Fixture: the owning manifest declares Vite `^7.3.1`; main imports `./style.css?url`; both `style.css` and `other.css` exist. The config contains an inline plugin with `enforce: 'pre'` and a `resolveId` hook redirecting that specifier to `other.css?url`. The service reports `complete: true` and target `style.css` with manifest/configuration evidence. A second service fixture with a plugin `config` hook supplying an alias is also accepted as the original target.

To confirm actual behavior, a separate synthetic native build used the already screened installed Vite 7, with `configFile: false`, `envFile: false`, `write: false`, no application plugins and only the reviewer-owned redirect hook. It emitted `assets/other-BiApDVgL.css` with `body{color:blue}` from `other.css`, rather than red `style.css`. The generated output was never executed; no server or browser was opened. The temporary fixture was removed after verifying its path stayed inside the system temporary root.

The branch must not establish an exact CSS source target while enabled plugin hooks remain unproven. Keep such configurations unresolved or separately bind a supported, audited plugin subset with evidence. A statement that plugin runtime behavior is unverified cannot make a concretely wrong source target correct.

### I2-3: Unreadable baseUrl TSX substitution falls through to a declared external package

Priority: P1. Status: independently reproduced; sent to module implementation agent and parent.

The new compiler substitution returns `source-text-unavailable` for an inventory-known `.ts` fallback whose bytes are absent. The `baseUrl` branch retains only successful results, so that failure falls through to package resolution and can become an external success.

Exact fixture:

```text
tsconfig.json: {"compilerOptions":{"baseUrl":"."}}
package.json: {"dependencies":{"value.tsx":"1"}}
main.ts: import "value.tsx";
opaque inventory member: value.ts
```

The service returns `complete: true`, `status: external`, empty targets and only `package.json` configuration evidence. Installed TypeScript `resolveModuleName`, with the same local file existence and base URL, resolves `/fixture/value.ts` as a local TypeScript source. Its missing captured bytes must remain an unresolved evidence gap; a same-name package declaration cannot replace that compiler-selected input. Preserve unreadable/case-mismatched compiler fallback results before external fallback.

### I2-4: The comparator rejects the current Desktop snapshot source label

Priority: P2. Status: independently reproduced; sent to parent.

`sourceKinds` permits legacy `figma-desktop-plugin` but omits current `figma-plugin-api-pinned`. The shared snapshot reader preserves `overview.source` in its output, and the existing Desktop collector supplies the pinned label. A valid same-scope snapshot with that source is rejected with `CAPTURE_COMPARISON_INVALID`.

If the comparator supports service-produced snapshots as its allowlist implies, include the current pinned collector label and retain its source as transport provenance. This is schema compatibility, not a request to perform Desktop live acceptance or treat Desktop facts as another collector's observations.

## Native variable marker assessment

No actionable new defect was found in the bounded marker change. It exempts only `stopsVar` whose actual value is an empty array. Other marker names, malformed values, nonempty arrays, separate variable/variable-set rows, instance inheritance and descendant overrides retain conservative unknowns. Unresolved component identity remains unknown in the instance regression. This is not an audit or expansion of every native variable encoding.

The implementation record's CDD comparison moves from 457 to 261 unobserved positions with 14,402 compared positions, zero unexplained differences and unchanged retained representations, fonts and original images. eCommerce remains at 204,755 positions and 59 unknowns. Those real-file comparisons are implementer-recorded evidence; this reviewer did not rerun them. Full capture remains unaccepted, and render-bound/network/catalog/component-identity gaps remain separate obligations.

## Comparator and source-evidence observations

The comparator retains every observed node property, tree parent/order relationships and root facts except explicitly named transport metadata. Missing fields remain distinct from present values, and new root facts are not silently dropped. It hashes the original snapshots, normalized facts and supplied verified asset records separately. `fullCaptureAccepted` is always false, correctly separating recorded equality from capture admission and frontend acceptance.

The CLI requires paired asset manifests and verifies each captured row's actual bytes and SHA-256 through `RepoReader` under explicit capture roots. Relative path traversal is rejected. Canonical query keys avoid object-key-order mismatches. This verifies the retained manifest's files at read time; it does not prove that a manifest covers every required design asset, that two inputs are independently acquired, or that either source remains live and unchanged. Empty or partial records must remain interpreted within those limits even when their recorded values compare equal.

The extension repair retains exact `.tsx` precedence and config-relative rootDirs/path evidence, while missing or unsupported contexts remain unresolved in the covered tests. Node/private package targets deliberately do not receive this new compiler fallback. The CSS branch requires a supplied owning manifest, supported Vite selector, supplied configuration and actual stylesheet text. I2-2 and I2-3 identify additional cases not covered by those positive checks.

## Executed verification and limits

At **16:12:37 KST**, this reviewer independently ran:

```text
node node_modules/vitest/vitest.mjs run packages/cli/test/figma-native-metadata.test.ts packages/cli/test/figma-native-nodes.test.ts packages/cli/test/capture-fact-comparison.test.ts packages/mcp/test/portal/module-resolution.test.ts --maxWorkers=1
```

Result: **125/125 tests passed in four files**, no failures or skips. The adversarial reproductions above expose cases outside those initial tests. Source-level probes used the project source loader and actual exported service functions. The TypeScript oracle and Vite build used existing installed tools, with only synthetic reviewer-owned inputs. No sample application's configuration, server, frontend or generated output was executed.

No whole suite, source Chrome, authenticated endpoint, daemon restart, commit, index/provenance update or production source edit occurred in this review. No Docker or Codex browser/Figma connector was used. Native tests run with the Windows owner's permissions in a separate working copy, not an OS sandbox.

## Continuation

Repair and regress I2-1 through I2-4, freeze new hashes, and recheck the exact failing cases before integrating this iteration. Preserve the earlier whole pass at its source checkpoint. The parent owns source reconciliation, new whole verification and service-owned live comparisons. The current reported live comparison of 36,205 positions and 25 asset files is separate parent evidence and is not independently claimed by this reviewer. Live cases, official authorization and final frontend acceptance remain unresolved.

## Independent repair recheck at 16:26 KST

The parent requested a read-only recheck after the four findings above. I reread the shared policy, current repository instructions, this report, the current canonical service baseline and the updated sample implementation record. The earlier findings and source hashes remain historical evidence.

The following final native file hashes were independently computed before and after the focused run and remained unchanged:

| Rechecked file | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/module-resolution.ts` | `8c00795ce9aa6fb6aa4bf87e592df039b0ea28b42703527a38608414d0c8ebdb` |
| `packages/mcp/test/portal/module-resolution.test.ts` | `92967d1c37b351fa6218379007400bd6dca693f8906ac4322a8c1bff12c1ff38` |
| `packages/cli/src/capture-fact-comparison.ts` | `787ce9c74c4ec2c8c86f65cefb4a3b109ffc7329699b2313b50e8bd18f75cce1` |
| `packages/cli/test/capture-fact-comparison.test.ts` | `a182fc17174722aae35633b3135c4addac275af61ac0ba0524784d2f44ab2906` |

The metadata implementation and test hashes still match `b1f81358...` and `e095dae2...` in the initial table. They were not changed for these findings, so their earlier independent test evidence remains applicable within its scope. `commands.ts` was observed at `a727c8eefc675b8c87f020903681053804f875fa59b79e285ee7025a2e982747`; the parent continues integrating other CLI features. This recheck does not extend into its page-API acquisition or portal paths.

### Exact reproduction outcomes

| Finding or control | Result from actual source-loaded service functions |
| --- | --- |
| I2-1: same-file URL selects `99:99` while snapshot claims `0:1` | Throws `CAPTURE_COMPARISON_SCOPE_MISMATCH`. |
| I2-1: requested/scope mismatch or PAGE scope/page mismatch | Each throws `CAPTURE_COMPARISON_SCOPE_MISMATCH`. |
| I2-2: inline pre-resolution plugin redirects CSS | `complete:false`, unresolved `vite-css-url-configuration-required`, no guessed targets; manifest/config evidence retained. |
| I2-2: plugin config hook supplies a different alias | Same conservative unresolved result. |
| I2-2 positive control: literal empty plugin list | `complete:true`, ordinary CSS target and manifest/config evidence retained. |
| I2-3: local `.ts` fallback is in inventory without source text | `complete:false`, `source-text-unavailable`, target `value.ts` and `tsconfig.json` evidence retained. |
| I2-3: case-aliased fallback | `complete:false`, `case-mismatched-target`; it does not become an external dependency. |
| I2-3 positive control: readable local `.ts` fallback | Resolves `value.ts` with its TypeScript configuration evidence. |
| I2-4: current `figma-plugin-api-pinned` source | Accepted for fact comparison; equal facts remain `observedFactsEqual:true` and `fullCaptureAccepted:false`. |

The Vite narrowing accepts only absent or literal empty `plugins`. It deliberately does not whitelist active sample plugins or infer their behavior from names. The comparator now checks URL/requested/scope identity before comparing, applies the PAGE/page invariant, and includes the current pinned source label. No additional actionable defect was found in this bounded recheck.

At **16:26:25 KST**, the independent focused run passed **103/103 tests in two files**, zero failures or skips:

```text
node node_modules/vitest/vitest.mjs run packages/cli/test/capture-fact-comparison.test.ts packages/mcp/test/portal/module-resolution.test.ts --maxWorkers=1
```

The in-memory adversarial probes immediately preceding that run used the project's source loader and actual exported service functions. No additional Vite build, sample execution, Chrome action, whole check, production edit or index/provenance change was performed during the recheck. The implementation agent separately reports 159 related cases passing with one existing skip; that broader run is not independently repeated here.

**Disposition:** I2-1 through I2-4 are addressed for their reproduced cases at the hashes above. The parent reports the new actual CDD comparison R4 still matches 36,205 positions and 25 asset files with zero differences and `fullCaptureAccepted:false`; this remains parent-run evidence. The actual sample record now reports C2 with five issues and C3 with three, both incomplete. C2's newly explicit active-plugin uncertainty is retained rather than hidden to recover the earlier lower issue count.

The prior `18525cdc...` whole pass still does not cover these later changes. Parent integration, fresh whole-source verification, complete live cases, authorized official-server access and final frontend acceptance remain separate required work.
