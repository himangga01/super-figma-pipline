# Independent review of the 31e4 source-epoch failure

Review date: October 12, 2026 (Asia/Seoul).

Scope: read-only review of release timestamp generation, the failed whole-check evidence and the coordinator's pinned-epoch rerun. This follows [AGENTS.md](../../../AGENTS.md), the shared analysis policy and [canonical service analysis](../../service-analysis.md). Only this English report was written. No service source, process, state, namespace, root index, browser or active test was changed or run by this reviewer.

## Baseline and verdict

The reviewed source is **`sha256:31e47b614fbc093b160d562e7b4107a4c1ad473965237b086f100663bb4f5ef5`**. Main and native source fingerprints were independently recomputed during the rerun and both matched it. Main remains on Git HEAD `22517932dc9b2cb974c177ec4eacb84d4b16e254`; the native validation worktree is detached at `6459363354f52940b4c67e399b9e735d7332d4dc`, with synchronized uncommitted source. Different Git HEAD metadata does not imply different synchronized service bytes.

**The cause and pinned-epoch repair are consistent with the inspected code and retained evidence.** The initial whole attempt remains failed, despite all sixteen commands exiting zero. The new attempt is pending; no current 31e4 whole/release pass is claimed.

## Confirmed failure mechanism

`service/scripts/release-common.mjs:14` sets release `epoch` from `SOURCE_DATE_EPOCH` when supplied, otherwise from `git log -1 --format=%ct` in its service working directory. `isoTime` is that value converted to UTC. `generate-sbom.mjs:13` writes `creationInfo.created: isoTime`, and `publishDocument` replaces the tracked SBOM source file. The source-check runner hashes service source before all gates and again afterward; the tracked SBOM participates in that fingerprint. A changed timestamp therefore correctly fails `SOURCE_CHANGED_DURING_VERIFICATION`, even if package/runtime checks succeed.

Actual Git timestamp observations:

| Working copy | Git HEAD | Commit epoch | Corresponding UTC time |
| --- | --- | --- | --- |
| Main | `22517932dc9b2cb974c177ec4eacb84d4b16e254` | `1791202532` | `2026-10-05T12:15:32.000Z` |
| Native | `6459363354f52940b4c67e399b9e735d7332d4dc` | `1791195684` | `2026-10-05T10:21:24.000Z` |

The coordinator retained the wrongly regenerated native SBOM at `.worktrees/baseline/service/.cache/SBOM-31e4-unpinned-epoch.json` before restoring exact main bytes. An independent recursive JSON comparison found exactly one different path, **`/creationInfo/created`**, with the two times above. Every other JSON value is equal. The two times also independently match their respective Git epochs.

| SBOM evidence | SHA-256 |
| --- | --- |
| Current main and restored native SBOM | `def65842c04e035fe82f55b09e6113a0d33a95e506ba9151079bf58b5c5eb008` |
| Retained native unpinned SBOM | `b4957d3a2df2813d43ec7d9bfba4881eb364ffad43f35d0ca9e4c8a795c5cdee` |

The reviewer also read the SBOM blob through the existing alternate R14 index. It matches current main bytes and the selected creation time. R14 index SHA-256 was `af30172194f29766c55e422259c552f9a8d529fa754e28172c59fc9bb10df42f` before and after that read; no staging/index replacement occurred. The coordinator's broader historical native/main/R14 comparison identified no other changed source. This reviewer independently confirms the SBOM difference and current full-fingerprint equality; the failed report itself does not publish an after-fingerprint or complete changed-path inventory.

## Preserved failed attempt

Attempt **`a95898c8-fbee-4067-8e70-3162706d7422`** is preserved under [full-source-31e4-epoch-failed](full-source-31e4-epoch-failed/report.json). Its report says `status:"failed"` and `error:"SOURCE_CHANGED_DURING_VERIFICATION"`. All sixteen named gates have exit code zero, including test ledger, provenance, SBOM, packaging, checksums, artifacts and isolated runtime.

The preserved full scope binds the same attempt and 31e4 source, with 462 files and 5,370 registered cases. Its [test summary](full-source-31e4-epoch-failed/test-summary.json) records **5,350 passed, zero failed and twenty skips**, with test-run success true. That is a successful test stage inside an unsuccessful whole attempt. The final source immutability check was neither waived nor weakened.

| Preserved document | SHA-256 |
| --- | --- |
| `report.json` | `28598790128dc61427de7df82144a90f2cab3667493cb6f48fa1e9d66ebd7415` |
| `test-scope.json` | `d6eed1a774b4f84612bcf5c6e28e2b3e0323bcfc1c3e2330c58aaeb50db920f1` |
| `test-summary.json` | `ceb54220743171788691cdc8f512e402afd1461e193fdf27a65868e3592136b6` |

The restored bytes and rerun do not retroactively make this attempt pass. Its live-Figma, target-service and remote-CI acceptance flags are explicitly false.

## Rerun binding and flag scope

The coordinator's private `.cache/export-source-epoch-binding-20261012.json` binds `SOURCE_DATE_EPOCH=1791202532` to the existing main SBOM creation time and the exact 31e4 source. Its SHA-256 is `63945c12f298ed3174067d29361d83be6c6691ca2b3387d2b5918c31f26c9773`. That selection preserves the established source metadata; it is not a new observation time or renewed execution authority.

At this read, the active source-check pointer identifies attempt **`ed4b77cc-acc5-4b28-b869-ae3d0efa891a`**, status `pending`, source 31e4. The coordinator's tool session ID is 89357; it is distinct from the source-check attempt ID. The new full scope binds that attempt/source with `command:["pnpm","test"]`, 462 files and 5,370 cases. No reduced case set or assertion/skip relaxation is indicated. Its pending report has an empty published checks array because this runner does not publish every in-memory stage result while running; that array cannot determine its current stage or final outcome.

`run-source-checks.mjs` forwards the parent process environment to every gate. `build-server.mjs` also consumes `SOURCE_DATE_EPOCH` for its numeric build label. Actual native `packages/mcp/dist/build-info.json` now contains **`buildId:1791202532000`**, confirming that the pin reached the new build stage, with content identity `sha256:df79ca3721f383b9b899fa022653857d42518bd89f45d0a574cdbfa239fb8d2e`.

The coordinator reports fresh `LOCALAPPDATA` under `.worktrees/_cache/verification-export-20261012-appdata` and fresh `SFP_STATE_ROOT` for validation. This worker did not inspect live process environment or authentication state. The exact release pin is confirmed through the binding receipt, code and build output; the fresh-state launch settings are coordinator evidence.

Reproduction settings for the coordinator, not executed here and not an instruction to start another concurrent whole check:

```powershell
# Working directory: C:/2026_project/super-figma-pipline/.worktrees/baseline/service
$env:SOURCE_DATE_EPOCH = '1791202532'
$env:LOCALAPPDATA = 'C:/2026_project/super-figma-pipline/.worktrees/_cache/verification-export-20261012-appdata'
$env:SFP_STATE_ROOT = 'C:/2026_project/super-figma-pipline/.worktrees/_cache/verification-export-20261012-appdata/SuperFigmaPipeline'
node scripts/run-source-checks.mjs
```

Preserve and restore the caller's environment in any reusable launcher. The reviewer did not set these variables or execute this command. The actual original failed launch was not reconstructed from a live process environment; its omitted release pin and fresh rerun settings come from the coordinator's retained launch evidence.

The source epoch is consumed by release metadata and build labeling. Portal run/lease and egress expiry code use their runtime clock/`Date.now`, not this environment variable. It does **not** renew a one-hour run, coding lease, model-data grant, native approval or retained unknown outcome.

## Package/source proof and material limits

`package-artifacts.mjs` copies the current source SBOM into each archive, uses `isoTime` for manifest creation, and uses the selected epoch for staging Git author/committer dates. It creates hermetic staging repositories rather than archiving the main/native repository HEAD. `generate-checksums.mjs` hashes the manifest and four actual archives, while artifact verification checks archive/file/checksum contents and portable startup. Thus the timestamp pin applies consistently to SBOM, archive metadata and build labeling without substituting Git commit equality for source-byte equality.

The full service source fingerprint is broader than the daemon build identity. The latter hashes CLI/IR/MCP/shared source and required build metadata; it is not the complete portal/test/SBOM source binding. Repeated build IDs are expected under a fixed epoch; content identity, full source fingerprint and verified archive bytes remain necessary.

At this read, `artifacts/artifact-manifest.v1.json` still had the **old native-fallback creation time `2026-10-05T10:21:24.000Z`**. The rerun had rebuilt the daemon but had not yet republished final package evidence. This is normal intermediate state; those archives/manifest must not be promoted as the pinned rerun's final artifacts. Wait for its package/checksum/artifact gates, final before/after source equality and source-bound success report. The separately required artifact-content check remains a distinct completion obligation.

The earlier sixteen exit-zero commands demonstrate their stated local checks, not an immutable-source whole pass. The new attempt remains pending. Neither proves a fresh machine installation, remote CI, live Figma capture, complete CDD frontend or final eCommerce acceptance. The SBOM records installed production dependencies and explicitly omits absent platform-optional packages; choosing a historical reproducibility epoch does not date the actual analysis, build observation or release publication to October 5.

No test runner, packager, SBOM generator or browser was executed by this reviewer. Verification here consisted of source/JSON inspection, metadata comparison, Git HEAD/timestamp reads, alternate-index blob reads, file hashes and readonly main/native source hashing. No credential or private browser endpoint was read or recorded. Root retains completion of the active whole/artifact run and its final immutable-source proof.

## Continuation

Keep source frozen and carry the explicit epoch into every whole/release/artifact launch for this source. Preserve the failed attempt and bad-SBOM backup. If the rerun succeeds, bind its own report/scope/archive hashes and recheck main/native source equality; never rewrite the failed report as successful. No source repair to the verifier is required by the evidence reviewed here.

Pending native Chrome approval and the fresh-QA eight-hour/four-class grant remain unanswered. The new QA 4315 export attempt, prefix `fa9b8cbc...`, timed out before its preflight and remains unknown; the previous main workspace/journal fences also remain preserved. The epoch repair does not authorize or replay any of them. New capture/readiness work must use the coordinator's explicit authorization and service-owned workflow after these separate prerequisites are resolved.
