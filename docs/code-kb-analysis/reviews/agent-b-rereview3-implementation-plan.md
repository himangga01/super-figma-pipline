# 구현 계획 Fix Round 3 최종 Scoped Re-review — Agent B

> 검토일: 2026-08-28  
> 대상: `docs/superpowers/plans/2026-08-27-super-figma-pipeline-v0.1.md`  
> 대상 SHA-256: `A7BCB30A09DA3E0DDF0DE1511D2464E569245F6E77D3AD7F3DB56EA971EC0069`  
> 대상 크기/물리 행: 191,782 bytes / 2,800행  
> 이전 기준: `agent-b-rereview2-implementation-plan.md`의 open rows, Critical 4건, Important 4건과 §10 Round 3 ledger

## 1. 최종 verdict

**Implementation handoff: NOT READY.**

Round 3는 pair POST CORS, baseline 79+library mutation outcome, 30일 signed-ID/tombstone 모델, alwaysBundle isolated install, nested fidelity, operation resolution, exact FQDN scope 축소를 실질적으로 강화했다. 그러나 Round 3 ledger 16행을 독립 검증한 결과는 **ADDRESSED 9 / NOT ADDRESSED 7**이다.

남은 핵심은 다음과 같다.

- 새 Critical 2건: `SnapshotStoragePort`의 shared↔IR dependency cycle, signed-ID 계약과 Task 7 RED의 unsigned fixture 충돌.
- 새 Important 2건: tombstone-full resolution 저장 공간 부재, release pack producer의 `verify:release` wiring 불명확.
- B-I-10은 subtask 표와 실제 numbered RED/GREEN/commit 단계가 서로 맞지 않아 닫히지 않았다.
- `service/`는 아직 존재하지 않으므로 이는 plan/source 정적 검증이며 구현 테스트 통과 주장이 아니다.

## 2. 이전 open rows 8건 binary 판정

| Finding | Round 3 판정 | 근거 |
|---|---|---|
| B-I-03 — pairing/PNA/ACL | **ADDRESSED** | OPTIONS와 실제 POST 성공/typed error의 ACAO/ACAPN/Vary matrix, hostile/absent Origin negative, UI fetch adapter가 모두 연결됐다(`plan:537-543, 1389-1442, 1804-1809`). |
| B-I-04 — filesystem/storage port | **NOT ADDRESSED** | 정확한 port method/path는 생겼지만 shared port가 미래 IR `SnapshotV1`을 직접 사용하여 compile/DAG cycle을 만든다(`plan:627-635, 894, 1204-1212, 1943-1951`). R3-C-01 참조. |
| B-I-05 — nested snapshot fidelity | **ADDRESSED** | structured `planPath/order/depth/status`, expanded plan과 complete leaf 분리, cycle/depth8/section256 fixture가 일치한다(`plan:563-589, 1955-2014`). |
| B-I-07 — commitUndo/live evidence | **ADDRESSED** | baseline 79 write-name outcome migration, sole dispatcher owner, wire metadata stripping, final library row 80과 packed evidence 흐름이 구체화됐다(`plan:1754-1869, 2042-2146, 2326-2386`). |
| B-I-10 — task granularity | **NOT ADDRESSED** | 2/7/9/12 subtask 표에는 독립 commit이 있지만 실제 numbered task의 마지막 단계는 여전히 aggregate commit 하나다. 특히 9B는 hand-derived 79-handler semantics를 한 review slice로 묶는다(`plan:1063-1070↔1132, 1483-1491↔1632-1634, 1770-1778↔1867-1869, 2058-2065↔2144-2146`). |
| N-C-03 — generation/idempotency | **NOT ADDRESSED** | signed-ID/horizon 모델은 좋아졌지만 Task 7 RED가 unsigned `op-1`/`new-op`을 사용해 verify-first 구현과 양립하지 않는다(`plan:1496-1534, 1602-1608`). R3-C-02 참조. |
| N-I-01 — journal caps/recovery | **NOT ADDRESSED** | active-cap resolution API는 생겼다. 하지만 tombstone index 자체가 full이면 resolved row를 그 full index로 옮길 공간이 없다(`plan:1538-1543, 1606-1608, 2612`). R3-I-01 참조. |
| N-I-03 — packed artifact/live evidence | **ADDRESSED** | MCP shared+IR 및 CLI shared `alwaysBundle`, private/workspace dependency 제거, fresh-cache single-tarball install, `npm ls`, installed-bin smoke가 명시됐다(`plan:899, 2330-2386`). Pack producer wiring은 별도 R3-I-02로 남는다. |

## 3. Round 2 Critical 4건 binary 판정

| Finding | Round 3 판정 | 근거 |
|---|---|---|
| R2-C-01 — actual pair POST CORS | **ADDRESSED** | allowed Origin 3종의 success/wrong/expired/used/rate/internal response와 hostile/absent no-allow response가 machine-checkable하다(`plan:542-543, 1389-1442`). |
| R2-C-02 — baseline 79 handler outcomes | **ADDRESSED** | `PluginHandlerOutcome{value,mutated}`, 78 non-batch+batch exact set, changed/no-op fixture ledger, read/UI handling, sole commit site, wire `value` only가 Files/Interfaces/tests에 포함됐다(`plan:247-265, 1758-1857`). |
| R2-C-03 — signed ID/30-day tombstones | **NOT ADDRESSED** | contract 자체는 30-day horizon과 expired runtime-zero로 정합하지만 RED fixture가 서명되지 않아 GREEN이 불가능하다. R3-C-02 참조. |
| R2-C-04 — isolated bundle/install | **ADDRESSED** | internal workspace bundling과 packed manifest/fresh-cache isolated smoke가 Task 15 hard gate에 들어갔다(`plan:899, 2330-2386`). |

## 4. Round 2 Important 4건 binary 판정

| Finding | Round 3 판정 | 근거 |
|---|---|---|
| R2-I-01 — exact SnapshotStoragePort/path | **NOT ADDRESSED** | signature와 namespace는 정확하지만 package ownership이 미래 `SnapshotV1`을 역참조한다. R3-C-01 참조. |
| R2-I-02 — recursive fidelity | **ADDRESSED** | `expandedSections`, `completeLeafSections`, structured issues와 stable path/order/depth가 RED 및 algorithm과 일치한다(`plan:563-589, 1955-2014`). |
| R2-I-03 — operation resolution | **NOT ADDRESSED** | issue/list/status/resolve와 CLI는 생겼으나 tombstone-full 상태의 resolution persistence가 정의되지 않았다. R3-I-01 참조. |
| R2-I-04 — FQDN/PSL | **ADDRESSED** | suffix matching을 제거하고 exact three-or-more-label ASCII FQDN equality만 지원한다. `com`, `co.uk`, apex two-label, wildcard/dotted form은 syntactic rejection이며 redirect도 별도 exact rule을 요구한다(`plan:694-715, 1702-1734, 2172-2173, 2616`). PSL semantic claim이 없으므로 scope reduction은 타당하다. |

## 5. 새 Critical findings

### R3-C-01 — shared `SnapshotStoragePort`가 미래 IR `SnapshotV1`을 참조한다

**Severity: Critical**

Round 3는 `SnapshotStoragePort`를 shared에 두고 Task 4에서 생성한다(`plan:627-635, 1204-1212`). 그러나 port signature는 `SnapshotV1`을 직접 인자·결과 타입으로 사용한다(`plan:628-629`). `SnapshotV1`의 실제 파일/producer는 Task 11의 `packages/ir/src/snapshot-v1.ts`이며 IR은 shared에 의존한다(`plan:894, 1943-1951`).

현재 dependency는 다음 cycle이 된다.

```text
Task 4 @sfp/shared SnapshotStoragePort
  → needs Task 11 @sfp/ir SnapshotV1
  → @sfp/ir depends on @sfp/shared
```

따라서 Task 4/8은 Task 11 전 compile할 수 없고 Task 11이 Task 8 concrete port를 consume한다는 DAG도 성립하지 않는다.

정확한 수정은 다음 중 하나다.

1. shared port를 `SnapshotStoragePort<TSnapshot>` generic으로 만들고 Task 8은 generic JSON/byte storage adapter를 제공하며 Task 11이 `SnapshotStoragePort<SnapshotV1>`로 bind한다.
2. port를 byte-oriented `save(key, canonicalBytes, checksum)`/`load(): bytes`로 만들고 SnapshotV1 encode/decode/validation을 IR이 소유한다.
3. `SnapshotV1` schema/type 자체를 shared의 Task 4 산출물로 이동하고 IR은 이를 재사용한다.

수정 후 package import graph와 Task 4→8→11 compile RED/GREEN을 추가해야 한다.

### R3-C-02 — signed-ID verify-first 계약과 Task 7 RED fixture가 충돌한다

**Severity: Critical**

Round 3 계약은 operation ID를 server-issued timestamp/HMAC token으로 제한하고 forged ID를 idempotency lookup 전 거부한다(`plan:28, 361-449, 1602-1608`). 하지만 Task 7의 핵심 RED는 다음 unsigned literal을 계속 사용한다.

- conflict test: `'op-1'` (`plan:1496-1501`)
- persisted success/generation test: `'op-1'` (`plan:1522-1528`)
- active hard-cap test: `'new-op'` (`plan:1531-1535`)

이 테스트들은 각각 기대한 `OPERATION_ID_CONFLICT`, `OPERATION_ALREADY_SETTLED`, `JOURNAL_CAPACITY_EXCEEDED`까지 도달하지 못하고 먼저 `OPERATION_ID_INVALID`가 되어야 한다. 즉 plan의 RED/GREEN이 자체 contract와 불일치한다.

정확한 수정:

- 모든 call fixture를 `const opId = issuer.issue(ctx.actor.actorId, now)`로 만들고 같은 signed ID를 재사용한다.
- seeded record/tombstone의 claims·actorHash·issuedAt도 동일 issuer에서 생성한다.
- cap test도 valid issued ID를 사용한다.
- 별도 forged literal test만 `OPERATION_ID_INVALID`를 기대한다.
- mutation call은 dispatch 전에 issued ID가 client에 전달되었다는 initial progress/control test를 둔다.

## 6. 새 Important findings

### R3-I-01 — tombstone-full 상태에서 resolution을 저장할 공간이 없다

**Severity: Important**

계획은 tombstone index가 1,000,000행/256 MiB로 full이어도 status/resolution/horizon purge를 허용한다(`plan:1538-1543, 1608`). 동시에 resolved outcome-unknown row는 active journal에서 제거되어 같은 tombstone index로 이동해야 한다. 모든 tombstone이 unexpired이면 resolution 결과를 기록할 공간이 없으므로 promised recovery가 실패한다.

현재 full-index RED는 list가 가능하다는 것만 확인하며 resolution→persist→active-cap/workspace unblock을 검증하지 않는다(`plan:1538-1543`).

수정안:

- resolution용 reserved tombstone capacity를 별도로 둔다.
- 또는 resolved tombstone spill file/segment를 허용하고 동일 cap·checksum 규칙을 둔다.
- full-index + active unknown fixture에서 resolve가 영속화되고 같은 ID는 settled, workspace/cap은 unblock되는 RED/GREEN을 추가한다.

### R3-I-02 — `verify:release`에 MCP/CLI tarball producer가 명시적으로 연결되지 않았다

**Severity: Important**

Task 15는 MCP/CLI tarball을 생산한다고 하지만 root `verify:release`는 `generate-sbom → package-plugin.mjs → generate-checksums → artifact test`만 실행한다(`plan:915`). Files에는 별도 `package-release.mjs`/MCP·CLI pack script가 없고 `package-plugin.mjs`는 이름과 설명상 plugin ZIP producer다(`plan:787, 2330-2335`).

Step 3은 MCP/CLI를 pack하라고 prose로만 말하며(`plan:2374-2376`), 명시적인 `pnpm pack --pack-destination ...`은 없다. Step 5의 `pnpm pack --json`은 이미 `verify:release`와 artifact test가 끝난 뒤다(`plan:2382-2386`). Clean checkout에서 `mcp.tgz`/`cli.tgz`가 없으면 hard gate가 먼저 실패한다.

수정안:

- `package-release-artifacts.mjs`를 만들어 MCP tarball, CLI tarball, plugin ZIP을 한 번에 deterministic path/name으로 생성한다.
- 이를 `verify:release`에서 checksum/test보다 먼저 실행한다.
- producer output manifest와 artifact test input을 같은 authority로 만든다.
- clean artifacts directory에서 `verify:release` 한 명령이 세 artifact 생성부터 isolated smoke까지 완료하는 test를 추가한다.

`package-plugin.mjs`가 실제 umbrella producer라면 파일명, Files/Interfaces, script contract와 three-artifact test에서 이를 명시해야 한다.

## 7. 요청 핵심별 결과

| 확인 항목 | 결과 | 결론 |
|---|---|---|
| Pair POST headers | PASS | success/typed error/hostile matrix와 UI fetch 연결 |
| Baseline79 + library outcome | PASS | baseline exact set, fixtures, wire stripping, final row80 |
| 30d signed IDs/tombstones | FAIL | 모델은 정합하나 핵심 RED가 unsigned ID를 사용 |
| alwaysBundle/isolated install | PASS | bundle closure와 single-tarball fresh-cache smoke 존재 |
| SnapshotStoragePort | FAIL | exact signature가 shared→future IR type cycle 생성 |
| Nested fidelity | PASS | complete leaf와 expanded/issues가 구조적으로 분리됨 |
| Operations resolve | PARTIAL | endpoint/CLI/audit는 PASS, tombstone-full persistence는 FAIL |
| Exact FQDN | PASS | suffix feature를 제거한 exact 3+ label equality로 scope 축소 |
| Subtask boundaries | FAIL | binding 표와 실제 aggregate numbered commit 단계가 불일치 |
| Release producer | FAIL | hard gate 앞 MCP/CLI pack command가 명시되지 않음 |

## 8. READY 전 최소 수정 순서

1. Snapshot port의 package/type dependency 방향을 generic/byte port 또는 shared-owned SnapshotV1로 바로잡는다.
2. Task 7의 모든 idempotency/cap RED에 issuer-generated signed ID를 사용한다.
3. Tombstone-full resolution reserved/spill persistence와 recovery test를 추가한다.
4. MCP/CLI/plugin 세 artifact producer를 `verify:release` 앞단에 고정한다.
5. 2/7/9/12 subtask의 표를 실제 numbered RED→GREEN→review→commit 단계로 풀고 aggregate final commit과의 충돌을 제거한다.

위 변경 전에는 Task 4/8/11 type graph, Task 7 핵심 GREEN, hard-cap recovery, clean release artifact gate를 계획대로 실행할 수 없으므로 implementation handoff는 **NOT READY**다.
