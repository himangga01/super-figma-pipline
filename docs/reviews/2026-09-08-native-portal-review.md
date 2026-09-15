# Native portal implementation and review

Date: 2026-09-08. Scope: the active four-case portal plan, with Docker prohibited.

## Outcome and evidence boundaries

The service now has a native portal workflow with nine canonical tools, a CLI driver, retained source authority, signed plans/runs, agent leases, candidate submission, owner-reviewed execution profiles, visual checks and recoverable publication. The canonical catalog contains 125 tools. Only C4 is frontend-only; C2/C3 retain the relevant operational portal scope.

This is not a claim that every item in the active implementation plan is complete. Source verification, native fixtures, live Figma acquisition and a finished target portal are separate acceptance levels. The current evidence is [the validation record](2026-09-08-validation.json). The older aggregate receipt in `service/artifacts/source-checks-report.json` is historical and must not be cited as evidence for these edits.

## Review decisions and fixes

Three independent reviewers examined native authority, capture evidence and case contracts. The main agent accepted the following findings and implemented corrections:

| Area | Corrected behavior |
| --- | --- |
| No Docker | Native working copies and explicitly reviewed commands replace the container requirement. No Docker, Podman, WSL or VM substitute is installed or launched. |
| Windows process ownership | A fixed broker uses an unnamed, non-inherited Job Object with kill-on-close, an independent deadline and owner-pipe EOF detection. Project values are encoded as data. A bounded watchdog reports unknown cleanup instead of hanging indefinitely. |
| Cancellation | A per-owner/run reservation exists before asynchronous preflight. Cancellation fences it before work can start. Partial publication remains reconcilable rather than becoming terminal cancellation. |
| Recovery concurrency | `portal_resume` with continuation uses the same repository write lane as normal application. |
| Command closure | The complete analyzed legacy baseline plus candidate overlays is required. Replaced files use their final hash. Closure is rechecked before each command and after execution. |
| Workflow acceptance | Checks must cover the same required workflow and layer. Unrelated API/persistence/authorization results cannot satisfy another workflow. |
| Operational blueprint | Draft workflows enter `needs-input`. Evidence remains readable without a coding lease. The driver instructs the agent to create a confirmed replacement plan with roles, states, contracts and per-layer implementation decisions. |
| C4 source scope | Supported frontend source/configuration formats are checked; backend dependencies, npm aliases, server imports/exports, Bun/Deno server calls and server actions are rejected. |
| Service selection | Root selection supports `.` consistently. Ambiguous paths across source roots are rejected. Dependency layers are retained conservatively instead of silently dropping a backend. |
| Stack selection | Explicit stack choices apply to new/reference candidates. Legacy stack overrides are rejected. |
| Cross-language evidence | Exact owner-reviewed file/hash/layer conclusions can resolve lexical warnings. Truncation and hard analysis limits are separately marked and cannot be waived through those reviews. |
| Asset delivery | Captured assets up to 5 MB can be delivered, with a bounded aggregate read budget and hash verification. |
| Capture continuation | Signed progress continues the unchanged design beyond a 256-asset batch. Exact existing bytes recover after publication interrupted before a progress checkpoint. |
| Visual authority | Successful visual-command reports are aggregated. Saved screenshot bytes are independently compared with every captured root PNG; unrelated local baselines and exit status alone do not establish fidelity. |
| Pinned artifacts | Standalone historical JSON is readable evidence but remains incomplete without usable, bound assets. |

The implementation reuses the existing external Playwright/Scripter collector, source readers, atomic writer, policy/execution plane, owner-state protections, Figma token/mapping primitives and Figwright-derived project convention analyzer. The three foundation repositories are not implicitly treated as business-service references. Their pinned source directories remain unchanged.

## Verification performed

Real Windows native tests cover execution, source/executable drift, timeout, cancellation, output bounds, a root exiting while descendants hold output pipes, argument preservation and prohibited container/shell commands. Native operational fixtures exercise API requests, SQLite persistence across restart and owner authorization for legacy/reference strategies. These fixtures intentionally do not claim complete frontend acceptance.

A separate manual Windows experiment killed the owning Node process while its broker-managed child wrote a heartbeat. The heartbeat stopped after owner termination. Only the fixture's owned process was terminated, and its verified temporary directory was removed. This confirms the owner-death path in addition to normal cancellation tests.

An owned headless Firefox fixture performs a real PNG comparison, accepts matching blue content and rejects a red mismatch. Additional tests cover authoritative oracle coverage, capture continuation and interrupted publication, draft-to-confirmed blueprint handling, cancellation during preflight, partial-result cancellation and truncated analysis remaining non-reviewable.

The full run passed type checking, lint, formatting, unused-code checks, builds, **316 test files / 3,395 tests**, provenance, graph memory, SBOM/notices and artifact checks. Seventeen tests were skipped. Its last installed-runtime check failed because two release scripts still expected 116 tools. Both scripts now compare canonical tool names, and the corrected installed-runtime check passed with 125 tools. Only those smoke scripts and provenance records changed after the full suite. They received focused lint/format/runtime checks; archives were regenerated and verified. The full suite was not repeated after this runner-only correction, and the aggregate command itself is not reported as a successful run.

See [the full verification log](2026-09-08-full-verify.txt), [the corrected installed-runtime log](2026-09-08-packed-runtime.txt) and [the validation record](2026-09-08-validation.json) for exact evidence and the final source hash.

## Remaining work in the approved plan

1. Acquire the supplied Figma file from the existing authorized Chrome tab and complete its live nodes, tokens, component/interaction context and assets. An installed desktop app or an unrelated Chrome connection does not establish that the required file is accessible. Do not launch or navigate Chrome to conceal that prerequisite.
2. Complete the real C1/C4, C2 and C3 target-portal acceptance matrix, including both supported frontend stacks and the actual reference/legacy service contracts. Native unit fixtures do not substitute for this matrix.
3. Finish the planned typed upstream workflow recipe registry and consuming feature-use records. Exact target/variable resolution, dependent compositions, Rust prompt/skill recipes and mapping parity remain in the [upstream adoption backlog](2026-09-07-upstream-adoption-audit.md). All tool names being mapped is not full behavioral utilization.
4. Extend service analysis beyond lexical review where complete cross-language semantic support is required. Conservative whole-source dependency layers are currently safer than claiming precise dependency closure. Fully qualified multi-source service selection and conflict resolution need their own end-to-end acceptance.
5. Support portable pinned capture packages with a validated asset manifest if offline completion is required. Standalone JSON intentionally does not pass visual completion.
6. Exercise the same lifecycle and native acceptance contracts on supported non-Windows hosts. No cross-platform runtime claim follows from Windows-only execution evidence.

These items are retained as incomplete; they are not converted into frontend-only scope or marked complete by documentation.

## Latest live connection observation

The latest attach-only attempt used the supplied Figma file key `4IBhv1d8hEclifZQrOYxHS` and the external Playwright connector. It returned `CHROME_CONNECTION_REQUIRED`. This supersedes the earlier observation of a successful connection with no matching Figma tab. No Chrome window/tab was launched or navigated. The Figma URL is already known; the unresolved prerequisite is access to the existing authorized browser session.
