# Task 3.3 fix round 1 report

## Review disposition

Addressed the blocking R1 finding in `task-3.3-review.md`. The reviewer and main independently reproduced all five missing-input variants before this fix. Their original positive reproduction, retained fixture directories, initial report, initial hashes and original review remain unchanged. The corrected regression is a separate owned test file and asserts rejection through the actual runner.

The fix does not treat an entrypoint, package name, eval form or source-root membership as sufficient transitive module authority. A service-owned Node module loader now consumes a per-command table of verified input identities and byte hashes. Preparation binds the exact preload source, protocol and child/worker injection policy before nonce approval. Execution derives its table from inventories whose digests must still match approved artifacts, material source hashes and previous producer receipts. Ordinary module resolution and loading are then checked against that table, including project scripts, inline commands, relative external entrypoints, aliases of require and imported package code.

The same fixed guard is installed for ordinary Node children and workers, including explicit minimal `env` and replacement `execArgv` options. Public child APIs cannot quietly remove the guard. Unsupported custom preloads/hooks, direct low-level child spawning and shared-environment worker forms fail explicitly. Generated modules produced and consumed within a command have separate observed evidence and retained bytes; they are not rewritten into the approved input identity.

## Actual consumer behavior

`native-module-fence-source.ts` contains the exact service preload. It uses synchronous `module.registerHooks`, not the asynchronous hook variant with CommonJS/createRequire gaps. The Node documentation describes this distinction and preload inheritance; the implementation was tested with the installed Node 24.19.0 runtime. [Node module customization hooks](https://nodejs.org/api/module.html#customization-hooks)

The resolve/load hooks canonicalize resolved file paths, check retained file/directory identity, link count, size and SHA-256, and supply verified source bytes for supported JavaScript/JSON loads. A changed or unlisted module fails before its code executes. The approved table is constructed from all observed files in the same inventory scan that is compared against the prepared inventory digest, rather than separately adopting a later changed tree. The guard also validates manual CommonJS compilation against the bound source bytes and checks direct addon loading. Runtime hook registration and custom extension mutation are unsupported.

The runner returns verified `NativeCommandResult.moduleEvidence`, including the policy hash, approved-input hash, retained evidence directory and trace filenames, observed trace digest, participating process/thread count and generated-module records. The controller checks every ordinary module record against its approved table and verifies archived generated-module bytes. It rechecks the retained evidence after subsequent commands. Native acceptance rechecks it again after freshness capture, alongside artifact/output and applied-target checks.

Acceptance now binds `moduleFenceProtocol` and `moduleEvidenceHash` separately from the original artifact/output fields. Old artifact-versioned acceptance without these module proof fields remains readable but cannot authorize current completion. A passed native command sequence requires actual module evidence, not merely a preload pathname.

### Node CLI eval compatibility

Node 24 invokes `_compile` for a fixed host bootstrap named `[eval]-wrapper`. It contains no application program and has no filesystem source file. The guard admits that one bootstrap only when **all content bytes exactly match** the following local runtime-observed scaffold, including its surrounding whitespace as encoded in the preload:

```javascript
globalThis.module = module;
globalThis.exports = exports;
globalThis.__dirname = __dirname;
globalThis.require = require;
return (main) => main();
```

The literal expected bytes are part of the approved preload-source hash. Altered content with that filename is rejected; ordinary manual `_compile` also cannot substitute different bytes for a bound filename. The original inline application command is still approval-bound and every application import/require uses the same module guard. This rule does not allow arbitrary eval source or a filename-only bypass. The exact scaffold was inspected using a task-owned local diagnostic, not by modifying Node or the service distribution.

### Child and worker propagation

Root execution uses the reviewed command plus the deterministic service preload. Guard propagation is applied to spawn, spawnSync, execFile, execFileSync, fork and Worker. Replacement environment objects receive the required guard fields; replacement execArgv receives the preload. The standard execFile callback and promisify behavior is retained. Fork/worker inheritance omits parent CLI eval arguments while retaining the guard. Public custom-loader options are rejected before child code starts. Ordinary file-based workers and minimal-environment Node children are covered by positive and negative tests.

Native child launches require captured file authority. The implementation does not claim to confine arbitrary native code, Node internal bindings, hostile JavaScript or network behavior. Shared-environment workers and unsupported shell/custom-loader forms are explicit prerequisites. These restrictions are not package-name trust exemptions.

### Typed Windows drive-mapping probe

Actual Vite 8.2.2 uses `exec('net use')` to discover mapped-drive aliases during its Windows realpath initialization. The supported compatibility capability translates **only that exact request** into the approved absolute `System32/net.exe` with fixed `['use']` arguments and no shell. The dedicated `hostProbes` authority binds both net.exe and net1.exe identities/bytes, a five-second timeout, a 512 KiB per-stream bound and the fixed query policy before approval. Invocation and outcome hashes are recorded. Callback error/stdout/stderr semantics are retained.

The host-probe role does not grant generic child execution. Direct net.exe/net1.exe calls are denied by the generic child adapter even if those files also appear in an input table. Delete forms, connection/credential arguments and concatenated shell text are rejected. Negative destructive-looking strings are exercised through the actual preload with a test-owned mocked child transport, so even a failing test cannot alter the user's network mappings. The real Vite acceptance exercises the positive actual OS query. No package name is consulted by this capability.

## Generated modules, bounds and protection limits

A new module is eligible within a currently approved producer root only as observed producer output. Before execution its actual bytes and digest are recorded, and the bytes are retained in the private evidence directory. Thus a Vite configuration bundle or another generated module may be loaded and subsequently deleted without falsely treating an empty final output inventory as proof of the earlier consumed code. The normal output receipt remains separate.

Per command, policy materialization permits at most 128,000 files, 128,000 directories and 32 MiB of policy JSON. Evidence permits at most 512 trace files, 8 MiB per trace and 16 MiB aggregate trace bytes. A generated loaded module is bounded to 16 MiB; retained generated proof is bounded to 64 MiB during controller verification. The preload also bounds per-process generated retention. Existing artifact/source inventory limits remain in effect. Policy, preload, trace and retained-module rereads use bounded readers. These are capture/verification bounds, not an OS memory/disk quota or a guarantee against arbitrary process behavior.

The same Windows account, filesystem, network and process namespace remain shared. Observations are rechecked but are not an atomic filesystem snapshot. OS libraries, the verified Node executable's builtin scaffolding and the stated host runtime prerequisites remain trusted. Resource admission/locking, durable cleanup ownership and quarantine remain Task 3.4. No claim of a JavaScript, native-process or OS sandbox is made.

## Verification

The original independent diagnostic demonstrated five successful bypasses before repair. The separate corrected regression now blocks all five through `NativePortalRunner.execute`: eval, project script, relative external entry, aliased require and a package's escaping import. No changed foreign dependency executes.

The final affected-suite command was:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-module-fence.test.ts packages/mcp/test/portal/native-artifacts.test.ts packages/mcp/test/portal/native-work.test.ts packages/mcp/test/portal/native-runner.test.ts packages/mcp/test/portal/operational-native.test.ts packages/ir/test/portal-completion.test.ts packages/cli/test/admin-commands.test.ts
```

Result: **7 files passed; 88 tests passed; 1 explicit opt-in Vite test skipped; exit 0; 70.46 seconds**.

This includes all five corrected reviewer cases, generated-then-deleted module evidence, ordinary children/workers, positive and negative minimal env/execArgv replacements, custom child preload refusal, typed host-probe positives/negatives, altered fixed-wrapper/manual compilation rejection and the prior authority/application tests. The fixed seven host-probe adapter cases passed separately using the non-destructive mock transport. The active-cancellation test now waits for an actual command-start marker instead of assuming that the expanded preflight finishes within 250 ms; cancellation before launch was already correctly rejected and is not a service regression.

Final real preset and validator command:

```powershell
$env:SFP_NATIVE_VITE_ACCEPTANCE='1'
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-artifacts.test.ts packages/mcp/test/portal/native-work.test.ts -t 'actual locked React/Vite|actual bound validator import'
```

Result: **2 selected tests passed; exit 0; 22.34 seconds wall time**. The actual locked React 19.2.8 / Vite 8.2.2 npm installation, Vite build and native assertion all passed with the module guard and typed host probe. The actual retained service validator bundle and its installed pnpm-backed dependencies were imported through the guarded native consumer. The validator check did not launch a browser. Real offline npm provisioning also passes in the affected suite.

MCP, CLI and IR TypeScript projects passed `tsc --noEmit`. Scoped oxlint with `--deny-warnings` passed for all owned source/tests. Oxfmt `--check` passed for all 19 owned files. No additional broad test run is needed before scoped independent rereview.

## Integration boundary

The exact final allowlist is the original 16 Task 3.3 files plus three new guard source/helper/test files. No main-owned module/service-graph, source-guard, service-connections or workflow files are included. The original reviewer diagnostic file and `.task33-fix/inspect-eval.cjs` are retained diagnostic material outside this allowlist. Do not include them, `.task2`, alternate dist output, node_modules or temporary fixtures in source integration.

No Superpowers, subagents, Docker, primary dist rebuild, live daemon action, browser/Chrome action, index change, commit or push was performed. Initial review evidence is preserved. Contract regeneration/final release artifacts and the remaining service tasks still belong to later integration work. This fix report does not claim that the overall service is complete.

## Exact final owned files

| Relative path | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/native-artifacts.ts` | `fd35084efaf6880dbd2d1f97b9e33960fe99789675928f9dfd34d5d4b4fc2a5a` |
| `packages/mcp/src/portal/native-runner.ts` | `0d6202cfee90e1ae10c9d1d370577dab356ae8a98c230f615214c14d1c481625` |
| `packages/mcp/src/portal/native-work.ts` | `b88f02a85e7bce30544f06c33d38a8b225f15c513ed8a03a352ba4207d589194` |
| `packages/mcp/src/portal/control.ts` | `adba6f73e8f5a0d9fbbab32cffb3907e3b24fec78d1890aaddb760d18691645b` |
| `packages/mcp/src/index.ts` | `079ea4273e678d65d8f4de599961c3ff1ebc0723e26170b64a1b403decb294d2` |
| `packages/cli/src/admin-commands.ts` | `c90e980d2db0e052ef1b4f003076f616805058cdfb41ab8fc26c558fe56b4256` |
| `packages/shared/src/portal.ts` | `d18321066aaca57b2da5b7e40fc3e51252b66a033a0a3fa207327b8f07ed13d7` |
| `packages/ir/src/portal-run.ts` | `64a9d3664cd1c01db7eccd02210dfb1a77b73286b6c044eaecf7fa1c93c62a6e` |
| `packages/mcp/test/portal/native-artifacts.test.ts` | `c63135010e87bbee9d4e87bb466f030c426c72cdffcffd4968343cb319de79d7` |
| `packages/mcp/test/portal/native-runner.test.ts` | `53955c882ba1f93979533f260429412c5d17ab998c9bf64e3dfebe13cb3d058c` |
| `packages/mcp/test/portal/native-work.test.ts` | `70c329c2d003ce7d955eeb34c5500ee9218d1f9cd40bb7ea998e429d84278c8b` |
| `packages/mcp/test/portal/operational-native.test.ts` | `c0806ada0b290f71f53d597e920790313d90d048a09c67f30607d592f8b70a87` |
| `packages/ir/test/portal-completion.test.ts` | `155073051550903fbbb3ae295286631d36a39ff25ba9eb3491ff54363889159f` |
| `packages/cli/test/admin-commands.test.ts` | `1a8de554ac6e97509cfa60e209fbfe7ea3122284d860eab2a982f9c5016ed31a` |
| `packages/mcp/test/portal/fixtures/native-vite-lock.json` | `816e2fdf9bb50a3560de6926196274e450dd0ebdff0880e9179af0aa58361095` |
| `packages/mcp/test/portal/fixtures/native-vite-package.json` | `2f4907a04dcab0719241f50c70f9caeba731b21a5fa22259003a3e024999253e` |
| `packages/mcp/src/portal/native-module-fence-source.ts` | `c7d80126b2e5eb6b23ddf5fd6e38d828e1c260df207192aa49d567a1eaf83798` |
| `packages/mcp/src/portal/native-module-fence.ts` | `b8be96d1262d65a18083470bbd33e603d80cbb386609035eb96898abb55bfc84` |
| `packages/mcp/test/portal/native-module-fence.test.ts` | `70f64ad847ab570af9c74358c40e2c953d5db46d49af7bcb187eeff25cb82491` |
