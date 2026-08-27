# Agent A 구현 계획 Fix Round 3 최종 Scoped Re-review

> 대상: [`2026-08-27-super-figma-pipeline-v0.1.md`](../../superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md)  
> 검증 snapshot: SHA-256 `A7BCB30A09DA3E0DDF0DE1511D2464E569245F6E77D3AD7F3DB56EA971EC0069`, 2,800행  
> 이전 입력: [`agent-a-rereview2-implementation-plan.md`](agent-a-rereview2-implementation-plan.md)의 Important 2건과 [`agent-b-rereview2-implementation-plan.md`](agent-b-rereview2-implementation-plan.md)의 관련 Round 3 ledger  
> 판정일: 2026-08-27 (Asia/Seoul)  
> 원칙: §10 `Round 3 resolutions`의 선언이 아니라 binding type, Task owner, RED/GREEN, package dependency, control/CLI consumer가 서로 실행 가능한지 검증했다. 계획 본문과 원본 OSS는 수정하지 않았다.

## 1. 결론

| 범위 | ADDRESSED | NOT ADDRESSED | 합계 |
|---|---:|---:|---:|
| Agent A Round 2 신규 Important | 1 | 1 | 2 |
| Agent B 관련 Round 3 ledger | 10 | 6 | 16 |
| **전체** | **11** | **7** | **18** |

Round 3에서 다음은 실제로 닫혔다.

- 실제 `POST /pair/exchange` 성공·typed error CORS/PNA/Vary matrix와 plugin UI fetch integration.
- Baseline 79/final 80 write handler의 explicit `{value,mutated}` contract, wire stripping, dispatcher-only `commitUndo`.
- Exact FQDN equality만 허용하는 no-suffix/no-PSL v0.1 범위 축소.
- MCP/CLI internal workspace bundle closure와 isolated one-tarball install/bin smoke.
- Recursive snapshot fidelity의 expanded plan/complete leaf/issue 분리.
- Task 2/7/9/12의 dependency-visible subtask review/commit boundaries.

하지만 implementation handoff는 아직 **NOT READY**다. Round 3 fix가 만든 새 Critical 2건과 Important 1건이 있다.

1. HMAC 발급 operation ID만 허용하면서 binding Task 7 RED가 여전히 `'op-1'`, `'new-op'`을 사용한다.
2. Task 4 shared의 `SnapshotStoragePort`가 Task 11 IR 소유 `SnapshotV1`을 선행 참조해 package/type ownership이 순환한다.
3. Hard-cap resolution은 prior approval과 대량 resolve를 요구하지만 cap 상태에서 approval을 생성·승인하거나 bulk resolve하는 계약이 없다.

## 2. Finding별 최종 판정

### 2.1 Agent A Round 2 신규 Important

| Finding | 판정 | 근거와 결론 |
|---|---|---|
| AR2-IP-N01 — operations resolution/horizon | **NOT ADDRESSED** | Resolved states, HMAC operation ID, tombstone horizon, issue/list/status/resolve endpoints, CLI와 no-replay 원칙은 추가됐다(`plan:349-449,1466-1622,2163-2232`). 그러나 signed-ID 이전 RED가 forged literal을 사용해 의도한 conflict/cap/settled branch에 도달하지 못하고(`plan:1493-1543`), hard-cap recovery test는 정의되지 않은 bulk helper와 이미 존재하는 `approvalId`를 가정한다(`plan:1575-1593`). Resolution이 요구하는 prior approval을 cap 상태에서 어떻게 생성·승인하는지도 없다(`plan:1608-1612`). AR3-N01/N03 참조. |
| AR2-IP-N02 — PSL authority | **ADDRESSED** | Suffix/subdomain 기능을 v0.1에서 삭제하고 exact ASCII FQDN equality만 허용한다. `domainToASCII`, lowercase, no trailing dot/wildcard/port/path/IP, 최소 3 labels, redirect host 별도 allowlist를 binding한다(`plan:684-715,1666-1734`). `com`, `co.uk`, `example.com`을 syntax scope로 거부하고 `assets.example.com`만 exact match하며 subdomain은 불허한다. Semantic PSL 보장도 주장하지 않으므로 별도 PSL authority가 필요 없다. |

### 2.2 Agent B 관련 Round 3 ledger

| Finding | 판정 | 근거와 결론 |
|---|---|---|
| B-I-03 — pairing POST/PNA | **ADDRESSED** | Allowed three Origins의 actual POST 200 및 typed 400/401/409/429/500에 ACAO/ACAPN/Vary를 강제하고 hostile/absent Origin은 allow header/oracle body를 받지 않는다(`plan:492-545,1356-1442`). Task 9 real UI fetch adapter도 ticket/error body를 읽는 RED를 가진다(`plan:1804-1809`). |
| B-I-04 — Snapshot storage boundary | **NOT ADDRESSED** | Port method/key/ref와 Task 8 concrete adapter는 생겼지만 shared port의 `save/load`가 `SnapshotV1`을 직접 참조한다(`plan:591-635`). `SnapshotV1`은 Task 11의 `packages/ir/src/snapshot-v1.ts`에서 생성되고 IR은 shared에 의존한다(`plan:804-809,1939-1951`). Task 4 shared가 나중 Task/하위 package type을 import할 수 없어 ownership 또는 generic/byte codec 결정이 빠졌다. AR3-N02 참조. |
| B-I-05 — nested snapshot fidelity | **ADDRESSED** | `expandedSections`, `completeLeafSections`, structured issues에 node/path/order/depth/status가 있고(`plan:560-589`), cycle fixture는 expanded `root,a,a2`, complete leaf `a1,b`, cycle issue `root`로 정확히 분리한다. depth9/section257 cap RED도 있다(`plan:1953-1999`). |
| B-I-07 — undo/live artifact | **ADDRESSED** | Task 9가 exact 78 non-batch+batch files, generated 79-name contract, hand-derived changed/no-op fixtures, wire-value stripping과 sole dispatcher call site를 소유한다(`plan:1754-1869`). Task 15는 internal packages를 bundle하고 isolated tarball smoke를 수행한다(`plan:889-900,2326-2386`). |
| B-I-10 — review granularity | **ADDRESSED** | Task 2/7/9/12에 subtask별 review surface, RED/GREEN, commit, frozen downstream handoff가 생겼다(`plan:1063-1070,1483-1491,1770-1778,2058-2065`). 단순 설명이 아니라 dependency-visible commit boundary다. |
| N-C-03 — generation/idempotency retention | **NOT ADDRESSED** | 30-day server-issued/HMAC ID, horizon tombstone, expired-ID runtime zero와 generation transition contract 자체는 일관된다(`plan:361-449,1602-1608`). 하지만 core RED의 literal IDs는 verification에서 먼저 `OPERATION_ID_INVALID`가 되어 settled/conflict/cap을 증명하지 못한다(`plan:1493-1543`). AR3-N01 참조. |
| N-I-01 — journal cap/manual resolution | **NOT ADDRESSED** | 상태/API/CLI/audit는 추가됐으나 resolution은 prior approval을 요구한다. Hard cap allowlist에는 approval creation/settlement이 없고, cap recovery RED는 실제 per-ID endpoint 대신 undefined `resolveOldestUnknowns`와 preexisting approval을 사용한다(`plan:1575-1612`). Fresh hard-cap 사용자가 정상 recovery를 시작할 수 있다는 증거가 없다. AR3-N03 참조. |
| N-I-03 — packed artifact/live evidence | **ADDRESSED** | MCP bundles shared+IR, CLI bundles shared; packed manifest는 private/workspace runtime dependency를 제거한다. 각 tarball을 fresh cache/empty prefix에 단독 설치해 `npm ls`, installed MCP 116 tool smoke, CLI help/status와 workspace path 0건을 검증한다(`plan:889-900,2326-2386`). |
| R2-C-01 — actual pair POST CORS | **ADDRESSED** | POST success와 wrong/expired/used/rate/internal error matrix, allowed/hostile/absent Origin, shared response helper, Task 9 UI fetch가 모두 있다(`plan:537-545,1389-1442,1804-1809`). |
| R2-C-02 — all mutation handler outcomes | **ADDRESSED** | Baseline exact79 contract와 fixtures, 78 non-batch+batch migration, read/mutation handler type 분리, wire metadata strip, final library row80, sole production commit site를 명시한다(`plan:247-266,1758-1869,2042-2134`). |
| R2-C-03 — retention/exactly-once | **NOT ADDRESSED** | 30-day horizon scope 축소와 tombstone/token expiry contract는 합리적이다. 그러나 이를 검증해야 할 persisted success/conflict/cap tests가 invalid literal ID를 사용해 HMAC precondition을 통과하지 못한다(`plan:1493-1543`). Contract와 RED가 불일치해 handoff gate로는 미종결이다. |
| R2-C-04 — isolated tarball closure | **ADDRESSED** | `alwaysBundle`, packed manifest rejection, one-tarball/fresh-cache install, `npm ls`, MCP list-tools116, CLI installed-bin smoke가 exact Task 15 gate다(`plan:889-900,2326-2386`). |
| R2-I-01 — exact SnapshotStoragePort | **NOT ADDRESSED** | Signatures/namespace/checksum은 구체화됐지만 port parameter `SnapshotV1`의 package owner가 Task 4 shared와 Task 11 IR 사이에서 정의되지 않았다. 이 상태로는 Task 4/8가 Task 11보다 먼저 typecheck할 수 없다(`plan:591-635,1200-1268,1939-2010`). AR3-N02 참조. |
| R2-I-02 — recursive fidelity | **ADDRESSED** | Expanded plan과 complete leaf를 분리하고 failed/cycle/depth/cap issue가 stable planPath/order/depth를 가진다. Nested/cap/store RED가 schema와 일치한다(`plan:560-635,1953-2014`). |
| R2-I-03 — manual resolution | **NOT ADDRESSED** | Issue/list/status/resolve/CLI와 terminal states는 존재한다. 하지만 prior approval bootstrap과 hard-cap actual endpoint recovery가 빠져 “resolution available at cap”을 실행 가능하게 증명하지 못한다(`plan:1575-1612,2163-2232`). AR3-N03 참조. |
| R2-I-04 — no-PSL exact FQDN | **ADDRESSED** | includeSubdomains/suffix match를 제거했다. Exact 3+ label host만 equality match하며 redirect도 별도 exact allowlist를 요구한다. Apex 1/2-label과 wildcard/dotted form을 의도적으로 제외하고 PSL claim을 삭제했다(`plan:684-715,1702-1734,2304-2306`). |

## 3. 요청 핵심 항목 cross-check

| 항목 | 판정 | 요약 |
|---|---|---|
| Operations resolution/horizon | **FAIL** | 계약은 추가됐지만 signed-ID RED와 approval-at-cap/bulk recovery가 실행 불가 |
| Exact FQDN, no PSL | **PASS** | suffix 기능 자체를 제거한 안전한 scope reduction |
| Pair POST CORS/PNA | **PASS** | success 및 모든 typed error, hostile/absent Origin, UI fetch까지 연결 |
| 80 write outcomes/sole undo | **PASS** | baseline79+library80, fixture ledger, wire strip, dispatcher 1 call site |
| Bundled tarball | **PASS** | shared/IR closure, no workspace dependency, isolated install/bin smoke |
| SnapshotStoragePort | **FAIL** | method는 exact하나 `SnapshotV1` type owner가 shared↔IR 순환 |
| Nested fidelity | **PASS** | expanded vs leaf vs issue와 stable path/order/depth가 일치 |

## 4. 새 Critical/Important

### AR3-IP-N01 — Signed operation-ID contract와 binding RED가 충돌한다

**Severity: Critical**

Section 3.3과 Task 7 Step 3은 모든 supplied operation ID를 HMAC/actor/issuedAt 기준으로 **idempotency lookup 전에** 검증하며 forged ID는 `OPERATION_ID_INVALID`라고 한다(`plan:361-449,1602-1604`). 그런데 binding RED는 다음 literal을 그대로 쓴다.

- Same-ID conflict: `'op-1'`(`plan:1496-1500`).
- Restarted success/mismatch: `'op-1'`(`plan:1522-1528`).
- Hard active-cap rejection: `'new-op'`(`plan:1531-1535`).

따라서 이 테스트는 기대한 `OPERATION_ID_CONFLICT`, `OPERATION_ALREADY_SETTLED`, `JOURNAL_CAPACITY_EXCEEDED`까지 도달하지 않고 먼저 `OPERATION_ID_INVALID`로 끝난다. 검증을 느슨하게 만들면 production HMAC gate를 훼손한다.

**정확한 수정안**

1. 모든 Task 7 fixture ID를 `issuer.issue(actorId, fixedNow)`로 생성한다.
2. Seeded record/tombstone의 `issuedAt`, actorHash, operationId claims를 같은 issuer fixture에서 만든다.
3. Conflict는 같은 valid ID+다른 args, capacity는 fresh valid ID, expiry/forgery는 별도 test로 유지한다.
4. `rg`/AST test로 security fixture 밖의 supplied literal operation ID를 금지한다.

### AR3-IP-N02 — Shared storage port가 IR의 미래 `SnapshotV1`을 참조한다

**Severity: Critical**

Task 4가 `service/packages/shared/src/snapshot-storage.ts`와 exact port를 생성하고 Task 8이 구현한다. 그러나 port signature는 `snapshot: SnapshotV1` 및 `snapshot: SnapshotV1` result를 사용한다(`plan:591-635`). `SnapshotV1`은 Task 11의 `packages/ir/src/snapshot-v1.ts`에서 생성되며 IR은 shared에 의존한다(`plan:804-809,1939-1951`).

선택 가능한 현 상태는 모두 문제가 있다.

- shared→IR type import: package dependency cycle.
- Task 4가 duplicate `SnapshotV1` 선언: Task 11 authority와 drift.
- Task 8이 `unknown` cast: exact typed port 주장 위반.

**정확한 수정안 — 하나를 binding**

1. 권장: `SnapshotV1`/fidelity structural types를 shared로 이동하고 IR은 shared type에 대한 strict Zod schema·canonicalization만 소유한다.
2. 또는 shared port를 `SnapshotStoragePort<TSnapshot>` generic으로 만들고 concrete codec/serializer injection이 Task 8 이전에 존재하도록 DAG를 조정한다.
3. Task 4 typecheck와 Task 8 fake SnapshotV1 round trip, Task 11 schema compatibility를 같은 type authority에 고정한다.

### AR3-IP-N03 — Hard-cap resolution의 approval bootstrap과 bulk 경로가 없다

**Severity: Important**

`POST /control/operations/:id/resolve`는 prior approval, approvalId, actionNonce, reason/evidence hash를 요구한다(`plan:1575-1585,1610-1612`). 하지만 active cap allowlist는 status/doctor/operation list-status-resolve만 허용하고 approval request/settlement을 포함하지 않는다(`plan:1606-1608`). Cap에 이미 도달한 fresh operator가 resolution approval을 생성·승인하는 경로가 없다.

또한 cap recovery RED는 실제 per-ID route가 아닌 `control.resolveOldestUnknowns({count:3000,...})`를 호출한다(`plan:1587-1593`). Bulk endpoint/schema/최대 batch/selection hash는 Files·Interfaces·CLI에 없고, one-use approval/nonce 하나로 3,000 records를 해결할 권한 범위도 정의되지 않았다.

**정확한 수정안**

- Resolution을 control-auth+actionNonce+explicit confirmation 자체로 승인된 administrative action으로 정의해 별도 approvalId를 제거하거나,
- Cap 상태에서도 resolution approval request/list/settle을 허용하고 two-phase endpoint를 명시한다.
- Bulk가 필요하면 exact ID set hash, max batch, one approval scope, per-record resolution audit를 가진 `/control/operations/resolve-batch`를 추가한다. 아니면 RED를 실제 single-ID endpoint loop와 각 nonce/approval로 작성한다.
- “preexisting approval fixture” 없이 hard cap에서 시작해 approve→resolve→compact→new valid operation 성공까지 검증한다.

## 5. 새 finding 집계

| 등급 | 수 | Finding |
|---|---:|---|
| Critical | 2 | AR3-IP-N01 signed-ID RED, AR3-IP-N02 SnapshotV1 ownership |
| Important | 1 | AR3-IP-N03 resolution approval/bulk recovery |

문구·명명·UX 취향은 새 finding으로 올리지 않았다. 위 세 건은 각각 Task 7 GREEN branch 도달 불가, package typecheck 순환, hard-cap recovery 불가라는 실행 차단만 다룬다.

## 6. Final verdict

**Implementation handoff: NOT READY.**

Round 3는 pair, handler outcomes, tarball closure, recursive fidelity, exact-FQDN 범위를 충분히 구체화했다. 그러나 다음 세 보정 전에는 계획을 그대로 실행할 수 없다.

1. Task 7의 supplied fixture IDs를 전부 issuer-generated valid tokens로 교체한다.
2. `SnapshotV1` type ownership을 shared 또는 generic port 한 곳으로 고정한다.
3. Hard-cap에서 approval을 처음부터 만들 수 있는 실제 resolution route와 batch/single-ID RED를 정의한다.

이 세 변경은 canonical `116/106/server10`, operation/egress116, undo80, 18개 Task numbering을 바꿀 필요가 없다. 반영 후에는 위 세 blocker만 scoped 확인하면 implementation handoff를 재판정할 수 있다.

