# Task 5.5 main critical review

Status: Changes requested. Two independently reproduced findings; no integration approved yet. Review of the remaining consumer path continues against the eventual corrected manifest.

## R1: Candidate-written motion records satisfy temporal verification

`preview-interactions.ts` initializes `window.__sfpMotion`, appends observations there, and later trusts `page.evaluate('window.__sfpMotion')`. This property belongs to the candidate page. A static candidate's click handler can populate it with an invented duration, frames and samples. The real Firefox assertion then reports the required 300 ms dissolve as passed even though the page contains no CSS or Web Animations API animation.

The main session reproduced this using the actual source interaction contract, prepared observation manifest, saved PNG comparison and `assertNativePortalPreview`. The page only reveals the overlay and supplies the writable global. The returned receipt reports temporal observedMs 300 and animatedProperties opacity. No real motion was performed. This is a false acceptance in the implemented temporal verifier, not a claim about defeating the operating system or pipe authentication.

Keep authoritative observation state private to the validator, such as a closure-held browser handle/promise created before the action. Preserve genuine visible sampling, elapsed timing, source association and expected easing/direction checks. A candidate-written similarly named property must not affect the accepted result. Retain the existing real animation positive and static negative.

Command: `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/review-55-motion.diagnostic.test.ts --maxWorkers=1`. Result: one diagnostic passed, 4.13 seconds, September 15 at 08:44:42. The passing test asserts the defective acceptance.

Retained diagnostic: `packages/mcp/test/portal/review-55-motion.diagnostic.test.ts.disabled` in the native working copy. SHA-256: `974f9489eed49359ace9eb6e7d298f3bdfabea6c5431a11160b036714441ee05`.

## R2: Pipe chunk decoding corrupts multibyte text

Both `preview-channel.ts` and `preview-worker.ts` convert each arbitrary socket chunk independently with `chunk.toString('utf8')`. UTF-8 code points can span chunks. A receipt containing Korean text becomes replacement characters when the split occurs inside a character, yet the changed report is accepted. Configuration flowing in the other direction uses the same flawed conversion, so non-ASCII selectors or assertion text can change before browser execution.

The main session used the actual authenticated named-pipe channel, split the bytes of a Korean label across two writes, and observed a changed accepted label containing U+FFFD. Use a streaming strict UTF-8 decoder in both directions, retain actual byte/frame limits, and reject invalid/truncated trailing encodings instead of silently substituting characters.

Command: `node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/review-55-unicode.diagnostic.test.ts -t 'review: split' --maxWorkers=1`. Result: one diagnostic passed, two existing cases filtered, 913 ms, September 15 at 08:45:07. The passing test asserts the corruption.

Retained diagnostic: `packages/mcp/test/portal/review-55-unicode.diagnostic.test.ts.disabled`. SHA-256: `7326105580d8bced085c9a02ad6f50ca6796984d6f701a5d86ff6ef15226854f`.

## Disposition

Both findings were sent to the original author, who accepted the concrete reproductions and is preparing a bounded correction. Original source/report/manifests and diagnostics must remain available. The main session will independently verify corrected tests and final source before integration. No production source was edited during this review, and no main copy, daemon, user Chrome/Figma action, Git index operation, commit or push was performed.
