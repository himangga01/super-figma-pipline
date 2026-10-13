# Independent review of the native feedback fixture repair

Review date: October 12, 2026 (Asia/Seoul).

This bounded report follows [repository instructions](../../../AGENTS.md) and supplements [canonical service analysis](../../service-analysis.md). The coordinator retains the original failed whole-check evidence and final source integration. It is separate from the pending [Chrome session-owner review](chrome-session-owner-review.md).

## Baseline and scope

The coordinator reported that whole attempt `79cecde8-fb11-43ea-a6da-35031cf76edd` on source `sha256:673629ce8080ac1e697d144143b7b5d2c3a58482745a7ef885d0ea09578a0bfa` failed with 5,306 passes, eight failures and twenty existing skips. Its native feedback case retained an assertion command with exit zero and expected output, but classified it timed out after approximately 5,411 ms against its 5,000-ms fixture budget. This is coordinator-supplied failure evidence; the reviewer did not rerun the entire failed source or independently reproduce its whole-load timing.

The root-owned managed repair changes only `packages/mcp/test/portal/native-work.test.ts`, from native baseline `0d12374852a3de5cd1a990a8ea8a57fc798dbe3da47765b6ec3f3cb447e318bc` to frozen candidate `730539f5bb11ff561bdc3e347fd83c3a0c092cb962431977848de942ea25eb38`. The reviewer verified that candidate and compared its exact delta with the immutable native test. Production `packages/mcp/src/portal/native-work.ts` remains at `d0592bb58da1f9e31c7ba2a04fc83226bf28010de7251f8858fcfc3e3b592727`; the managed production hash was independently checked and the coordinator reports native/main match.

## Assessment and execution

The two parameter cases test persistence of failed native feedback after a valid prerequisite command. Assigning that owned fixture command a 15,000-ms budget, before cloning the deliberate exit-nine command, keeps startup/helper scheduling from substituting a timeout for the scenario under test. Production timeout enforcement, the failed required-check assertions, absent live design proof, capture-call counts and retained evidence-path checks remain unchanged.

The new unconditional expected-command array strengthens the `command-failed` case: retained evidence must include both the passed prerequisite and `failed-command` with status `failed` and exit code nine. It no longer accepts a generic failure that might have been a timeout. The existing sixty-second outer test bound remains unchanged. This is a bounded test-fixture correction, not relaxed frontend/source acceptance.

Independent execution in the managed service root:

```powershell
node node_modules/vitest/vitest.mjs run packages/mcp/test/portal/native-work.test.ts --project mcp -t 'retains failed native feedback' --reporter=json --outputFile=.cache/native-feedback-fixture-independent-20261012.json
```

Result: **two selected cases passed, zero failed**. Forty-one other cases were excluded by the explicit name filter; they are not presented as executed passes or added runtime skips. Private receipt SHA-256: `49158bebd163c74e473da84cdd306e8e99c502590dfcc67b49f8396f49342708`.

## Disposition and limits

**Approved for exact-file integration of the frozen test-only repair.** No reviewer source edit, live Chrome, native runtime, service policy, root index, package installation or dependency-junction mutation occurred. These owned native fixtures run under the same Windows account, not an OS sandbox. The two-case run does not prove the repaired whole source passes; root retains a fresh whole check and the original failure evidence.
