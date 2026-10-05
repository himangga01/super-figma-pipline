# Handoff: continue on another PC

Prepared on October 5, 2026, at about 10:10 KST (Asia/Seoul). The owner asked for a detailed record that lets the work continue on another PC, followed by a commit and push. For a new machine, this document replaces the operational steps of the [evening handoff](reboot-2026-10-04-evening.md). The historical evidence there and in the linked records stays valid.

## 1. Read order

1. [AGENTS.md](../../AGENTS.md): the repository rules. They override any resume prompt.
2. This document.
3. The [evening handoff](reboot-2026-10-04-evening.md), especially [Remaining work at 09:47 KST on October 5](reboot-2026-10-04-evening.md#remaining-work-at-0947-kst-on-october-5).
4. The [service analysis](../service-analysis.md), the canonical report. Start with its current continuation section.
5. The [native collector increments](../testing/2026-10-04-ecommerce-parity/native-effects/README.md) and the [control diagnostics](../testing/2026-10-04-ecommerce-parity/control-diagnostics/README.md).

## 2. Published state

| Item | Value |
| --- | --- |
| Repository | `https://github.com/himangga01/super-figma-pipline`. It is **public**: anything pushed is readable by anyone |
| Branch | `main`. Merge commit `4c24aa3a4360d06d8ac082d3e114add3598e3ea5` brought in `remediation/2026-09-27`, which was then deleted (see [Branch cleanup](#branch-cleanup-on-october-5)) |
| Work commit | `78af2b1adf4d3cd7c2ebda67afb0edee2f1a0b6f`: all service, test, provenance and evidence changes (260 files) |
| Handoff commit | `a795151a4f044ee1e88c03863d3bfc41054448f4`: this document, its helper copies and pointer updates. A later documentation commit on `main` records the branch cleanup |
| Earlier published commits | `5b9343efc82ef47ba56f412acbd4eee5a328d335` (former remediation tip) and `0a0f3ad58cc41326e3f362fb9dc350eb45d371e3` (former `main`) |
| Service source fingerprint | `sha256:eb9c2c5c5369df4c75ce6050b1484a4ccf4252528e4583741039e154d120d602`, after the October 5 commit "feat: repair review findings and add native metadata fields" on `main`. The earlier handoff state was `sha256:62023ddd...` |
| Committed service tree | `1cff1731766a12eef1242ce662d0fd5120354903`, identical to the last verified review index (`review-20261005.index`); the earlier work commit's tree was `5f342a83...` |
| Provenance | Checked on the staged state before each commit: slice `review-2026-10-04` (71 semantic changes) and then slice `review-2026-10-05` (21 changes), each with 4 authority paths; the offline upstream lock (3 upstreams, 238 vendor rows) |
| Secret scan | No credential, cookie, token or pairing-code pattern found in the 258 committed text files or the two committed ZIP archives |

`service/.gitattributes` keeps service text files on LF, so the fingerprint reproduces on a fresh clone even with `core.autocrlf=true`. Root documents may check out with CRLF; Git normalizes them on commit.

This source passed focused tests and provenance checks, but its whole check did **not** complete (section 6). It is not release-verified or acceptance-verified.

Pushing `service/**` triggers the `Service verification` workflow in `.github/workflows/service-ci.yml`. Its results are not part of this handoff. Its `non-ascii-paths` variant is expected to fail until T01, and its Ubuntu job is informational.

### Branch cleanup on October 5

At the owner's request, the work was merged into `main` with a merge commit and pushed (`0a0f3ad..4c24aa3`). Every other branch was already contained in `main` before anything was deleted, and no pull request was open.

- **Remote.** `remediation/2026-09-27` and `feat/super-figma-pipeline-v0.1` were deleted. Only `main` remains.
- **Local, deleted.** `remediation/2026-09-27` and eight task branches: `rem/p0-baseline`, `rem/p0-wiring`, `rem/t01-lease-v2`, `rem/t03-t04-tooling`, `rem/t06a-repros`, `rem/t08-workspace-rows`, `rem/t09-retention-sweep` and `rem/t26-analysis-limits`.
- **Local, worktree branches.** Five branches were checked out in task worktrees: `rem/t07-replace-integrity` (`.worktrees/lane-a`), `rem/t14a-consumption-logic` (`lane-b`), `rem/t10-leader-health` (`lane-c`), `rem/t05a-provenance` (`lane-d`) and `rem/int-contracts-refresh` (`main-wiring`). Their commits are all in `main`.
  - Claude Code's automatic permission check denied the agent's attempt to remove those worktrees.
  - The owner then ran the removal and `git branch -d` personally, and all five branches were deleted.
  - Git left four `code-kb` junctions in the lane folders. The agent removed those links without recursion, so the 807 files in the real `code-kb` folder were unchanged, and then removed the empty lane folders.
  - The empty `.worktrees/main-wiring` folder stays because another process holds it. It can be removed with `rmdir` after that process ends.
  - Locally, only `main` remains.
- **Uncommitted September 27 work.** `lane-a` (T07 replace integrity: 2 modified, 4 new files) and `lane-b` (T14a consumption logic: 5 modified, 2 new files) hold work that is in no commit. Before any cleanup it was copied to the old PC's ignored `.worktrees/_cache/wip-backup-20261005`. Each lane has `info.txt` (branch and base commit), `tracked.patch`, `paths.txt` and full file copies. The copies matched by SHA-256, and both patches apply cleanly to their base commits. This backup is local only and was not pushed.
- **Recovery list.** Every branch tip before cleanup is in `branch-tips-before-cleanup.txt` in the same folder.

The owner then also deleted the detached `.worktrees/baseline` validation copy, so the main checkout is now the only worktree. That copy's ignored contents are gone, including:

- `node_modules` and `dist`;
- the `.cache` helpers and alternate review indexes;
- `artifacts/source-checks`, which held the `pending` pointer of interrupted check `1c7268c7...`.

The four helpers listed in section 8 and the committed evidence records survive. To work on the old PC again, recreate the validation copy with the section 4 setup, as on a new PC. `.worktrees/_cache` still holds the private state, the live inputs, the pnpm shims and the September 27 WIP backup.

## 3. What Git does not carry

| Item | Old PC location, relative to the repository | On the new PC |
| --- | --- | --- |
| Service owner state: control credentials, egress grants, portal designs, plans and runs, Desktop pairing | `.worktrees/_cache/cdd-native-appdata/SuperFigmaPipeline` | Start fresh. Never move credentials through Git. The R2/R6 plans and the R8 run state stay on the old PC |
| Separate verification state | `.worktrees/_cache/verification-20261004-r8-appdata` | Create a new, empty folder |
| Native validation copy, with `node_modules`, `dist`, `.cache` helpers and `artifacts/source-checks` | `.worktrees/baseline/service`: a Git worktree detached at `db821db`, plus synced files | Recreate it as a worktree at the handoff commit (section 4) |
| pnpm shims (`pnpm`, `pnpx`) | `.worktrees/_cache/bin` | Recreate them with Corepack (section 4) |
| Native eCommerce input (`document.fig`) | `.worktrees/_cache/live-ecommerce-native-refresh-20261004` (96 MB) | Re-collect it with `chrome-export`, or copy it privately |
| eCommerce Chrome/Scripter reference R2: plan, reference tree and assets | `.worktrees/_cache/ecommerce-service-context-20261004-prep-r2` (11 MB) | Re-collect it with a fresh preparation, or copy it privately |
| eCommerce R6 plan context | `.worktrees/_cache/ecommerce-service-context-20261004-prep-r6` (1.9 MB) | Its plan exists only in the old owner state; a new PC needs a fresh preparation |
| Native CDD input | `.worktrees/_cache/live-cdd-2026-10-04` (52 MB) | Re-collect it, or copy it privately |
| CDD R8 reference context | `.worktrees/_cache/cdd-codegen-context-20261004-r8` (8.3 MB) | Re-collect it, or copy it privately |
| CDD R8 applied frontend | `.worktrees/_cache/cdd-service-outputs/cdd-chrome-frontend-r8` | Committed as [cdd-chrome-frontend-r8.zip](2026-10-04-evening/cdd-chrome-frontend-r8.zip). Check its 44 entries against [cdd-r8-files.json](2026-10-04-evening/cdd-r8-files.json) |
| Daemon logs | `.worktrees/_cache/daemon-logs` | Not needed |
| Old task worktrees and the September 27 WIP backup | `.worktrees/lane-a` to `lane-d`, `.worktrees/main-wiring` and `.worktrees/_cache/wip-backup-20261005` | Not needed for current work; see [Branch cleanup](#branch-cleanup-on-october-5) |
| Agent memory of owner preferences | Claude Code's per-user memory folder | Summarized in section 9 |

"Copy privately" means a direct transfer the owner controls, such as an external drive. Never use this public repository for it. Copied inputs keep the folder names used in section 7. Re-collected inputs get new folder names, and comparisons made with them are new evidence, not reproductions of the recorded results.

## 4. Set up the new PC

Requirements:

- **Windows 11.** The authorization probe, ACL checks and Job Object controls are Windows-specific. The old PC ran Windows 11 Pro 10.0.26200 with 15.6 GB of memory.
- **Git, Node.js 24 and pnpm.** The engine range is `>=24.0.0 <25`; `service/.node-version` is `v24.17.0`, and the old PC ran `v24.21.0`. Use Corepack with pnpm `11.24.0`, which `packageManager` pins.
- **Google Chrome stable**, signed in to Figma with access to both files. Enable remote debugging at `chrome://inspect/#remote-debugging`. The Chrome/Scripter path also needs permission to run the Scripter plugin.
- **Figma Desktop**, for the Desktop development-plugin path.
- **About 6 GB of free memory** for the whole check.
- No Docker.

Clone and prepare in PowerShell. These paths match the old PC, so the relative paths in the records keep working:

```powershell
git clone https://github.com/himangga01/super-figma-pipline.git C:/2026_project/super-figma-pipline
cd C:/2026_project/super-figma-pipline
git log --oneline -3   # main: expect the cleanup docs commit, then merge 4c24aa3 above a795151 and 78af2b1

# Native validation copy at the same commit
git worktree add --detach .worktrees/baseline HEAD

# Local pnpm shims, without changing the global Node installation
New-Item -ItemType Directory -Force .worktrees/_cache/bin | Out-Null
corepack enable --install-directory C:/2026_project/super-figma-pipline/.worktrees/_cache/bin pnpm
$env:PATH = 'C:/2026_project/super-figma-pipline/.worktrees/_cache/bin;' + $env:PATH

cd .worktrees/baseline/service
pnpm install --frozen-lockfile --ignore-scripts   # the same install command as CI
pnpm build
node scripts/verify-upstream-lock.mjs --offline
```

Check that both copies have the recorded source fingerprint:

```powershell
node -e "import('file:///C:/2026_project/super-figma-pipline/service/scripts/source-fingerprint.mjs').then(async m => console.log(await m.sourceFingerprint('C:/2026_project/super-figma-pipline/service'), await m.sourceFingerprint('C:/2026_project/super-figma-pipline/.worktrees/baseline/service')))"
```

Both values must be `sha256:eb9c2c5c5369df4c75ce6050b1484a4ccf4252528e4583741039e154d120d602`. If they differ, compare the file lists before running anything that records evidence.

## 5. Start the service

Do this only for live work, with the owner present.

```powershell
cd C:/2026_project/super-figma-pipline/.worktrees/baseline/service
$sfpUserLocalAppData = $env:LOCALAPPDATA
$env:SFP_CHROME_USER_DATA_DIR = Join-Path $sfpUserLocalAppData 'Google/Chrome/User Data'
$env:LOCALAPPDATA = 'C:/2026_project/super-figma-pipline/.worktrees/_cache/owner-appdata'
$env:PATH = 'C:/2026_project/super-figma-pipline/.worktrees/_cache/bin;' + $env:PATH
node packages/cli/dist/index.mjs status

# Start the daemon only if it is absent: hidden, no console window, output captured
New-Item -ItemType Directory -Force ../../_cache/daemon-logs | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$node = (Get-Command node).Source
Start-Process -FilePath $node -ArgumentList 'packages/mcp/dist/daemon-entry.mjs' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -RedirectStandardOutput "../../_cache/daemon-logs/$stamp.out.log" -RedirectStandardError "../../_cache/daemon-logs/$stamp.err.log"
node packages/cli/dist/index.mjs status
```

Then:

1. Open the file with `node packages/cli/dist/index.mjs chrome-open --url 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1' --wait 300`. The owner approves Chrome's connection prompt by hand.
2. Check `node packages/cli/dist/index.mjs egress status`. Before any frontend generation, the owner authorizes `egress allow` again. The earlier grant covered the public, project-code, design-text and design-image classes; it expired at 00:24:12 KST on October 5.

To stop the daemon, first identify its process, then stop only that process:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -match 'daemon-entry' | Select-Object ProcessId, CommandLine
Stop-Process -Id <ProcessId>
```

## 6. Whole check: the first task, after the owner asks

**State.** Whole check `1c7268c7-567a-488d-a78a-9cbcc6577ae5` at `62023ddd...` passed typecheck, lint, format, knip, contracts and build. Claude Code's memory reaper then stopped it at the test gate ([record](../testing/2026-10-04-ecommerce-parity/native-effects/interrupted-source-check.json)). Its `pending` pointer was deleted with the old validation copy; that committed record is now the only evidence. The current source is newer (`eb9c2c5c...`) and has had no whole check.

The last complete pass is `a59a6e15-5c33-472d-b947-a86d249124f8`, at the older source `ac67794d...` ([checkpoint](../testing/2026-10-04-ecommerce-parity/control-diagnostics/full-source-checkpoint.json)):

- all 16 gates in 859 s, including 787 s for tests;
- 4,769 passed, 0 failed, 20 skipped;
- all 37 required Chrome cases passed.

```powershell
cd C:/2026_project/super-figma-pipline/.worktrees/baseline/service
$env:LOCALAPPDATA = 'C:/2026_project/super-figma-pipline/.worktrees/_cache/verification-appdata'
$env:PATH = 'C:/2026_project/super-figma-pipline/.worktrees/_cache/bin;' + $env:PATH
node scripts/run-source-checks.mjs
```

- **Before starting.** Ask the owner first: the run launches Chrome test instances. Stop the daemon and confirm about 6 GB of free memory.
- **Memory reaper.** In Claude Code, the background-shell memory reaper can stop the run. Either start Claude Code with `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`, or let the owner run the check in a separate terminal.
- **Pointer.** The pointer is `artifacts/source-checks/current.json`. A `pending` pointer left by a stopped run means interrupted, not passed. Do not edit it or reuse its UUID.
- **After a pass.** Record it with the helper copies in section 8, using a new docs folder. Then update the service analysis and this branch's handoff records.

## 7. Commands and inputs

Run all commands from `.worktrees/baseline/service` with the environment from section 5. Placeholders are in angle brackets.

| Purpose | Command |
| --- | --- |
| Service state | `node packages/cli/dist/index.mjs status` |
| Open a Figma file in the owner's Chrome (owner approves) | `node packages/cli/dist/index.mjs chrome-open --url '<figma-url>' --wait 300` |
| Independent native collection, without Scripter | `node packages/cli/dist/index.mjs chrome-export --url '<figma-url>' [--open] [--out <folder>]` |
| Native versus Chrome/Scripter comparison | `node packages/cli/dist/index.mjs chrome-compare --input <document.fig> --reference <reference.json> --reference-assets <reference-assets.json> --url '<figma-url>' --out <folder>` |
| Desktop plugin preparation | `node packages/cli/dist/index.mjs connect --url '<figma-url>' --wait 900 --out <folder>`; 900 s is the maximum |
| Fresh Desktop pairing code | `node packages/cli/dist/index.mjs pair` |
| Official local MCP probe | `node packages/cli/dist/index.mjs figma-mcp probe --endpoint http://127.0.0.1:3845/mcp` |
| Official remote MCP | `figma-mcp probe` or `read` with `--endpoint https://mcp.figma.com/mcp --oauth-token-env <NAME>`. The named environment variable must hold the owner's externally authorized OAuth credential; the service does not run the OAuth flow. Never record the value |
| Model-data egress | `node packages/cli/dist/index.mjs egress status`; `egress allow` requires the owner's authorization |
| Whole check | `node scripts/run-source-checks.mjs` |
| Offline provenance lock | `node scripts/verify-upstream-lock.mjs --offline` |
| Staged change manifest | `node scripts/verify-staged-change-manifest.mjs [--write] --slice <id>`, with `SFP_REPOSITORY_ROOT` set to the main checkout. Optionally set `GIT_INDEX_FILE` to an alternate index |

### Figma files

- **eCommerce, the final acceptance target:** `https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1`. Page `0:1`, 11 roots, 3,198 nodes, 283 assets.
- **CDD:** `https://www.figma.com/design/ly06O8jAcrd7oWmwhz5Vr6?node-id=1378-120`.

### Recorded comparisons

`$C` is `C:/2026_project/super-figma-pipline/.worktrees/_cache`:

```text
chrome-compare --input $C/live-ecommerce-native-refresh-20261004/4IBhv1d8hEclifZQrOYxHS-1791110752199-869e9afe/document.fig --reference $C/ecommerce-service-context-20261004-prep-r2/reference-tree.json --reference-assets $C/ecommerce-service-context-20261004-prep-r2/reference-assets.json --url 'https://www.figma.com/design/4IBhv1d8hEclifZQrOYxHS?node-id=0-1' --out <folder>

chrome-compare --input $C/live-cdd-2026-10-04/ly06O8jAcrd7oWmwhz5Vr6-1791098970942-82f8dbca/document.fig --reference $C/cdd-codegen-context-20261004-r8/reference-tree-and-styles.json --reference-assets $C/cdd-codegen-context-20261004-r8/reference-assets.json --url 'https://www.figma.com/design/ly06O8jAcrd7oWmwhz5Vr6?node-id=1378-120' --out <folder>
```

With those exact inputs, the latest results over 87 declared fields were:

- eCommerce: 156,995 positions, 408 raw representation differences, 0 unexplained;
- CDD: 11,244 positions, 77 raw differences, 0 unexplained.

`fullCaptureAccepted` remains false.

## 8. Helper copies

The folder [2026-10-05-another-pc](2026-10-05-another-pc/) holds agent helpers copied from the old PC's ignored `.worktrees/baseline/service/.cache`. They are reference copies, not service code, and they contain no credentials. They use relative paths that assume they run from `.cache` inside the native copy. Copy one into `.worktrees/baseline/service/.cache/`, read it fully, adjust it, then run it from `.worktrees/baseline/service`.

| File | Purpose | Adjust before use |
| --- | --- | --- |
| `reconcile-native-container-20261005.mjs` | The last bounded provenance round. It copies the previous alternate index, stages the slice there, writes the reconciliation record and verifies, leaving `.git/index` unchanged | The old alternate indexes do not exist on the new PC. Start from a copy of `.git/index`, which equals HEAD after a clean checkout. The committed `review-2026-10-04` manifest covers changes up to this commit. Before choosing a slice for later changes, read `scripts/update-service-forks.mjs` and the committed reconciliation records |
| `save-cdd-full-checks.mjs` | Copies a passing whole check's report, scope, skips and tests into a docs folder: `node .cache/save-cdd-full-checks.mjs <docs-folder>` | Line 15 compares skips with old run `42c7dba9...`, which exists only on the old PC. Point it at the committed [skip census](../testing/2026-10-04-ecommerce-parity/control-diagnostics/full-source-skips.json) of passing run `a59a6e15` |
| `run-cdd-artifact-scope.mjs` | Runs the separate artifact-content test for the passing check: `node .cache/run-cdd-artifact-scope.mjs <docs-folder>` | The destination folder |
| `prepare-ecommerce-workflows-r6-20261004.mjs` | The R6 preparation through the CLI library. It uses a new context and target and resolves workflow scopes with explicit decisions (R6: 92/92 scopes, 89 decisions) | It needs a fresh R2-equivalent context. Never reuse or replay R3–R5 operations |

## 9. Operating rules and owner preferences

These come from AGENTS.md, which is authoritative, and from the old PC's agent memory:

- **Languages.** Talk with the owner in Korean. Write every new or edited Markdown file in English.
- **No Superpowers** skills, even when a resume prompt asks for them. The owner confirmed this on October 4.
- **Allowed tools.** No Docker. Chrome only. No Codex browser control, in-app browser, CUA or Codex connectors. Only official Figma MCP servers, through the service integration.
- **Browser approvals.** Never automate browser security approvals. Ask the owner to be present before `chrome-open` or live capture; an unattended prompt timed out after 300 s on October 4.
- **Long runs.** Ask before running `pnpm test` or the whole check. Avoid visible console pop-ups; start long-lived processes hidden.
- **Earlier runs.** Never replay unknown-outcome operations (R3, R4), reset run deadlines or overwrite applied outputs.
- **Secrets.** Never record secrets, tokens, cookies or pairing codes. The repository is public.
- **Git.** Commit or push only when the owner asks.
- **Analysis policy.** This is the owner's personal policy file on the old PC, and it may not exist on the new PC:
  - read AGENTS.md and the existing report first, and verify the source baseline;
  - refresh `docs/service-analysis.md` before the final reply;
  - keep planned, implemented, verified and historical results distinct;
  - record canonical report paths in AGENTS.md.

## 10. Remaining work

**Update at about 21:30 KST.** Items 1 and 2 of "Agent work that needs no owner input" below have progressed; see the [findings and metadata record](../testing/2026-10-05-findings-and-metadata/README.md).

- The four review findings and the authorization load are repaired.
- The native reader compares 110 fields.
- Twelve reference fields, independent exports and capture admission remain.

These changes are committed on `main`, so the service source is now `sha256:eb9c2c5c...`, and the first whole check applies to that source.

### First steps on the new PC

1. Do the setup and fingerprint check in section 4.
2. With the owner's approval, run the whole check at `eb9c2c5c...` (section 6).

### Needs the owner

- **Official MCP direction.** Figma's [rate limits and access page](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/), read on October 5, gives the Starter plan 20 tool calls per month. The local server on port 3845 was not listening on the old PC. The options are:
  - upgrade the plan or seat;
  - authorize the remote server with OAuth within that quota;
  - record the official path as plan-blocked, which leaves the final acceptance incomplete.
- **Desktop pairing.** The owner must be present, start the bundled plugin and paste a fresh `pair` code within 5 minutes.
- **Live access.** Approve Chrome's prompt when live work resumes, and re-authorize egress before generation.
- **C2/C3 targets.** C2 needs a real legacy target and C3 needs reference services, each with test environments and credentials. The owner names what is available, or decides which cases are relevant.

### Agent work that needs no owner input

1. **Native collector.** Add the 36 remaining fields: grid auto-layout, style identifiers, variables, annotations and exports, component semantics, render bounds, vectors and arcs ([inventory](../testing/2026-10-04-ecommerce-parity/native-effects/uncompared-node-fields.json)). Also add independent SVG and root-PNG exports and native capture admission.
2. **Open review findings.** F4 (shared 256-call re-observation cap), F5 (a malformed native style row aborts node comparison), F9 (proof re-hashing), F10 (duplicated fingerprint formula), and the Windows authorization probe load.
3. **Official MCP source boundary.** The portal source schema admits only Chrome and Desktop sources, so an official MCP read cannot yet produce its own frontend.
4. **Pairing usability.** Propose a repair for the 5-minute code inside the 900 s `connect` wait. The owner reviews it before it is applied, because it touches an authentication boundary.

### Then, in order

1. Desktop live collection, compared against separate Chrome evidence.
2. Relevant C1–C3 full-portal cases and independent review gates, including the open items of the [M01–M17 plan](../plans/2026-09-30-code-remediation-plan.md).
3. The final eCommerce test: two separate new frontends, one from official MCP and one from Chrome, without reference frontend code. Each goes through candidate, guarded application, applied runtime checks and final source freshness, starting from a fresh live preparation on the new PC.
4. Report refresh and the final release review. `verify:release`, remote CI and the two final critical review rounds have not been run.

## 11. Known pitfalls

- **Time zone.** Git Bash ignores `TZ=Asia/Seoul` and prints UTC. Use PowerShell `Get-Date` for KST.
- **Paths in Node.** Use Windows paths (`C:/...`) inside Node scripts; Git Bash `/c/...` paths fail there.
- **Shell chains.** Join dependent steps with `&&`. `set -e` did not stop one malformed provenance helper run. Run `node --check` on edited helpers before running them.
- **Desktop connect.** `connect --wait` above 900 fails with `WAIT_INVALID`, and the embedded pairing code expires after 5 minutes.
- **Monitoring.** It may report `monitoring-delayed` while the Windows authorization probe is busy. It waits up to 60 s before cancelling.
- **Memory.** Claude Code's background-shell memory reaper stopped two whole checks at the test gate.

## 12. Evidence index

- [Service analysis](../service-analysis.md)
- [Evening handoff](reboot-2026-10-04-evening.md) and its [backups](2026-10-04-evening/)
- [Control diagnostics](../testing/2026-10-04-ecommerce-parity/control-diagnostics/README.md)
- [Native increments](../testing/2026-10-04-ecommerce-parity/native-effects/README.md)
- [Complete eCommerce collection](../testing/2026-10-04-ecommerce-parity/README.md)
- [CDD generation record](../testing/2026-10-03-cdd-generation/README.md) and [CDD resume record](../testing/2026-10-04-cdd-resume/README.md)
- [Final acceptance request](../testing/2026-10-02-final-figma-preparation/README.md)
- [Active case scope](../plans/2026-09-07-portal-four-cases-plan.md) and [remediation plan](../plans/2026-09-30-code-remediation-plan.md)
