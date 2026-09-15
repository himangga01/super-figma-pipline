# Task 3.3 fix round 1 independent review

## Outcome

**R1 is addressed. Changes requested for one immediate P2 compatibility regression in the new host-probe adapter.** All 19 frozen owned-file hashes match the refreshed integration manifest. No implementation source or owned test was edited.

This review is scoped to the original R1 closure finding, its synchronous runtime guard, evidence consumers and immediate child/worker/host-probe compatibility effects. It does not restart review of unchanged Task 3.3 code or include Task 3.4 lifecycle/quarantine work. The final whole-code review rounds remain separate.

## R1 disposition

The original five entry forms now encounter an actually consumed synchronous module guard. I independently ran the corrected actual-runner tests for eval, project script, relative external entry, aliased require and an imported package's escaping dependency. Each rejects `PORTAL_NATIVE_MODULE_UNBOUND` instead of executing foreign code.

Inspection confirms that the fixed preload source and propagation policy enter prepared configuration authority. Per-command policy tables are constructed from source byte hashes and the same observed artifact/producer inventories whose digests are verified. Module resolve/load and manual compilation checks consume those tables. Current producer modules have separately retained bytes and module evidence, including when consumed files are deleted before final output inventory. Subsequent native work and post-freshness acceptance recheck the evidence; completion requires its protocol and hash.

The fixed eval bootstrap compares all expected scaffold bytes, rather than granting authority by its synthetic filename. Child and worker adapters restore the guard when ordinary environment or execArgv defaults are replaced. The selected negative child cases and altered manual compile cases pass. The typed Windows probe grants only the approved exact `net use` request; it does not grant general net.exe/net1.exe execution. Seven existing non-destructive probe adapter tests pass independently.

This assessment concerns module-input authority and the explicitly supported APIs, not confinement of hostile JavaScript, arbitrary native code, network behavior or the shared Windows account.

## F1 - P2: Preserve the native promisified exec contract for the supported probe

Location: `service/packages/mcp/src/portal/native-module-fence-source.ts:169-179`.

The replacement `child_process.exec` function has no `util.promisify.custom` implementation. Node's original exec provides a custom adapter that resolves `{ stdout, stderr }`, exposes the child on the returned promise, and includes stdout/stderr on a rejected error. Default promisification of this new callback wrapper instead resolves only its first success argument, a stdout string. Consequently an ordinary supported call such as `const { stdout } = await promisify(exec)('net use')` receives `undefined`, and subsequent parsing fails or silently treats the result as empty. This is a compatibility regression introduced by the fix, independent of the validity of the narrow host-probe capability.

I reproduced it with the exact frozen preload and a task-owned mocked execFile transport. The result is `{"type":"string"}` rather than an object containing both fixture streams. No actual OS probe or network mapping command was executed. Inspection of the installed Node 24.19.0 builtin `child_process` implementation independently confirms the expected `customPromiseExecFunction` contract. The neighboring execFile adapter at line 158 already implements this behavior.

Add the corresponding custom promisify adapter to the supported exec wrapper, routing through the same exact request check and typed probe authority. Preserve success streams, error streams, and the returned promise's child property; add mocked success/error regressions so unsupported probe commands still cannot reach transport. This requires no expansion of shell or net command permission.

## Independent verification

All commands ran from `C:/Users/c/AppData/Local/SuperFigmaPipeline/validation/remaining-20260915/service`.

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-module-fence.test.ts -t 'blocks changed unbound|retains producer-bound|blocks unbound child|altered manual compilation'
```

Result: **11 selected tests passed; 14 tests excluded by selection; exit 0; 33.88 seconds**.

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-module-fence.test.ts -t 'host probe text|generic child execution|fixed query'
```

Result: **7 selected tests passed; 18 tests excluded by selection; exit 0; 1.10 seconds**. The transport is mocked by the owned fixture, including for destructive-looking negative strings.

```text
node .task33-fix/review-probe-promisify.mjs
```

Result: **exit 0; reproduced the incorrect string result**. The diagnostic-only script is outside the 19-file integration allowlist. It and `C:/Users/c/AppData/Local/Temp/sfp-task33-review-promisify-QtBHRQ` are retained. No cleanup was attempted. The original R1 diagnostic and evidence remain unchanged.

The main session is independently running the final affected suite; this report does not claim that run's result. No redundant actual registry/Vite build, browser, daemon, primary dist build, Superpowers, subagent, Docker, Git index/history operation or original reference write occurred. Native validation remains same-account execution in the separate working copy, without OS sandbox isolation.
