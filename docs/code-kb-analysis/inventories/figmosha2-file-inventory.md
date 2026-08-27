# figmosha2 전체 파일 인벤토리

> 조사 기준 시점: 2026-08-27 (Asia/Seoul)  
> 저장소: `code-kb/figmosha2`  
> 기준 커밋: `547cefb4c90abaa1da68db5455b921cbf3f8a5b9` (`master`, tag `v2.1.0`)  
> 라이선스: MIT (`LICENSE`)

## 1. 범위와 계수 규칙

- Git 내부 구현 자료인 `.git/**`는 제외했다. 작업 트리에서 `.git` 바깥의 파일을 재귀 열거한 결과와 `git ls-files` 결과가 모두 **15개**로 일치했으므로, 조사 시점에는 별도의 비추적 파일이 없다.
- 파일 크기는 작업 트리 파일의 바이트 수다. 15개 합계는 **109,430 bytes**다.
- UTF-8 텍스트 14개는 `[IO.File]::ReadAllLines()` 기준 **물리 2,518행**, 그중 공백만 있는 행을 제외한 **비공백 2,082행**이다. PNG 1개는 행 합계에서 제외했다.
- `plugin/icon.png`는 원본을 직접 열어 확인했다. 128×128, 32-bit ARGB PNG이며 5,285 bytes다.
- Git 파일 모드는 `git ls-files -s` 기준이다. 실행 비트가 있는 파일은 `start-bridge.sh` 하나(`100755`)이고 나머지는 `100644`다.
- `venv/`, `__pycache__/`, `*.log`, `.env`, `CLAUDE.local.md` 등 `.gitignore` 대상은 조사 시점 작업 트리에 존재하지 않았다. 제외 규칙 자체는 `.gitignore`의 역할로 아래 목록에 포함했다.

## 2. 전체 파일 목록

| # | 상대 경로 | 유형 | 역할 | bytes | 물리 행 | 비공백 행 | Git mode |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | `.gitignore` | Git 설정 | venv·캐시·로그·IDE·로컬 MCP/Claude 설정 제외 규칙 | 222 | 19 | 15 | 100644 |
| 2 | `CHANGELOG.md` | 변경 이력 | 2.0.0/2.1.0 기능·보안·수정 내역과 버전 정책 | 5,100 | 91 | 77 | 100644 |
| 3 | `CLAUDE.md` | 에이전트 운용 문서 | Claude Code용 실행법, helper/CLI 규약, 오류 복구 지침 | 9,259 | 204 | 153 | 100644 |
| 4 | `LICENSE` | 라이선스 | MIT License, 2026 Denys Osadchyi | 1,092 | 21 | 17 | 100644 |
| 5 | `README.md` | 사용자·개발 문서 | 목적, 아키텍처, 설치, API, 보안, 기능, 한계, 테스트 설명 | 19,633 | 391 | 293 | 100644 |
| 6 | `bridge.py` | Python 런타임 | aiohttp HTTP↔WebSocket 브리지, 보호 로직, pending 상관관계, 힌트 | 14,037 | 360 | 298 | 100644 |
| 7 | `figmosha.py` | Python CLI | HTTP 클라이언트, 진단 및 12개 parser 이름/11개 고유 동작 | 17,199 | 455 | 373 | 100644 |
| 8 | `plugin/code.js` | Figma main plugin | 임의 JS 실행기, 결과 직렬화, `h.*` helper 20개 | 13,208 | 356 | 319 | 100644 |
| 9 | `plugin/icon.png` | 이미지 자산 | 128×128 Figmosha 아이콘; manifest에서는 직접 참조하지 않음 | 5,285 | — | — | 100644 |
| 10 | `plugin/manifest.json` | Figma 설정 | main/UI 진입점, Figma·FigJam 대상, 권한과 localhost 네트워크 허용 | 436 | 13 | 13 | 100644 |
| 11 | `plugin/ui.html` | Figma plugin UI | 220×28 상태 바, localhost WebSocket, ping/pong, 재연결·중계 | 6,088 | 138 | 125 | 100644 |
| 12 | `start-bridge.ps1` | Windows 실행기 | venv/PATH Python 선택, 포트 PID 탐색, 중지·재시작, 숨김 실행·로그 | 2,861 | 76 | 67 | 100644 |
| 13 | `start-bridge.sh` | Unix 계열 실행기 | bash/tmux 세션 재생성, bridge 실행, 1초 상태 확인·로그 | 903 | 27 | 24 | 100755 |
| 14 | `tests/helpers.test.js` | Node 테스트 | Figma stub으로 `hex`·`solid`·`frame`·`sel`의 20개 assertion 검사 | 4,301 | 105 | 92 | 100644 |
| 15 | `tests/test_bridge.py` | pytest 테스트 | 실제 aiohttp test server/WS와 fake plugin으로 bridge 16개 case 정의 | 9,806 | 262 | 216 | 100644 |
| **합계** | **15개** | **텍스트 14 + PNG 1** |  | **109,430** | **2,518** | **2,082** |  |

## 3. 확장자별 통계

확장자가 없는 `LICENSE`와 점파일 `.gitignore`는 `무확장자/점파일`로 함께 집계했다. 행 수는 텍스트만 합산한다.

| 분류 | 파일 수 | bytes | 물리 행 | 비공백 행 | 파일 |
|---|---:|---:|---:|---:|---|
| `.py` | 3 | 41,042 | 1,077 | 887 | `bridge.py`, `figmosha.py`, `tests/test_bridge.py` |
| `.md` | 3 | 33,992 | 686 | 523 | `README.md`, `CLAUDE.md`, `CHANGELOG.md` |
| `.js` | 2 | 17,509 | 461 | 411 | `plugin/code.js`, `tests/helpers.test.js` |
| 무확장자/점파일 | 2 | 1,314 | 40 | 32 | `LICENSE`, `.gitignore` |
| `.html` | 1 | 6,088 | 138 | 125 | `plugin/ui.html` |
| `.png` | 1 | 5,285 | — | — | `plugin/icon.png` |
| `.ps1` | 1 | 2,861 | 76 | 67 | `start-bridge.ps1` |
| `.sh` | 1 | 903 | 27 | 24 | `start-bridge.sh` |
| `.json` | 1 | 436 | 13 | 13 | `plugin/manifest.json` |
| **합계** | **15** | **109,430** | **2,518** | **2,082** |  |

## 4. 디렉터리별 통계

| 디렉터리 | 파일 수 | bytes | 물리 행 | 비공백 행 | 주된 책임 |
|---|---:|---:|---:|---:|---|
| 저장소 루트 | 9 | 70,306 | 1,644 | 1,317 | bridge, CLI, 실행기, 문서, 라이선스·ignore |
| `plugin/` | 4 | 25,017 | 507 | 457 | Figma plugin main/UI/manifest/icon |
| `tests/` | 2 | 14,107 | 367 | 308 | bridge 통합 성격 테스트와 순수 helper 테스트 |
| **합계** | **15** | **109,430** | **2,518** | **2,082** |  |

## 5. 역할별 완전성 확인

| 역할군 | 파일 수 | 확인 내용 |
|---|---:|---|
| 실행 구현 | 4 | `bridge.py`, `figmosha.py`, `plugin/code.js`, `plugin/ui.html`을 줄 단위로 읽고 HTTP/WS 메시지와 helper 호출 관계를 역추적했다. |
| 설치·실행·설정 | 4 | 두 start script, manifest, `.gitignore`를 구현과 대조했다. 포트 설정 분리와 manifest의 `documentAccess` 부재를 확인했다. |
| 문서·법적 자료 | 4 | README/CLAUDE/CHANGELOG의 정량·기능·버전 주장을 코드와 테스트에 대조하고 MIT 본문을 확인했다. |
| 테스트 | 2 | pytest 12개 함수(매개변수 전개 시 16 case)와 Node의 20개 `check()` 호출을 구현 심볼별로 매핑했다. |
| 자산 | 1 | PNG를 시각 확인하고 크기·픽셀 형식·해시를 검사했다. |

## 6. 재실행 가능한 집계 명령

다음 PowerShell 명령은 저장소 루트 `code-kb/figmosha2`에서 실행한다.

```powershell
# canonical 파일 목록과 Git mode
git ls-files
git ls-files -s

# .git 바깥 실제 파일 수와 추적 파일 수가 모두 15인지 교차 확인
(Get-ChildItem -Recurse -Force -File |
  Where-Object { $_.FullName -notmatch '[\\/]\.git([\\/]|$)' }).Count
(git ls-files | Measure-Object).Count

# 파일별 bytes / 물리 행 / 비공백 행
git ls-files | ForEach-Object {
  $item = Get-Item -LiteralPath $_
  if ($_ -eq 'plugin/icon.png') {
    [pscustomobject]@{ Path=$_; Bytes=$item.Length; Physical=$null; Nonblank=$null }
  } else {
    $lines = [IO.File]::ReadAllLines($item.FullName)
    $nonblank = ($lines | Where-Object { -not [String]::IsNullOrWhiteSpace($_) }).Count
    [pscustomobject]@{
      Path=$_; Bytes=$item.Length; Physical=$lines.Count; Nonblank=$nonblank
    }
  }
} | Format-Table -AutoSize

# 총 bytes
$bytes = 0
git ls-files | ForEach-Object { $bytes += (Get-Item -LiteralPath $_).Length }
$bytes  # 109430
```

PNG 검증값은 다음과 같다.

```text
path: plugin/icon.png
dimensions: 128 x 128
pixel format: Format32bppArgb
bytes: 5285
SHA-256: 65be474c4ec4ccc633ca386d35f1094f9d370cf09069ece3435b1970ae61ab4d
```
