# Task 3.3 implementation report

## Result

Implemented separate external artifact authority and actual native consumer enforcement. The source-authority version remains independent. Current owner registration, native execution, acceptance and completion require the new artifact contract. Historical profiles/reports remain parseable; missing artifact authority is never synthesized into permission.

The authenticated preparation route resolves service-injected validator, browser and captured asset inputs before nonce creation. Registration compares the exact prepared profile against current resolved inputs and independently rechecks all artifact inventories; it never replaces an already approved manifest. The CLI prepares without issuing a nonce, emits artifact/configuration hashes and public service input paths without environment secret values, and requires the reviewed prepared fields for `--yes`. The original owner/session action nonce boundary remains in force.

The actual runner verifies artifact identity and bytes before launch, before every command, and before returning evidence. A successful producer records a separate installed/generated output receipt. Subsequent commands and final acceptance reverify these receipts. A failed command cannot authorize completion merely because no assertion explicitly named that command. Final applied-target verification now also runs after the potentially long freshness capture.

## Authority and consumer interfaces

- `native.externalArtifacts`: bounded declarations with canonical root, kind and optional package resolution path.
- `native.artifactAuthority`: independent version 1 authority containing command/input hash, protected effective-configuration hash, executable inventories and external artifact inventories. Absence remains readable and fails current execution.
- `commands[].produces`: explicit root-relative `provisioned-dependencies` or `generated-output` roots. Inputs cannot overlap outputs. Existing output roots are refused. A generated direct child of a provisioned root is supported only when its producer is a later command.
- `NativeRunResult.artifactAuthorityHash` and `outputReceipts`: bind producer command hash, approved input authority, successful exit outcome, output path/kind, exact observed identity/membership/content digest and any approved later-generated direct children.
- `PortalAcceptance.nativeArtifactAuthority`: optional historical field; current native acceptance emits version, manifest hash and output receipt hash. Completion rejects absence or an unsupported version.
- `POST /control/portal/profiles/prepare`: authenticated administrative read-only route. It validates owner, plan/run, candidate/context and material closure before resolving preparation. No nonce and no command execution occur here.
- Existing `/control/portal/profiles` remains nonce protected. A nonce binds the reviewed prepared request; wrong owner, changed request, changed server injection and changed artifacts cannot register a replacement behind that nonce.

For Task 3.4: retain these approved artifact/configuration inputs while adding canonical environment-resource admission and lifecycle ownership. Runtime directory identity, quarantine and cross-run resource locking remain Task 3.4; this implementation does not claim those protections.

## Supported closure rules and limits

Every inventory includes regular-file bytes, file/directory device/inode identity, exact included membership and framed SHA-256 hashes. Directory names, generated-looking names and dotfiles are not arbitrary exclusions. Regular hardlinks are supported only by this read-only artifact scanner: device/inode/link-count/size/content and change checks remain bound. No RepoReader/AtomicFileStore hardlink or write authority was relaxed. Symlinks must resolve inside the same captured tree; their link text and target identity are recorded and rechecked. Canonical package roots and their actual lexical resolution paths are rechecked independently, avoiding persistent `require.resolve` cache authority.

Limits are 100,000 entries, 2 GiB total and 512 MiB per file for one artifact tree; a prepared profile has at most 128 artifact roots, 500,000 aggregate entries and 8 GiB aggregate artifact bytes. Package exploration is capped at 1,024 canonical packages and 4,096 resolution edges. Package manifests are read with a 1 MiB allocation/read bound. Service-bundle and external-harness static graph discovery permits at most 1,024 JavaScript files, 16 MiB per file, 128 MiB aggregate script bytes and 1,000,000 visited AST nodes per file. Limit exhaustion fails; it does not silently omit inputs.

The validator binds its whole emitted bundle directory and discovers actual literal module imports from the validator entry and reachable emitted files. It resolves installed dependency, peer and available optional package trees, including the actual pnpm-backed Playwright installation. This is not an entry-file-only fingerprint or a hardcoded three-package list. Browser preparation binds its containing runtime directory. Captured assets bind their whole dedicated asset root.

Supported execution uses an absolute reviewed Node executable and a conservative Node CLI flag allowlist. External harnesses and service bundle entrypoints require literal supported module references; unsupported dynamic loaders, escaping relative references, custom loader flags and package layouts fail with stable prerequisite errors. npm `ci`/`install` supports a reviewed `package.json`/`package-lock.json`, the full npm implementation tree, scripts disabled and the explicit supported argument subset. pnpm/yarn/corepack provisioning and lifecycle scripts are not advertised as supported by this contract. They remain explicit prerequisites, not successful receipts. Package aliases or unconventional loaders needing a wider resolution model likewise require additional support.

Provisioning receipts capture installed bytes, including package-manager metadata and contained links. Generated outputs have their own producer and receipt. The only dependency-inventory projection is an explicitly approved later-generated direct child, such as `node_modules/.vite-temp`; the child must be absent before its producer and receives independent verification after production. There are no generic generated-directory ignore patterns. Original source/closure bytes cannot be replaced by producers. Pre-existing generated trees which are already material inputs cannot be silently overwritten.

The effective configuration hash binds the reviewed environment, fixed private HOME/config/cache/temp substitution policy, blank npm/git configuration inputs, host Windows environment roots and fixed broker code/configuration. User runtime-loader/trust/PATH injection variables are rejected. Environment secrets remain in the protected approved configuration, not artifact manifests or CLI review output. OS libraries, kernel and the host PowerShell/.NET runtime remain explicit trusted host prerequisites; no claim is made that global modules or the entire operating system are captured. These are repeated observations under the same Windows account, not a frozen filesystem or OS sandbox.

## Verification evidence

The initial new consumer regression suite failed because the artifact implementation did not yet exist. New actual consumer tests then covered missing authority, external harness dependency replacement, installed-byte change/add/remove, failed installation, unknown entrypoints/loaders, pre-existing unbound dependencies, inventory limits, hardlink mutation and generated-child receipts.

A concrete independently identified applied-target race was reproduced before its fix: mutation of an untouched target file during suspended freshness capture returned acceptance. The final-target recheck makes that same regression reject `PORTAL_APPLIED_SOURCE_CHANGED`.

Last complete affected-suite command:

```text
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-artifacts.test.ts packages/mcp/test/portal/native-work.test.ts packages/mcp/test/portal/native-runner.test.ts packages/mcp/test/portal/operational-native.test.ts packages/ir/test/portal-completion.test.ts packages/cli/test/admin-commands.test.ts
```

Result: **6 files passed; 60 tests passed; 1 explicit opt-in native Vite test skipped; exit 0**. The skipped test was separately executed successfully below. This complete run includes the suspended freshness regression. Two subsequent test-only additions specifically cover npm implementation replacement with an unchanged Node executable and validator dependency replacement with an unchanged entrypoint; both passed in a targeted two-file run (2 selected tests passed, exit 0). Runtime source did not change after the complete run. Scoped lint and MCP typecheck passed again after those test additions.

Actual locked React/Vite acceptance:

```powershell
$env:SFP_NATIVE_VITE_ACCEPTANCE='1'
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-artifacts.test.ts -t 'actual locked React/Vite'
```

Result: **1 selected test passed; exit 0; 18.96 seconds of test execution**. A fresh temporary project used the recorded React 19.2.8 / Vite 8.2.2 lock, actual npm ci with lifecycle scripts disabled, actual Vite build with React configuration, and a native emitted-asset assertion. Installed dependencies, dist and Vite configuration cache each had bound output evidence. The package/lock snapshots are copied from the existing owned C4 draft as test inputs; no original project or reference dependency tree was changed. This test is opt-in because it provisions real locked registry packages. The normal focused suite also executes an entirely offline real npm tarball installation, build and assertion.

Actual installed validator preparation/registration passes against the retained emitted bundle and its installed pnpm package layout. This test reads them; it does not rebuild dist or start/restart the daemon.

Affected TypeScript projects `packages/mcp`, `packages/cli`, and `packages/ir` passed `tsc --noEmit`. Scoped oxlint with `--deny-warnings` and oxfmt `--check` passed for all owned files. A prior broader portal/IR run found only the expected completion-fixture migration; that fixture now explicitly provides current synthetic artifact fields and separately asserts historical/future fencing. No extra broad rerun was needed after the final focused checks.

No Superpowers, subagents, Docker, primary dist build, live daemon operation, Chrome connection, source index mutation, commit or push was used. Validation ran in the separate native working copy with the same account, filesystem, network and process protection limits described above.

## Integration and remaining work

Integrate only the exact files below. Do not include main's four Task 4.1 module/service-graph paths, retained `.task2` diagnostics, alternate dist output, node_modules or temporary native fixture trees. No Markdown source document was edited by this implementation; this report is English.

Generated contract catalogs and final source/package/provenance artifacts must be regenerated by the final integration/release task after all schema changes settle. Resource locking/quarantine remains Task 3.4; final live C4/React/Vue and C2/C3 portal acceptance remains Task 7; whole-code critical review remains Task 8. This report does not claim the overall service is finished.

## Exact owned files

| Relative path | SHA-256 |
| --- | --- |
| `packages/mcp/src/portal/native-artifacts.ts` | `9a930d90ea4b0783ab052d4563e5ad8195951a4cbacac16d0472301c7e632823` |
| `packages/mcp/src/portal/native-runner.ts` | `9e65bd32aafd8eea75e58a4d7f366f5bfc0c56bae84377944ab5586deeec8cb0` |
| `packages/mcp/src/portal/native-work.ts` | `e63a5e4c568932793d29a885806c0676abd17436c81e4ea93d45372549c35a79` |
| `packages/mcp/src/portal/control.ts` | `adba6f73e8f5a0d9fbbab32cffb3907e3b24fec78d1890aaddb760d18691645b` |
| `packages/mcp/src/index.ts` | `079ea4273e678d65d8f4de599961c3ff1ebc0723e26170b64a1b403decb294d2` |
| `packages/cli/src/admin-commands.ts` | `c90e980d2db0e052ef1b4f003076f616805058cdfb41ab8fc26c558fe56b4256` |
| `packages/shared/src/portal.ts` | `296e4bff9339ce2de255e8f6164f1c2dc8890b96cd15c50bd12601affc7811f5` |
| `packages/ir/src/portal-run.ts` | `67fe6c768ef68ca0f1cd484f4abb319d359e87add4655814edbf1c63361e1dd0` |
| `packages/mcp/test/portal/native-artifacts.test.ts` | `c63135010e87bbee9d4e87bb466f030c426c72cdffcffd4968343cb319de79d7` |
| `packages/mcp/test/portal/native-runner.test.ts` | `3588c9fd30f0aec05d36c12d16c6a6868392838b1ecdc4dea41c243381322040` |
| `packages/mcp/test/portal/native-work.test.ts` | `681a8aa68779b2a03d823fb2a0c785c486d101cb747a6f0ce9cb8d811a8bc16d` |
| `packages/mcp/test/portal/operational-native.test.ts` | `c0806ada0b290f71f53d597e920790313d90d048a09c67f30607d592f8b70a87` |
| `packages/ir/test/portal-completion.test.ts` | `1c464f454507a91a19acbd8d1bf7d6bd618235476202441a26067057a6501cad` |
| `packages/cli/test/admin-commands.test.ts` | `1a8de554ac6e97509cfa60e209fbfe7ea3122284d860eab2a982f9c5016ed31a` |
| `packages/mcp/test/portal/fixtures/native-vite-lock.json` | `816e2fdf9bb50a3560de6926196274e450dd0ebdff0880e9179af0aa58361095` |
| `packages/mcp/test/portal/fixtures/native-vite-package.json` | `2f4907a04dcab0719241f50c70f9caeba731b21a5fa22259003a3e024999253e` |
