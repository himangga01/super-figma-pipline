# Limited review: project references and rootDirs

Analysis date: October 11, 2026 (Asia/Seoul), approximately 14:30 KST.

This independent review covers the uncommitted project-reference, source-membership and `rootDirs` changes in the native module resolver. It is not a final whole-service review, complete C2/C3 analysis, or portal acceptance. The canonical authority remains [the service analysis](../../service-analysis.md), with [the continuation record](README.md), [sample screening](../../analysis/oss-samples-malware-review.md) and [repository instructions](../../../AGENTS.md).

## Baseline and ownership

Main is at published commit `22517932dc9b2cb974c177ec4eacb84d4b16e254`, with existing uncommitted changes. Review used `.worktrees/baseline/service`, whose detached baseline is `6459363354f52940b4c67e399b9e735d7332d4dc`. The implementation agent confirmed the following frozen, modified source files before review:

| Native service file | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/module-resolution.ts` | `4abc4ed086f3a6e4ac4284e2b4806b52a4c5f7602f652e01f7109401a33734e7` |
| `packages/mcp/test/portal/module-resolution.test.ts` | `f8bd7700c59e588370b721bc3e8164865cadc3427785ebee157d3c6771327101` |

This reviewer independently recomputed both hashes. The implementation agent owns those files. No production files or tests were edited by this reviewer. The parent authorized the implementation agent to repair reported defects during this review; newer bytes require a separate follow-up below.

The prior whole-source pass at `f975a577...` predates this change and does not cover it. The implementation agent reported 50 focused cases passing and 115 related cases passing with one existing skip before review. Those reported counts are separate from the tests executed by this reviewer.

## Purpose and implemented architecture

The service analyzes supplied source evidence to determine module dependencies used by application-generation and portal workflows. `resolvePortalModules` takes a source-text map and an inventory, parses manifests and TypeScript/JavaScript configuration, and reports dependency references, configuration evidence and unresolved issues. It does not execute the analyzed application or load configuration as code.

This change reads relative TypeScript project references, retains inherited file selectors with their defining-directory bases, chooses referenced projects by source membership, and resolves relative imports through configured `rootDirs` overlays when a direct target is absent. It bounds configuration depth, reference count, selectors and membership comparisons. The existing supplied-source and inventory limits remain in place. Generated files are resolved only if the required target inventory and source evidence exists for imports.

The implementation agent's sample runs reduced C2 issues from 59 to 58 and C3 from 7 to 5 before review. These are reported bounded improvements, not independently rerun sample results or completed source/portal acceptance.

## Findings

### SM-1: Imported files lose the importing project's configuration context

Priority: P1. Status: independently reproduced at the frozen source; repair assigned to the implementation agent.

`selectConfig` identifies project membership using `files`, `include`, and `exclude` alone (`module-resolution.ts:477-513`). These identify root input files, not the full project source closure. Imports can bring an excluded or unlisted file into a project. The resolver analyzes each source once and may choose an unrelated referenced project's aliases for that imported source.

Exact reproduced fixture:

```json
{
  "tsconfig.json": {"files": [], "references": [{"path": "./a.json"}, {"path": "./b.json"}]},
  "a.json": {"files": ["app/main.ts"], "compilerOptions": {"paths": {"dep": ["./app/a.ts"]}}},
  "b.json": {"files": ["app/helper.ts"], "compilerOptions": {"paths": {"dep": ["./app/b.ts"]}}}
}
```

`app/main.ts` imports `./helper`; `app/helper.ts` imports `dep`; both target files contain `export {};`.

The service returned `complete: true`, with helper's `dep` resolving only to `app/b.ts` and evidence `b.json`, `tsconfig.json`. An in-memory program created with the installed TypeScript compiler for project A contained `app/a.ts`, `app/helper.ts`, and `app/main.ts`. Thus helper also has project A's context, and its dependency differs by project. Choosing only B creates an incorrect dependency graph while claiming completeness.

Preserve project context across verified import edges with bounded closure, or conservatively mark unsupported/overlapping contexts unresolved. A source imported by project A must not silently adopt project B merely because B lists it as a root. Add this exact case and a uniquely imported unlisted source as regressions.

### SM-2: A terminal recursive exclusion does not exclude descendant files

Priority: P1. Status: independently reproduced at the frozen source; repair assigned.

The `matchesSelector` translation at lines 76-101 maps `**` to a repeated directory pattern ending in `/`. When it is the terminal segment of an exclusion such as `src/**`, the resulting expression fails to match ordinary descendant file paths.

Fixture: solution `files: []`, reference `child.json`; child has `include: ["src/**/*"]`, `exclude: ["src/**"]`; `src/main.ts` imports declared external `dep`. The service returned `complete: true` and selected the child. The installed TypeScript `parseJsonConfigFileContent` and `matchFiles` returned no input files for that child, with its expected no-input diagnostic.

This incorrectly grants project ownership to excluded sources and can apply that project's aliases. Correct recursive exclusion semantics, including nested descendants, rather than accepting the configuration as understood while ignoring its effect.

### SM-3: Output directories are not implicitly excluded from project membership

Priority: P1. Status: independently reproduced at the frozen source; repair assigned.

The Config structure does not retain output-directory membership effects. At `selectConfig:497`, absent `exclude` becomes an empty exclusion list. TypeScript supplies default exclusions, including configured `outDir`.

Fixture: solution `files: []`, reference `child.json`; child has `include: ["**/*"]`, `compilerOptions: {"outDir": "src"}`; `src/main.ts` imports declared `dep`. The service returned `complete: true` and selected the child. Installed TypeScript returned no input files and reported the implicit exclusion `/fixture/src`.

Retain defining-directory bases for inherited output directories and apply their default exclusions only when not overridden by an explicit exclusion list. Keep explicit `files` membership distinct, since root files do not use include-glob exclusion rules. A conservative unsupported result is preferable to wrong ownership if a configuration form cannot be modeled.

### SM-4: Explicit missing generated root files can leave the analysis complete

Priority: P2. Status: independently reproduced at the frozen source; repair assigned.

The new `sourceFiles` records are used as membership strings without requiring the explicitly listed input to exist in the supplied inventory and verified source map.

Fixture: solution `files: []`, reference `child.json`; child has `files: ["generated/missing.ts", "src/main.ts"]`; only `src/main.ts`, containing `export {};`, is supplied. The service returned:

```json
{"complete":true,"references":[],"issues":[]}
```

The installed TypeScript program for those root files reported diagnostic 6053: missing `generated/missing.ts`. This is an explicit required input, not an optional unmatched include glob. A generated root that the configuration requires must remain missing/unreadable until its actual source evidence is supplied. Keep the valid solution pattern `files: []` supported.

## Boundaries and observations without additional findings

- Reference and selector paths reject absolute paths, drive/colon forms, backslashes, encoded paths, controls and source-root escape. A relative reference to another package inside the supplied source root can be legitimate explicit configuration; it is not automatically a filesystem escape.
- Relative inherited selectors and `rootDirs` are normalized against the file that defines them. Explicit empty `rootDirs` overrides an inherited overlay. Invalid selectors and cycles make the overall analysis incomplete.
- A missing or unreadable `rootDirs` import target stays unresolved. Case mismatches remain explicit. No generated source was synthesized by this change.
- Project `references` are separated from `extends`, preserving the distinction between referenced projects and inherited options. Membership ambiguity already fails closed for overlapping root selectors; SM-1 concerns the missing transitive case.
- Per-reference `configuration` lists contain chosen project/ancestor evidence. They do not necessarily enumerate every competing project configuration consulted to rule out ownership. The full service source hash binds the broader inventory, so this review does not claim a demonstrated freshness bypass. Keep per-edge evidence completeness distinct from source-snapshot integrity.
- Complete module analysis is not a claim that a TypeScript build succeeds, that external dependencies are installed, or that the service can run. The specific missing root input in SM-4 is evidence incompleteness visible from parsed configuration, not a request to treat all compiler diagnostics as module-analysis failures.

## Executed verification

Read the shared analysis policy, repository instructions, current service analysis and sample malware report before inspecting the scoped sources and related graph evidence construction. The review oracle was the installed TypeScript library operating on in-memory fixture files; no external source lookup or analyzed application execution was required.

Control-flow fixtures were invoked from `.worktrees/baseline/service` using the project's source loader:

```text
node --experimental-transform-types --disable-warning=ExperimentalWarning --import ./scripts/register-source.mjs --input-type=module
```

The inline programs imported `resolvePortalModules` and `typescript`. SM-1 compared service output with `ts.createProgram`; SM-2/3 used `ts.parseJsonConfigFileContent` with `ts.matchFiles` over the same virtual files; SM-4 used `ts.createProgram(...).getOptionsDiagnostics()`. No disk fixtures or output files were created by those probes. One preliminary inline harness syntax error was corrected before recording results; it was not a service failure.

At 14:27:47 KST this reviewer ran:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/module-resolution.test.ts --maxWorkers=1
```

The implementation agent had just added three regression tests. Result: **50 passed, 3 failed, 53 total**. The three failures were exactly SM-1, SM-2 and SM-3. This is expected failing-regression evidence before repair, not a claimed pass or an unchanged-test replay. No additional tests were run while the implementation agent repaired the files.

## Limits and continuation

This reviewer did not execute the real sample services, install dependencies, access Chrome or Figma, run a whole suite/build, alter production files, restart the daemon, commit or push. No Docker was used. Native execution has the Windows owner's filesystem/process privileges and is not an OS sandbox.

Repair the four findings, preserve failing and passing regression evidence, freeze new source hashes, and rerun focused/related tests and both sample analyses. Independently recheck project-context propagation, exclusions and absent-source evidence against those final bytes. The parent should link this limited review and repair status from the continuation record and canonical service analysis. The existing final whole-service review and C2/C3 portal obligations remain open.

## First repair review

The first repaired implementation was frozen at SHA-256 `346fbe90793ef83a37f5d5b10e301d2b5650b8824e9329843edd2b7eee98b382`; tests were `c3f928250a86ccde26bfe4d544e214e1e1e42fcdb4fbea470a9c052ca7c7d7a7`. Both hashes were independently checked. The implementation agent reported 54 focused tests passing. I did not rerun that suite while reviewing the new source and follow-up fixtures.

The repair adds recursive exclusion handling, inherited `outDir` and `declarationDir` exclusions, explicit-file inventory checks, and a bounded post-resolution propagation of project contexts over resolved code imports. Multi-context sources become unresolved. The initial SM-2 and SM-3 repairs match their reported failure causes. SM-1 and SM-4 require the following further corrections before closure:

1. **SM-1, standalone nested configuration.** The propagation seeds only configurations already present in project-reference closures. A nested standalone `tsconfig.json` that supplied the source's original resolution is omitted. With solution A listing `app/main.ts`, A's `dep` mapping to `app/a.ts`, main importing `./helper/helper`, and a nested `app/helper/tsconfig.json` mapping `dep` to `./b.ts`, the helper still resolves to `app/helper/b.ts` with `complete: true`. Propagation adds only A, sees one owner and leaves the previously chosen nested target unchanged. Retain the source's original configuration identity even when it is not a referenced project.
2. **SM-1, no-configuration resolution.** An explicit default/no-config identity is needed too. Reproduction: `app/tsconfig.json` references `app/a.json`; A lists `main.ts` and maps `dep` to `./a.ts`; main imports `../shared/helper`; `shared/helper.ts` imports `dep`; root `package.json` declares external `dep`. With no config enclosing `shared`, the first repair still returns `complete: true` and treats helper's dependency as external, although project A brings helper into its alias context. Adding only A after resolution does not recompute the stale default-context result.
3. **SM-4, overridden inherited files.** A base template containing `files: ["generated/missing.ts"]`, extended by `tsconfig.json` with `files: ["src/main.ts"]`, now produces `CONFIG_SOURCE_FILE_MISSING:base.json:generated/missing.ts` even when `src/main.ts` is supplied. The parent's list has been overridden and is not a required root of the effective child project. Validate effective file lists for actual project configurations after inheritance, rather than emitting missing-file issues while merely reading an overridable base template.

All three follow-ups were reproduced with the actual resolver in memory and sent to the parent and implementation agent. The first repair must not be described as closing SM-1 or SM-4. No production file was changed by this reviewer.

## Verified second repair at 14:33 KST

The second repaired files were frozen and independently rehashed:

| Native service file | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/module-resolution.ts` | `3fa69131b3df9c18d8b0bc693e69448822bcde09483ff8fa1492616cf235bfbb` |
| `packages/mcp/test/portal/module-resolution.test.ts` | `26ed8b847056b2feb5684d07049c7377553409b631eeae9ed360db0bd31f9a9b` |

I reviewed the revised context-seeding and effective-file validation code, then independently reran the focused command above. Result at **14:33:04 KST: 1 file passed, 57 tests passed, no failures or skips**. The suite includes the four original findings and the three first-repair follow-up scenarios. The implementation agent separately reports that those follow-ups failed before the second repair; this reviewer directly observed their resolver reproductions and the final passing suite, not that intermediate test invocation.

The closure now preserves the configuration actually used for every source with outgoing module references, including standalone and default/no-config identities. It propagates verified import contexts and marks conflicting contexts unresolved with cleared targets and explicit configuration evidence. Leaves without outgoing references or declared project ownership do not acquire a fictitious prior resolution context. Required `files` inputs are checked from effective configurations after inheritance and overrides at discovered config roots and project-reference targets.

**Disposition:** SM-1 through SM-4 and their documented follow-ups are addressed for the reproduced cases at these final hashes. No additional actionable defect was found in this scoped recheck. This is not an exhaustive TypeScript conformance claim. A file requiring context-specific re-resolution may remain conservatively unresolved, and multiple contexts are rejected rather than represented as complete compiler executions. Generated code still requires actual supplied evidence.

The final focused pass does not establish passing related suites, a current whole-source check, complete C2/C3 source graphs, installed sample runtime, or portal/frontend acceptance. The implementation agent and parent own the related/static/sample runs and final integration. Preserve the earlier source hashes and failures as historical evidence rather than reclassifying them as passes.

### Final lint-only delta at 14:34 KST

The implementation agent replaced the active-config array flattening with equivalent Set/add loops and retained unique sorted iteration. I inspected that delta and independently confirmed the final implementation hash `76d9e47741e7c5cb8c24415543b841b2fcbf45df22db6122601ed605a3e0b023`; the test hash remains `26ed8b847056b2feb5684d07049c7377553409b631eeae9ed360db0bd31f9a9b`. A fresh focused run at **14:34:25 KST passed all 57 tests**, with no failures or skips, at these final bytes. The finding dispositions and verification limits above remain unchanged.
