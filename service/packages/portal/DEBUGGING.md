# Server diagnostics

The portal and private daemon keep structured JSON Lines diagnostics separately from the user activity audit. Diagnostics explain transport failures and job execution. They do not authorize operations, prove a mutation succeeded, or resolve a retained unknown job.

## Location and configuration

- Portal: `<SFP_PORTAL_STATE_ROOT>/diagnostics/portal.jsonl`. The default portal state root is `SuperFigmaPipeline/web-portal` under `LOCALAPPDATA`, or the user's home directory when `LOCALAPPDATA` is absent.
- Daemon: `<SFP_STATE_ROOT>/diagnostics/daemon.jsonl`, using the service's existing default state root when the environment override is absent.
- Older files have suffixes `.1`, `.2`, and `.3`. Each file is limited to 1 MiB. The oldest retained diagnostics can disappear after rotation. This retention does not remove activity records or service jobs.
- `SFP_DIAGNOSTICS_LEVEL=info` is the default. `debug` adds request and outbound-client start events. `warn`, `error`, and `off` reduce logging. Set the environment for both processes before starting them. Changing an existing process's parent shell environment does not reconfigure that process.

`GET /api/health` includes `diagnostics`: the relative log location, level, retained-file and byte limits, successful writes, queued writes, dropped events, write failures, pre-write retries, recovered writes and unconfirmed flush waits. This read does not expose log contents, filesystem roots, credentials or results.

## Follow a request or job

1. Copy the visible service job ID from the portal's activity or service-job panel. Search that ID in both JSONL files and their retained rotations.
2. The portal's `job.created`, `job.state`, `job.operation-retained`, `job.execution-error`, and `job.finished` events share `jobId`. The originating HTTP request has `requestId`, also returned in the `x-sfp-request-id` response header. Approval-triggered execution can have the later action request's ID; `jobId` remains stable.
3. Outbound CLI control requests propagate the validated portal request/job IDs. The daemon records its own `requestId` plus the portal's `parentRequestId` and `jobId`. The CLI's `control.client-response` event retains the daemon's request ID as `daemonRequestId`.
4. Inspect `method`, sanitized `route`, `phase`, `status`, `durationMs`, and `outcome`. An HTTP `responded` outcome means a response was delivered. Read the durable job/operation state to establish execution outcome. `unknown` remains unknown until the original service recovery evidence establishes otherwise.
5. Follow the bounded `error` cause chain. A known error code such as `ERR_INVALID_URL` or `ECONNRESET` remains readable. Stack frames include source or built-entry module basenames and line/column numbers. Bundled chunks retain a closed source-derived family such as `commands.mjs` and a hash of the opaque chunk basename; private roots and arbitrary suffixes stay hidden. Built locations refer to the running bundle unless the runtime produces mapped source locations.

Example read-only PowerShell inspection, replacing the paths and ID with the owned runtime's values:

```powershell
$jobId = '00000000-0000-4000-8000-000000000001'
Get-Content -LiteralPath 'C:/owned-portal-state/diagnostics/portal.jsonl' |
  Select-String -SimpleMatch $jobId
Get-Content -LiteralPath 'C:/owned-daemon-state/diagnostics/daemon.jsonl' |
  Select-String -SimpleMatch $jobId
```

## Privacy and failure behavior

Diagnostics discard request/result bodies, code, arguments, authentication headers, cookies, action nonces, arbitrary error inputs, error messages, absolute paths and private browser URLs. Unknown error codes, error-message prefixes, operation IDs and leader generations use correlation hashes. Error-message hashes cover only the first 4,096 characters; the original character count is retained. Stack module/code labels use a closed source-derived catalog. A newly introduced label remains opaque until explicitly added to that catalog.

The portal and its separately bundled public CLI share one process-level asynchronous correlation context. Headers are correlation hints, never authority or authentication. Incoming correlation IDs must have UUID form; the service generates its own HTTP request IDs. The readable catalog includes every currently registered public CLI feature and MCP tool name; unknown labels remain hashed.

To maintain the closed catalog after adding source labels or public features, run `node --experimental-transform-types --disable-warning=ExperimentalWarning scripts/update-diagnostics-catalog.mjs` from `service/`, then the same command with `--check` and the diagnostics tests. Review the generated diff before integration. The generator reads production error/event/route/module labels, the actual registered CLI/tool inventories and the activity schema; it never executes a feature, opens a connection, or reads runtime credentials, logs, inputs or results. Tests, fixtures, caches, dependencies and the generated catalog are excluded from the scan. The diagnostics tests compare the readable labels against the currently registered tool/feature catalog.

Writes are asynchronous, with at most 128 queued events per logger. Queue overflow increments `dropped`; a disk/path failure increments `writeFailures`. The first failure and every hundredth repeated failure emit a sanitized `diagnostics.failure` JSON record to stderr. These counters remain readable even if stderr also fails. Logging failures do not replace typed responses, prevent cancellation, or turn failed execution into success. The activity audit keeps its existing independent durability rules.

Ordinary concurrent writers use a short-lived, exclusive TCP bind on `127.0.0.1` to serialize inspection, rotation and append across separate processes. A stable hash of the canonical diagnostic directory and component selects exactly one port in 55000–64999. The listener has no data protocol and immediately destroys incoming connections. There is no fallback port, persistent lock file or per-process log-file growth. The operating system releases the slot when a holder crashes. A hash collision or unrelated application holding that slot can cause logging contention; the service never probes, stops or evicts that application.

Acquisition retries for at most 250 ms. During ownership, the writer checks a second 250 ms deadline before each filesystem mutation and issues no later mutations after expiry. Already-issued filesystem work must settle before the slot is released. An operating-system filesystem stall can therefore exceed the hold deadline; timer-unlocking an unfinished append would break the file-size guarantee. Request handling and cancellation never wait for logging. Logging contention or expired writes increment `writeFailures` and emit a sanitized signal.

When the service's own deadline check expires before any append was issued, the writer releases its slot, waits 10 ms in the background and retries that same immutable JSONL row once. It reacquires the identical slot and inspects the current files, including any rotation already completed. A partially completed rotation does not permit retry because restarting its descending moves could discard additional retained history. The row keeps its queue position and original correlation fields. `preWriteRetries` and `recoveredWrites`, plus sanitized `diagnostics.retry` signals, expose attempts and recovery. A second expiry becomes a visible write failure. Arbitrary error codes, filesystem failures, an issued or partially completed append, and unconfirmed handle/slot closure never authorize retry. This does not replay a service operation or increase the queue, acquisition, hold or flush limits.

Diagnostics flush waits are bounded to two seconds, with an optional shorter internal wait. An unfinished wait returns unconfirmed, increments `flushTimeouts`, and emits `flush-unconfirmed`; it does not release an in-flight writer slot or claim pending writes succeeded. Portal close callbacks report `DIAGNOSTICS_FLUSH_UNCONFIRMED` instead of a clean closure if flushing remains pending. Orderly portal/daemon shutdown exits non-clean in this case. Abrupt process termination can lose queued diagnostics. This is bounded operational logging, not a transactional execution journal. The service rejects diagnostic directory/file links and nonregular or multiply linked log files. It runs under the existing Windows user and state-directory protection; it is not an operating-system sandbox or a complete defense against same-user path replacement races.

Portal failures before obtaining the state lock emit sanitized startup details to stderr instead of writing into another running portal's log. Failures after the portal owns its state lock are also persisted. Existing processes must be restarted from an authorized, source-verified build before these diagnostics are active.

## Local capture outcomes and explicit recovery

The function request detail shows safe connection/capture phases and refreshes active requests without replacing unsent input forms. `connecting` describes an attachment attempt; it does not prove that Chrome currently displays a native approval prompt. Review any native prompt manually. Progress contains closed phase names and timestamps, not endpoints, URLs, credentials or raw command messages. The visible request ID remains the correlation key for server diagnostics.

New local captures can finish as failed only when the public CLI's internal, invocation-bound proof confirms that no capture write or source effect was issued. Open/select intents, focus initialization and output creation cross that boundary before dispatch. Error text, missing folders and zero daemon operations are never proof, and older unknown jobs are not reclassified.

For an unknown, zero-operation local Chrome capture with a named workspace, the request detail offers a separate owner recovery review when the actual producer and current source cleanup are quiescent. A one-use confirmation expires after sixty seconds and binds the exact original record and workspace identity. Review the evidence, provide its SHA-256 and an explanation, and explicitly acknowledge the unresolved outcome. A legacy record also requires the owner's assertion that its prior producer and delayed source changes have ended. The service checks the current runtime but cannot prove that historical assertion. Unconfirmed current initialization, source intent or cleanup blocks the action.

The resulting `owner-abandoned` disposition releases only that local fence. The original job remains unknown, with its original timestamps, deadline, error and evidence. Other unknown jobs still block overlapping work. Recovery never dispatches the original command, resolves a daemon operation, renews permission or extends an execution deadline. A new capture requires a separately reviewed request and fresh attempt/output identity. After an ambiguous confirmation response, inspect the recorded disposition before taking another action. Existing Chrome Allow is not authorization for this owner decision.

Physical copy/export restoration remains tracked even if the caller has cancelled or the logical helper has returned. A failed restoration remains unconfirmed across Chrome connection replacement. A failed Scripter snapshot also conservatively leaves cleanup unconfirmed because that helper does not supply a complete deferred-UI cleanup proof. The service will not clear these conditions from messages or elapsed time; historical recovery after an owner-reviewed producer retirement still requires the explicit legacy assertion.

Scripter asset evaluation and cancellation RPCs are also tracked until their physical promises settle. A posted cancellation does not prove that an already-issued Plugin API export computation has ended inside Figma. Interrupted or failed reads therefore quarantine the current owner even after the browser RPCs settle. Historical recovery still requires the explicit legacy retirement assertion. Quiescence never establishes the original capture outcome or admission of its data.
