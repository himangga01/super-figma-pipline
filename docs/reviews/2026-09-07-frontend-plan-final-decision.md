# 네 가지 프론트엔드 구현 경우 — 메인 최종 판단

작성일: 2026-09-07. 최종 판단자: 메인 에이전트.

**판정: [구현 계획 v1.0](../plans/2026-09-07-frontend-four-cases-plan-ko.md)을 확정한다.** 사용자가 공유한 Figma URL을 초기 프로젝트 디자인 binding으로 사용하며 다시 요청하지 않는다. 이번 변경물은 계획과 리뷰 문서다. 생산 기능 구현·실제 Figma 캡처·생성된 앱의 실행을 완료한 것으로 보고하지 않는다.

## 1. 리뷰 진행 결과

사용자가 요청한 서로 다른 서브에이전트 **정확히 3개**가 v0.1을 독립 검토했다. 제품/요구, 아키텍처/실행 경계, 검증/개발 현실성으로 역할을 나눴으며 각자 현재 코드 근거를 확인했다. 메인이 보강한 v0.9에 대해서도 같은 세 리뷰어의 재확인을 받았다. Superpowers와 추가 중첩 에이전트는 사용하지 않았다.

| 리뷰어                                                           | 최초 의견              | 재확인 및 메인 처리                                                                                   |
| ---------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| [제품/요구](2026-09-07-frontend-plan-product-review.md)          | P1 3개, P2 2개         | PRD-01–05 계획 수준 해결, 남는 필수 수정 없음                                                         |
| [아키텍처/실행](2026-09-07-frontend-plan-architecture-review.md) | P0 1개, P1 6개, P2 1개 | 주요 공백 해결. 마지막 outer queue selector와 read-only host mount 금지 지적을 메인이 §8.1/8.3에 반영 |
| [검증/현실성](2026-09-07-frontend-plan-validation-review.md)     | P0 1개, P1 8개, P2 1개 | V01–10 계획 수준 해결. 예정된 Docker CLI/Linux provider 문구를 최종 확정                              |

합계 **23개 지적: P0 2개, P1 17개, P2 4개**. 이 우선순위는 계획의 누락에 대한 분류이며 현재 서비스에서 23개의 장애가 발생했다는 뜻은 아니다. 계획 수준의 미반영 필수 지적은 없고, 해당 구현과 실증은 계획의 단계별 완료 조건으로 남긴다.

## 2. 최종 제품 결정

| 요청 경우                   | 확정 방식                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Figma로 완전히 새 서비스 | 신규 진입점. reference가 있으면 3번, 없으면 4번으로 자동 분기. 기존 저장소·stack·출력 경로를 반드시 먼저 요구하지 않음               |
| 2. 레거시 서비스에 구현     | 실제 frontend package와 dirty 상태를 분석하고 기존 API·관례를 유지하면서 Figma의 필수 UX를 구현                                      |
| 3. 레퍼런스 기반 신규       | 명시한 reference는 읽기 전용. 필요한 frontend 구조·라이브러리·패턴을 근거와 함께 채택하고 원본 없이도 설치·실행되는 새 프로젝트 생성 |
| 4. 무참조 신규              | 주변 저장소를 임의 참고하지 않고 검증된 기본/선택 preset으로 생성. 기본 후보는 React·TypeScript·Vite·CSS Modules/디자인 토큰         |

1번과 3·4번의 겹침은 네 요구가 잘못되었다는 의미가 아니다. 네 사용자 진입 경우를 보존하고 세 실행 전략을 공유한다. C1 두 분기는 별도 인수 테스트를 갖는다.

모든 경우는 frontend-only다. 실제 backend 주문·결제·인증 서버는 생성하지 않는다. 기본 demo 상태는 UI에서도 의미를 명확히 표시하고 기존 서비스의 운영 API 계약을 임의 변경하지 않는다. framework 관례 유지가 Figma의 필수 상태·디자인을 생략하는 이유가 되어서는 안 된다.

## 3. 의견별 반영표

| 원본 지적            | 메인 결정                                                                                                        | 최종 계획 위치   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------- |
| PRD-01, V03, V09     | 화면 분모·자료/overlay/variant 분류, node PNG 비교 원본, observable UX assert 채택                               | §4, §9, §12      |
| PRD-02, V01          | SupportMatrix와 필수 검사 집계, skipped/blocked의 완료 금지, freshness 분리 채택                                 | §5, §9.1         |
| PRD-03, V06          | Figma UX 보존 + 기존 API 경계, 실제 dirty baseline·의도된 차이·새 실패 구분 채택                                 | §6, §8.2, §9     |
| PRD-04               | local/fixture/existing-api/unavailable 및 demo의 종료 상태 채택                                                  | §9               |
| PRD-05               | optional raw input 후 정규화, C1 reference CLI, reference와 겹치지 않는 기본 output으로 보강                     | §2, §10          |
| V02                  | 분석 capability와 작성/검증 capability 분리. React/Vite·Vue/Vite v1, Next/Nuxt는 검증 조합별 후속 승격           | §6, §7, §9.1, P9 |
| V04                  | 기존 Chrome 보호, Firefox 명시설치·별도 preview, WebKit 선택 coverage, 초기 browser smoke 채택                   | §9, P1           |
| V05                  | source+lockfile만으로 외부 clean install. 실제 reference를 삭제하지 않는 독립성 검증 채택                        | §9, C3-A/B       |
| 아키텍처 P0-01, V07  | 실제 MCP pull/submit adapter와 초기 end-to-end 수직 실증 채택. guidance-only/숨은 sampling 전제 기각             | §7, §8, P1/P2    |
| 아키텍처 P1-01/P1-02 | 승인 전 multi-root admission resolver, 역할별 IO grant와 저장소/recipient별 egress manifest 채택                 | §5, §8           |
| 아키텍처 P1-03       | durable run/lease/owner resume·cancel, 바깥 executor queue 선택까지 확장해 validate와 control lane 분리          | §8.1             |
| 아키텍처 P1-04, V08  | crash-safe intent/관측 journal, 조건부 rollback, no-replace publish, 단계별 실패 주입 채택                       | §8.2, §12.1      |
| 아키텍처 P1-05       | source-write/process effect 분리, Docker CLI Linux-container provider, 실제 host root/socket mount 금지로 구체화 | §8.3             |
| 아키텍처 P1-06       | IO/process 강제와 agent 실증을 scaffold build·실제 target 적용보다 먼저 배치                                     | §11              |
| 아키텍처 P2-01, V10  | canonical ToolSpec 9개 단일 경로, CLI repo target과 Figma target 분리, 경로/cwd/산출물 기준 통일                 | §8, §10, §12.2   |

## 4. 유지하지 않은 초안 선택

- frontend 기능을 별도 service operation과 MCP wrapper 양쪽으로 중복 등록하는 방식을 쓰지 않는다. 9개 canonical 도구와 기존 executor를 사용하여 origin 위조·중복 operation/receipt를 피한다. 기존 private identity 및 control-only service 경계를 보존한다.
- `target:none` queue 뒤에 장기 validate와 status/cancel을 모두 묶지 않는다. 내부 scheduler만 추가해서는 이 문제가 해결되지 않으므로 바깥 queue selector를 확장한다.
- temp 폴더·허용 command 이름·env 필터만으로 reference/host 보호를 보증하지 않는다. 실제 격리를 갖춘 runner부터 활성화한다.
- 모든 framework를 감지한다는 이유로 모든 framework를 자동 구현 가능하다고 표시하지 않는다. 네 경우와 stack 지원 조합은 별도 행렬로 관리한다.
- 기존 테스트 3,325개 통과 기록을 새 frontend 기능의 완료 증거로 사용하지 않는다. 실제 생성 결과의 install/build/UX/시각·복구 검증을 추가한다.

## 5. 실행 순서와 완료선

`P0 계약 → P1 권한·격리 runner → P2 실제 agent 연결 → P3 분석/P4 생성 → P5 적용·복구 → P6 legacy/reference → P7 UX 인수 → P8 패키지·전체 검증 → P9 추가 framework` 순서로 진행한다.

네 가지 경우 지원 완료는 선택한 지원 조합의 필수 범위와 검증을 모두 충족했을 때 선언한다. 최신 공유 Figma live 인수, fixed capture fixture, 생성 앱 인수, pipeline 자체 소스 검사, 원격 CI 결과를 각각 기록한다.

사용자의 일괄 승인은 이 계획의 구현 작업에 유지한다. 구현 시작 전에 같은 일반 승인을 다시 요청할 필요는 없다. 실제로 불명확한 legacy package, 존재하지 않는 reference, 사용할 수 없는 출력 위치 등 필요한 정보만 요청하고 독립 작업을 계속한다. 신규 생성은 기존 저장소 경로가 없다는 이유로 막지 않는다.
