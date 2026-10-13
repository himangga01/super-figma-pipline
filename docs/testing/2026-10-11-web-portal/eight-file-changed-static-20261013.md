# Eight-file native changed-source static checks

Date: October 13, 2026 (Asia/Seoul). All four requested scoped checks passed. Main/native integration at sha256:7ae88cfdd8343e83e8872d0edd3a0d82d31f253b20169f55328e1d4c8d66c6d7 is recorded by integration receipt 137706cd3586b8937c761e1e4a60ed928a821aa231ed2007632049cdd5e157f0. This report records package type checking and exact changed-file lint/format only.

## Executed commands and toolchain

Working directory: .worktrees/baseline/service. PATH prepended the existing .worktrees/_cache/bin shim and installed native node_modules/.bin. COREPACK_HOME used USERPROFILE/AppData/Local/node/corepack and COREPACK_ENABLE_NETWORK was zero. Nothing was installed. Versions: Node 24.21.0, Corepack 0.36.0, pnpm 11.24.0, TypeScript 6.0.3, oxlint 1.80.0, oxfmt 0.65.0.

| Command | Exit | Scope |
| --- | --- | --- |
| pnpm --filter @sfp/mcp typecheck | 0 | Native package script: tsc --noEmit -p tsconfig.json |
| pnpm --filter @sfp/portal typecheck | 0 | Native package script: tsc --noEmit -p tsconfig.json |
| oxlint --config .oxlintrc.json | 0 | Exactly eight paths below |
| oxfmt --config .oxfmtrc.json --check | 0 | Exactly eight paths below |

No CLI package check, fixture rerun, full regression, whole check, build, QA operation, Chrome action or Git mutation occurred.

## Input binding

| Checked code path | Before/after SHA-256 | Comparison |
| --- | --- | --- |
| packages/mcp/src/portal/react-router-compiler-evidence.ts | 44b1952686603dd056faea33803c65a985e7b41230b5b04ad434ab69ac2065c8 | unchanged |
| packages/mcp/test/portal/react-router-compiler-evidence.test.ts | fb2ef781c20c20d1f2b5ee5148448239829188a8b05f3c18fd6c0f4d982305f8 | unchanged |
| packages/portal/src/bridge.ts | ab7008aea8646ade1eff75bb03b5e5c755656662e815dc1775185528ea94b9e2 | unchanged |
| packages/portal/test/backend.test.ts | 2b47f7e3c843b47cb19ea4eb20038de330c90d80602c58499842e62d116538ac | unchanged |
| packages/mcp/src/portal/preview.ts | 58eac8fb765ed34799d86a431fb7cef39131bcbd5870b97d076b81d76f158f37 | unchanged |
| packages/mcp/test/portal/preview-interactions.test.ts | da7dbb42c129bf1408331e71cdf8e13a2a971bea0abe5530fc50e7a1ab68ef0d | unchanged |
| packages/mcp/src/portal/module-resolution.ts | 2358e3d2fa16b28d086c600e1b947c3da579ff1f7485cb93649024c8b0dd85ef | unchanged |
| packages/mcp/test/portal/module-resolution.test.ts | fab4f3b951e951342c2c39cba72e6264226acc8ed30b295282678419f0e436c6 | unchanged |

Eight TypeScript/package/lint/format configuration inputs also remained identical; their full before/after hashes are in the JSON receipt. Package type checks started only after Root synchronized the final generated diagnostics-catalog.ts, bound at 4c4d0ba72588b0e8ba25e3fbfd12eac8e5a31006ce8ff0a0b6bb48de2bef197e. That catalog remained byte-identical in Main/native through the checks. The agent did not generate or write metadata.

## Concurrent metadata limits

The initial full Main/native source hash was sha256:7ae88cfdd8343e83e8872d0edd3a0d82d31f253b20169f55328e1d4c8d66c6d7. At package-check start Main was sha256:882813e862ac862c12c433646c950e3c657969a80902982a2f3752c799bb0bc2 and native was sha256:bdf5a5b9515394b82510df810d14f8b0e60e30fdb04a3724d101f9c12ad7f4de. At final readback Main was sha256:6f87f836d872a4ba8ab49533f6447a7c921adb6b8af3dae75ddd6241e8b8a1cb and native was sha256:bdf5a5b9515394b82510df810d14f8b0e60e30fdb04a3724d101f9c12ad7f4de. Root updated authority/provenance JSON concurrently. These are the actual separately observed fingerprints; the full source tree is not described as frozen. The eight checked code files, eight captured configurations and final derived TypeScript catalog stayed unchanged. Passing these scoped static checks does not establish a whole-check pass, new public graph/native acceptance, deployed behavior or complete C2/C3 acceptance.

Receipt: [eight-file-changed-static-20261013.json](eight-file-changed-static-20261013.json), SHA-256 1f552f9bf7f4cd3e04919d17666140b3682299b2b3bfc75ee270daae1d985c05.

The exact installed executable and complete argument vector for each command are recorded in the JSON checks array; lint/format contain all eight paths rather than a wildcard. The pre-publication command-display correction retained its original JSON/Markdown under the private static evidence folder. No check was repeated for that recording correction.
