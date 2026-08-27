# Agent A 구현 계획 Fix Round 2 최종 Scoped Re-review

> 대상: [`2026-08-27-super-figma-pipeline-v0.1.md`](../../superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md)  
> 검증 snapshot: SHA-256 `2C9CE04C6C06263559EAF11ABE0A774AD8E5D3B0E43931B3F4D0113AAB6FDE31`, 2,471행  
> 이전 입력: [`agent-a-rereview-implementation-plan.md`](agent-a-rereview-implementation-plan.md)의 미종결 8건  
> 판정일: 2026-08-27 (Asia/Seoul)  
> 판정 원칙: §10 Round 2 ledger의 `accepted` 선언만 신뢰하지 않고, 각 finding마다 binding interface, producing Task, failing RED, GREEN/DoD, downstream consumer가 연결되는지 확인했다. 계획 본문과 세 원본 OSS는 수정하지 않았다.

## 1. 결론

| 범위 | ADDRESSED | NOT ADDRESSED | 합계 |
|---|---:|---:|---:|
| Round 1 기존 미종결 | 3 | 0 | 3 |
| Round 1 신규 finding | 5 | 0 | 5 |
| **검토 대상 전체** | **8** | **0** | **8** |

요청된 8건은 전부 해결됐다.

§10 `Round 2 resolutions — Agent A rereview`의 8개 `accepted` row와 독립 판정은 8/8 일치하며, ledger 대비 판정 불일치는 0건이다. 새 finding 2건은 그 ledger의 기존 row를 다시 여는 것이 아니라 Round 2가 새로 도입한 hard-cap/domain-validation 계약에서 발견한 후속 breakage다.

- Egress는 exact result-policy registry와 pre-execution consent upper bound를 가지며, unknown/disallowed class에서 runtime mock 호출 **0회**를 검사한다.
- Workspace add/list/remove는 authenticated control endpoint, journal usage guard, nonce/actor/realpath tests, CLI consumer까지 이어진다.
- `figma.commitUndo()`는 plugin top-level dispatcher 한 곳만 소유하고 handler·navigation·read·no-op·failure는 직접 commit하지 않는다.
- Persisted success, pending/queued/dispatched, plugin generation change와 mismatch semantics가 서로 구분된다.
- Remote image는 vetted IP로 실제 TLS connection을 pin하고 Host/SNI/certificate/remoteAddress를 검증하며, owner-managed empty-default domain config를 갖는다.

그러나 Round 2 fix가 새로 도입한 계약에서 **새 Critical은 없고 새 Important 2건**이 발견됐다. 둘 다 Task 7/8 RED를 그대로 구현하려면 추가 authority가 필요한 문제라 implementation handoff verdict는 **NOT READY**다.

## 2. Round 1 open 8건 최종 판정

| Finding | 최종 판정 | 실제 반영 근거 | 결론 |
|---|---|---|---|
| A-IP-I04 — workspace config authority | **ADDRESSED** | Exact file map에 `workspace-endpoints.ts`(`plan:741-745`), Task 7 Files/Produces에 endpoint와 test(`plan:1320-1335`), authenticated GET/POST/DELETE·server-derived actor·nonce·realpath·unsettled guard RED/GREEN(`plan:1394-1400,1417-1429`), Task 13 exact CLI routes(`plan:1886-1936`) | Store와 CLI 사이 비어 있던 daemon transport가 완결됐다. |
| A-IP-I09 — egress/progress/result schemas | **ADDRESSED** | `ResultEgressPolicy`, classified payload, pre/output manifests(`plan:260-298`); exact baseline112 policy authority와 classifier tests(`plan:1164-1221`); Task 7 preflight→runtime→post-classification order와 runtime-zero matrix(`plan:1354-1364,1421-1429`); Task 12 final116 coverage(`plan:1796-1819,1854-1862`) | Result schema, egress classifier, progress wire가 모두 machine-checkable authority를 가진다. |
| A-IP-I10 — approval CLI/undo | **ADDRESSED** | `figma-ui`, `PluginHandlerOutcome`, `UndoBoundaryPolicy` 계약(`plan:221-258`); dispatcher sole owner와 UI/read/no-op RED(`plan:1550-1589`); structural one-call-site gate와 exact 79 baseline policies(`plan:1605-1621`); library handler direct commit 금지와 final80 policy(`plan:1796-1815,1850-1862`); CLI approval routes(`plan:1893-1903`) | Approval CLI와 exactly-once/zero undo ownership 모순이 제거됐다. |
| AR-IP-N01 — runtime 전 egress fail-closed | **ADDRESSED** | Global constraint가 preflight를 queue/runtime보다 앞에 두고 runtime count zero를 고정한다(`plan:26`). `possibleInputClasses`, `possibleResultClasses`, input/result classifiers와 nullable consent manifests가 분리됐다(`plan:263-298`). Task 7 RED가 document write, image, project code, network import 네 경로에서 runtime 0회를 확인한다(`plan:1354-1364`). 실행 순서와 contract-breach 상태도 binding이다(`plan:1421-1429`). | 이전의 runtime-before-consent 결함이 명시적 RED로 닫혔다. |
| AR-IP-N02 — workspace control endpoint 부재 | **ADDRESSED** | Task 7이 `/control/workspaces*`를 produce하고 `workspace-endpoints.test.ts`를 소유한다(`plan:1328-1335`). Actor body override, nonce replay, invalid path, unsettled removal이 실패한다(`plan:1394-1400,1417-1419`). Task 13 fake server가 exact method/path를 검사한다(`plan:1929-1936`). | Endpoint producer와 consumer가 같은 schema로 연결됐다. |
| AR-IP-N03 — undo owner/navigation effect 충돌 | **ADDRESSED** | `navigate_to_page`는 compatibility kind write를 유지하되 effect는 `figma-ui`만 가진다(`plan:258,1209-1215`). Handler와 file identity module의 direct commit을 구조적으로 금지하고 production `commitUndo` call site를 dispatcher 1개로 고정한다(`plan:1605-1621`). Safe-union handler도 `PluginHandlerOutcome`만 반환한다(`plan:1850-1862`). | kind, document effect, mutation outcome, undo owner가 분리됐다. |
| AR-IP-N04 — persisted success/restart semantics | **ADDRESSED** | `OperationAlreadySettled`와 numeric journal limits(`plan:339-396`); restart/new generation exact success runtime-zero, mismatch conflict, pending/queued/dispatched transitions RED(`plan:1366-1392`); bounded in-memory replay와 durable hash-only settled behavior(`plan:1409-1415`); reconnect consumer도 old-generation success를 재실행하지 않는다(`plan:1677-1679`). | Persisted success는 generation과 무관하게 settled이며 raw result 없이 hash/status를 반환한다. |
| AR-IP-N05 — DNS-pinned connect/domain config | **ADDRESSED** | Remote domain store와 pinned address contracts(`plan:593-625`); `node:https.request` custom lookup, original Host/SNI, default certificate verification, `secureConnect.remoteAddress` membership, redirect별 새 resolution/connection(`plan:623-625`); public→private/drift/redirect/approval-nonexpansion RED(`plan:1473-1507`); authenticated empty-default domain control 및 CLI(`plan:1524-1536,1888-1936`) | DNS 검증과 실제 socket connect 사이 TOCTOU 및 runtime approval→allowlist 확대 문제가 닫혔다. |

## 3. 핵심 요청별 cross-check

### 3.1 Runtime-before-egress 0회

**PASS.** Task 7은 다음 순서를 binding한다.

~~~text
parse/effects/approval
→ classify input + possible result upper bound
→ persist pre-execution consent
→ consent/classes/budget gate
→ queue/runtime
→ strict result parse/classify/redact/output manifest
~~~

Unknown mode 또는 허용되지 않은 input/possible-result class는 queue 진입 전 실패한다. RED는 `create_text`, `get_screenshot`, `scan_components`, URL `import_image` 각각에서 `runtime.not.toHaveBeenCalled()`을 확인한다(`plan:1354-1364,1421-1429`).

### 3.2 Workspace endpoints

**PASS.** Task 4 store와 Task 7 journal guard 사이 reverse import를 없애기 위해 `WorkspaceUsageGuard`를 주입하고(`plan:419-437,1094-1140`), Task 7이 authenticated endpoint를 mount하며 Task 13 CLI가 exact routes만 사용한다. Body actor override와 workspace-in-use negative case도 존재한다.

### 3.3 Sole `commitUndo` owner

**PASS.** Baseline 79와 final 80 write-kind policy rows는 모두 존재하되 `navigate_to_page`는 `figma-ui`/false다. Handler·file identity direct calls는 structural test로 0개, top-level dispatcher production call site는 정확히 1개다. Library import는 outcome만 반환한다(`plan:1563-1621,1796-1815,1850-1862`).

### 3.4 Settled/generation semantics

**PASS for the Round 1 requirement.** Exact persisted success는 result cache가 없어도 `OPERATION_ALREADY_SETTLED`이고 runtime 0회다. Generation change 시 pending approval은 rejected, queued는 failed, dispatched는 outcome-unknown, succeeded는 settled다. 다른 args/tool/workspace/file target은 계속 conflict다(`plan:28-29,372-396,1366-1415`).

### 3.5 DNS-pinned connect와 domain lifecycle

**PASS for the Round 1 requirement.** 검증된 IP가 custom lookup의 실제 connect address가 되고 certificate hostname은 원 host로 유지된다. `secureConnect` 뒤 remote address도 재확인한다. Redirect는 resolver/connector를 새로 만든다. Domain default는 empty이고 control/CLI add/list/remove만 변경하며 one-call approval은 확대 권한이 없다(`plan:593-625,1443-1548,1888-1936`).

## 4. Round 2 fix가 만든 새 finding

### AR2-IP-N01 — Journal의 “manual resolution”은 호출 가능한 계약이 아니다

**Severity: Important**

Round 2는 hard cap에 도달하면 status/doctor/**manual-resolution**만 허용한다고 쓰고, unresolved/unknown row는 explicit resolution을 요구한다(`plan:1413-1415,2312-2314`). 그러나 다음이 전부 없다.

- `OperationStatus`의 resolved/acknowledged terminal state.
- `/control/operations` list/status/acknowledge endpoint와 file/test.
- CLI unresolved list/acknowledge command.
- 누가 어떤 근거로 outcome-unknown을 종결했는지 기록하는 actor/decision/time schema.

따라서 outcome-unknown 한 건은 workspace removal을 무기한 막고, 충분히 쌓이면 새 operation 전체를 영구 차단할 수 있는데 정상적인 복구 경로가 없다. 또한 terminal rows를 30일 뒤 제거하면서 Global의 “persisted succeeded key는 재실행하지 않는다”를 얼마나 오래 보장하는지도 명시되지 않았다(`plan:28,382-388,1413-1415`).

**정확한 수정안**

1. `OperationStatus`에 `unknown-acknowledged` 같은 terminal state와 `OperationResolutionRecord {actorId,operationId,decision,reasonHash,decidedAt}`를 추가한다.
2. Authenticated `GET /control/operations?status=outcome-unknown`과 `POST /control/operations/:id/acknowledge`를 Task 7에 추가한다. Acknowledge는 재실행 허가가 아니며 동일 operation ID는 계속 settled/conflict여야 한다.
3. Task 13에 `sfp operations unresolved`와 explicit-confirmation `acknowledge`를 추가한다.
4. Hard-cap 상태에서도 이 endpoint가 동작해 cap 아래로 compact되고 workspace guard가 해제되는 RED를 추가한다.
5. 30일 retention 뒤 idempotency 보장 범위를 문서화하거나, args/result hash만 가진 최소 tombstone을 더 오래 보존한다.

### AR2-IP-N02 — Public-suffix-only domain 거부에 PSL authority가 없다

**Severity: Important**

Task 8은 `com`, `co.uk` 같은 public suffix를 allowlist rule로 등록하지 못하게 해야 하지만(`plan:1528-1530`), declared runtime dependency에는 PSL library/data가 없고(`plan:794-802`), exact file map에도 vendored PSL snapshot/update/provenance authority가 없다. 문자열 label 수만 검사하면 `co.uk` 같은 multi-label suffix를 놓쳐 `includeSubdomains:true`가 사실상 광범위 wildcard가 될 수 있다.

**정확한 수정안**

- `tldts`/동등 PSL library를 exact version으로 mcp dependencies와 lock/SBOM/notices에 추가하거나, provenance가 있는 pinned PSL snapshot과 deterministic updater를 명시한다.
- Domain normalization을 ASCII/punycode authority 하나로 고정하고, registrable-domain 존재 여부로 public-suffix-only를 거부한다.
- 최소 `com`, `co.uk`, `example.com`, `example.co.uk`, Unicode/ASCII equivalent, trailing dot, suffix-rule duplicate를 RED/GREEN으로 고정한다.

## 5. 새 Critical/Important 탐지 결과

| 등급 | 수 | Finding |
|---|---:|---|
| Critical | 0 | 없음 |
| Important | 2 | AR2-IP-N01 journal resolution, AR2-IP-N02 PSL authority |

이번 scoped review에서는 Minor 문구나 구현 취향은 새 finding으로 올리지 않았다. 두 finding은 모두 Round 2에서 새로 강화한 hard-cap/domain-policy 요구를 실제로 구현·복구할 authority가 없다는 점만 다룬다.

## 6. Final verdict

**Implementation handoff: NOT READY.**

Round 1 open 8건은 전부 `ADDRESSED`이며 핵심 security/correctness 경로는 상당히 구체적이다. 그러나 계획이 스스로 요구하는 journal explicit resolution과 public-suffix rejection을 현재 Task/File/Dependency로 구현할 수 없으므로, handoff 전에 위 Important 2건을 짧은 보정으로 닫아야 한다.

보정 후 READY 기준은 다음과 같다.

1. Outcome-unknown list/acknowledge의 typed control·CLI·journal transition과 hard-cap recovery RED가 있다.
2. Public suffix 판정에 사용할 pinned dependency/data, normalization contract, license/SBOM, multi-label suffix tests가 있다.
3. 위 변경 뒤에도 final `116 tools / 106 handlers / server10`, result/operation/egress116, undo80과 18개 Task dependency가 변하지 않는다.
