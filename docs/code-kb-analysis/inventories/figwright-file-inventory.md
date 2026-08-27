# Figwright 전체 파일 인벤토리

> 조사 대상: code-kb/figwright  
> 기준 커밋: a835e81b575eab2c9265a67f9353c89b848f81ca (v0.4.0-33-ga835e81)  
> 생성 기준일: 2026-08-27 (Asia/Seoul)

## 범위와 집계 규칙

- canonical 파일 집합은 저장소 루트에서 실행한 git ls-files 결과다. 추적 파일 **612개 전부**를 포함했다.
- .git/**, 미추적·ignore 파일, 설치 산출물(node_modules/**)과 빌드/테스트 산출물(dist/**, build/**, coverage/**, *.tsbuildinfo)은 제외했다. 현재 이 저장소 스냅샷에는 해당 산출물이 추적되어 있지 않다.
- PNG 5개와 GIF 2개는 바이너리로 분류해 라인 수를 —로 표기했다. SVG는 XML 텍스트로 집계했다.
- 텍스트 라인은 .NET [IO.File]::ReadAllLines(path).Count의 물리 라인 기준이며, 바이트는 워킹트리 파일의 Length다.
- 역할은 파일 경로와 구현 내용을 함께 조사해 분류했다. 상세 동작은 ../03-figwright-analysis.md에서 교차 검증한다.

## 총계

| 항목 | 값 |
|---|---:|
| 전체 파일 | 612 |
| 전체 바이트 | 7,010,446 |
| 텍스트 파일 | 605 |
| 바이너리 파일 | 7 |
| 텍스트 물리 라인 | 69,469 |
| 텍스트 비공백 라인 | 62,275 |

## 디렉터리 통계

| 범위 | 파일 | 바이트 | 텍스트 | 바이너리 | 물리 라인 | 비공백 라인 |
|---|---:|---:|---:|---:|---:|---:|
| .claude | 5 | 40030 | 5 | 0 | 771 | 636 |
| (root) | 24 | 224271 | 24 | 0 | 5217 | 4125 |
| .github | 21 | 4121209 | 14 | 7 | 890 | 845 |
| .vscode | 1 | 224 | 1 | 0 | 9 | 9 |
| packages/mcp | 233 | 1332637 | 233 | 0 | 31052 | 28298 |
| packages/plugin | 285 | 1011388 | 285 | 0 | 25872 | 23257 |
| packages/shared | 26 | 161063 | 26 | 0 | 3827 | 3537 |
| scripts | 2 | 12402 | 2 | 0 | 318 | 277 |
| skills | 13 | 100898 | 13 | 0 | 1379 | 1174 |
| test | 2 | 6324 | 2 | 0 | 134 | 117 |

## 확장자 통계

| 확장자 | 파일 | 바이트 | 텍스트 물리 라인 |
|---|---:|---:|---:|
| .ts | 521 | 2446523 | 59071 |
| .md | 23 | 214113 | 2806 |
| .json | 20 | 28647 | 1017 |
| .vue | 15 | 36227 | 874 |
| .yml | 9 | 15432 | 418 |
| .png | 5 | 417038 | — |
| .mjs | 4 | 24797 | 611 |
| .svg | 4 | 51082 | 448 |
| .gif | 2 | 3636612 | — |
| .yaml | 2 | 131749 | 3987 |
| .css | 1 | 5784 | 163 |
| .editorconfig | 1 | 228 | 12 |
| .gitattributes | 1 | 369 | 6 |
| .gitignore | 1 | 476 | 22 |
| .html | 1 | 291 | 12 |
| .node-version | 1 | 9 | 1 |
| [none] | 1 | 1069 | 21 |

## 재실행 가능한 집계 명령

~~~powershell
$files = git ls-files
$files.Count
($files | ForEach-Object { (Get-Item -LiteralPath $_).Length } | Measure-Object -Sum).Sum
$text = $files | Where-Object { [IO.Path]::GetExtension($_).ToLowerInvariant() -notin '.png', '.gif' }
($text | ForEach-Object { [IO.File]::ReadAllLines((Resolve-Path -LiteralPath $_)).Count } | Measure-Object -Sum).Sum
($text | ForEach-Object { @([IO.File]::ReadAllLines((Resolve-Path -LiteralPath $_)) | Where-Object { $_.Trim().Length -gt 0 }).Count } | Measure-Object -Sum).Sum
~~~

## 전체 파일 목록 (612행)

| # | 상대 경로 | 유형 | 역할 | 라인 | 바이트 |
|---:|---|---|---|---:|---:|
| 1 | .claude/hooks/format-on-edit.mjs | mjs | Claude Code 편집 후 자동 포맷/린트 hook: format-on-edit | 44 | 1925 |
| 2 | .claude/settings.json | json | Claude Code 프로젝트 설정 | 17 | 416 |
| 3 | .claude/skills/figma-typings-audit/SKILL.md | md | 저장소 개발 감사(audit) 스킬: SKILL | 245 | 13473 |
| 4 | .claude/skills/mcp-sdk-audit/probe.mjs | mjs | 저장소 개발 감사(audit) 스킬: probe | 249 | 10470 |
| 5 | .claude/skills/mcp-sdk-audit/SKILL.md | md | 저장소 개발 감사(audit) 스킬: SKILL | 216 | 13746 |
| 6 | .cspell.json | json | 프로젝트/도구 구성 파일 | 30 | 450 |
| 7 | .editorconfig | editorconfig | 프로젝트/도구 구성 파일 | 12 | 228 |
| 8 | .gitattributes | gitattributes | 프로젝트 소스/구성 | 6 | 369 |
| 9 | .github/code-to-figma.gif | binary/gif | 문서/홍보용 래스터 미디어 자산 | — | 2415258 |
| 10 | .github/figma-to-code.gif | binary/gif | 문서/홍보용 래스터 미디어 자산 | — | 1221354 |
| 11 | .github/ISSUE_TEMPLATE/bug_report.yml | yml | GitHub 이슈 템플릿/설정 | 99 | 3729 |
| 12 | .github/ISSUE_TEMPLATE/config.yml | yml | GitHub 이슈 템플릿/설정 | 11 | 635 |
| 13 | .github/ISSUE_TEMPLATE/docs.yml | yml | GitHub 이슈 템플릿/설정 | 27 | 1015 |
| 14 | .github/ISSUE_TEMPLATE/feature_request.yml | yml | GitHub 이슈 템플릿/설정 | 45 | 2028 |
| 15 | .github/logo-dark.svg | svg | 브랜드/문서용 SVG 로고 자산 | 112 | 8310 |
| 16 | .github/logo-full-dark.svg | svg | 브랜드/문서용 SVG 로고 자산 | 112 | 17231 |
| 17 | .github/logo-full-light.svg | svg | 브랜드/문서용 SVG 로고 자산 | 112 | 17231 |
| 18 | .github/logo-light.svg | svg | 브랜드/문서용 SVG 로고 자산 | 112 | 8310 |
| 19 | .github/plugin-panel.png | binary/png | 문서/홍보용 래스터 미디어 자산 | — | 166125 |
| 20 | .github/plugin-theme.png | binary/png | 문서/홍보용 래스터 미디어 자산 | — | 95138 |
| 21 | .github/plugin-window.png | binary/png | 문서/홍보용 래스터 미디어 자산 | — | 81664 |
| 22 | .github/PULL_REQUEST_TEMPLATE.md | md | GitHub PR 템플릿 | 24 | 1045 |
| 23 | .github/social-preview-dark.png | binary/png | 문서/홍보용 래스터 미디어 자산 | — | 37341 |
| 24 | .github/social-preview-light.png | binary/png | 문서/홍보용 래스터 미디어 자산 | — | 36770 |
| 25 | .github/workflows/actionlint.yml | yml | GitHub Actions 워크플로(검증·릴리스) | 27 | 667 |
| 26 | .github/workflows/ci.yml | yml | GitHub Actions 워크플로(검증·릴리스) | 76 | 2726 |
| 27 | .github/workflows/release.yml | yml | GitHub Actions 워크플로(검증·릴리스) | 65 | 2650 |
| 28 | .github/workflows/semantic-pr.yml | yml | GitHub Actions 워크플로(검증·릴리스) | 40 | 1199 |
| 29 | .github/workflows/zizmor.yml | yml | GitHub Actions 워크플로(검증·릴리스) | 28 | 783 |
| 30 | .gitignore | gitignore | 프로젝트 소스/구성 | 22 | 476 |
| 31 | .mcp.json | json | 프로젝트/도구 구성 파일 | 8 | 122 |
| 32 | .node-version | node-version | 프로젝트 소스/구성 | 1 | 9 |
| 33 | .oxfmtrc.json | json | 프로젝트/도구 구성 파일 | 24 | 506 |
| 34 | .oxlintrc.json | json | 프로젝트/도구 구성 파일 | 43 | 1044 |
| 35 | .vscode/settings.json | json | VS Code 포맷·수정 설정 | 9 | 224 |
| 36 | AGENTS.md | md | 저장소 canonical 개발·아키텍처 지침 | 97 | 18512 |
| 37 | CHANGELOG.md | md | 릴리스 변경 이력 | 367 | 34129 |
| 38 | CLAUDE.md | md | Claude Code 전용 보충 지침 | 13 | 2895 |
| 39 | CONTRIBUTING.md | md | 기여 절차 문서 | 58 | 3547 |
| 40 | glama.json | json | 프로젝트/도구 구성 파일 | 7 | 354 |
| 41 | knip.json | json | 프로젝트/도구 구성 파일 | 18 | 393 |
| 42 | LICENSE | 무확장 텍스트 | MIT 라이선스 원문 | 21 | 1069 |
| 43 | package.json | json | 루트 워크스페이스 manifest·스크립트 | 48 | 1472 |
| 44 | packages/mcp/package.json | json | mcp 패키지 manifest | 61 | 1498 |
| 45 | packages/mcp/README.md | md | npm 패키지 README | 35 | 1259 |
| 46 | packages/mcp/src/build-id.ts | ts | MCP 서버 핵심 모듈: build-id | 16 | 1000 |
| 47 | packages/mcp/src/diff/design-diff.ts | ts | 디자인 baseline diff 코어: design-diff | 225 | 8225 |
| 48 | packages/mcp/src/dispatch.ts | ts | MCP 서버 핵심 모듈: dispatch | 158 | 6831 |
| 49 | packages/mcp/src/election/election.ts | ts | 리더/팔로어 선출·수명주기 모듈: election | 280 | 11748 |
| 50 | packages/mcp/src/election/follower.ts | ts | 리더/팔로어 선출·수명주기 모듈: follower | 216 | 8134 |
| 51 | packages/mcp/src/election/leader-endpoints.ts | ts | 리더/팔로어 선출·수명주기 모듈: leader-endpoints | 250 | 9610 |
| 52 | packages/mcp/src/election/leader-lock.ts | ts | 리더/팔로어 선출·수명주기 모듈: leader-lock | 280 | 12414 |
| 53 | packages/mcp/src/election/node.ts | ts | 리더/팔로어 선출·수명주기 모듈: node | 211 | 7506 |
| 54 | packages/mcp/src/icons/repo-icons.ts | ts | 저장소 SVG/아이콘 탐지 모듈: repo-icons | 104 | 4616 |
| 55 | packages/mcp/src/ignored-dirs.ts | ts | MCP 서버 핵심 모듈: ignored-dirs | 26 | 1326 |
| 56 | packages/mcp/src/index.ts | ts | MCP 서버 핵심 모듈: index | 281 | 13521 |
| 57 | packages/mcp/src/instructions.ts | ts | MCP 서버 핵심 모듈: instructions | 19 | 2392 |
| 58 | packages/mcp/src/join/casefold.ts | ts | Figma↔코드 grounding 조인 모듈: casefold | 27 | 1691 |
| 59 | packages/mcp/src/join/component-map.ts | ts | Figma↔코드 grounding 조인 모듈: component-map | 478 | 21586 |
| 60 | packages/mcp/src/join/icon-map.ts | ts | Figma↔코드 grounding 조인 모듈: icon-map | 237 | 10308 |
| 61 | packages/mcp/src/join/status.ts | ts | Figma↔코드 grounding 조인 모듈: status | 38 | 2114 |
| 62 | packages/mcp/src/join/token-map.ts | ts | Figma↔코드 grounding 조인 모듈: token-map | 601 | 27920 |
| 63 | packages/mcp/src/lifecycle.ts | ts | MCP 서버 핵심 모듈: lifecycle | 66 | 2894 |
| 64 | packages/mcp/src/local-access.ts | ts | MCP 서버 핵심 모듈: local-access | 93 | 4782 |
| 65 | packages/mcp/src/node-id.ts | ts | MCP 서버 핵심 모듈: node-id | 101 | 4259 |
| 66 | packages/mcp/src/profile/profile.ts | ts | 레거시 프로젝트 기술스택 프로파일러: profile | 893 | 42405 |
| 67 | packages/mcp/src/prompts/code-to-figma.ts | ts | MCP prompt 정의/레지스트리: code-to-figma | 55 | 7124 |
| 68 | packages/mcp/src/prompts/figma-to-code.ts | ts | MCP prompt 정의/레지스트리: figma-to-code | 79 | 28500 |
| 69 | packages/mcp/src/prompts/registry.ts | ts | MCP prompt 정의/레지스트리: registry | 44 | 2259 |
| 70 | packages/mcp/src/relay/relay.ts | ts | 로컬 WebSocket relay·세션 모듈: relay | 545 | 22283 |
| 71 | packages/mcp/src/relay/session.ts | ts | 로컬 WebSocket relay·세션 모듈: session | 131 | 5087 |
| 72 | packages/mcp/src/repo-walk.ts | ts | MCP 서버 핵심 모듈: repo-walk | 125 | 6291 |
| 73 | packages/mcp/src/scan/scan.ts | ts | 컴포넌트/SFC AST 스캐너: scan | 901 | 42006 |
| 74 | packages/mcp/src/scan/sfc-blocks.ts | ts | 컴포넌트/SFC AST 스캐너: sfc-blocks | 349 | 12597 |
| 75 | packages/mcp/src/tokens/css-scan.ts | ts | 프로젝트 토큰 탐지·파싱·인덱스 모듈: css-scan | 397 | 15171 |
| 76 | packages/mcp/src/tokens/figma-tokens.ts | ts | 프로젝트 토큰 탐지·파싱·인덱스 모듈: figma-tokens | 197 | 9106 |
| 77 | packages/mcp/src/tokens/generated-tokens.ts | ts | 프로젝트 토큰 탐지·파싱·인덱스 모듈: generated-tokens | 74 | 3693 |
| 78 | packages/mcp/src/tokens/hex.ts | ts | 프로젝트 토큰 탐지·파싱·인덱스 모듈: hex | 13 | 624 |
| 79 | packages/mcp/src/tokens/js-config.ts | ts | 프로젝트 토큰 탐지·파싱·인덱스 모듈: js-config | 617 | 31593 |
| 80 | packages/mcp/src/tokens/load.ts | ts | 프로젝트 토큰 탐지·파싱·인덱스 모듈: load | 477 | 25165 |
| 81 | packages/mcp/src/tokens/repo-css.ts | ts | 프로젝트 토큰 탐지·파싱·인덱스 모듈: repo-css | 49 | 2243 |
| 82 | packages/mcp/src/tokens/repo-scss.ts | ts | 프로젝트 토큰 탐지·파싱·인덱스 모듈: repo-scss | 63 | 2901 |
| 83 | packages/mcp/src/tokens/scss-file.ts | ts | 프로젝트 토큰 탐지·파싱·인덱스 모듈: scss-file | 85 | 4313 |
| 84 | packages/mcp/src/tokens/token-index.ts | ts | 프로젝트 토큰 탐지·파싱·인덱스 모듈: token-index | 189 | 7507 |
| 85 | packages/mcp/src/tokens/tokens.ts | ts | 프로젝트 토큰 탐지·파싱·인덱스 모듈: tokens | 254 | 14025 |
| 86 | packages/mcp/src/tools/add-component-property.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: add-component-property | 32 | 1659 |
| 87 | packages/mcp/src/tools/add-page.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: add-page | 14 | 392 |
| 88 | packages/mcp/src/tools/add-variable-mode.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: add-variable-mode | 19 | 775 |
| 89 | packages/mcp/src/tools/analyze-project.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: analyze-project | 40 | 2344 |
| 90 | packages/mcp/src/tools/annotations.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: annotations | 17 | 815 |
| 91 | packages/mcp/src/tools/apply-animation-style.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: apply-animation-style | 25 | 1229 |
| 92 | packages/mcp/src/tools/apply-manual-keyframe-track.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: apply-manual-keyframe-track | 22 | 1090 |
| 93 | packages/mcp/src/tools/apply-style-to-node.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: apply-style-to-node | 18 | 633 |
| 94 | packages/mcp/src/tools/batch.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: batch | 34 | 1438 |
| 95 | packages/mcp/src/tools/batch-rename-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: batch-rename-nodes | 18 | 546 |
| 96 | packages/mcp/src/tools/binary-payload.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: binary-payload | 30 | 1607 |
| 97 | packages/mcp/src/tools/bind-component-property.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: bind-component-property | 27 | 1209 |
| 98 | packages/mcp/src/tools/binding-schema.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: binding-schema | 35 | 1886 |
| 99 | packages/mcp/src/tools/bind-variable-to-node.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: bind-variable-to-node | 24 | 983 |
| 100 | packages/mcp/src/tools/bind-variable-to-paint.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: bind-variable-to-paint | 33 | 1274 |
| 101 | packages/mcp/src/tools/clone-node.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: clone-node | 18 | 647 |
| 102 | packages/mcp/src/tools/combine-as-variants.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: combine-as-variants | 26 | 1068 |
| 103 | packages/mcp/src/tools/component-map.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: component-map | 153 | 6773 |
| 104 | packages/mcp/src/tools/create-component.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-component | 28 | 1185 |
| 105 | packages/mcp/src/tools/create-effect-style.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-effect-style | 19 | 681 |
| 106 | packages/mcp/src/tools/create-ellipse.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-ellipse | 22 | 921 |
| 107 | packages/mcp/src/tools/create-frame.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-frame | 26 | 1057 |
| 108 | packages/mcp/src/tools/create-grid-style.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-grid-style | 20 | 754 |
| 109 | packages/mcp/src/tools/create-instance.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-instance | 22 | 956 |
| 110 | packages/mcp/src/tools/create-paint-style.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-paint-style | 20 | 834 |
| 111 | packages/mcp/src/tools/create-rectangle.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-rectangle | 23 | 1001 |
| 112 | packages/mcp/src/tools/create-section.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-section | 23 | 1010 |
| 113 | packages/mcp/src/tools/create-text.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-text | 22 | 942 |
| 114 | packages/mcp/src/tools/create-text-style.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-text-style | 34 | 1544 |
| 115 | packages/mcp/src/tools/create-variable.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-variable | 25 | 1328 |
| 116 | packages/mcp/src/tools/create-variable-collection.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: create-variable-collection | 16 | 518 |
| 117 | packages/mcp/src/tools/delete-component-property.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: delete-component-property | 20 | 869 |
| 118 | packages/mcp/src/tools/delete-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: delete-nodes | 18 | 584 |
| 119 | packages/mcp/src/tools/delete-page.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: delete-page | 17 | 463 |
| 120 | packages/mcp/src/tools/delete-style.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: delete-style | 16 | 441 |
| 121 | packages/mcp/src/tools/delete-variable.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: delete-variable | 18 | 594 |
| 122 | packages/mcp/src/tools/delete-variable-collection.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: delete-variable-collection | 18 | 688 |
| 123 | packages/mcp/src/tools/design-context-guard.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: design-context-guard | 300 | 15478 |
| 124 | packages/mcp/src/tools/design-diff.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: design-diff | 213 | 8385 |
| 125 | packages/mcp/src/tools/detach-instance.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: detach-instance | 20 | 835 |
| 126 | packages/mcp/src/tools/edit-component-property.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: edit-component-property | 29 | 1402 |
| 127 | packages/mcp/src/tools/effect-schema.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: effect-schema | 30 | 1296 |
| 128 | packages/mcp/src/tools/export-pdf.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: export-pdf | 69 | 2812 |
| 129 | packages/mcp/src/tools/export-video.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: export-video | 94 | 3746 |
| 130 | packages/mcp/src/tools/find-replace-text.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: find-replace-text | 20 | 867 |
| 131 | packages/mcp/src/tools/get-annotations.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-annotations | 20 | 626 |
| 132 | packages/mcp/src/tools/get-component-api.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-component-api | 23 | 1123 |
| 133 | packages/mcp/src/tools/get-design-context.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-design-context | 69 | 4430 |
| 134 | packages/mcp/src/tools/get-document.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-document | 13 | 418 |
| 135 | packages/mcp/src/tools/get-fonts.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-fonts | 14 | 445 |
| 136 | packages/mcp/src/tools/get-local-components.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-local-components | 21 | 855 |
| 137 | packages/mcp/src/tools/get-metadata.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-metadata | 15 | 488 |
| 138 | packages/mcp/src/tools/get-motion-styles.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-motion-styles | 16 | 658 |
| 139 | packages/mcp/src/tools/get-node.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-node | 20 | 883 |
| 140 | packages/mcp/src/tools/get-node-motion.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-node-motion | 21 | 1039 |
| 141 | packages/mcp/src/tools/get-nodes-info.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-nodes-info | 13 | 431 |
| 142 | packages/mcp/src/tools/get-pages.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-pages | 12 | 309 |
| 143 | packages/mcp/src/tools/get-reactions.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-reactions | 15 | 584 |
| 144 | packages/mcp/src/tools/get-screenshot.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-screenshot | 194 | 10980 |
| 145 | packages/mcp/src/tools/get-selection.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-selection | 17 | 758 |
| 146 | packages/mcp/src/tools/get-styles.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-styles | 21 | 1143 |
| 147 | packages/mcp/src/tools/get-variable-defs.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-variable-defs | 16 | 690 |
| 148 | packages/mcp/src/tools/get-viewport.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: get-viewport | 14 | 422 |
| 149 | packages/mcp/src/tools/grid-schema.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: grid-schema | 28 | 1454 |
| 150 | packages/mcp/src/tools/group-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: group-nodes | 17 | 547 |
| 151 | packages/mcp/src/tools/icon-map.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: icon-map | 107 | 4526 |
| 152 | packages/mcp/src/tools/import-image.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: import-image | 26 | 1292 |
| 153 | packages/mcp/src/tools/import-svg.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: import-svg | 26 | 1302 |
| 154 | packages/mcp/src/tools/list-files.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: list-files | 14 | 466 |
| 155 | packages/mcp/src/tools/lock-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: lock-nodes | 18 | 648 |
| 156 | packages/mcp/src/tools/motion-schemas.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: motion-schemas | 215 | 7908 |
| 157 | packages/mcp/src/tools/move-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: move-nodes | 17 | 564 |
| 158 | packages/mcp/src/tools/navigate-to-page.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: navigate-to-page | 16 | 461 |
| 159 | packages/mcp/src/tools/paint-schema.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: paint-schema | 47 | 1931 |
| 160 | packages/mcp/src/tools/ping.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: ping | 235 | 8954 |
| 161 | packages/mcp/src/tools/registry.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: registry | 247 | 10059 |
| 162 | packages/mcp/src/tools/remove-animation-style.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: remove-animation-style | 22 | 842 |
| 163 | packages/mcp/src/tools/remove-manual-keyframe-track.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: remove-manual-keyframe-track | 20 | 769 |
| 164 | packages/mcp/src/tools/remove-reactions.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: remove-reactions | 19 | 697 |
| 165 | packages/mcp/src/tools/rename-node.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: rename-node | 18 | 615 |
| 166 | packages/mcp/src/tools/rename-page.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: rename-page | 18 | 610 |
| 167 | packages/mcp/src/tools/rename-variable.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: rename-variable | 18 | 655 |
| 168 | packages/mcp/src/tools/reorder-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: reorder-nodes | 17 | 573 |
| 169 | packages/mcp/src/tools/reparent-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: reparent-nodes | 20 | 894 |
| 170 | packages/mcp/src/tools/resize-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: resize-nodes | 17 | 511 |
| 171 | packages/mcp/src/tools/rotate-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: rotate-nodes | 16 | 501 |
| 172 | packages/mcp/src/tools/save-image-fills.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: save-image-fills | 140 | 5911 |
| 173 | packages/mcp/src/tools/save-screenshots.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: save-screenshots | 102 | 4214 |
| 174 | packages/mcp/src/tools/scan-components.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: scan-components | 43 | 1919 |
| 175 | packages/mcp/src/tools/scan-nodes-by-types.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: scan-nodes-by-types | 19 | 891 |
| 176 | packages/mcp/src/tools/scan-text-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: scan-text-nodes | 16 | 539 |
| 177 | packages/mcp/src/tools/search-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: search-nodes | 19 | 816 |
| 178 | packages/mcp/src/tools/set-arc.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-arc | 28 | 1192 |
| 179 | packages/mcp/src/tools/set-auto-layout.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-auto-layout | 64 | 2697 |
| 180 | packages/mcp/src/tools/set-blend-mode.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-blend-mode | 19 | 803 |
| 181 | packages/mcp/src/tools/set-constraints.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-constraints | 23 | 1014 |
| 182 | packages/mcp/src/tools/set-corner-radius.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-corner-radius | 24 | 1214 |
| 183 | packages/mcp/src/tools/set-effects.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-effects | 18 | 596 |
| 184 | packages/mcp/src/tools/set-fills.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-fills | 21 | 859 |
| 185 | packages/mcp/src/tools/set-instance-properties.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-instance-properties | 35 | 1602 |
| 186 | packages/mcp/src/tools/set-layout-grids.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-layout-grids | 23 | 1043 |
| 187 | packages/mcp/src/tools/set-layout-props.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-layout-props | 70 | 2860 |
| 188 | packages/mcp/src/tools/set-mask.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-mask | 22 | 756 |
| 189 | packages/mcp/src/tools/set-opacity.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-opacity | 18 | 681 |
| 190 | packages/mcp/src/tools/set-position.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-position | 23 | 1135 |
| 191 | packages/mcp/src/tools/set-reactions.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-reactions | 38 | 1423 |
| 192 | packages/mcp/src/tools/set-strokes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-strokes | 35 | 1697 |
| 193 | packages/mcp/src/tools/set-text.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-text | 19 | 711 |
| 194 | packages/mcp/src/tools/set-text-properties.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-text-properties | 74 | 3181 |
| 195 | packages/mcp/src/tools/set-text-range.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-text-range | 79 | 3989 |
| 196 | packages/mcp/src/tools/set-timeline-duration.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-timeline-duration | 18 | 730 |
| 197 | packages/mcp/src/tools/set-variable-code-syntax.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-variable-code-syntax | 34 | 1690 |
| 198 | packages/mcp/src/tools/set-variable-value.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-variable-value | 51 | 2572 |
| 199 | packages/mcp/src/tools/set-visible.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: set-visible | 19 | 744 |
| 200 | packages/mcp/src/tools/skew-notice.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: skew-notice | 84 | 4552 |
| 201 | packages/mcp/src/tools/spec.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: spec | 60 | 3487 |
| 202 | packages/mcp/src/tools/swap-component.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: swap-component | 18 | 692 |
| 203 | packages/mcp/src/tools/token-map.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: token-map | 187 | 9667 |
| 204 | packages/mcp/src/tools/ungroup-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: ungroup-nodes | 18 | 620 |
| 205 | packages/mcp/src/tools/unlock-nodes.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: unlock-nodes | 17 | 551 |
| 206 | packages/mcp/src/tools/update-effect-style.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: update-effect-style | 25 | 1193 |
| 207 | packages/mcp/src/tools/update-paint-style.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: update-paint-style | 22 | 925 |
| 208 | packages/mcp/src/tools/update-text-style.ts | ts | MCP 도구 스펙·서버 핸들러/도우미: update-text-style | 35 | 1575 |
| 209 | packages/mcp/test/diff/design-diff.test.ts | ts | MCP Vitest 테스트/계약 fixture: design-diff.test | 164 | 6219 |
| 210 | packages/mcp/test/dispatch.test.ts | ts | MCP Vitest 테스트/계약 fixture: dispatch.test | 486 | 17709 |
| 211 | packages/mcp/test/e2e/_helpers.ts | ts | MCP 빌드 산출물 기반 E2E 테스트: _helpers | 139 | 4373 |
| 212 | packages/mcp/test/e2e/get-document.test.ts | ts | MCP 빌드 산출물 기반 E2E 테스트: get-document.test | 106 | 2714 |
| 213 | packages/mcp/test/e2e/get-selection.test.ts | ts | MCP 빌드 산출물 기반 E2E 테스트: get-selection.test | 100 | 2528 |
| 214 | packages/mcp/test/e2e/mcp-wire.test.ts | ts | MCP 빌드 산출물 기반 E2E 테스트: mcp-wire.test | 454 | 21311 |
| 215 | packages/mcp/test/e2e/ping.test.ts | ts | MCP 빌드 산출물 기반 E2E 테스트: ping.test | 102 | 2708 |
| 216 | packages/mcp/test/e2e/process-lifecycle.test.ts | ts | MCP 빌드 산출물 기반 E2E 테스트: process-lifecycle.test | 226 | 9799 |
| 217 | packages/mcp/test/e2e/read-tools.test.ts | ts | MCP 빌드 산출물 기반 E2E 테스트: read-tools.test | 656 | 19918 |
| 218 | packages/mcp/test/election/election.test.ts | ts | MCP Vitest 테스트/계약 fixture: election.test | 527 | 20396 |
| 219 | packages/mcp/test/election/follower.test.ts | ts | MCP Vitest 테스트/계약 fixture: follower.test | 292 | 10952 |
| 220 | packages/mcp/test/election/leader-endpoints.test.ts | ts | MCP Vitest 테스트/계약 fixture: leader-endpoints.test | 507 | 17542 |
| 221 | packages/mcp/test/election/leader-lock.test.ts | ts | MCP Vitest 테스트/계약 fixture: leader-lock.test | 401 | 16482 |
| 222 | packages/mcp/test/election/node.test.ts | ts | MCP Vitest 테스트/계약 fixture: node.test | 165 | 5788 |
| 223 | packages/mcp/test/icons/repo-icons.test.ts | ts | MCP Vitest 테스트/계약 fixture: repo-icons.test | 71 | 2984 |
| 224 | packages/mcp/test/join/casefold.test.ts | ts | MCP Vitest 테스트/계약 fixture: casefold.test | 38 | 1828 |
| 225 | packages/mcp/test/join/component-map.test.ts | ts | MCP Vitest 테스트/계약 fixture: component-map.test | 445 | 18421 |
| 226 | packages/mcp/test/join/icon-map.test.ts | ts | MCP Vitest 테스트/계약 fixture: icon-map.test | 196 | 7059 |
| 227 | packages/mcp/test/join/status.test.ts | ts | MCP Vitest 테스트/계약 fixture: status.test | 42 | 1996 |
| 228 | packages/mcp/test/join/token-map.test.ts | ts | MCP Vitest 테스트/계약 fixture: token-map.test | 599 | 28917 |
| 229 | packages/mcp/test/lifecycle.test.ts | ts | MCP Vitest 테스트/계약 fixture: lifecycle.test | 156 | 4983 |
| 230 | packages/mcp/test/local-access.test.ts | ts | MCP Vitest 테스트/계약 fixture: local-access.test | 111 | 4269 |
| 231 | packages/mcp/test/no-binary-sources.test.ts | ts | MCP Vitest 테스트/계약 fixture: no-binary-sources.test | 38 | 1907 |
| 232 | packages/mcp/test/node-id.test.ts | ts | MCP Vitest 테스트/계약 fixture: node-id.test | 132 | 5191 |
| 233 | packages/mcp/test/plugin-contract.json | json | MCP Vitest 테스트/계약 fixture: plugin-contract | 600 | 18163 |
| 234 | packages/mcp/test/plugin-contract.test.ts | ts | MCP Vitest 테스트/계약 fixture: plugin-contract.test | 239 | 11029 |
| 235 | packages/mcp/test/plugin-contract.ts | ts | MCP Vitest 테스트/계약 fixture: plugin-contract | 212 | 8286 |
| 236 | packages/mcp/test/profile/profile.test.ts | ts | MCP Vitest 테스트/계약 fixture: profile.test | 694 | 29658 |
| 237 | packages/mcp/test/profile/styling-cascade.test.ts | ts | MCP Vitest 테스트/계약 fixture: styling-cascade.test | 162 | 7079 |
| 238 | packages/mcp/test/profile/utility-first-single-source.test.ts | ts | MCP Vitest 테스트/계약 fixture: utility-first-single-source.test | 71 | 3825 |
| 239 | packages/mcp/test/prompts/prompt-tool-names.test.ts | ts | MCP Vitest 테스트/계약 fixture: prompt-tool-names.test | 35 | 1711 |
| 240 | packages/mcp/test/prompts/registry.test.ts | ts | MCP Vitest 테스트/계약 fixture: registry.test | 56 | 2419 |
| 241 | packages/mcp/test/relay/relay.test.ts | ts | MCP Vitest 테스트/계약 fixture: relay.test | 943 | 32287 |
| 242 | packages/mcp/test/relay/session.test.ts | ts | MCP Vitest 테스트/계약 fixture: session.test | 41 | 1368 |
| 243 | packages/mcp/test/repo-walk.test.ts | ts | MCP Vitest 테스트/계약 fixture: repo-walk.test | 156 | 6559 |
| 244 | packages/mcp/test/scan/scan.test.ts | ts | MCP Vitest 테스트/계약 fixture: scan.test | 698 | 32357 |
| 245 | packages/mcp/test/scan/sfc-blocks.test.ts | ts | MCP Vitest 테스트/계약 fixture: sfc-blocks.test | 235 | 9435 |
| 246 | packages/mcp/test/tokens/css-scan.test.ts | ts | MCP Vitest 테스트/계약 fixture: css-scan.test | 276 | 12147 |
| 247 | packages/mcp/test/tokens/figma-tokens.test.ts | ts | MCP Vitest 테스트/계약 fixture: figma-tokens.test | 453 | 14024 |
| 248 | packages/mcp/test/tokens/generated-tokens.test.ts | ts | MCP Vitest 테스트/계약 fixture: generated-tokens.test | 91 | 3925 |
| 249 | packages/mcp/test/tokens/js-config.test.ts | ts | MCP Vitest 테스트/계약 fixture: js-config.test | 659 | 29827 |
| 250 | packages/mcp/test/tokens/load.test.ts | ts | MCP Vitest 테스트/계약 fixture: load.test | 717 | 34018 |
| 251 | packages/mcp/test/tokens/repo-css.test.ts | ts | MCP Vitest 테스트/계약 fixture: repo-css.test | 49 | 1893 |
| 252 | packages/mcp/test/tokens/token-index.test.ts | ts | MCP Vitest 테스트/계약 fixture: token-index.test | 249 | 9709 |
| 253 | packages/mcp/test/tokens/tokens.test.ts | ts | MCP Vitest 테스트/계약 fixture: tokens.test | 197 | 9982 |
| 254 | packages/mcp/test/tools/binary-payload.test.ts | ts | MCP Vitest 테스트/계약 fixture: binary-payload.test | 31 | 1281 |
| 255 | packages/mcp/test/tools/component-map.test.ts | ts | MCP Vitest 테스트/계약 fixture: component-map.test | 187 | 7717 |
| 256 | packages/mcp/test/tools/design-context-guard.test.ts | ts | MCP Vitest 테스트/계약 fixture: design-context-guard.test | 592 | 22601 |
| 257 | packages/mcp/test/tools/design-diff.test.ts | ts | MCP Vitest 테스트/계약 fixture: design-diff.test | 141 | 5961 |
| 258 | packages/mcp/test/tools/export-pdf.test.ts | ts | MCP Vitest 테스트/계약 fixture: export-pdf.test | 115 | 4335 |
| 259 | packages/mcp/test/tools/export-video.test.ts | ts | MCP Vitest 테스트/계약 fixture: export-video.test | 169 | 5542 |
| 260 | packages/mcp/test/tools/get-document.test.ts | ts | MCP Vitest 테스트/계약 fixture: get-document.test | 26 | 884 |
| 261 | packages/mcp/test/tools/get-screenshot.test.ts | ts | MCP Vitest 테스트/계약 fixture: get-screenshot.test | 211 | 9261 |
| 262 | packages/mcp/test/tools/get-selection.test.ts | ts | MCP Vitest 테스트/계약 fixture: get-selection.test | 24 | 843 |
| 263 | packages/mcp/test/tools/layout-tier-coverage.test.ts | ts | MCP Vitest 테스트/계약 fixture: layout-tier-coverage.test | 136 | 5682 |
| 264 | packages/mcp/test/tools/local-tools.test.ts | ts | MCP Vitest 테스트/계약 fixture: local-tools.test | 108 | 5067 |
| 265 | packages/mcp/test/tools/motion-schemas.test.ts | ts | MCP Vitest 테스트/계약 fixture: motion-schemas.test | 112 | 3812 |
| 266 | packages/mcp/test/tools/ping.test.ts | ts | MCP Vitest 테스트/계약 fixture: ping.test | 261 | 8740 |
| 267 | packages/mcp/test/tools/read-tools.test.ts | ts | MCP Vitest 테스트/계약 fixture: read-tools.test | 193 | 8455 |
| 268 | packages/mcp/test/tools/save-image-fills.test.ts | ts | MCP Vitest 테스트/계약 fixture: save-image-fills.test | 227 | 7744 |
| 269 | packages/mcp/test/tools/save-screenshots.test.ts | ts | MCP Vitest 테스트/계약 fixture: save-screenshots.test | 154 | 5711 |
| 270 | packages/mcp/test/tools/skew-notice.test.ts | ts | MCP Vitest 테스트/계약 fixture: skew-notice.test | 155 | 5830 |
| 271 | packages/mcp/test/tools/token-map.test.ts | ts | MCP Vitest 테스트/계약 fixture: token-map.test | 473 | 19471 |
| 272 | packages/mcp/test/tools/write-tools.test.ts | ts | MCP Vitest 테스트/계약 fixture: write-tools.test | 284 | 13662 |
| 273 | packages/mcp/test/tool-schema.ts | ts | MCP Vitest 테스트/계약 fixture: tool-schema | 23 | 1038 |
| 274 | packages/mcp/tsconfig.json | json | mcp TypeScript 설정 | 9 | 199 |
| 275 | packages/mcp/tsdown.config.ts | ts | MCP tsdown 번들/배포 설정 | 26 | 937 |
| 276 | packages/mcp/vitest.config.ts | ts | mcp Vitest 프로젝트 설정 | 10 | 281 |
| 277 | packages/plugin/manifest.json | json | Figma 플러그인 manifest·권한 설정 | 14 | 530 |
| 278 | packages/plugin/package.json | json | plugin 패키지 manifest | 33 | 974 |
| 279 | packages/plugin/protocol/bridge.ts | ts | plugin UI↔sandbox 패널/브리지 계약: bridge | 141 | 5123 |
| 280 | packages/plugin/protocol/editor-context.ts | ts | plugin UI↔sandbox 패널/브리지 계약: editor-context | 86 | 5318 |
| 281 | packages/plugin/protocol/panel-control.ts | ts | plugin UI↔sandbox 패널/브리지 계약: panel-control | 147 | 6624 |
| 282 | packages/plugin/src/code.ts | ts | Figma API sandbox 핵심 모듈: code | 69 | 2759 |
| 283 | packages/plugin/src/dispatcher.ts | ts | Figma API sandbox 핵심 모듈: dispatcher | 69 | 2296 |
| 284 | packages/plugin/src/handlers/add-component-property.ts | ts | Figma sandbox 도구 핸들러/도우미: add-component-property | 81 | 3082 |
| 285 | packages/plugin/src/handlers/add-page.ts | ts | Figma sandbox 도구 핸들러/도우미: add-page | 16 | 643 |
| 286 | packages/plugin/src/handlers/add-variable-mode.ts | ts | Figma sandbox 도구 핸들러/도우미: add-variable-mode | 40 | 1767 |
| 287 | packages/plugin/src/handlers/apply-animation-style.ts | ts | Figma sandbox 도구 핸들러/도우미: apply-animation-style | 37 | 1679 |
| 288 | packages/plugin/src/handlers/apply-manual-keyframe-track.ts | ts | Figma sandbox 도구 핸들러/도우미: apply-manual-keyframe-track | 33 | 1567 |
| 289 | packages/plugin/src/handlers/apply-style-to-node.ts | ts | Figma sandbox 도구 핸들러/도우미: apply-style-to-node | 43 | 1766 |
| 290 | packages/plugin/src/handlers/batch.ts | ts | Figma sandbox 도구 핸들러/도우미: batch | 491 | 21496 |
| 291 | packages/plugin/src/handlers/batch-rename-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: batch-rename-nodes | 27 | 1068 |
| 292 | packages/plugin/src/handlers/bind-component-property.ts | ts | Figma sandbox 도구 핸들러/도우미: bind-component-property | 99 | 4090 |
| 293 | packages/plugin/src/handlers/bindings.ts | ts | Figma sandbox 도구 핸들러/도우미: bindings | 274 | 11587 |
| 294 | packages/plugin/src/handlers/bind-variable-to-node.ts | ts | Figma sandbox 도구 핸들러/도우미: bind-variable-to-node | 41 | 2016 |
| 295 | packages/plugin/src/handlers/bind-variable-to-paint.ts | ts | Figma sandbox 도구 핸들러/도우미: bind-variable-to-paint | 60 | 2576 |
| 296 | packages/plugin/src/handlers/clone-node.ts | ts | Figma sandbox 도구 핸들러/도우미: clone-node | 26 | 1097 |
| 297 | packages/plugin/src/handlers/combine-as-variants.ts | ts | Figma sandbox 도구 핸들러/도우미: combine-as-variants | 54 | 2184 |
| 298 | packages/plugin/src/handlers/component-property.ts | ts | Figma sandbox 도구 핸들러/도우미: component-property | 67 | 2992 |
| 299 | packages/plugin/src/handlers/convert.ts | ts | Figma sandbox 도구 핸들러/도우미: convert | 104 | 4528 |
| 300 | packages/plugin/src/handlers/create-component.ts | ts | Figma sandbox 도구 핸들러/도우미: create-component | 64 | 2226 |
| 301 | packages/plugin/src/handlers/create-effect-style.ts | ts | Figma sandbox 도구 핸들러/도우미: create-effect-style | 30 | 1200 |
| 302 | packages/plugin/src/handlers/create-ellipse.ts | ts | Figma sandbox 도구 핸들러/도우미: create-ellipse | 35 | 999 |
| 303 | packages/plugin/src/handlers/create-frame.ts | ts | Figma sandbox 도구 핸들러/도우미: create-frame | 30 | 946 |
| 304 | packages/plugin/src/handlers/create-grid-style.ts | ts | Figma sandbox 도구 핸들러/도우미: create-grid-style | 28 | 1186 |
| 305 | packages/plugin/src/handlers/create-instance.ts | ts | Figma sandbox 도구 핸들러/도우미: create-instance | 50 | 1730 |
| 306 | packages/plugin/src/handlers/create-paint-style.ts | ts | Figma sandbox 도구 핸들러/도우미: create-paint-style | 30 | 1210 |
| 307 | packages/plugin/src/handlers/create-rectangle.ts | ts | Figma sandbox 도구 핸들러/도우미: create-rectangle | 28 | 935 |
| 308 | packages/plugin/src/handlers/create-section.ts | ts | Figma sandbox 도구 핸들러/도우미: create-section | 36 | 1104 |
| 309 | packages/plugin/src/handlers/create-text.ts | ts | Figma sandbox 도구 핸들러/도우미: create-text | 31 | 1071 |
| 310 | packages/plugin/src/handlers/create-text-style.ts | ts | Figma sandbox 도구 핸들러/도우미: create-text-style | 82 | 3563 |
| 311 | packages/plugin/src/handlers/create-variable.ts | ts | Figma sandbox 도구 핸들러/도우미: create-variable | 47 | 2111 |
| 312 | packages/plugin/src/handlers/create-variable-collection.ts | ts | Figma sandbox 도구 핸들러/도우미: create-variable-collection | 23 | 758 |
| 313 | packages/plugin/src/handlers/delete-component-property.ts | ts | Figma sandbox 도구 핸들러/도우미: delete-component-property | 49 | 1974 |
| 314 | packages/plugin/src/handlers/delete-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: delete-nodes | 30 | 1169 |
| 315 | packages/plugin/src/handlers/delete-page.ts | ts | Figma sandbox 도구 핸들러/도우미: delete-page | 26 | 1028 |
| 316 | packages/plugin/src/handlers/delete-style.ts | ts | Figma sandbox 도구 핸들러/도우미: delete-style | 19 | 743 |
| 317 | packages/plugin/src/handlers/delete-variable.ts | ts | Figma sandbox 도구 핸들러/도우미: delete-variable | 20 | 815 |
| 318 | packages/plugin/src/handlers/delete-variable-collection.ts | ts | Figma sandbox 도구 핸들러/도우미: delete-variable-collection | 22 | 911 |
| 319 | packages/plugin/src/handlers/detach-instance.ts | ts | Figma sandbox 도구 핸들러/도우미: detach-instance | 22 | 915 |
| 320 | packages/plugin/src/handlers/edit-component-property.ts | ts | Figma sandbox 도구 핸들러/도우미: edit-component-property | 70 | 2784 |
| 321 | packages/plugin/src/handlers/export-pdf.ts | ts | Figma sandbox 도구 핸들러/도우미: export-pdf | 41 | 1829 |
| 322 | packages/plugin/src/handlers/export-video.ts | ts | Figma sandbox 도구 핸들러/도우미: export-video | 81 | 3658 |
| 323 | packages/plugin/src/handlers/find-replace-text.ts | ts | Figma sandbox 도구 핸들러/도우미: find-replace-text | 66 | 2592 |
| 324 | packages/plugin/src/handlers/get-annotations.ts | ts | Figma sandbox 도구 핸들러/도우미: get-annotations | 40 | 1402 |
| 325 | packages/plugin/src/handlers/get-component-api.ts | ts | Figma sandbox 도구 핸들러/도우미: get-component-api | 68 | 2733 |
| 326 | packages/plugin/src/handlers/get-design-context.ts | ts | Figma sandbox 도구 핸들러/도우미: get-design-context | 717 | 35107 |
| 327 | packages/plugin/src/handlers/get-document.ts | ts | Figma sandbox 도구 핸들러/도우미: get-document | 16 | 507 |
| 328 | packages/plugin/src/handlers/get-fonts.ts | ts | Figma sandbox 도구 핸들러/도우미: get-fonts | 42 | 1482 |
| 329 | packages/plugin/src/handlers/get-local-components.ts | ts | Figma sandbox 도구 핸들러/도우미: get-local-components | 80 | 2934 |
| 330 | packages/plugin/src/handlers/get-metadata.ts | ts | Figma sandbox 도구 핸들러/도우미: get-metadata | 17 | 583 |
| 331 | packages/plugin/src/handlers/get-motion-styles.ts | ts | Figma sandbox 도구 핸들러/도우미: get-motion-styles | 19 | 862 |
| 332 | packages/plugin/src/handlers/get-node.ts | ts | Figma sandbox 도구 핸들러/도우미: get-node | 21 | 770 |
| 333 | packages/plugin/src/handlers/get-node-motion.ts | ts | Figma sandbox 도구 핸들러/도우미: get-node-motion | 35 | 1776 |
| 334 | packages/plugin/src/handlers/get-nodes-info.ts | ts | Figma sandbox 도구 핸들러/도우미: get-nodes-info | 25 | 1019 |
| 335 | packages/plugin/src/handlers/get-pages.ts | ts | Figma sandbox 도구 핸들러/도우미: get-pages | 12 | 360 |
| 336 | packages/plugin/src/handlers/get-reactions.ts | ts | Figma sandbox 도구 핸들러/도우미: get-reactions | 58 | 2104 |
| 337 | packages/plugin/src/handlers/get-screenshot.ts | ts | Figma sandbox 도구 핸들러/도우미: get-screenshot | 216 | 10932 |
| 338 | packages/plugin/src/handlers/get-selection.ts | ts | Figma sandbox 도구 핸들러/도우미: get-selection | 16 | 508 |
| 339 | packages/plugin/src/handlers/get-styles.ts | ts | Figma sandbox 도구 핸들러/도우미: get-styles | 143 | 5968 |
| 340 | packages/plugin/src/handlers/get-variable-defs.ts | ts | Figma sandbox 도구 핸들러/도우미: get-variable-defs | 81 | 3316 |
| 341 | packages/plugin/src/handlers/get-viewport.ts | ts | Figma sandbox 도구 핸들러/도우미: get-viewport | 15 | 499 |
| 342 | packages/plugin/src/handlers/group-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: group-nodes | 31 | 1345 |
| 343 | packages/plugin/src/handlers/import-image.ts | ts | Figma sandbox 도구 핸들러/도우미: import-image | 55 | 2013 |
| 344 | packages/plugin/src/handlers/import-svg.ts | ts | Figma sandbox 도구 핸들러/도우미: import-svg | 42 | 1531 |
| 345 | packages/plugin/src/handlers/list-files.ts | ts | Figma sandbox 도구 핸들러/도우미: list-files | 18 | 512 |
| 346 | packages/plugin/src/handlers/lock-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: lock-nodes | 27 | 1083 |
| 347 | packages/plugin/src/handlers/motion-shared.ts | ts | Figma sandbox 도구 핸들러/도우미: motion-shared | 65 | 2975 |
| 348 | packages/plugin/src/handlers/move-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: move-nodes | 29 | 1149 |
| 349 | packages/plugin/src/handlers/navigate-to-page.ts | ts | Figma sandbox 도구 핸들러/도우미: navigate-to-page | 21 | 831 |
| 350 | packages/plugin/src/handlers/ping.ts | ts | Figma sandbox 도구 핸들러/도우미: ping | 12 | 386 |
| 351 | packages/plugin/src/handlers/place.ts | ts | Figma sandbox 도구 핸들러/도우미: place | 21 | 719 |
| 352 | packages/plugin/src/handlers/registry.ts | ts | Figma sandbox 도구 핸들러/도우미: registry | 241 | 14418 |
| 353 | packages/plugin/src/handlers/remove-animation-style.ts | ts | Figma sandbox 도구 핸들러/도우미: remove-animation-style | 36 | 1616 |
| 354 | packages/plugin/src/handlers/remove-manual-keyframe-track.ts | ts | Figma sandbox 도구 핸들러/도우미: remove-manual-keyframe-track | 25 | 1155 |
| 355 | packages/plugin/src/handlers/remove-reactions.ts | ts | Figma sandbox 도구 핸들러/도우미: remove-reactions | 24 | 882 |
| 356 | packages/plugin/src/handlers/rename-node.ts | ts | Figma sandbox 도구 핸들러/도우미: rename-node | 18 | 792 |
| 357 | packages/plugin/src/handlers/rename-page.ts | ts | Figma sandbox 도구 핸들러/도우미: rename-page | 21 | 813 |
| 358 | packages/plugin/src/handlers/rename-variable.ts | ts | Figma sandbox 도구 핸들러/도우미: rename-variable | 20 | 898 |
| 359 | packages/plugin/src/handlers/reorder-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: reorder-nodes | 29 | 1257 |
| 360 | packages/plugin/src/handlers/reparent-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: reparent-nodes | 38 | 1583 |
| 361 | packages/plugin/src/handlers/resize-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: resize-nodes | 34 | 1333 |
| 362 | packages/plugin/src/handlers/rotate-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: rotate-nodes | 28 | 1133 |
| 363 | packages/plugin/src/handlers/save-image-fills.ts | ts | Figma sandbox 도구 핸들러/도우미: save-image-fills | 101 | 4335 |
| 364 | packages/plugin/src/handlers/scan-nodes-by-types.ts | ts | Figma sandbox 도구 핸들러/도우미: scan-nodes-by-types | 28 | 1057 |
| 365 | packages/plugin/src/handlers/scan-text-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: scan-text-nodes | 20 | 763 |
| 366 | packages/plugin/src/handlers/search-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: search-nodes | 34 | 1460 |
| 367 | packages/plugin/src/handlers/set-arc.ts | ts | Figma sandbox 도구 핸들러/도우미: set-arc | 51 | 2154 |
| 368 | packages/plugin/src/handlers/set-auto-layout.ts | ts | Figma sandbox 도구 핸들러/도우미: set-auto-layout | 101 | 4393 |
| 369 | packages/plugin/src/handlers/set-blend-mode.ts | ts | Figma sandbox 도구 핸들러/도우미: set-blend-mode | 20 | 896 |
| 370 | packages/plugin/src/handlers/set-constraints.ts | ts | Figma sandbox 도구 핸들러/도우미: set-constraints | 31 | 1329 |
| 371 | packages/plugin/src/handlers/set-corner-radius.ts | ts | Figma sandbox 도구 핸들러/도우미: set-corner-radius | 53 | 2119 |
| 372 | packages/plugin/src/handlers/set-effects.ts | ts | Figma sandbox 도구 핸들러/도우미: set-effects | 25 | 1005 |
| 373 | packages/plugin/src/handlers/set-fills.ts | ts | Figma sandbox 도구 핸들러/도우미: set-fills | 65 | 2523 |
| 374 | packages/plugin/src/handlers/set-instance-properties.ts | ts | Figma sandbox 도구 핸들러/도우미: set-instance-properties | 37 | 1621 |
| 375 | packages/plugin/src/handlers/set-layout-grids.ts | ts | Figma sandbox 도구 핸들러/도우미: set-layout-grids | 39 | 1513 |
| 376 | packages/plugin/src/handlers/set-layout-props.ts | ts | Figma sandbox 도구 핸들러/도우미: set-layout-props | 109 | 4371 |
| 377 | packages/plugin/src/handlers/set-mask.ts | ts | Figma sandbox 도구 핸들러/도우미: set-mask | 22 | 1093 |
| 378 | packages/plugin/src/handlers/set-opacity.ts | ts | Figma sandbox 도구 핸들러/도우미: set-opacity | 20 | 898 |
| 379 | packages/plugin/src/handlers/set-position.ts | ts | Figma sandbox 도구 핸들러/도우미: set-position | 52 | 2432 |
| 380 | packages/plugin/src/handlers/set-reactions.ts | ts | Figma sandbox 도구 핸들러/도우미: set-reactions | 28 | 1183 |
| 381 | packages/plugin/src/handlers/set-strokes.ts | ts | Figma sandbox 도구 핸들러/도우미: set-strokes | 69 | 2638 |
| 382 | packages/plugin/src/handlers/set-text.ts | ts | Figma sandbox 도구 핸들러/도우미: set-text | 30 | 1202 |
| 383 | packages/plugin/src/handlers/set-text-properties.ts | ts | Figma sandbox 도구 핸들러/도우미: set-text-properties | 105 | 4912 |
| 384 | packages/plugin/src/handlers/set-text-range.ts | ts | Figma sandbox 도구 핸들러/도우미: set-text-range | 158 | 7481 |
| 385 | packages/plugin/src/handlers/set-timeline-duration.ts | ts | Figma sandbox 도구 핸들러/도우미: set-timeline-duration | 30 | 1353 |
| 386 | packages/plugin/src/handlers/set-variable-code-syntax.ts | ts | Figma sandbox 도구 핸들러/도우미: set-variable-code-syntax | 58 | 2733 |
| 387 | packages/plugin/src/handlers/set-variable-value.ts | ts | Figma sandbox 도구 핸들러/도우미: set-variable-value | 63 | 3356 |
| 388 | packages/plugin/src/handlers/set-visible.ts | ts | Figma sandbox 도구 핸들러/도우미: set-visible | 19 | 841 |
| 389 | packages/plugin/src/handlers/swap-component.ts | ts | Figma sandbox 도구 핸들러/도우미: swap-component | 43 | 1637 |
| 390 | packages/plugin/src/handlers/ungroup-nodes.ts | ts | Figma sandbox 도구 핸들러/도우미: ungroup-nodes | 25 | 1018 |
| 391 | packages/plugin/src/handlers/update-effect-style.ts | ts | Figma sandbox 도구 핸들러/도우미: update-effect-style | 36 | 1229 |
| 392 | packages/plugin/src/handlers/update-paint-style.ts | ts | Figma sandbox 도구 핸들러/도우미: update-paint-style | 36 | 1214 |
| 393 | packages/plugin/src/handlers/update-text-style.ts | ts | Figma sandbox 도구 핸들러/도우미: update-text-style | 73 | 3117 |
| 394 | packages/plugin/src/idempotency.ts | ts | Figma API sandbox 핵심 모듈: idempotency | 57 | 1903 |
| 395 | packages/plugin/src/panel.ts | ts | Figma API sandbox 핵심 모듈: panel | 100 | 4398 |
| 396 | packages/plugin/src/reveal.ts | ts | Figma API sandbox 핵심 모듈: reveal | 74 | 3301 |
| 397 | packages/plugin/src/serializer.ts | ts | Figma API sandbox 핵심 모듈: serializer | 845 | 38058 |
| 398 | packages/plugin/src/traverse.ts | ts | Figma API sandbox 핵심 모듈: traverse | 40 | 1463 |
| 399 | packages/plugin/test/components/panel-background-button.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: panel-background-button.test | 39 | 1436 |
| 400 | packages/plugin/test/components/panel-chrome.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: panel-chrome.test | 132 | 4903 |
| 401 | packages/plugin/test/components/panel-footer.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: panel-footer.test | 38 | 1433 |
| 402 | packages/plugin/test/components/panel-status.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: panel-status.test | 86 | 3275 |
| 403 | packages/plugin/test/components/panel-tabs.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: panel-tabs.test | 46 | 1772 |
| 404 | packages/plugin/test/components/tab-activity-row.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: tab-activity-row.test | 284 | 10842 |
| 405 | packages/plugin/test/components/tab-panels.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: tab-panels.test | 256 | 9002 |
| 406 | packages/plugin/test/components/ui-payload-block.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: ui-payload-block.test | 108 | 3859 |
| 407 | packages/plugin/test/components/ui-primitives.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: ui-primitives.test | 184 | 6656 |
| 408 | packages/plugin/test/composables/use-panel-window.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: use-panel-window.test | 120 | 3779 |
| 409 | packages/plugin/test/composables/use-relay-session.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: use-relay-session.test | 341 | 10648 |
| 410 | packages/plugin/test/dispatcher.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: dispatcher.test | 120 | 4359 |
| 411 | packages/plugin/test/handlers/add-page.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: add-page.test | 25 | 1091 |
| 412 | packages/plugin/test/handlers/add-variable-mode.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: add-variable-mode.test | 54 | 2380 |
| 413 | packages/plugin/test/handlers/apply-style-to-node.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: apply-style-to-node.test | 48 | 1587 |
| 414 | packages/plugin/test/handlers/batch.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: batch.test | 601 | 22782 |
| 415 | packages/plugin/test/handlers/batch-rename-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: batch-rename-nodes.test | 33 | 1256 |
| 416 | packages/plugin/test/handlers/bindings.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: bindings.test | 287 | 10027 |
| 417 | packages/plugin/test/handlers/bind-variable-to-node.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: bind-variable-to-node.test | 80 | 2985 |
| 418 | packages/plugin/test/handlers/bind-variable-to-paint.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: bind-variable-to-paint.test | 117 | 4037 |
| 419 | packages/plugin/test/handlers/clone-node.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: clone-node.test | 33 | 1436 |
| 420 | packages/plugin/test/handlers/combine-as-variants.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: combine-as-variants.test | 79 | 2994 |
| 421 | packages/plugin/test/handlers/component-property.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: component-property.test | 270 | 10831 |
| 422 | packages/plugin/test/handlers/create-component.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-component.test | 86 | 3197 |
| 423 | packages/plugin/test/handlers/create-effect-style.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-effect-style.test | 92 | 3256 |
| 424 | packages/plugin/test/handlers/create-ellipse.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-ellipse.test | 63 | 1934 |
| 425 | packages/plugin/test/handlers/create-frame.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-frame.test | 85 | 2526 |
| 426 | packages/plugin/test/handlers/create-grid-style.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-grid-style.test | 88 | 2940 |
| 427 | packages/plugin/test/handlers/create-instance.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-instance.test | 49 | 1898 |
| 428 | packages/plugin/test/handlers/create-paint-style.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-paint-style.test | 107 | 3645 |
| 429 | packages/plugin/test/handlers/create-rectangle.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-rectangle.test | 63 | 1940 |
| 430 | packages/plugin/test/handlers/create-section.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-section.test | 46 | 1405 |
| 431 | packages/plugin/test/handlers/create-text.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-text.test | 52 | 1841 |
| 432 | packages/plugin/test/handlers/create-text-style.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-text-style.test | 251 | 11025 |
| 433 | packages/plugin/test/handlers/create-variable.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-variable.test | 83 | 2942 |
| 434 | packages/plugin/test/handlers/create-variable-collection.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: create-variable-collection.test | 27 | 987 |
| 435 | packages/plugin/test/handlers/delete-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: delete-nodes.test | 38 | 1608 |
| 436 | packages/plugin/test/handlers/delete-page.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: delete-page.test | 41 | 1707 |
| 437 | packages/plugin/test/handlers/delete-style.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: delete-style.test | 24 | 1059 |
| 438 | packages/plugin/test/handlers/delete-variable.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: delete-variable.test | 26 | 1150 |
| 439 | packages/plugin/test/handlers/delete-variable-collection.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: delete-variable-collection.test | 28 | 1261 |
| 440 | packages/plugin/test/handlers/detach-instance.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: detach-instance.test | 27 | 1282 |
| 441 | packages/plugin/test/handlers/export-pdf.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: export-pdf.test | 76 | 2959 |
| 442 | packages/plugin/test/handlers/export-video.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: export-video.test | 125 | 4070 |
| 443 | packages/plugin/test/handlers/find-replace-text.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: find-replace-text.test | 39 | 1732 |
| 444 | packages/plugin/test/handlers/get-annotations.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-annotations.test | 64 | 2375 |
| 445 | packages/plugin/test/handlers/get-component-api.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-component-api.test | 96 | 3557 |
| 446 | packages/plugin/test/handlers/get-design-context.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-design-context.test | 913 | 38261 |
| 447 | packages/plugin/test/handlers/get-document.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-document.test | 57 | 2101 |
| 448 | packages/plugin/test/handlers/get-fonts.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-fonts.test | 55 | 2236 |
| 449 | packages/plugin/test/handlers/get-local-components.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-local-components.test | 96 | 3184 |
| 450 | packages/plugin/test/handlers/get-metadata.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-metadata.test | 76 | 2430 |
| 451 | packages/plugin/test/handlers/get-node.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-node.test | 55 | 2123 |
| 452 | packages/plugin/test/handlers/get-node-motion.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-node-motion.test | 90 | 3721 |
| 453 | packages/plugin/test/handlers/get-nodes-info.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-nodes-info.test | 52 | 1925 |
| 454 | packages/plugin/test/handlers/get-pages.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-pages.test | 33 | 1003 |
| 455 | packages/plugin/test/handlers/get-reactions.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-reactions.test | 73 | 2874 |
| 456 | packages/plugin/test/handlers/get-screenshot.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-screenshot.test | 328 | 13227 |
| 457 | packages/plugin/test/handlers/get-selection.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-selection.test | 55 | 1886 |
| 458 | packages/plugin/test/handlers/get-styles.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-styles.test | 389 | 13394 |
| 459 | packages/plugin/test/handlers/get-variable-defs.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-variable-defs.test | 209 | 6499 |
| 460 | packages/plugin/test/handlers/get-viewport.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: get-viewport.test | 22 | 754 |
| 461 | packages/plugin/test/handlers/group-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: group-nodes.test | 34 | 1422 |
| 462 | packages/plugin/test/handlers/import-image.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: import-image.test | 86 | 2523 |
| 463 | packages/plugin/test/handlers/import-svg.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: import-svg.test | 72 | 2310 |
| 464 | packages/plugin/test/handlers/list-files.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: list-files.test | 29 | 1008 |
| 465 | packages/plugin/test/handlers/lock-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: lock-nodes.test | 34 | 1418 |
| 466 | packages/plugin/test/handlers/move-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: move-nodes.test | 31 | 1205 |
| 467 | packages/plugin/test/handlers/navigate-to-page.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: navigate-to-page.test | 28 | 1179 |
| 468 | packages/plugin/test/handlers/projection-coverage.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: projection-coverage.test | 229 | 7963 |
| 469 | packages/plugin/test/handlers/remove-reactions.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: remove-reactions.test | 27 | 1102 |
| 470 | packages/plugin/test/handlers/rename-node.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: rename-node.test | 24 | 1160 |
| 471 | packages/plugin/test/handlers/rename-page.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: rename-page.test | 29 | 1104 |
| 472 | packages/plugin/test/handlers/rename-variable.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: rename-variable.test | 37 | 1318 |
| 473 | packages/plugin/test/handlers/reorder-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: reorder-nodes.test | 36 | 1303 |
| 474 | packages/plugin/test/handlers/reparent-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: reparent-nodes.test | 44 | 1964 |
| 475 | packages/plugin/test/handlers/resize-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: resize-nodes.test | 31 | 1276 |
| 476 | packages/plugin/test/handlers/rotate-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: rotate-nodes.test | 27 | 1130 |
| 477 | packages/plugin/test/handlers/save-image-fills.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: save-image-fills.test | 180 | 6653 |
| 478 | packages/plugin/test/handlers/scan-nodes-by-types.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: scan-nodes-by-types.test | 45 | 1517 |
| 479 | packages/plugin/test/handlers/scan-text-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: scan-text-nodes.test | 62 | 1845 |
| 480 | packages/plugin/test/handlers/search-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: search-nodes.test | 76 | 2656 |
| 481 | packages/plugin/test/handlers/set-arc.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-arc.test | 42 | 2071 |
| 482 | packages/plugin/test/handlers/set-auto-layout.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-auto-layout.test | 157 | 5984 |
| 483 | packages/plugin/test/handlers/set-blend-mode.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-blend-mode.test | 25 | 1124 |
| 484 | packages/plugin/test/handlers/set-constraints.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-constraints.test | 33 | 1390 |
| 485 | packages/plugin/test/handlers/set-corner-radius.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-corner-radius.test | 64 | 2741 |
| 486 | packages/plugin/test/handlers/set-effects.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-effects.test | 74 | 2687 |
| 487 | packages/plugin/test/handlers/set-fills.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-fills.test | 127 | 4530 |
| 488 | packages/plugin/test/handlers/set-instance-properties.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-instance-properties.test | 49 | 1948 |
| 489 | packages/plugin/test/handlers/set-layout-grids.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-layout-grids.test | 132 | 4519 |
| 490 | packages/plugin/test/handlers/set-layout-props.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-layout-props.test | 141 | 4899 |
| 491 | packages/plugin/test/handlers/set-mask.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-mask.test | 37 | 1690 |
| 492 | packages/plugin/test/handlers/set-opacity.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-opacity.test | 25 | 1250 |
| 493 | packages/plugin/test/handlers/set-position.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-position.test | 81 | 2808 |
| 494 | packages/plugin/test/handlers/set-reactions.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-reactions.test | 45 | 1661 |
| 495 | packages/plugin/test/handlers/set-strokes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-strokes.test | 106 | 3907 |
| 496 | packages/plugin/test/handlers/set-text.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-text.test | 60 | 2157 |
| 497 | packages/plugin/test/handlers/set-text-properties.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-text-properties.test | 178 | 6239 |
| 498 | packages/plugin/test/handlers/set-text-range.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-text-range.test | 289 | 11280 |
| 499 | packages/plugin/test/handlers/set-variable-code-syntax.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-variable-code-syntax.test | 87 | 3392 |
| 500 | packages/plugin/test/handlers/set-variable-value.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-variable-value.test | 148 | 6431 |
| 501 | packages/plugin/test/handlers/set-visible.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: set-visible.test | 24 | 1198 |
| 502 | packages/plugin/test/handlers/swap-component.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: swap-component.test | 56 | 2251 |
| 503 | packages/plugin/test/handlers/ungroup-nodes.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: ungroup-nodes.test | 29 | 1161 |
| 504 | packages/plugin/test/handlers/update-effect-style.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: update-effect-style.test | 70 | 2654 |
| 505 | packages/plugin/test/handlers/update-paint-style.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: update-paint-style.test | 86 | 3349 |
| 506 | packages/plugin/test/handlers/update-text-style.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: update-text-style.test | 166 | 6923 |
| 507 | packages/plugin/test/idempotency.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: idempotency.test | 68 | 2683 |
| 508 | packages/plugin/test/lib/format.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: format.test | 70 | 2510 |
| 509 | packages/plugin/test/panel.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: panel.test | 242 | 8522 |
| 510 | packages/plugin/test/protocol/bridge.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: bridge.test | 111 | 3917 |
| 511 | packages/plugin/test/protocol/editor-context.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: editor-context.test | 85 | 3779 |
| 512 | packages/plugin/test/protocol/panel-control.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: panel-control.test | 119 | 4811 |
| 513 | packages/plugin/test/relay/client.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: client.test | 789 | 27738 |
| 514 | packages/plugin/test/relay/diagnostics.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: diagnostics.test | 121 | 4310 |
| 515 | packages/plugin/test/relay/node-ids.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: node-ids.test | 79 | 2984 |
| 516 | packages/plugin/test/relay/payload.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: payload.test | 63 | 3097 |
| 517 | packages/plugin/test/relay/state.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: state.test | 161 | 5626 |
| 518 | packages/plugin/test/reveal.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: reveal.test | 219 | 6920 |
| 519 | packages/plugin/test/sandbox/commands.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: commands.test | 95 | 2705 |
| 520 | packages/plugin/test/sandbox/messaging.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: messaging.test | 137 | 4146 |
| 521 | packages/plugin/test/sandbox/tool-bridge.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: tool-bridge.test | 106 | 3326 |
| 522 | packages/plugin/test/serializer.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: serializer.test | 1536 | 50178 |
| 523 | packages/plugin/test/traverse.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: traverse.test | 68 | 2434 |
| 524 | packages/plugin/test/variable-binding-coverage.test.ts | ts | 플러그인 Vitest 테스트/계약 검증: variable-binding-coverage.test | 78 | 4242 |
| 525 | packages/plugin/tsconfig.json | json | plugin TypeScript 설정 | 23 | 540 |
| 526 | packages/plugin/ui/App.vue | vue | Vue 패널 진입점/스타일/HTML: App | 118 | 5597 |
| 527 | packages/plugin/ui/components/PanelBackgroundButton.vue | vue | Vue 패널 UI 컴포넌트: PanelBackgroundButton | 39 | 2005 |
| 528 | packages/plugin/ui/components/PanelFooter.vue | vue | Vue 패널 UI 컴포넌트: PanelFooter | 21 | 982 |
| 529 | packages/plugin/ui/components/PanelGrip.vue | vue | Vue 패널 UI 컴포넌트: PanelGrip | 53 | 2327 |
| 530 | packages/plugin/ui/components/PanelStatus.vue | vue | Vue 패널 UI 컴포넌트: PanelStatus | 59 | 1960 |
| 531 | packages/plugin/ui/components/PanelTabs.vue | vue | Vue 패널 UI 컴포넌트: PanelTabs | 37 | 1299 |
| 532 | packages/plugin/ui/components/TabActivity.vue | vue | Vue 패널 UI 컴포넌트: TabActivity | 35 | 1382 |
| 533 | packages/plugin/ui/components/TabActivityRow.vue | vue | Vue 패널 UI 컴포넌트: TabActivityRow | 186 | 8664 |
| 534 | packages/plugin/ui/components/TabContext.vue | vue | Vue 패널 UI 컴포넌트: TabContext | 76 | 2942 |
| 535 | packages/plugin/ui/components/TabDebug.vue | vue | Vue 패널 UI 컴포넌트: TabDebug | 99 | 3865 |
| 536 | packages/plugin/ui/components/UiCopyButton.vue | vue | Vue 패널 UI 컴포넌트: UiCopyButton | 41 | 1503 |
| 537 | packages/plugin/ui/components/UiMetaRow.vue | vue | Vue 패널 UI 컴포넌트: UiMetaRow | 39 | 1278 |
| 538 | packages/plugin/ui/components/UiPayloadBlock.vue | vue | Vue 패널 UI 컴포넌트: UiPayloadBlock | 38 | 1262 |
| 539 | packages/plugin/ui/components/UiSection.vue | vue | Vue 패널 UI 컴포넌트: UiSection | 23 | 795 |
| 540 | packages/plugin/ui/components/UiSectionHeading.vue | vue | Vue 패널 UI 컴포넌트: UiSectionHeading | 10 | 366 |
| 541 | packages/plugin/ui/composables/useCopyToClipboard.ts | ts | Vue 패널 composable: useCopyToClipboard | 9 | 509 |
| 542 | packages/plugin/ui/composables/usePanelWindow.ts | ts | Vue 패널 composable: usePanelWindow | 41 | 1378 |
| 543 | packages/plugin/ui/composables/useRelaySession.ts | ts | Vue 패널 composable: useRelaySession | 120 | 6062 |
| 544 | packages/plugin/ui/composables/useSharedNow.ts | ts | Vue 패널 composable: useSharedNow | 10 | 482 |
| 545 | packages/plugin/ui/env.d.ts | ts | Vue 패널 진입점/스타일/HTML: env.d | 5 | 214 |
| 546 | packages/plugin/ui/index.html | html | Vue 패널 진입점/스타일/HTML: index | 12 | 291 |
| 547 | packages/plugin/ui/lib/format.ts | ts | 플러그인 UI 유틸리티: format | 32 | 1498 |
| 548 | packages/plugin/ui/lib/tabs.ts | ts | 플러그인 UI 유틸리티: tabs | 8 | 291 |
| 549 | packages/plugin/ui/main.ts | ts | Vue 패널 진입점/스타일/HTML: main | 29 | 992 |
| 550 | packages/plugin/ui/relay/client.ts | ts | 플러그인 WebSocket client·상태/UI 진단: client | 545 | 21835 |
| 551 | packages/plugin/ui/relay/diagnostics.ts | ts | 플러그인 WebSocket client·상태/UI 진단: diagnostics | 85 | 3335 |
| 552 | packages/plugin/ui/relay/node-ids.ts | ts | 플러그인 WebSocket client·상태/UI 진단: node-ids | 52 | 2034 |
| 553 | packages/plugin/ui/relay/payload.ts | ts | 플러그인 WebSocket client·상태/UI 진단: payload | 80 | 3441 |
| 554 | packages/plugin/ui/relay/state.ts | ts | 플러그인 WebSocket client·상태/UI 진단: state | 152 | 5673 |
| 555 | packages/plugin/ui/sandbox/commands.ts | ts | UI↔sandbox 호출 브리지: commands | 46 | 2030 |
| 556 | packages/plugin/ui/sandbox/messaging.ts | ts | UI↔sandbox 호출 브리지: messaging | 66 | 3014 |
| 557 | packages/plugin/ui/sandbox/tool-bridge.ts | ts | UI↔sandbox 호출 브리지: tool-bridge | 91 | 2786 |
| 558 | packages/plugin/ui/style.css | css | Vue 패널 진입점/스타일/HTML: style | 163 | 5784 |
| 559 | packages/plugin/vite.config.main.ts | ts | 플러그인 UI/sandbox Vite 빌드 설정 | 20 | 372 |
| 560 | packages/plugin/vite.config.ts | ts | 플러그인 UI/sandbox Vite 빌드 설정 | 23 | 665 |
| 561 | packages/plugin/vitest.config.ts | ts | plugin Vitest 프로젝트 설정 | 22 | 919 |
| 562 | packages/shared/package.json | json | shared 패키지 manifest | 21 | 444 |
| 563 | packages/shared/src/codec.ts | ts | server↔plugin 공유 스키마·codec·타입: codec | 12 | 470 |
| 564 | packages/shared/src/components.ts | ts | server↔plugin 공유 스키마·codec·타입: components | 60 | 2700 |
| 565 | packages/shared/src/design-context.ts | ts | server↔plugin 공유 스키마·codec·타입: design-context | 736 | 35106 |
| 566 | packages/shared/src/design-context-dedupe.ts | ts | server↔plugin 공유 스키마·codec·타입: design-context-dedupe | 274 | 10465 |
| 567 | packages/shared/src/envelope.ts | ts | server↔plugin 공유 스키마·codec·타입: envelope | 143 | 4530 |
| 568 | packages/shared/src/heartbeat.ts | ts | server↔plugin 공유 스키마·codec·타입: heartbeat | 60 | 1577 |
| 569 | packages/shared/src/index.ts | ts | server↔plugin 공유 스키마·codec·타입: index | 15 | 485 |
| 570 | packages/shared/src/protocol.ts | ts | server↔plugin 공유 스키마·codec·타입: protocol | 40 | 1722 |
| 571 | packages/shared/src/queries.ts | ts | server↔plugin 공유 스키마·codec·타입: queries | 326 | 15441 |
| 572 | packages/shared/src/rpc.ts | ts | server↔plugin 공유 스키마·codec·타입: rpc | 37 | 1444 |
| 573 | packages/shared/src/serialized-node.ts | ts | server↔plugin 공유 스키마·codec·타입: serialized-node | 655 | 28212 |
| 574 | packages/shared/src/styles.ts | ts | server↔plugin 공유 스키마·codec·타입: styles | 75 | 3105 |
| 575 | packages/shared/src/tool-budgets.ts | ts | server↔plugin 공유 스키마·codec·타입: tool-budgets | 53 | 2855 |
| 576 | packages/shared/src/variables.ts | ts | server↔plugin 공유 스키마·codec·타입: variables | 96 | 4001 |
| 577 | packages/shared/src/version.ts | ts | server↔plugin 공유 스키마·codec·타입: version | 179 | 10871 |
| 578 | packages/shared/src/writes.ts | ts | server↔plugin 공유 스키마·codec·타입: writes | 112 | 4175 |
| 579 | packages/shared/test/codec.test.ts | ts | 공유 계층 Vitest 테스트: codec.test | 50 | 1760 |
| 580 | packages/shared/test/design-context-dedupe.test.ts | ts | 공유 계층 Vitest 테스트: design-context-dedupe.test | 335 | 12107 |
| 581 | packages/shared/test/envelope.test.ts | ts | 공유 계층 Vitest 테스트: envelope.test | 63 | 2349 |
| 582 | packages/shared/test/heartbeat.test.ts | ts | 공유 계층 Vitest 테스트: heartbeat.test | 72 | 2249 |
| 583 | packages/shared/test/serialized-node.test.ts | ts | 공유 계층 Vitest 테스트: serialized-node.test | 221 | 6681 |
| 584 | packages/shared/test/tool-budgets.test.ts | ts | 공유 계층 Vitest 테스트: tool-budgets.test | 47 | 1770 |
| 585 | packages/shared/test/version.test.ts | ts | 공유 계층 Vitest 테스트: version.test | 127 | 6084 |
| 586 | packages/shared/tsconfig.json | json | shared TypeScript 설정 | 8 | 176 |
| 587 | packages/shared/vitest.config.ts | ts | shared Vitest 프로젝트 설정 | 10 | 284 |
| 588 | pnpm-lock.yaml | yaml | pnpm 의존성 lockfile | 3976 | 131596 |
| 589 | pnpm-workspace.yaml | yaml | pnpm 워크스페이스 설정 | 11 | 153 |
| 590 | README.md | md | 프로젝트 사용자 README | 323 | 19489 |
| 591 | renovate.json | json | 프로젝트/도구 구성 파일 | 14 | 370 |
| 592 | scripts/release.mjs | mjs | 개발/릴리스 자동화 스크립트: release | 279 | 10717 |
| 593 | scripts/sync-skills.mjs | mjs | 개발/릴리스 자동화 스크립트: sync-skills | 39 | 1685 |
| 594 | SECURITY.md | md | 보안 모델·취약점 신고 정책 | 49 | 5120 |
| 595 | skills/figma-build/references/assemble-screens.md | md | 에이전트 스킬 상세 참조: assemble-screens | 74 | 4315 |
| 596 | skills/figma-build/references/author-design-system.md | md | 에이전트 스킬 상세 참조: author-design-system | 117 | 8639 |
| 597 | skills/figma-build/references/motion.md | md | 에이전트 스킬 상세 참조: motion | 86 | 4866 |
| 598 | skills/figma-build/references/write-rules.md | md | 에이전트 스킬 상세 참조: write-rules | 144 | 10218 |
| 599 | skills/figma-build/SKILL.md | md | 배포용 에이전트 워크플로 스킬: SKILL | 95 | 7011 |
| 600 | skills/figma-codegen/references/assets-and-icons.md | md | 에이전트 스킬 상세 참조: assets-and-icons | 72 | 5125 |
| 601 | skills/figma-codegen/references/grounding.md | md | 에이전트 스킬 상세 참조: grounding | 276 | 24856 |
| 602 | skills/figma-codegen/references/motion.md | md | 에이전트 스킬 상세 참조: motion | 69 | 5740 |
| 603 | skills/figma-codegen/references/responsive.md | md | 에이전트 스킬 상세 참조: responsive | 66 | 5187 |
| 604 | skills/figma-codegen/references/stylesheets.md | md | 에이전트 스킬 상세 참조: stylesheets | 132 | 6168 |
| 605 | skills/figma-codegen/references/verify.md | md | 에이전트 스킬 상세 참조: verify | 29 | 2326 |
| 606 | skills/figma-codegen/SKILL.md | md | 배포용 에이전트 워크플로 스킬: SKILL | 193 | 14966 |
| 607 | skills/README.md | md | 에이전트 스킬 패키지 안내 | 26 | 1481 |
| 608 | test/docs-sync.test.ts | ts | 패키지 횡단 통합/문서 동기화 테스트: docs-sync.test | 28 | 1340 |
| 609 | test/tool-registry.test.ts | ts | 패키지 횡단 통합/문서 동기화 테스트: tool-registry.test | 106 | 4984 |
| 610 | tsconfig.base.json | json | 프로젝트/도구 구성 파일 | 25 | 700 |
| 611 | tsconfig.json | json | 프로젝트/도구 구성 파일 | 5 | 72 |
| 612 | vitest.config.ts | ts | 빌드/테스트 도구 설정 | 39 | 1196 |
