# Task 3.3 fix round 2 report

## Review disposition

Addressed F1 (P2) in `task-3.3-fix-1-review.md`. The original R1 remains closed by the independently reviewed module-input guard. This round changes only the exec adapter's promise compatibility and its existing safe tests; no authority, shell permission, generic child execution or module-resolution scope was expanded.

The guarded `child_process.exec` now supplies `util.promisify.custom`. It resolves `{ stdout, stderr }`, exposes the actual child on the returned promise, and enriches the original rejected error with stdout/stderr. The custom adapter invokes the same guarded exec function, so exact probe request matching, byte/identity checks, output/timeout bounds and role restrictions remain in force. Unsupported promisified requests reject without reaching transport. The implementation follows the neighboring guarded execFile adapter's existing contract.

Relative to the frozen fix 1 allowlist, only these files changed:

- `packages/mcp/src/portal/native-module-fence-source.ts`
- `packages/mcp/test/portal/native-module-fence.test.ts`

All other 17 owned files retain their fix 1 bytes. The new preload bytes automatically change prepared configuration authority; an old approved preload hash is not silently reused.

## Verification

Before the implementation change, the new three-case promisify regression produced two failures: successful results lacked stdout/stderr and `.child`, while rejected errors lacked both stream properties and `.child`. The unsupported-request case already remained blocked. This matches the independent review and main reproduction.

After the fix:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-module-fence.test.ts -t 'host probe|host-probe role|fixed query|promisified exec'
```

Result: **10 selected tests passed; 18 unrelated cases excluded by selection; exit 0; 1.18 seconds**. The set includes callback success/error behavior, promise success/error streams and child property, unsupported delete/connection/credential/shell-text forms, and denial of generic net.exe/net1.exe execution. Child transport is mocked before loading the actual guard, so none of the destructive-looking strings can operate on real network mappings.

Scoped oxlint with `--deny-warnings` and oxfmt `--check` passed for both changed files. An initial full MCP typecheck encountered two concurrent queue-test edits owned by another worker. After that worker completed its fixes, I independently reran `tsc --noEmit -p packages/mcp/tsconfig.json`: **exit 0**. No owned source changed during that coordination.

No broad suite, registry installation or actual OS probe was repeated for this isolated callback/promise compatibility fix. The fix 1 affected-suite and real npm/Vite/validator evidence is retained unchanged. Original review reports, initial/fix 1 hash evidence, and the independent promisify diagnostic remain preserved.

## Scope and protection limits

Execution remains native in the separate working copy with the same Windows account, filesystem, network and process namespace; there is no OS sandbox claim. No Superpowers, subagents, Docker, browser, daemon, primary dist build, original reference mutation, Git index change, commit or push was performed. The typed probe still allows only the fixed read-only query through its dedicated role and does not authorize arbitrary shell or net commands.

The final integration allowlist remains 19 files. Exclude `.task33-fix`, the reviewer diagnostic, task-owned temporary fixtures, unrelated queue/workflow/service-graph files, node_modules and alternate distribution output. Runtime source is frozen for narrow rereview.

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
| `packages/mcp/src/portal/native-module-fence-source.ts` | `398ea7495f983c3c872c3acb4436cfc0dcfbaae61231a55b0a044831cbb9e52f` |
| `packages/mcp/src/portal/native-module-fence.ts` | `b8be96d1262d65a18083470bbd33e603d80cbb386609035eb96898abb55bfc84` |
| `packages/mcp/test/portal/native-module-fence.test.ts` | `ecbeec3c1e840379ab052676f4706cc6b53badb581af3e7c54cb8bad2d0722ad` |
