# 구현 계획 Fix Round 2 최종 Scoped Re-review — Agent B

> 검토일: 2026-08-27  
> 대상: `docs/superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md`  
> 대상 SHA-256: `2C9CE04C6C06263559EAF11ABE0A774AD8E5D3B0E43931B3F4D0113AAB6FDE31`  
> 대상 크기/물리 행: 162,234 bytes / 2,471행  
> 이전 기준: `reviews/agent-b-rereview-implementation-plan.md`의 NOT ADDRESSED 7건, 신규 Critical 3건, 신규 Important 3건

## 1. 최종 verdict

**Implementation handoff: NOT READY.**

Round 2는 safe vendoring, AST import gate, workspace/snapshot DAG port, capability runtime authority, progress ownership, source-complete/GA 상태 분리를 크게 개선했다. 그러나 scoped 13개 finding 중 **ADDRESSED 5 / NOT ADDRESSED 8**이며, 구현 또는 GA artifact를 직접 막는 새 Critical 4건과 Important 4건이 남았다.

- `service/`는 아직 존재하지 않으므로 이번 판정은 최신 계획과 원본 OSS의 정적 교차 검토다.
- Round 2 ledger의 “모든 Critical/Important 수용” 선언(`plan:2447-2465`)은 아래 실행 계약 공백 때문에 독립 검증을 통과하지 못한다.
- source-complete preview와 GA의 명칭·gate 분리는 올바르지만, source artifact 설치 가능성과 핵심 plugin pairing/undo가 아직 증명 가능한 계획이 아니므로 handoff는 보류한다.

## 2. Round 1 NOT ADDRESSED 7건 재판정

| Finding | Round 2 판정 | 검증 근거와 잔여 문제 |
|---|---|---|
| B-I-01 — task DAG/port | **ADDRESSED** | `WorkspaceUsageGuard`를 Task 4가 정의·fake 주입하고 Task 7이 journal adapter로 구현한다(`plan:425-437, 1094-1140, 1320-1419`). Task 11도 Task 8 `WorkspacePolicy`/`AtomicFileStore`를 명시적으로 consume한다(`plan:1703-1715`). |
| B-I-03 — pairing/PNA/ACL | **NOT ADDRESSED** | Pair ID/code, SID/icacls argv, OPTIONS PNA preflight는 구체화됐다(`plan:435-489, 1235-1314`). 그러나 실제 `POST /pair/exchange` 성공·typed 4xx 응답의 CORS header 계약과 integration test가 없다. R2-C-01 참조. |
| B-I-04 — filesystem boundary/storage port | **NOT ADDRESSED** | IR direct fs 제거와 MCP adapter 방향은 맞다. 하지만 `SnapshotStoragePort`는 이름만 있고 method signature가 0건이며 path namespace도 없다(`plan:544, 799, 1703-1753`). R2-I-01 참조. |
| B-I-05 — nested snapshot assembly | **NOT ADDRESSED** | bounded DFS, depth 8/section 256/cycle/concurrency 2는 생겼다(`plan:544, 1734-1757`). 그러나 fidelity schema가 약속한 plan path를 표현하지 못하고 RED가 full leaf가 아닌 parent를 complete로 표시한다. R2-I-02 참조. |
| B-I-07 — commitUndo/live evidence | **NOT ADDRESSED** | dispatcher sole-owner와 packed artifact installer/Ed25519 evidence 방향은 생겼다. 하지만 모든 handler의 `PluginHandlerOutcome` 전환 범위가 없고 isolated package dependency도 닫히지 않는다. R2-C-02/R2-C-04 참조. |
| B-I-08 — capability/runtime authority | **ADDRESSED** | `figmoshaHelpers/figmoshaCliParsers` 오타가 고쳐졌고, `RuntimeBinding.authority`, common 71행의 source 2+target 1, baseline server 7/final 10 gate가 일치한다(`plan:149-193, 238-245, 1028-1088, 1785-1862`). |
| B-I-10 — task granularity | **NOT ADDRESSED** | §6.1이 review slice를 설명하지만 dependency-visible subtask, slice별 RED/GREEN, slice별 commit/handoff는 만들지 않았다(`plan:852-877`). Task 7은 여전히 여러 subsystem을 한 Task/한 commit으로 끝낸다(`plan:1320-1441`). Ledger도 `partially accepted`다(`plan:2457`). |

## 3. Round 1 신규 blocking/Important 6건 재판정

| Finding | Round 2 판정 | 검증 근거와 잔여 문제 |
|---|---|---|
| N-C-01 — safe vendoring/root authority | **ADDRESSED** | `copy`, `mergeDependencyManifests`, `referenceOnly`가 분리되고 root/package/lock/config는 byte overwrite되지 않는다. upstream postinstall/release 제거, root hash 보존, lock 재생성과 frozen install까지 Task 2에 연결됐다(`plan:95-128, 950-1014`). |
| N-C-02 — AST runtime import gate | **ADDRESSED** | import/export/import type/dynamic import/require/package dependency는 AST로 검사하며 protocol tag·comment·user text는 exact allowlist로 분리한다(`plan:126-128, 954-1014`). 전체 raw `@figwright/` 0건이라는 불가능한 gate가 제거됐다. |
| N-C-03 — generation/idempotency | **NOT ADDRESSED** | generation별 pending/queued/dispatched/succeeded 처리는 구체화됐다(`plan:396, 1366-1415, 1677-1679`). 그러나 terminal record 30일 삭제가 절대 never-reexecute 보장을 다시 깨뜨린다. R2-C-03 참조. |
| N-I-01 — journal caps | **NOT ADDRESSED** | 8,000행/24 MiB compact, 10,000행/32 MiB hard stop, 30일 retention은 고정됐다(`plan:382-388, 1375-1392, 1413-1415`). 하지만 계획이 허용한다고 쓴 manual resolution의 interface/route/CLI/state transition이 없다. R2-I-03 참조. |
| N-I-02 — progress ownership | **ADDRESSED** | Task 7은 transport, Task 11은 snapshot producer/wiring, Task 12는 PDF/video만 소유하고 Task 13이 두 병렬 결과를 consume한다(`plan:1324-1335, 1421-1423, 1712-1771, 1854-1856, 1886-1889`). |
| N-I-03 — packed artifact/live evidence | **NOT ADDRESSED** | 설치된 bin, plugin ZIP hash, `/ping` identity, detached signature까지 추가됐다(`plan:2045-2262`). 그러나 tarball 내부 private workspace dependency closure가 정의되지 않아 isolated install이 성립한다고 보장할 수 없다. R2-C-04 참조. |

## 4. 추가 요청 항목: source-complete와 GA 분리

### Source-complete vs GA — ADDRESSED

Global Constraint는 Tasks 1–16을 `source-complete-preview / blocked-external-evidence`, Tasks 17–18을 GA external evidence gate로 분리한다(`plan:34`). Task 16 marker와 Task 17/18의 독립 OS evidence, DoD의 명칭 제한도 일치한다(`plan:2109-2162, 2176-2274, 2280-2284, 2339-2343`).

이는 “외부 machine/owner 부재 때문에 source 구현 자체를 영원히 완료 불가로 만들지 않되, GA·release·양 OS live accepted라고 과장하지 않는다”는 경계를 명확히 한다. 단, 아래 artifact closure가 고쳐져야 source-complete artifact라는 주장이 기술적으로 유효하다.

## 5. 새 Critical findings

### R2-C-01 — 실제 pair POST 응답의 CORS 계약이 없다

**Severity: Critical**

`OPTIONS /pair/exchange`는 exact PNA request/response/Vary를 정의한다. 그러나 실제 `POST /pair/exchange`에는 Host/Origin 검증만 있고, 성공 ticket 응답과 typed 4xx 응답에 필요한 다음 계약이 없다(`plan:484-489`).

- `Access-Control-Allow-Origin: <validated Origin>`
- `Vary: Origin`
- 허용되지 않은 Origin에서 allow header 0건
- 성공/expired/wrong/used/rate-limited 응답을 Figma plugin UI의 `fetch`가 실제 읽을 수 있다는 integration test

Task 6 RED도 OPTIONS만 검증한다(`plan:1266-1281`). Preflight가 성공해도 실제 response에 ACAO가 없으면 browser/Figma UI는 ticket 또는 오류 body를 읽지 못한다.

정확한 수정: section 3.5에 POST 성공/4xx CORS matrix를 추가하고 `TabPairing` fetch를 통과하는 process test를 Task 6/9에 넣는다.

### R2-C-02 — `PluginHandlerOutcome` 전환의 파일·구현 범위가 없다

**Severity: Critical**

계획은 모든 handler가 `{ value, mutation:'changed'|'no-op' }`를 반환한다고 요구하고 dispatcher만 `commitUndo`를 호출하게 한다(`plan:247-255, 1564, 1611`). 그러나 Task 9 Files는 dispatcher/idempotency/registry와 `import-image`만 수정하며 나머지 write handler를 포함하지 않는다(`plan:1552-1559`).

원본의 `SandboxToolHandler`는 raw `unknown`을 반환하고(`code-kb/figwright/packages/plugin/src/dispatcher.ts:12`), 해당 타입을 사용하는 handler 파일은 103개다. 예를 들어 `rename-node.ts:15-17`은 기존 이름과 비교하지 않고 값을 대입한 뒤 raw `MutateResult`만 반환한다. 반면 Round 2 RED는 unchanged rename의 commit 0회를 요구한다(`plan:1581-1588`). 중앙 wrapper는 각 setter가 실제로 변경했는지 알 수 없다.

정확한 수정:

1. Task 9 Files에 mutation-producing handler 전체 또는 명시적 adapter map을 포함한다.
2. 78개 baseline document-write마다 changed/no-op 판정 책임과 fixture를 고정한다.
3. read/UI handler는 outcome wrapper 대상인지 dispatcher adapter 대상인지 명확히 한다.
4. wire result는 `outcome.value`만 전달되고 mutation metadata는 plugin 내부에만 남는 test를 둔다.
5. slice별 RED/GREEN/commit으로 분리해 B-I-10도 함께 닫는다.

### R2-C-03 — 30일 retention이 절대 exactly-once를 파괴한다

**Severity: Critical**

계획은 persisted succeeded key가 generation/restart와 무관하게 never re-executed라고 선언한다(`plan:28, 372-396, 1366-1415, 2312`). 동시에 terminal rows는 30일 후 제거한다(`plan:382-388, 1415, 2314`). 영구 tombstone 또는 actor namespace rotation 계약이 없으므로 삭제 뒤 같은 `(actorId, operationId)`와 동일 write가 새 operation처럼 실행될 수 있다.

정확한 수정은 둘 중 하나다.

- 영구 compact tombstone `{actorId,operationId,toolName,argsHash,workspaceId,fileExecutionKey,resultHash,status}`를 별도 bounded/indexed store에 보존하고 collision/restart test를 추가한다.
- 보장을 명시적인 30일 idempotency window로 낮추고 global/DoD/docs/client operation-ID lifecycle을 모두 바꾼다.

현재처럼 “never”와 “30일 삭제”를 동시에 유지할 수 없다.

### R2-C-04 — isolated MCP/CLI tarball의 내부 dependency가 닫히지 않는다

**Severity: Critical**

dependency table은 IR→shared, MCP→shared/IR, CLI→shared workspace 의존을 선언한다(`plan:796-802`). 그러나 Task 15 artifact는 `mcp.tgz`, `cli.tgz`, `plugin.zip`만 만들고(`plan:2055-2081`), Task 16 installer는 앞의 두 tarball만 빈 isolated prefix에 `npm install --ignore-scripts`한다(`plan:2154-2156`). 계획 전체에 다음 중 어느 것도 없다.

- shared/IR tarball
- `bundledDependencies`
- MCP `alwaysBundle: ['@sfp/shared','@sfp/ir']`
- CLI `alwaysBundle: ['@sfp/shared']`
- empty npm cache에서 isolated install/bin smoke test

원본 MCP는 이 문제를 피하려고 `code-kb/figwright/packages/mcp/tsdown.config.ts:22`에서 shared를 명시적으로 bundle한다. Round 2 계획대로라면 private `workspace:*` package를 registry에서 찾다가 설치가 실패하거나 잘못된 외부 버전을 해석할 수 있다.

정확한 수정: Task 15 Files에 MCP/CLI tsdown/package manifest를 넣고 internal workspace dependencies를 bundle하거나, shared/IR까지 네 tarball을 고정 lock으로 설치한다. 빈 npm cache의 install, `npm ls`, installed MCP/CLI bin 실행, workspace path 0건을 Task 15 GREEN으로 앞당겨야 Task 16이 안전하게 consume할 수 있다.

## 6. 새 Important findings

### R2-I-01 — `SnapshotStoragePort`와 path namespace가 선언되지 않았다

**Severity: Important**

`SnapshotStoragePort`라는 이름은 세 번 등장하지만 actual `export interface/type` declaration은 0건이다(`plan:544, 1708, 1753`). `save/load/list/delete` 중 무엇을 제공하는지, workspaceId/fileIdentity/snapshotId/checksum/path 인자·결과가 무엇인지 Task 11 구현자가 발명해야 한다.

또한 Task 10 design baseline은 `.sfp/snapshots/{fileIdentityHash}/{sanitizedNodeId}.json`을 사용한다(`plan:1673-1675`). Full SnapshotV1 store의 정확한 namespace가 없어 충돌 가능성도 남는다.

수정: binding contract에 exact port signature를 넣고 예를 들어 design baseline은 `.sfp/design-diff-baselines/v1/...`, SnapshotV1은 `.sfp/snapshots/v1/{fileHash}/{snapshotId}.json`으로 분리하며 endpoint 반환 path/checksum test를 추가한다.

### R2-I-02 — nested fidelity schema와 RED가 recursive algorithm 주장과 불일치한다

**Severity: Important**

계획은 failed/omitted descendant를 exact plan path와 함께 기록한다고 한다(`plan:544, 1755-1757`). 그러나 schema는 `failedSections: {nodeId,code}[]`, `sectionsOmitted:string[]`뿐이다(`plan:509-517`). 같은 node가 여러 경로에 나타날 때 구조화된 path를 보존할 수 없다.

또한 RED에서 `a2`는 다시 `root` plan을 반환해 cycle이므로 full leaf가 아닌데 `completeSections`에 `a2`를 넣는다(`plan:1734-1742`). 이는 “degraded/plan payload를 complete로 relabel하지 않는다”는 invariant와 충돌한다.

수정: `{nodeId, planPath:string[], code/reason}` 형태의 issue schema와 `expandedSections`/`completeLeafSections`를 분리하고, 위 fixture의 complete leaf는 `a1,b`만 되도록 고친다.

### R2-I-03 — journal hard-cap에서 빠져나올 manual resolution API가 없다

**Severity: Important**

Task 7은 cap 도달 후 status/doctor/manual-resolution만 허용한다고 하지만(`plan:1415`) `OperationStatus`, control Files/Interfaces, Task 13 command table 어디에도 unresolved list/acknowledge/resolve가 없다. outcome-unknown rows가 10,000개 또는 32 MiB를 채우면 정상적인 복구 경로 없이 모든 새 operation이 영구 차단될 수 있다.

수정:

- `OperationResolutionRecord`와 `unknown-acknowledged` 같은 terminal state를 정의한다.
- authenticated `GET /control/operations?status=outcome-unknown` 및 explicit-confirmation `POST /control/operations/:id/acknowledge`를 Task 7에 둔다.
- Task 13에 `sfp operations unresolved/acknowledge`를 추가한다.
- acknowledge가 replay 허가가 아니며 같은 ID는 계속 settled/conflict라는 invariant와 cap recovery RED를 추가한다.

### R2-I-04 — public-suffix-only 거부를 구현할 PSL authority가 없다

**Severity: Important**

Task 8은 `com`, `co.uk` 같은 public suffix만의 allowlist 등록을 거부한다고 요구하지만(`plan:1528-1530, 1900-1901`), dependency table/file map/lock에는 PSL library나 pinned data authority가 없다(`plan:649-802`). 단순 label 수 검사로는 multi-label suffix를 판정할 수 없고 `includeSubdomains:true`에 `co.uk`가 등록되면 광범위 wildcard가 된다.

수정: pinned `tldts` 같은 PSL dependency 또는 provenance가 있는 PSL snapshot/updater를 dependency·lock·SBOM·notice에 넣고 ASCII/punycode 정규화 authority를 하나로 고정한다. `com`, `co.uk`, `example.com`, `example.co.uk`, Unicode/ASCII equivalent, trailing dot fixture가 필요하다.

## 7. 핵심 요구별 최종 표

| 확인 항목 | 결과 | 결론 |
|---|---|---|
| Safe vendoring | PASS | copy/merge/reference, root hash, lock/frozen install이 명확함 |
| AST import gate | PASS | runtime specifier와 raw protocol/provenance string을 분리 |
| Generation/idempotency | FAIL | generation branch는 PASS, 30일 retention이 permanent guarantee 파괴 |
| DAG ports | PARTIAL | Workspace guard/T11→T8는 PASS, SnapshotStoragePort signature는 FAIL |
| Pairing/PNA/ACL | FAIL | preflight/ACL은 PASS, 실제 POST CORS response가 없음 |
| Snapshot port/nested sections | FAIL | recursion bounds는 PASS, port/path/fidelity schema가 불완전 |
| `commitUndo` | FAIL | sole owner 선언은 PASS, 103 handler outcome migration plan이 없음 |
| Capability/runtime authority | PASS | typo/hash/RuntimeBinding/server7→10이 닫힘 |
| Journal caps | FAIL | numeric cap은 PASS, retention guarantee와 recovery API가 없음 |
| Packed artifact/evidence | FAIL | installed-bin/signature flow는 PASS, internal dependency closure가 없음 |
| Source-complete vs GA | PASS | 상태와 외부 evidence gate가 명확히 분리됨 |

## 8. READY 전 최소 수정 순서

1. POST `/pair/exchange` 성공/오류 CORS response 계약과 UI integration test를 추가한다.
2. write handler별 mutation outcome migration scope를 Files/Tasks/RED/GREEN/commit으로 만든다.
3. 30일 idempotency 보장 범위를 수정하거나 permanent tombstone을 추가하고 manual outcome resolution을 구현한다.
4. MCP/CLI internal workspace dependency를 bundle/pack하고 empty-cache isolated install을 Task 15 gate로 만든다.
5. exact `SnapshotStoragePort`, 분리된 namespace, structured recursive fidelity를 정의한다.
6. PSL authority와 IDN normalization tests를 추가한다.
7. Task 7/9/12 review slice마다 독립 RED/GREEN/commit을 만들어 B-I-10을 닫는다.

위 수정 전에는 Task 6 pairing, Task 9 undo GREEN, Task 15/16 isolated artifact, exactly-once/journal recovery를 계획대로 구현·검증할 수 없으므로 implementation handoff는 **NOT READY**다.
