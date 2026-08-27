# 구현 계획 수정 라운드 1 재검토 — Agent B

> 검토일: 2026-08-27  
> 대상: `docs/superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md`  
> 대상 SHA-256: `9FAE0BA38B6867AF252B53314275CAC9EDA33371AEB216C791ABF9F9214B3DF3`  
> 크기/물리 행: 122,740 bytes / 2,125행  
> 비교 기준: `reviews/agent-b-review-implementation-plan.md`, binding `05-unified-service-proposal.md`, capability-union 입력, 세 원본 저장소

## 1. 최종 판정

**NOT READY — 수정 후 재검토가 필요하다.**

이전 Critical 5개 가운데 동적 effect, PDF 엔진, state/workspace 분리는 닫혔다. 18개 Task 모두 `Files`와 `Interfaces`를 갖추고 반복 placeholder도 제거되어 문서 구조는 크게 개선됐다. 그러나 이전 Important 10개 중 7개는 계약 충돌 또는 실행 공백이 남았으며, 별도의 새 Critical 파손도 확인됐다.

- 이전 finding 판정: **ADDRESSED 8 / NOT ADDRESSED 7**.
- 정량 불변식 `112/105/7 → 116/106/10`, source `114/20/12`, kind `23/13/80`의 산술과 목표 자체는 일관된다(`plan:20-23, 1537-1550, 1591-1593, 1978-1983`).
- 다만 capability test의 필드명 오타, runtime authority 타입 부재, vendoring/standalone 충돌 때문에 그 수치를 현재 단계대로 증명할 수 없다.
- `service/`는 아직 존재하지 않는다. 따라서 이번 결과는 계획·원본 코드의 정적 교차 검토이며 구현 테스트 통과를 의미하지 않는다.

## 2. 정량/형식 재검증

| 점검 | 이전 계획 | 최신 계획 | 판정 |
|---|---:|---:|---|
| `### Task` | 12 | 18 | 개선 |
| `**Files**` | Task별 포괄적 목록 | 18/18 | PASS |
| `**Interfaces**` | 0 | 18/18 | PASS |
| 반복 `Implement only the files...` | 12 | 0 | PASS |
| 반복 `Run the broader task verification...` | 12 | 0 | PASS |
| 독립 spec/quality review와 commit 단계 | 불충분 | 18/18 | PASS |
| 구현 가능한 service tree | 없음 | 아직 없음 | 실행 검증 전 |

재실행 명령:

```powershell
$p = 'docs/superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md'
(Select-String -LiteralPath $p -Pattern '^### Task ').Count
(Select-String -LiteralPath $p -Pattern '^\*\*Files\*\*').Count
(Select-String -LiteralPath $p -Pattern '^\*\*Interfaces\*\*').Count
(Select-String -LiteralPath $p -Pattern 'Implement only the files').Count
(Select-String -LiteralPath $p -Pattern 'Run the broader task verification').Count
Get-FileHash -Algorithm SHA256 -LiteralPath $p
Test-Path -LiteralPath service
```

관측값은 차례대로 `18, 18, 18, 0, 0`, 위 SHA-256, `False`다.

## 3. 이전 Critical 5개 순서별 판정

### B-C-01 — ADDRESSED

최신 계획은 18개 Task 모두에 정확한 `Files`/`Interfaces`, RED 코드, 실행 명령, 예상 실패, GREEN 범위, 두 독립 리뷰, commit 명령을 둔다(`plan:760-2125`). 이전의 두 반복 placeholder도 0건이다. 하나의 부모 계획을 유지한 채 milestone A–E와 18개 작업으로 세분화한 것은 형식 문제를 실질적으로 해결했다(`plan:75-85, 731-754`).

다만 Task 단위의 크기가 여전히 과도한 문제는 별도 B-I-10에서 열어 둔다.

### B-C-02 — ADDRESSED

Task 1이 먼저 Vitest harness를 세우고, package manifest 부재를 의도한 RED로 만든다(`plan:760-824`). Task 2는 그 harness 위에서 실제 registry module 부재까지 도달한다(`plan:841-865`). 이후 Task도 새 module 부재 또는 기존 동작 결함을 구분하고, Task 16은 fake-control harness를 먼저 GREEN으로 만든 뒤 실제 plugin 부재가 `PLUGIN_NOT_CONNECTED`가 되는 것을 확인한다(`plan:1839-1872`).

따라서 원래의 “RED가 기대한 failure까지 도달하지 못함”은 해결됐다. 다만 Task 2의 vendor copy와 standalone 검사에는 새로운 blocking 파손 N-C-01/N-C-02가 있다.

### B-C-03 — ADDRESSED

정적 `effects`가 `effectsFor(args, context)`, `idempotencyFor`, `approvalFor`로 교체됐다(`plan:215-236`). Task 5는 `import_image(data/url)`, `design_diff(update)`, outPath/overwrite를 동적 분류하고 112/112 coverage를 요구한다(`plan:1027-1074`). MCP annotation은 가능한 effect의 보수적 합집합, runtime approval은 parse된 인자로 분리한다.

### B-C-04 — ADDRESSED

`pdf-lib` 1.17.1이 기술 스택·dependency·lock/SBOM 범위에 들어갔고(`plan:9, 494-511, 704, 1527-1532`), `mergeSinglePagePdfs`의 순서 보존 알고리즘과 corrupt/encrypted/non-single-page/mixed-size/no-overwrite fixture가 Task 12에 명시됐다(`plan:1553-1601`). 기존 single-page export만으로 multi-page GREEN을 주장하던 불가능성은 제거됐다.

### B-C-05 — ADDRESSED

`RuntimePaths`는 owner-only `stateRoot`와 user-approved `workspaceRoots`를 분리한다(`plan:24-25, 322-357`). Figma-only/no-filesystem 호출, URL import, workspace-required scan/export/snapshot의 경계도 구체화했고, Windows DACL과 Unix 0700/0600 fail-closed 검증을 Task 4에 둔다(`plan:964-1025`).

단, `WorkspaceConfigStore.remove`의 unsettled-operation guard가 미래 Task 7 journal에 역의존하는 문제는 B-I-01에서 별도로 판정한다.

## 4. 이전 Important 10개 순서별 판정

### B-I-01 — NOT ADDRESSED

표면상의 DAG는 `T4 paths → T5 policy → T6 auth → T7 executor → T8 fs/network → T9 plugin`으로 올바르게 재배치됐다(`plan:731-754`). 그러나 두 실제 역의존이 남는다.

1. Task 4의 `WorkspaceConfigStore.remove`는 unsettled operation이 workspace를 참조하면 거부해야 한다(`plan:343-347, 1001-1004`). operation journal/usage authority는 Task 7에서 처음 생긴다(`plan:1155-1206`). Task 4의 `Consumes`에는 그 dependency나 주입 가능한 guard가 없다(`plan:973-976`).
2. Task 11의 snapshot store는 atomic filesystem이 필요하지만 Task 8을 consume하지 않는다. 동시에 Task 8의 direct-fs boundary는 승인 adapter 밖 `node:fs`를 금지한다(`plan:1230-1283, 1451-1495`).

정확한 수정:

- Task 4에 `WorkspaceUsageGuard.hasUnsettled(workspaceId)` interface와 fake를 만들고 Task 7이 실제 adapter를 제공하도록 하거나, remove guard 통합 자체를 Task 7로 이동한다.
- Task 11이 Task 8 `AtomicFileStore`/`WorkspacePolicy`를 consume하도록 DAG와 Interfaces를 수정한다.

### B-I-02 — ADDRESSED

Task 1에 `.gitignore`, `.gitattributes`, `.editorconfig`, `.npmrc`가 추가됐다(`plan:762-824`). Task 15는 CI/release workflow, package/bin/files/export map, plugin ZIP, SBOM, provenance, notices, checksum, 실제 artifact open 검사를 요구한다(`plan:1763-1825`). 이전에 빠졌던 standalone hygiene와 release 경로는 문서상 생성됐다.

단, vendor copy가 이 root authority를 덮어쓸 수 있는 새 Critical 문제는 N-C-01이다.

### B-I-03 — NOT ADDRESSED

8자리 human code와 128-bit one-use ticket, challenge/exchange/hello/resume, follower/control token, owner-only ACL은 크게 개선됐다(`plan:359-411, 1088-1153`). 그러나 “exact pairing/PNA contract”는 아직 닫히지 않았다.

- 내부 request는 `challengeId + code`를 요구한다(`plan:376-377`). `plan:404`는 사용자에게 code만 보인다고 하지만 CLI 계약은 challengeId와 code를 함께 출력한다(`plan:1628`). challengeId의 공개/비밀 성격과 plugin 입력 형식이 충돌한다.
- PNA는 “narrowly scoped headers”라고만 하고, 허용 Origin, OPTIONS 대상, `Access-Control-Allow-Origin/Methods/Headers/Private-Network`, `Vary`의 정확한 값과 negative matrix가 없다(`plan:409, 1129-1141`).
- `icacls.exe`의 current SID 취득법, 정확한 argv/허용 ACE set 검증도 구현자 선택으로 남는다(`plan:355, 997-1000`).

수정안은 challengeId를 공개 식별자로 명시하고 UI 입력/복사 형식을 고정한 뒤, PNA request/response header를 literal contract와 table-driven tests로 넣는 것이다.

### B-I-04 — NOT ADDRESSED

Task 8은 기존 local tools, token/profile/icon scanner를 `WorkspacePolicy`, `RepoReader`, `AtomicFileStore`로 주입하고 adapter 밖 direct `node:fs`를 structural test로 거부한다(`plan:1230-1305`). 그러나 dependency table은 `@sfp/ir`가 Node fs를 직접 사용한다고 하고(`plan:703`), Task 11은 별도 `packages/ir/src/store.ts`에서 다시 atomic replacement를 구현한다(`plan:1455-1495`). Task 11은 Task 8을 consume하지 않는다.

즉 기존 local tool read/write는 닫혔지만 새 snapshot store가 같은 경계를 우회하거나 structural test와 충돌한다. IR은 schema/path layout만 담당하고 실제 read/write는 Task 8 adapter를 주입받게 해야 한다. 서비스-owned install metadata처럼 예외를 선택한다면 exact allowlist와 workspace resolution invariant를 명시해야 한다.

### B-I-05 — NOT ADDRESSED

`SnapshotReader.captureFull`, stable-order section merge, bounded concurrency 2, fidelity flags, 10k-node memory fixture는 추가됐다(`plan:426-464, 1451-1517`). 그러나 algorithm은 최초 `sectionPlan`의 section을 한 단계 fetch하는 것으로만 서술된다(`plan:464, 1493-1495`). 원본 Figwright prompt는 section 자체도 다시 `sectionPlan`을 반환할 수 있고 계속 내려가야 한다고 명시한다(`code-kb/figwright/packages/mcp/src/prompts/figma-to-code.ts:21`; schema는 `packages/shared/src/design-context.ts:642-652,691-706`).

중첩 plan을 만나면 현재 계약은 full observed snapshot을 조립하지 못한다. bounded DFS/work queue, `(pluginGeneration,nodeId)` cycle detection, max depth/section count, stable pre-order, nested omission/failure fidelity, nested-plan fixture를 추가해야 한다.

### B-I-06 — ADDRESSED

Task 14가 `service/docs/build-vs-buy.md`를 명시적으로 생성하고, 공식 `use_figma`, `generate_figma_design`, design-system search/assets, seat/permission/current limitation, checked URLs/date, REST/MCP 체계 분리, 고정 rate 숫자 금지를 docs-sync test와 DoD에 연결한다(`plan:1699-1761, 2017-2022`).

### B-I-07 — NOT ADDRESSED

CLI approval list/approve/reject와 blocking Windows/macOS owner/evidence는 생겼다(`plan:1624-1642, 1827-1970`). 그러나 undo와 live artifact chain에 모순이 남는다.

- Task 9 dispatcher가 성공한 top-level write/batch에 정확히 한 번 `commitUndo`를 소유한다(`plan:1333-1359`). Task 12는 library handler 자체가 “commits one undo boundary”라고 지시한다(`plan:1581-1584`). 그대로 구현하면 handler + dispatcher 이중 commit 가능성이 있다. handler는 0회, top-level dispatcher integration은 1회로 소유권을 한 곳에 고정해야 한다.
- Task 15는 `mcp.tgz`, `cli.tgz`, `plugin.zip`을 만든다(`plan:1780-1809`). 하지만 Task 17/18은 release ZIP plugin만 명시하고 MCP/CLI tarball을 임시 설치·실행하는 exact command가 없다(`plan:1891-1914, 1935-1958`). workspace script/daemon으로도 evidence가 통과할 수 있다.
- evidence를 “signed”라고 부르지만 schema 요구에는 signature/digest/key 또는 명시적 owner attestation field가 없고 schema validator command도 없다(`plan:1834-1864, 1891-1894, 1935-1938`).

정확한 수정은 packed tarball을 checksum 검증 후 임시 디렉터리에 설치해 그 bin으로 daemon/CLI를 실행하고 build identity를 evidence에 결합하는 것이다. 암호 서명이 아니라면 `owner-attested`로 용어를 바꾸고 `attestedBy/At/method`를 schema에 넣는다.

### B-I-08 — NOT ADDRESSED

두 층 ledger, registration/availability/investment, `sourceContracts[] + targetContractHash`, Motion/video experimental 상태, exact 116/106/10 목표는 설계됐다(`plan:141-187, 899-958, 1523-1601`). 그러나 executable authority가 세 곳에서 깨진다.

1. interface 필드는 `figmoshaHelpers`, `figmoshaCliParsers`인데 test는 `figmaoshaHelpers`, `figmaoshaCliParsers`를 참조한다(`plan:147-151` 대 `917-925`). TypeScript GREEN이 불가능하다.
2. `ToolRuntime`에는 `execute`만 있는데, 계획은 runtime authority에서 server-only 7/10을 derive하라고 한다(`plan:231-233, 912, 934-936`). `authority:'plugin'|'server'` 같은 판별 필드가 없다.
3. common 71행 계약은 source hash 2개와 target hash 1개인데(`plan:154-187`), Task 3은 “three source contract hashes”라고 지시한다(`plan:938-940`).

수정안:

```ts
interface RuntimeBinding<I, O> {
  authority: 'plugin' | 'server';
  runtime: ToolRuntime<I, O>;
}
```

필드명 오타를 고치고, 71 common row마다 `sourceContracts.length === 2`와 별도 `targetContractHash`를 검증해야 한다. 그러면 112→116 result/runtime/policy coverage와 server-only 7→10을 같은 authority에서 도출할 수 있다.

### B-I-09 — ADDRESSED

`EgressMode = local-trusted | external-model | unknown-fail-closed`가 명시적 persisted config가 됐고, `source:'mcp'`에서 추론하지 않는다(`plan:240-254, 1031-1068`). result schema validation 뒤 egress classification/hash/audit 순서와 unknown fail-closed도 Task 7/DoD에 고정됐다(`plan:1208-1216, 2000-2004`).

### B-I-10 — NOT ADDRESSED

12개에서 18개 Task, 5개 milestone checkpoint로 개선됐지만 여전히 8–12주 단일 계획이며(`plan:75-85`), 일부 Task는 한 review unit보다 훨씬 크다.

- Task 2: 600여 파일 vendoring, namespace/lock/provenance/license/parity를 한 commit에서 수행.
- Task 7: queue, idempotency, journal, approval, egress, progress, control endpoint를 한 Task에서 수행.
- Task 9: plugin pairing, resume, approval UI, file identity, URL removal, undo를 한 Task에서 수행.
- Task 12: 네 tool, PDF engine, permission, registry/result/runtime/policy/manifest atomic transition을 한 Task에서 수행.

원래 우려였던 “reviewer가 부분 subsystem을 독립적으로 reject/approve하기 어려움”은 남아 있다. 한 부모 문서를 유지하더라도 위 네 Task를 2–4개의 dependency-visible subtask/commit으로 나누고 각 milestone output의 freeze/hash/handoff 조건을 명시해야 한다.

## 5. 새 blocking breakage

### N-C-01 — Critical: vendoring이 Task 1 standalone authority를 덮어쓴다

Task 1은 새 root manifest, lock/workspace, tsconfig, Vitest, knip, 다섯 package manifest와 root scripts를 만든다(`plan:708-727, 760-824`). 그런데 vendor rules는 upstream root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, tsconfig/Vitest/knip/Node 설정까지 byte-copy 대상에 포함한다(`plan:97-120`). Task 2는 그 규칙을 그대로 copy한다고 한다(`plan:867-873`).

원본 root manifest에는 `postinstall: node scripts/sync-skills.mjs`가 있으나(`code-kb/figwright/package.json:17-32`) vendor rules는 `scripts/**`를 포함하지 않는다. 원본 knip config도 shared/mcp/plugin 세 package만 안다(`code-kb/figwright/knip.json:4-16`). 따라서 literal copy는 Task 1의 `ir/cli`, root verify/release scripts, lock authority를 되돌리고 다음 install에서 누락 postinstall script까지 호출할 수 있다.

수정:

- root scaffold-controlled 파일은 copy 대상에서 제외하고 upstream base hash만 provenance에 기록한다.
- 또는 vendor map에 `mode:'copy'|'merge-authority'|'reference-only'`를 추가해 root 파일별 merge 규칙을 고정한다.
- vendoring 뒤 다섯 package, root scripts, knip workspace, `pnpm install --lockfile-only`와 frozen install을 회귀 테스트한다.
- Global Constraint `service/`의 code-kb 독립에는 `vendor-upstreams`와 `verify-upstream-lock --with-upstreams`만 workspace-only bootstrap 예외임을 명시하고 release artifact에서 제외한다(`plan:16, 122, 608-609, 869, 883`).

### N-C-02 — Critical: Task 2의 전체 `@figwright/` 0건 gate는 현재 rewrite로 통과할 수 없다

계획은 세 package specifier만 rewrite하고 blind text replacement는 하지 않는다고 한다(`plan:120, 869`). 그런데 Step 6은 `service/packages`, `service/skills` 전체에서 모든 `@figwright/`가 0건이어야 한다(`plan:881-885`). 포함되는 원본에는 package specifier가 아닌 다음 문자열이 남는다.

- `code-kb/figwright/packages/plugin/protocol/bridge.ts:19` — `@figwright/bridge` protocol tag.
- `code-kb/figwright/packages/plugin/protocol/panel-control.ts:34` — `@figwright/panel` protocol tag.
- `code-kb/figwright/packages/shared/src/tool-budgets.ts:15` — 주석.
- `code-kb/figwright/packages/mcp/src/relay/relay.ts:387` — 사용자 안내 문자열.

검사를 import/export/package dependency specifier AST 검사로 좁히고 protocol/provenance/user-string은 explicit allowlist로 검증해야 한다. 또는 protocol tag와 안내 문자열까지 바꿀 경우 별도 rewrite map과 wire-compat test가 필요하다.

### N-C-03 — Critical: plugin generation 변경 시 같은 operation ID의 write 분기가 없다

idempotency fingerprint는 tool/args/workspace/file만 비교한다(`plan:28, 320`). completed result는 같은 plugin generation에서만 replay하고(`plan:1196-1199`), DoD는 generation 변경 시 completed cache를 invalidation한다고 한다(`plan:2002`). 새 generation에서 같은 actor/opId/args/file이 들어왔을 때 conflict, persisted replay, re-execution 중 무엇인지 정해지지 않았다. re-execution하면 “same contract applies once”와 충돌하고 write가 중복될 수 있다.

completed write는 generation 변경 시 절대 재실행하지 않고 `OPERATION_GENERATION_STALE`로 새 operationId를 요구하거나, journal에 보존한 terminal result만 반환하도록 계약과 test를 추가해야 한다. safe read의 재실행도 새 operationId에서만 허용하는 편이 명확하다.

## 6. 추가 Important 보완점

### N-I-01 — Journal limit이 이름만 있다

Task 7은 hard cap과 compaction fail-closed를 요구하지만 값, 단위, trigger가 없다(`plan:1200-1203`). DoD의 cap test도 무엇을 검증할지 고정되지 않는다. versioned `JournalLimits`에 per-actor max rows/bytes, compaction trigger, unsettled/unknown retention, cap 도달 시 read/mutation 동작을 정확히 정하고 crash-at-each-phase fixture를 추가해야 한다.

### N-I-02 — Task 11/12 병렬성과 snapshot progress 소유권이 충돌한다

T11/T12는 T10 뒤 병렬 가능하다(`plan:743-754`). Snapshot progress는 이미 T11 소유다(`plan:1457-1495`). 그러나 T12가 snapshot/PDF/video progress를 relay/MCP/CLI까지 연결하라고 한다(`plan:1585-1588`)면서 T11을 consume하지 않는다. Snapshot end-to-end wiring은 T11 단독으로 두고 T12는 PDF/video만 담당한 뒤 T13/T16에서 세 경로를 통합 검증하거나, T12를 T11 이후로 이동해야 한다.

### N-I-03 — Live evidence가 release binary를 증명하지 못한다

Task 17/18은 “exact release artifacts”를 사용한다고 하지만 실제 command는 workspace의 `pnpm -C service desktop:acceptance`이고 plugin ZIP 외 MCP/CLI tarball 설치·실행 절차가 없다(`plan:1780-1809, 1891-1914, 1935-1958`). 임시 install root에서 checksum 검증된 `mcp.tgz`/`cli.tgz`의 bin을 실행하고 `/ping` build identity와 artifact SHA-256을 evidence에 묶는 exact command가 필요하다.

## 7. 핵심 항목별 요약

| 요청된 확인 항목 | 결과 | 근거/잔여 문제 |
|---|---|---|
| Files / Interfaces / concrete steps | PASS | 18/18, placeholder 0; 다만 B-I-10의 task 크기 잔존 |
| behavior RED harness | PASS | T1 harness → T2 domain RED; T16 fake harness → live plugin absence |
| `effectsFor` | PASS | 동적 args/context와 conservative annotation 분리 |
| `pdf-lib` | PASS | dependency, merge algorithm, fixtures, SBOM/license 모두 포함 |
| `stateRoot/workspaceRoots` | PASS | 권한·용도 분리; remove guard dependency는 미해결 |
| Task DAG | FAIL | T4→T7 usage guard, T11→T8 filesystem dependency 누락 |
| Pairing/PNA/ACL | FAIL | entropy/rotation/ACL은 개선, exact PNA/header 및 challenge 표시 계약 미완 |
| Journal | FAIL | stateRoot/transition/recovery는 있음, generation branch와 numeric cap 없음 |
| Snapshot assembly | FAIL | 1-level merge만 명시; nested plan과 AtomicFileStore dependency 누락 |
| Official build-vs-buy | PASS | Task/file/test/DoD 존재, fixed rate 금지 |
| `commitUndo` / approve CLI | FAIL | approve/reject CLI는 PASS, handler/dispatcher undo owner 충돌 |
| Capability schemas | FAIL | 필드명 오타, runtime authority 부재, source/target hash 문구 충돌 |
| Live evidence | FAIL | OS owner/gate는 있음, packed MCP/CLI 실행·attestation 검증 미완 |
| `116/106/10` | 목표 PASS / 증명 FAIL | 산술·atomic target은 일치하나 schema/runtime gate가 현재 GREEN 불가 |

## 8. 재검토 전 최소 수정 순서

1. N-C-01 root vendoring mode와 bootstrap-only `code-kb` 예외를 고정한다.
2. N-C-02 namespace gate를 AST 기반으로 바꾼다.
3. N-C-03 generation 변경 idempotency 분기를 고정한다.
4. B-I-08의 두 필드 오타, runtime authority, source/target hash test를 고친다.
5. T4 usage guard와 T11 AtomicFileStore dependency를 DAG에 추가한다.
6. nested section plan, journal limits, PNA literal headers를 binding contract로 만든다.
7. `commitUndo`를 top-level dispatcher 단일 소유로 만들고 packed artifact live runner를 추가한다.
8. 위 변경 뒤 resolution ledger와 DoD를 다시 생성하고 정적 count/test command를 재실행한다.

이 수정들이 없으면 Task 2와 Task 3에서 계획 자체의 GREEN이 막히며, 그 두 문제를 우회하더라도 operation exactly-once, snapshot completeness, release evidence가 v0.1 hard gate를 충족하지 못한다.
