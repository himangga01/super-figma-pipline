# Portal OAuth Knip repair

Date: 2026-10-13, Asia/Seoul. Author: SOL delegate.

The two-file managed repair removes the reproduced Knip failure without suppressing unused-code findings or changing public OAuth schema validation. It is frozen for root integration and a new whole check.

## Root integration and independent verification, 01:33 KST

The coordinator verified the frozen manifest and every evidence hash, checked both Main/native preimages, confirmed the real consent HTML module and entry-only Knip change, then integrated exactly the two files. A separate native Knip invocation returned `{"issues":[]}` and the coordinator's native provider/endpoint/registry run passed 84/84. Its independent raw JSON receipt hashes to `4c6e30340b3192e059e1f85846ff912fa8d95c9c0b3379512f95adc57393292c`.

R18 reconciliation and offline upstream verification passed with the owner index unchanged. Main/native source is `sha256:276acbd0db383d3a6c315260dfa551e3af208dae8a42e861d516eceb7252813f`. New whole `7bb2e135-cd00-4ef1-862f-975a1e531828` is pending, and the original failed attempt remains failed. [Integration](knip2-integration-20261013.json) and [provenance](knip-r18-provenance-20261013.json) preserve exact scope. The earlier author-only paragraphs below remain historical descriptions of that delegate's scope. No live runtime replacement, authenticated official capture, complete portal journey or Git commit/push is claimed.

The coordinator preserved an initial PowerShell quoting failure while generating the private R18 preparation helper. It occurred before the helper executed or wrote authority state; a file-based JavaScript helper corrected it. Consumed reconciliation writers and shadow indexes were not replayed.

## Baseline and purpose

Read-before references: [repository instructions](../../../AGENTS.md), the shared analysis policy, [OAuth daemon review](own-official-oauth-daemon-review.md), [portal relay review](own-official-oauth-portal-relay-review.md), and the actual Knip/static resource configuration. Reuse this report and recheck current source and newer evidence before updating it.

The local portal serves a dedicated same-origin native consent document; its module reads safe status and submits a manual, CSRF-bound handoff form. The MCP pure contract supplies the same public configuration/binding/action schemas to daemon, portal and CLI consumers. This repair affects entry discovery and unused compile-time aliases, not consent, remote authorization or credential handling.

The preserved native whole attempt is `962a023d-fe48-4956-a4b6-0cf5e41eb6c7`, source `sha256:398e26cdf683d8b8a3a25b9ac3f2eaeb9612eb5f9134ccdb5856800685249e16`. Its report records typecheck, lint and format exit 0, then Knip exit 1 at `2026-10-12T16:16:36.903Z`. The report remains failed. Main/native owned preimages matched managed before editing. Concurrent native-contour/compiler implementation was outside this scope.

Only managed `service/knip.json` and `service/packages/mcp/src/control/figma-oauth-contract.ts` were edited. Main/native service source, live Chrome/runtimes/state, grants, coding leases, Git and provenance metadata were not changed by this delegate. The English report is the only Main documentation addition in this scope.

## Findings and implementation

Full managed Knip reproduced exactly the original findings: unused `web/figma-auth-consent.js`, five unused inferred input type exports, and duplicate Start/Refresh schema exports.

The consent HTML contains an actual nonce-bound module script at `/figma-auth-consent.js`; the portal serves the dedicated consent document and allows its static module. `scripts/verify-artifacts.mjs` explicitly requires the HTML, JS, CSS and public helper, and startup fixtures contain those resources. This is a genuine browser entry independent of `app.js`, so `web/figma-auth-consent.js` was added to the existing portal entry list. No ignore pattern, issue exclusion, plugin change or global entry wildcard was added.

Repository source/test/script searches found no consumers of `FigmaOAuthConfigureInput`, `FigmaOAuthStartInput`, `FigmaOAuthRefreshInput`, `FigmaOAuthHandoffInput` or `FigmaOAuthCleanupInput`. Their five exported type declarations were removed. All public schema exports and their consumers remain. Used binding/configuration/status/code types remain unchanged.

Refresh previously directly aliased the Start schema object. It now uses `FigmaOAuthStartInputSchema.clone()`, yielding a distinct export with the same strict shape and validations. No runtime consumer was found to rely on their object identity. Input fields, deadline/generation bounds, unknown-field rejection and safe closed error projection are unchanged.

## Executed verification

- Full managed Knip before: exit 1 and the exact original findings. After: exit 0, JSON `{"issues":[]}`. No `--fix`, issue suppression, cache or source-generating mode was used.
- Independent before/after schema comparison: 116 acceptance/error comparisons passed across all public schema exports. Checks include valid actions, missing fields, invalid UUIDs, negative/fractional/unsafe generations and deadlines, unknown fields, unsafe environment values and foreign endpoints. Both versions return the same closed error for a hostile getter. The before schema objects alias; the repaired objects are distinct.
- Actual frozen-source focused fixtures: 54 OAuth provider and 26 settings endpoint cases passed, 80/80, zero skips, exit 0. A separate actual control-route registry run passed 4/4. These use existing intercepted/injected transport and owned loopback fixtures; no real OAuth/network/browser operations were performed.
- Scoped lint and format passed for the owned files.
- Actual managed MCP noEmit encountered in-progress errors only in the other author's new `native-contours.ts` and `preview-native-contours.ts`. No passing managed combined typecheck is claimed. A real TypeScript noEmit program using the unchanged native MCP config and only the repaired contract supplied through an in-memory read overlay checked 1,161 source files with zero diagnostics. The compiler host rejects writes.

The private regular test copy uses native installed dependencies for read-only resolution and its own Vite cache. No build/install through a managed junction or dependency mutation occurred. The initial focused command included an incorrect registry filter; its receipt collected only the two real 80-case files. The corrected registry path was then executed separately and produced the four-case receipt. No nonexistent filter was counted as a pass.

PowerShell redirected Knip output is UTF-16LE. An initial private manifest reader treated it as UTF-8 and failed. It was corrected to decode the preserved output bytes; no Knip result or source behavior was changed. The original whole and pre-repair output remain preserved.

## Exact frozen files

Manifest: `.worktrees/_cache/portal-knip-repair-20261013/frozen-files.json`, SHA-256 `e812898ccadbbc1d6158f014f98ffde90da6d2c4e2ca3a7ea4e1fdd21b8c8a4d`.

| File under managed service | Before SHA-256 | Frozen SHA-256 |
| --- | --- | --- |
| `knip.json` | `da0d85126c80728acd465ef1bc540f9fa207e50c4c5f0b6c865daae52e3745b2` | `07407991f9d2c29e8908d3794ec727365e36c8e27022c750d79ff4b23e2335c9` |
| `packages/mcp/src/control/figma-oauth-contract.ts` | `b46deab1f5cb5b15988f07a1b9229559fb7857421ec3736036558d5aa9181006` | `4e748ba03778e1a4f554889ba6be105c6686335e0bf402d248aae5ba92e8017a` |

The manifest binds separate pre/post output and test evidence, all under the private root:

| Evidence | SHA-256 |
| --- | --- |
| `knip-before-output.txt` | `0f9fe4c586bc7a7ee16f460d0eb437d63f60de2f424134e9094cf4476fe6e7f0` |
| `knip-after-output.txt` | `758bddc20bb29d673d88261bbc868455b47b919bfc78f179b8e5c087b5c0b38d` |
| `schema-equivalence.json` | `5a8edb9d9057b834979330807738ba249f799c84cce9a8e6ec72964918b6ff90` |
| `focused-result.json` | `cfe21d3c72c1bbcc93868d15cbdee422419c63c077f42e62cac3f2cfb348c9ce` |
| `registry-result.json` | `0af0f20d4eb2f710485fa7ca7640acc6d1e9422cd872db4fcb0f5c471653cfa0` |
| `mcp-typecheck-overlay.json` | `aa6e8cd3626d479e5523b51145f1c43bc8240b08299d2e98a55214bf50a19cdd` |

## Reproduction and limits

Read-only full managed Knip command:

```powershell
node C:/2026_project/super-figma-pipline/.worktrees/baseline/service/node_modules/knip/bin/knip.js --directory C:/Users/강지혜/.codex/worktrees/4d3e/super-figma-pipline/service --no-progress --reporter json
```

From native service cwd, filter the absolute private fixture test paths with native Vitest and `.worktrees/_cache/portal-knip-repair-20261013/review.config.mjs`, `--configLoader native`, and a new distinct JSON output path. Actual files are `packages/mcp/test/control/figma-oauth-provider.test.ts`, `packages/mcp/test/control/figma-settings-endpoint.test.ts`, and `packages/mcp/test/election/control-route-registry.test.ts` under the private `service/` copy.

The independent schema comparison is `schema-equivalence.mjs`; the native MCP virtual noEmit command is `node C:/2026_project/super-figma-pipline/.worktrees/_cache/portal-knip-repair-20261013/typecheck-overlay.mjs` from native service cwd. Evidence scripts use exclusive output names; preserve existing receipts before creating another distinct execution.

Root owns exact integration, derived metadata reconciliation, the new whole launch and any actual portal acceptance. The two-file repair resolves the reproduced Knip gate in the reviewed managed source; it does not turn the preserved failed whole attempt into a pass. No new product question or external approval is required for this static repair. Actual official MCP verification remains owner-deferred.
