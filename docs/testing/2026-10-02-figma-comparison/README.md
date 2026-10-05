# Chrome and official Figma MCP comparison

Date: October 2, 2026 (Asia/Seoul). Baseline: `db821db346e7cb5dd27e4df465b91bb106e2f2b3` plus the uncommitted implementation. The service supports Chrome only and official Figma MCP servers. Chrome Figma Web is the primary live test source.

## Executed acquisition and comparison

The requested file is `ly06O8jAcrd7oWmwhz5Vr6`, page `1378:120`. Tested roots are Home / Desktop (`1381:541`) and Home / Mobile (`1381:530`). Playwright remote control operated Scripter in an authenticated Chrome Figma Web tab. A read-only traversal obtained node properties and styled text ranges. Its local script export preserved ASCII-escaped JSON. No design node was changed or script saved into the Figma file. File identity comes from the requested tab URL because `figma.fileKey` was unavailable in Scripter.

[The lossless Chrome capture](chrome-lossless.json) contains 189 nodes, 70 text nodes and 70 styled segments. Its SHA-256 is `eac16e65aaaac8d760fad76c10029a257a678410e6e78398572efec69b0902b5`. The [node values](chrome.json), [text ranges](chrome-text-ranges.json) and [executed collector](read-chrome-lossless.js) are retained separately.

Official Figma MCP read the same nodes in four node batches and three text batches. Exact canonical equality, including absent properties, produced these results in [comparison-lossless.json](comparison-lossless.json):

| Scope                                                                           |                Compared positions | Raw differences |
| ------------------------------------------------------------------------------- | --------------------------------: | --------------: |
| 33 node properties plus parent identity                                         |                             6,426 |               0 |
| Text characters, segment counts, boundaries and 15 requested segment properties |                             1,400 |              70 |
| Complete descendant ID sequence and order                                       | 189 nodes, checked per node batch |               0 |

Every text difference is an omitted official segment `textWrapStyle`. Chrome returned `AUTO`; a direct official read of each corresponding node also returned `AUTO`. The raw omissions remain in the comparison record. All other compared text values matched, including 33 U+2028 and eight U+FEFF code units. These were separate reads, not an atomic cross-source snapshot.

The desktop frame is 1728 by 1117 and mobile frame 497 by 800. Both have `clipsContent: false`; their main content instances extend to heights 2869 and 3051 respectively. Nominal frame height must not imply clipping.

## Correction and verification

The shared production capture reader now marks absent required text-segment fields and malformed segment structure as partial. It repairs an omitted `textWrapStyle` only from an actually observed, uniform node value of `AUTO` or `BALANCE`. It records `TEXT_SEGMENT_FIELD_RECOVERED` with node, segment, field and `node.textWrapStyle` provenance. Mixed, absent or unknown node values remain partial. Other missing requested fields remain partial; optional `boundVariables` is not treated as mandatory. The reader invents no default wrapping value.

Four focused capture suites passed 67/67 tests, including a VM harness exercising the production postMessage listener and compiled reader while preserving U+2028/U+FEFF. Shared and CLI typechecks, scoped lint and formatting passed. These controlled tests establish the correction's behavior; they do not establish a new live capture.

The malformed-getter rows were subsequently corrected to pass actual named values into Vitest, including the empty array. All 30 text-segment tests passed with the intended nonempty-text/empty-segment assertion. The final complete native source run passed 4,624 tests with 20 recorded optional/platform skips and zero failures; 31 required Chrome cases ran without skips. The distinct artifact-content case also passed. [The canonical report](../../service-analysis.md) and [provenance record](../../reviews/2026-10-02-verification-provenance.md) contain exact source and scope identities. These package/fixture results remain separate from live generated-frontend acceptance.

A post-fix official call using the compiled production reader was attempted for the first 25 retained text nodes. Figma rejected it because the Starter plan MCP call limit had been reached. [The failed attempt](official-post-fix-attempt.json) is retained. No post-fix live MCP comparison is claimed.

The current production reader also executed a [recorded-value replay](production-reader-replay.json) for all 70 text nodes. Its API inputs were reconstructed from the retained comparison: matching Chrome text values, the 70 recorded official segment omissions and each directly observed official node wrapping value. All 70 recovered segments matched the Chrome segments exactly, with 70 exact recovery-provenance records, zero remaining text differences and all 33 U+2028/eight U+FEFF code units preserved. This is execution on saved facts, not a new official request or complete capture. Source SHA-256 is `d01c262ca8b19794c1b9bd385637d0b034f387aedb119beeb830949f26b5d9cd`.

The [replay script](replay-recorded-wrap.mjs) uses the separate copy's TypeScript compiler and current shared reader. Reproduce from `.worktrees/baseline/service` with `node ../../../docs/testing/2026-10-02-figma-comparison/replay-recorded-wrap.mjs`; it verifies its assertions and rewrites only the replay evidence file.

## Superseded transport evidence

An initial manual text export through rendered DOM text collapsed some U+2028/U+FEFF characters. ASCII escaping before display and export corrected this evidence collection. The service transports the raw request-bound postMessage JSON response; it does not collect rendered `innerText`. The initial DOM exports and initial comparison are preserved as `initial-dom-*`; `comparison.json` is explicitly superseded. Its early exact-text conclusion must not be reused as current evidence.

## Acceptance limits

The comparison does not cover complete catalogs, asset bytes, component APIs, temporal prototype behavior or generated frontend visual acceptance. The direct service Playwright/CDP collector returned `CHROME_CONNECTION_REQUIRED`. Browser automation of Chrome remote-debugging settings was rejected by automatic security review; the owner was asked to enable and admit the connection manually. Extension-mediated remote control supplied the web evidence above and is a separate authority. The service CLI remote MCP probe also required its own OAuth authorization.

M16 remains open: admit the service Chrome collector, collect complete current evidence, generate C4 frontend code without reference frontend sources, and run candidate, apply and applied validation with owned Chrome while repairing genuine failures. Complete C1–C4 and final release acceptance remain separate work.
