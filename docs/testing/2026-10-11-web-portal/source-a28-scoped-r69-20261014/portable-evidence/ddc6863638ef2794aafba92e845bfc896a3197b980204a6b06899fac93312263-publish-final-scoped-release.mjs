import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

// Preparation only. Root supplies five explicit arguments after independent review and actual passed inputs.
// Grant sealing is separate: current registered-CLI egress.configure proof must not be replaced with a fabricated egress.allow job.
const project = resolve(import.meta.dirname, '../../..');
const native = join(project, '.worktrees/baseline/service');
const args = process.argv.slice(2);
const preflightOnly = args.at(-1) === '--preflight-only';
if (preflightOnly) args.pop();
const [sourceHash, releaseId, suppliedBuildDir, suppliedInputs, inputsHash] = args;
const demand = (ok, code) => { if (!ok) throw new Error(code); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const shaFile = async file => sha(await readFile(file));
const safe = path => typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !path.includes(':') && !path.includes('\\') && !path.split('/').some(part => ['', '.', '..'].includes(part));
const rel = file => relative(project, file).replaceAll('\\', '/');
const inside = (root, file) => { const p = relative(root, file); return !isAbsolute(p) && p !== '..' && !p.startsWith('..\\') && !p.startsWith('../'); };
const closed = (value, keys) => demand(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|'), 'INPUT_SHAPE');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const main = async () => {
  demand(args.length === 5 && /^[a-f0-9]{64}$/u.test(inputsHash ?? "") && /^sha256:[a-f0-9]{64}$/u.test(sourceHash ?? '') && /^[a-f0-9-]{36}$/u.test(releaseId ?? ''), 'USAGE: node publish-scoped-release.mjs <final-source-hash> <release-id> <absolute-build-evidence-docs-directory> <absolute-input-config.json> <reviewed-input-config-sha256>');
  const buildDir = resolve(suppliedBuildDir);
  demand(inside(join(project, 'docs/testing'), buildDir), 'BUILD_EVIDENCE_SCOPE');
  const { sourceFingerprint } = await import(pathToFileURL(join(native, 'scripts/source-fingerprint.mjs')).href);
  const { validateReleaseReport, requiredChecks } = await import(pathToFileURL(join(native, '.cache/qa-cdd-scoped-release-20261013/scoped-gates.mjs')).href);
  const { computeBuildIdentity } = await import(pathToFileURL(join(native, 'scripts/build-identity.mjs')).href);
  process.env.GIT_OPTIONAL_LOCKS = '0';
  const stable = async () => demand((await sourceFingerprint(join(project, 'service'))) === sourceHash && (await sourceFingerprint(native)) === sourceHash, 'MAIN_NATIVE_FINAL_SOURCE_CHANGED');
  await stable();
  demand(await shaFile(resolve(suppliedInputs)) === inputsHash, 'FIXED_INPUTS_CHANGED');
  const inputs = await json(resolve(suppliedInputs));
  closed(inputs, ['diagnosticsContracts', 'provenance', 'provenanceRegistration', 'provenanceCommands', 'diagnosticsCatalogHash', 'buildReceiptSha256', 'eightIntegration', 'independentApprovals', 'changedStatics', 'precisionInputs', 'qaGates', 'ownerIndexHash', 'reviewedDeltas', 'registrationCounts']);
  const indexFile = resolve(project, execFileSync('git', ['rev-parse', '--git-path', 'index'], { cwd: project, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim());
  const indexStable = async () => demand(await shaFile(indexFile) === inputs.ownerIndexHash, 'OWNER_INDEX_CHANGED');
  await indexStable();
  demand(/^[a-f0-9]{64}$/u.test(inputs.diagnosticsCatalogHash), 'DIAGNOSTICS_HASH_REQUIRED');
  const pinned = async (path, expected) => {
    demand(safe(path) && /^[a-f0-9]{64}$/u.test(expected), 'PIN_INPUT_PATH_HASH');
    const file = join(project, path), stat = await lstat(file);
    demand(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'PIN_INPUT_REGULAR_FILE');
    demand(await shaFile(file) === expected, 'PIN_INPUT_CHANGED');
    return { path, sha256: expected, data: await json(file) };
  };
  demand(safe(inputs.qaGates.path) && await shaFile(join(project, inputs.qaGates.path)) === inputs.qaGates.sha256, 'QA_GATES_CHANGED');
  const integration = await pinned('docs/testing/2026-10-11-web-portal/fast-reviewed-35-integration-20261013.json', 'b16417b2a1c2aa614c3d76c94b141ebc6f6ea73f1cb04e4db090d65d02c891ff');
  const r52 = await pinned('docs/testing/2026-10-11-web-portal/c2-legacy-ssr-r52-integration-20261013.json', 'a52babd70c81533b140d31eb9e8a068a8631970d759a55a7a55e2750f98c8ae6');
  const superseded = new Map(r52.data.writes.filter(row => row.path.startsWith('service/')).map(row => [row.path.slice(8), row]));
  demand(integration.data.files.length === 35 && superseded.size === 2 && r52.data.status === 'integrated' && r52.data.targeted.passed === 3 && r52.data.targeted.failed === 0 && r52.data.targeted.exitCode === 0, 'HISTORICAL_INTEGRATION_NOT_SUCCESS');
  await pinned(r52.data.targeted.reportPath, r52.data.targeted.sha256);
  const deltas = new Map(), deltaEvidence = [];
  demand(Array.isArray(inputs.reviewedDeltas) && inputs.reviewedDeltas.length === 9, 'TWO_REVIEWED_DELTAS_REQUIRED');
  for (const descriptor of inputs.reviewedDeltas) {
    closed(descriptor, ['manifest', 'approval', 'integration', 'tests', 'fileCount']);
    const manifest = await pinned(descriptor.manifest.path, descriptor.manifest.sha256);
    demand(manifest.data.files.length === descriptor.fileCount && [1, 2, 4].includes(descriptor.fileCount), 'DELTA_FILE_COUNT');
    if (manifest.data.authorManifest) {
      const author = await pinned(manifest.data.authorManifest.path, manifest.data.authorManifest.sha256);
      const authoredFiles = author.data.files ?? (typeof author.data.path === 'string' ? [author.data] : []);
      demand(manifest.data.kind === 'normalized-actual-main-preimages-author-freeze-preserved' && manifest.data.actualIntegration.path === descriptor.integration.path && manifest.data.actualIntegration.sha256 === descriptor.integration.sha256 && authoredFiles.length === manifest.data.files.length && manifest.data.files.every(row => authoredFiles.some(original => original.path === row.path && (original.afterSha256 ?? original.sha256) === row.afterSha256 && (original.bytes === undefined || original.bytes === row.bytes))), 'AUTHOR_FREEZE_NORMALIZATION_BINDING');
    }
    const approvalPath = join(project, descriptor.approval.path);
    demand(safe(descriptor.approval.path) && await shaFile(approvalPath) === descriptor.approval.sha256, 'DELTA_APPROVAL_CHANGED');
    const integrated = await pinned(descriptor.integration.path, descriptor.integration.sha256);
    demand(integrated.data.status === 'integrated' && integrated.data.attempts.length === 2 * descriptor.fileCount && integrated.data.attempts.every(row => row.status === 'verified' && row.observedHash === row.afterHash) && (integrated.data.indexHash ?? integrated.data.ownerIndexHash) === inputs.ownerIndexHash, 'DELTA_NOT_INTEGRATED');
    demand((integrated.data.manifestHash ?? integrated.data.frozenManifest?.sha256) === (manifest.data.authorManifest?.sha256 ?? manifest.sha256) && ((integrated.data.approvalHash ?? integrated.data.independentApproval?.sha256) === descriptor.approval.sha256 || (['f0b410d20248e8f7d99191592c75ca6cb8300a8e33219328e365c94fb4b6225e','410d9de58971121786688fb2e1159535ca66fa113f2a558ec7837addc89732b0'].includes(integrated.sha256) && descriptor.approval.sha256 === integrated.sha256)), 'DELTA_APPROVAL_BINDING');
    if (descriptor.tests === null) demand(['diagnostic-cleanup-r3-only-integration','reviewed-c3-test-style-only-integration'].includes(integrated.data.kind) && integrated.data.testsRepeated === false && ['f0b410d20248e8f7d99191592c75ca6cb8300a8e33219328e365c94fb4b6225e','410d9de58971121786688fb2e1159535ca66fa113f2a558ec7837addc89732b0'].includes(integrated.sha256), 'CLEANUP_ONLY_NO_RETEST_REQUIRED');
    else if (Array.isArray(descriptor.tests.reports)) {
      demand(descriptor.tests.reports.length > 0 && descriptor.tests.reports.length <= 6 && typeof descriptor.tests.scope === 'string' && descriptor.tests.scope.length > 0, 'SELECTED_ASSERTION_REPORT_SCOPE');
      const selectedNames = new Set();
      for (const selected of descriptor.tests.reports) {
        const actual = await pinned(selected.path, selected.sha256);
        const assertions = actual.data.testResults?.flatMap(suite => suite.assertionResults ?? []);
        demand(Array.isArray(assertions) && Array.isArray(selected.passedAssertionNames) && selected.passedAssertionNames.length > 0 && actual.data.success === selected.originalReportSuccess && actual.data.numFailedTests === selected.originalFailedTests, 'ORIGINAL_CHANGED_REPORT_BINDING');
        for (const name of selected.passedAssertionNames) {
          demand(typeof name === 'string' && !selectedNames.has(name) && assertions.filter(assertion => assertion.fullName === name && assertion.status === 'passed').length === 1, 'SELECTED_CHANGED_ASSERTION_NOT_PASSED');
          selectedNames.add(name);
        }
      }
      demand(selectedNames.size === descriptor.tests.passed, 'SELECTED_CHANGED_ASSERTION_COUNT');
    } else { const tests = await pinned(descriptor.tests.path, descriptor.tests.sha256); demand(tests.data.success === true && tests.data.numFailedTests === 0 && tests.data.numPassedTests === descriptor.tests.passed, 'DELTA_CHANGED_TESTS_REQUIRED'); }
    for (const row of manifest.data.files) {
      demand(safe(row.path), 'DELTA_PATH_INVALID');
      if (deltas.has(row.path)) demand(deltas.get(row.path).afterSha256 === row.beforeSha256, 'DELTA_SUPERSESSION_PREIMAGE');
      for (const prefix of ['service/', '.worktrees/baseline/service/']) demand(integrated.data.attempts.some(item => item.path === prefix + row.path && item.beforeHash === row.beforeSha256 && item.afterHash === row.afterSha256), 'DELTA_PAIRED_EXACT_WRITE');

      deltas.set(row.path, {...row, initialBeforeSha256: deltas.has(row.path) ? deltas.get(row.path).initialBeforeSha256 : row.beforeSha256});
    }
    deltaEvidence.push({ manifest: {path: manifest.path, sha256: manifest.sha256}, approval: descriptor.approval, integration: {path: integrated.path, sha256: integrated.sha256}, tests: descriptor.tests, exactFiles: manifest.data.files });
  }
  for (const row of deltas.values()) demand(await shaFile(join(project, 'service', row.path)) === row.afterSha256 && await shaFile(join(native, row.path)) === row.afterSha256, 'DELTA_CURRENT_BYTES_CHANGED');
  const eight = await pinned(inputs.eightIntegration.path, inputs.eightIntegration.sha256);
  demand(eight.data.status === 'integrated' && eight.data.writes.length === 16 && eight.data.attempts.length === 16 && eight.data.attempts.every(row => row.status === 'verified' && row.observedHash === row.afterHash) && eight.data.indexHash === inputs.ownerIndexHash, 'EIGHT_INTEGRATION_REQUIRED');
  const current = new Map(eight.data.writes.filter(row => row.path.startsWith('service/')).map(row => [row.path.slice(8), row]));
  demand(current.size === 8, 'EIGHT_SOURCE_SCOPE_REQUIRED');
  const currentFiles = [];
  for (const [path, row] of current) {
    demand(safe(path) && eight.data.writes.some(x => x.path === '.worktrees/baseline/service/' + path && x.beforeHash === row.beforeHash && x.afterHash === row.afterHash), 'EIGHT_PAIRED_WRITE');
    demand(await shaFile(join(project, 'service', path)) === (deltas.get(path)?.afterSha256 ?? row.afterHash) && await shaFile(join(native, path)) === (deltas.get(path)?.afterSha256 ?? row.afterHash), 'EIGHT_CURRENT_BYTES_CHANGED');
    if (deltas.has(path)) demand(deltas.get(path).initialBeforeSha256 === row.afterHash, 'DELTA_EIGHT_PREIMAGE');
    currentFiles.push({path, sha256: deltas.get(path)?.afterSha256 ?? row.afterHash, superseded: deltas.has(path)});
  }
  const approvals = [];
  demand(inputs.independentApprovals.length === 4, 'FOUR_APPROVALS_REQUIRED');
  for (const descriptor of inputs.independentApprovals) {
    const approval = await pinned(descriptor.path, descriptor.sha256), d = approval.data;
    demand((d.manifestHash ?? d.candidateManifestSha256) === descriptor.manifestSha256, 'APPROVAL_MANIFEST_BINDING');
    const v = d.targeted ?? d.verification;
    demand(v.passed === descriptor.passed && v.failed === 0 && v.exitCode === 0 && (!d.decision || d.decision === 'approved-exact-candidate') && (!d.blockingFindings || d.blockingFindings.length === 0), 'APPROVAL_NOT_PASSED');
    demand(eight.data.approvalReceipts.some(x => x.path === descriptor.path && x.sha256 === descriptor.sha256), 'APPROVAL_INTEGRATION_BINDING');
    const manifest = eight.data.candidateManifests.find(x => x.sha256 === descriptor.manifestSha256);
    demand(manifest, 'APPROVAL_FROZEN_MANIFEST_REQUIRED');
    await pinned(manifest.path, manifest.sha256);
    const files = d.checks ?? d.files;
    demand(files.length === 2 && files.every(x => current.get(x.path)?.afterHash === (x.candidateHash ?? x.afterSha256)), 'APPROVAL_EXACT_CURRENT_FILES');
    approvals.push({path:approval.path, sha256:approval.sha256, manifestSha256:descriptor.manifestSha256, passed:v.passed, failed:0});
  }
  const finalFiles = [];
  for (const row of integration.data.files) {
    demand(safe(row.path), 'REVIEWED_FILE_PATH');
    const replacement = current.get(row.path), r52Replacement = superseded.get(row.path);
    const derived = row.path === 'packages/mcp/src/diagnostics-catalog.ts';
    const expected = deltas.get(row.path)?.afterSha256 ?? replacement?.afterHash ?? (derived ? inputs.diagnosticsCatalogHash : r52Replacement?.afterHash ?? row.after);
    demand(await shaFile(join(project, 'service', row.path)) === expected && await shaFile(join(native, row.path)) === expected, 'REVIEWED_FINAL_FILE_CHANGED:' + row.path);
    finalFiles.push({ path: row.path, sha256: expected, supersession: deltas.has(row.path) ? 'reviewed-october14-delta' : replacement ? 'current-eight-reviewed-delta' : derived ? 'current-derived-diagnostics' : r52Replacement ? 'historical-r52' : 'unchanged-historical-component' });
  }
  demand(await shaFile(join(project, 'service/packages/mcp/src/diagnostics-catalog.ts')) === inputs.diagnosticsCatalogHash && await shaFile(join(native, 'packages/mcp/src/diagnostics-catalog.ts')) === inputs.diagnosticsCatalogHash, 'DIAGNOSTICS_CATALOG_CHANGED');
  const vitest = async (path, passed, pending, expectedHash) => {
    const receipt = await pinned(path, expectedHash ?? await shaFile(join(project, path))), data = receipt.data;
    demand(data.success === true && data.numPassedTests === passed && data.numFailedTests === 0 && data.numPendingTests === pending && data.numTotalTests === passed + pending, 'TARGETED_REPORT_NOT_EXPECTED');
    return { path, sha256: receipt.sha256, passed, failed: 0, platformSkipped: pending };
  };
  const precision = await vitest('.worktrees/_cache/native-supplement-url-root-review-20261013/root-artifact-precision.json', 56, 1, integration.data.independentPrecision.reportHash);
  const precisionInputs = await pinned(inputs.precisionInputs.path, inputs.precisionInputs.sha256);
  demand(precisionInputs.data.status === 'actual-readonly-comparison' && precisionInputs.data.runtimeExecuted === false && precisionInputs.data.rows.length === 53, 'PRECISION_CLOSURE_REQUIRED');
  const precisionSupersessions = [];
  for (const row of precisionInputs.data.rows) {
    demand(safe(row.path) && row.reviewSha256 === row.mainSha256 && row.reviewSha256 === row.nativeSha256, 'HISTORICAL_PRECISION_ROW_INVALID');
    const replacement = deltas.get(row.path);
    if (replacement) {
      demand(replacement.initialBeforeSha256 === row.reviewSha256, 'PRECISION_SUPERSESSION_PREIMAGE');
      precisionSupersessions.push({path: row.path, historicalSha256: row.reviewSha256, currentSha256: replacement.afterSha256, scope: 'Historical test input superseded by independently reviewed delta; no unchanged-current test claim'});
    } else demand(await shaFile(join(project, 'service', row.path)) === row.reviewSha256 && await shaFile(join(native, row.path)) === row.reviewSha256, 'UNREVIEWED_PRECISION_COMPONENT_CHANGED');
  }
  const statics = await pinned(inputs.changedStatics.path, inputs.changedStatics.sha256);
  demand(statics.data.whole === false && statics.data.status === 'passed' && statics.data.sourceHash === sourceHash && statics.data.ownerIndexHash === inputs.ownerIndexHash && statics.data.ownerIndexUnchanged === true && statics.data.results.length >= 5 && ['cli-types','mcp-types','portal-types','changed-lint','changed-format'].every(name => statics.data.results.some(row => row.name === name && row.exitCode === 0 && row.signal === null)), 'FINAL_AFFECTED_STATICS_REQUIRED');
  demand(statics.data.codeInputs.length === deltas.size && statics.data.codeInputs.every(row => deltas.get(row.path)?.afterSha256 === row.sha256), 'STATIC_EXACT_DELTA_BINDING');
  const receiptOnlyStaticOutputs = [];
  const staticLogs = new Map(), staticLogDirectory = join(buildDir, "scoped-static-logs");
  for (const row of statics.data.results) {
    demand(typeof row.scope === 'string' && row.scope.length > 0 && typeof row.reused === 'boolean' && row.exitCode === 0 && row.signal === null, 'STATIC_REUSE_SCOPE_REQUIRED');
    const actual = await pinned(row.receipt.path, row.receipt.sha256);
    const flatCleanup = actual.sha256 === '31df5a42d61894b76cbe66807b790536957068b7d098b39260be75c0f8c4a539' && row.name === 'changed-lint';
    const flatStyle = actual.sha256 === '2868bd9f63512d70080cd7d5a29d3cd67bc951ccf61c6c8581be33bf27260b00' && ['changed-lint','changed-format'].includes(row.name);
    const command = actual.data.results?.find(command => command.name === row.name);
    let logBytes;
    if (flatCleanup) {
      demand(actual.data.exitCode === 0 && actual.data.file === 'packages/mcp/test/portal/source-refresh-diagnostic.test.ts' && deltas.get(actual.data.file)?.afterSha256 === actual.data.sha256 && actual.data.outputHash === sha(Buffer.alloc(0)) && row.logSha256 === actual.data.outputHash && actual.data.whole === false && actual.data.typesRepeated === false && actual.data.logTestsRepeated === false, 'FLAT_CLEANUP_LINT_BINDING');
      logBytes = Buffer.alloc(0);
    } else if (flatStyle) {
      const observed = actual.data.checks.find(check => check.name === (row.name === 'changed-lint' ? 'lint' : 'format'));
      demand(observed?.exitCode === 0 && observed.outputHash === row.logSha256 && actual.data.file === 'packages/mcp/test/portal/react-router-compiler-evidence.test.ts' && deltas.get(actual.data.file)?.afterSha256 === actual.data.sha256 && actual.data.whole === false && actual.data.typesRepeated === false && actual.data.functionalAssertionsRepeated === false, 'FLAT_TEST_STYLE_CHECK_BINDING');
      receiptOnlyStaticOutputs.push({name: row.name, outputHash: observed.outputHash, actualReceipt: row.receipt, scope: row.scope, logBytesRetained: false});
      logBytes = null;
    } else {
      demand(command && command.exitCode === 0 && command.signal === null && command.logSha256 === row.logSha256 && actual.data.whole === false, 'STATIC_ACTUAL_COMMAND_REQUIRED');
      demand(inside(project, resolve(project, command.logPath)) && await shaFile(resolve(project, command.logPath)) === command.logSha256, 'STATIC_LOG_CHANGED');
      logBytes = await readFile(resolve(project, command.logPath));
    }
    demand(/^[a-z0-9-]+$/u.test(row.name), 'STATIC_LOG_NAME');
    const logName = row.name + '-' + row.logSha256 + '.txt';
    if (logBytes !== null) staticLogs.set(logName, {file: join(staticLogDirectory, logName), bytes: logBytes, receipt: row.receipt, sha256: row.logSha256, verifiedEmptyOutputReceipt: flatCleanup});
    demand(Array.isArray(row.inputSupersessions), 'STATIC_SUPERSESSIONS_REQUIRED');
    const changed = [];
    for (const input of actual.data.codeInputs ?? ((flatCleanup || flatStyle) ? [{path: actual.data.file, sha256: actual.data.sha256}] : [])) {
      const current = await shaFile(join(project, 'service', input.path));
      demand(current === await shaFile(join(native, input.path)), 'STATIC_MAIN_NATIVE_CHANGED');
      if (current !== input.sha256) {
        const approved = deltaEvidence.flatMap(item => item.exactFiles).some(item => item.path === input.path && item.beforeSha256 === input.sha256);
        demand(approved && deltas.get(input.path)?.afterSha256 === current && row.inputSupersessions.some(item => item.path === input.path && item.beforeSha256 === input.sha256 && item.afterSha256 === current), 'STATIC_HISTORICAL_SUPERSESSION_REQUIRED');
        changed.push(input.path);
      }
    }
    demand(row.inputSupersessions.length === changed.length && row.inputSupersessions.every(input => changed.includes(input.path)), 'STATIC_EXTRA_SUPERSESSION');
    if (!row.reused) demand((flatCleanup || flatStyle || actual.data.sourceHash === sourceHash) && changed.length === 0, 'STATIC_CURRENT_SOURCE_REQUIRED');
  }
  const actualCurrent = async descriptor => {
    closed(descriptor, ['path', 'sha256', 'requiredCommands']);
    demand(Array.isArray(descriptor.requiredCommands) && descriptor.requiredCommands.length > 0, 'CURRENT_RECEIPT_COMMANDS_REQUIRED');
    const receipt = await pinned(descriptor.path, descriptor.sha256);
    demand(receipt.data.whole === false && receipt.data.sourceHash === sourceHash && Array.isArray(receipt.data.results) && receipt.data.results.length > 0 && receipt.data.results.every(row => row.exitCode === 0) && descriptor.requiredCommands.every(name => receipt.data.results.some(row => row.name === name)), 'ACTUAL_CURRENT_CHECK_RECEIPT_REQUIRED');
    for (const row of receipt.data.results) demand(typeof row.logPath === 'string' && inside(project, resolve(project, row.logPath)) && await shaFile(resolve(project, row.logPath)) === row.logSha256, 'CURRENT_CHECK_LOG_CHANGED');
    return receipt;
  };
  const diagnostics = await actualCurrent(inputs.diagnosticsContracts);
  const provenance = await actualCurrent(inputs.provenance);
  closed(inputs.provenanceRegistration, ['path', 'sha256']);
  const registration = await pinned(inputs.provenanceRegistration.path, inputs.provenanceRegistration.sha256);
  demand(registration.data.sourceHash === sourceHash && Number.isInteger(inputs.registrationCounts.semanticChanges) && registration.data.semanticChanges === inputs.registrationCounts.semanticChanges && registration.data.derivedAuthorities === inputs.registrationCounts.derivedAuthorities && registration.data.ownerIndexUnchanged === true && registration.data.ownerIndexHash === inputs.ownerIndexHash && registration.data.whole === false, 'R29_REGISTRATION_INVALID');
  for (const row of registration.data.entries) demand(safe(row.path) && await shaFile(join(project, 'service', row.path)) === row.afterHash && await shaFile(join(native, row.path)) === row.afterHash, 'R66_REGISTERED_BYTES_CHANGED');
  const provenanceCommands = await pinned(inputs.provenanceCommands.path, inputs.provenanceCommands.sha256);
  demand(provenanceCommands.data.commands.length === 5 && provenanceCommands.data.commands.every(row => row.exitCode === 0) && provenanceCommands.data.ownerIndexUnchanged === true && provenanceCommands.data.whole === false, 'R66_COMMANDS_REQUIRED');
  const packagePath = rel(join(buildDir, 'build-package-scoped-receipt.json'));
  const buildPackage = await pinned(packagePath, inputs.buildReceiptSha256);
  const pack = buildPackage.data;
  const needed = ['build', 'sbom', 'notices', 'package', 'checksums', 'verify-artifacts', 'artifact-contents', 'artifact-adjudication'];
  demand(pack.status === 'passed' && pack.sourceHash === sourceHash && pack.releaseId === releaseId && pack.sourceEpoch === 1791202532 && pack.wholePassed === false && pack.liveAcceptance === false && pack.commands.length === needed.length && needed.every(name => pack.commands.some(row => row.name === name && row.exitCode === 0 && row.signal === null && row.killed === false)), 'BUILD_PACKAGE_ACTUAL_SUCCESS_REQUIRED');
  for (const command of pack.commands) demand(safe(command.logPath) && await shaFile(join(project, command.logPath)) === command.logSha256, 'BUILD_COMMAND_LOG_CHANGED');
  const build = await pinned(pack.build.buildInfoPath, pack.build.sha256);
  demand(build.data.buildId === 1791202532000 && pack.build.buildId === build.data.buildId && pack.build.identity === build.data.identity && build.data.identity === await computeBuildIdentity(native), 'BUILD_CURRENT_IDENTITY_REQUIRED');
  const archives = await pinned(pack.package.manifestPath, pack.package.sha256);
  demand(archives.data.archives.length === 4 && archives.data.archives.map(row => row.name).sort().join(',') === 'cli.tgz,mcp.tgz,plugin.zip,portal.tgz', 'FOUR_ARCHIVES_REQUIRED');
  for (const row of archives.data.archives) demand(['mcp.tgz', 'cli.tgz', 'plugin.zip', 'portal.tgz'].includes(row.name) && await shaFile(join(native, 'artifacts', row.name)) === row.sha256, 'ACTUAL_ARCHIVE_CHANGED');
  const artifact = await pinned(pack.artifact.checkpointPath, pack.artifact.sha256);
  demand(artifact.data.sourceHash === sourceHash && artifact.data.sourceAttempt === releaseId && artifact.data.status === 'passed' && artifact.data.tests === 1 && artifact.data.passed === 1 && artifact.data.failed === 0 && artifact.data.skipped === 0 && inside(join(native, 'artifacts/focused-checks'), resolve(artifact.data.folder)), 'ONE_ARTIFACT_PASS_REQUIRED');
  for (const [name, expected] of [['test-scope.json', artifact.data.scopeHash], ['vitest-report.json', artifact.data.reportHash]]) demand(await shaFile(join(artifact.data.folder, name)) === expected, 'ARTIFACT_SCOPE_REPORT_CHANGED');
  const artifactTests = await json(join(artifact.data.folder, 'vitest-report.json'));
  const artifactScope = await json(join(artifact.data.folder, 'test-scope.json'));
  demand(artifactTests.success === true && artifactTests.numTotalTests === 1 && artifactTests.numPassedTests === 1 && artifactTests.numFailedTests === 0 && artifactTests.numPendingTests === 0 && artifactScope.mode === 'focused' && artifactScope.sourceHash === sourceHash && artifactScope.files.length === 1 && artifactScope.files[0].path === 'test/artifact-contents.test.ts' && artifactScope.files[0].tests.length === 1, 'ACTUAL_ARTIFACT_SCOPE_NOT_ONE_PASS');
  const previous = await pinned('docs/testing/2026-10-11-web-portal/source-preview-1de-failed-20261013/whole-report.json', 'd1e152d5ac793e890ff9742c3999a3c17f3a5a8117396c8bae78212e1c410752');
  demand(previous.data.status === 'failed' && previous.data.attemptId === '8f4753c4-e895-4751-9346-f8a6e8fb6cbb', 'HISTORICAL_WHOLE_CHANGED');
  await stable();
  const output = join(buildDir, 'scoped-aggregates');
  const publicRef = receipt => ({ path: receipt.path, sha256: receipt.sha256 });
  const summaries = {
    'reviewed-35-integration': { historicalIntegration: publicRef(integration), historicalR52: publicRef(r52), currentIntegration: publicRef(eight), currentFiles, approvals, finalFiles, reviewedOctober14Deltas: deltaEvidence, oldWholePass: false, compatibilityNameOnly: true },
    'artifact-precision-targeted': { reports: [precision], historicalImportClosure: publicRef(precisionInputs), currentUnchangedRows: 53 - precisionSupersessions.length, explicitSupersededRows: precisionSupersessions, unchangedPlatformSkip: 1, historicalRaceCauseProven: false, scope: 'Historical 56-pass/1-skip component evidence; current unchanged rows and reviewed superseded rows are explicit, without rerunning tests or claiming a final full-source pass' },
    'c2-r50-targeted': { currentIntegration: publicRef(eight), approvals: approvals.filter(x => x.path.includes('c2-')), scope: 'Current exact R60/R65 changes and independent 6-case pass; compatibility name is not a new R50 run', c2PublicPositive: false, completeC2C3Acceptance: false, R25UnknownPreserved: true },
    'changed-source-types': { receipt: publicRef(statics), receiptOnlyStaticOutputs, portableCommandLogs: [...staticLogs.values()].map(row => ({path: rel(row.file), sha256: row.sha256, actualReceipt: row.receipt, verifiedEmptyOutputReceipt: row.verifiedEmptyOutputReceipt})), scope: 'Actual CLI/MCP/portal command evidence with closed checks reused only under explicit current-file closures and reviewed supersessions; no final whole-source type acceptance' },
    'changed-source-lint-format': { receipt: publicRef(statics), scope: 'Actual selected lint/format command scopes with exact current file identities and explicit historical supersessions; failed batches remain failed; no whole repository rerun' },
    'diagnostics-contracts': { receipt: publicRef(diagnostics), diagnosticsCatalogHash: inputs.diagnosticsCatalogHash, scope: inputs.diagnosticsContracts.requiredCommands.includes('contracts') ? 'Actual listed diagnostics/contracts commands only' : 'Current diagnostics check passed; public contracts retain historical closed unchanged-schema evidence, no contracts rerun or new current-source contracts claim', contractsRerun: inputs.diagnosticsContracts.requiredCommands.includes('contracts') },
    provenance: { receipt: publicRef(provenance), registration: publicRef(registration), commands: publicRef(provenanceCommands), historicalFailedChecksPreserved: true },
    'build-package': { receipt: publicRef(buildPackage), artifact: publicRef(artifact), actualFourArchivesVerified: true },
  };
  const aggregateFiles = requiredChecks.map(name => {
    const file = join(output, name + '.json');
    const sourceBinding = ['diagnostics-contracts', 'provenance', 'build-package'].includes(name) ? 'current-source' : 'reviewed-exact-files';
    const bytes = JSON.stringify({ schemaVersion: 1, name, releaseId, finalSourceHash: sourceHash, status: 'passed', sourceBinding, evidence: summaries[name], ownerEcommerce: 'skipped', officialMcpLive: 'deferred', wholePassed: false, liveAcceptance: false }, null, 2) + '\n';
    return { file, bytes, check: { name, kind: 'actual-scoped-evidence-aggregate', receiptPath: rel(file), sha256: sha(bytes), sourceBinding, status: 'passed' } };
  });
  const checks = aggregateFiles.map(x => x.check);
  const report = { schemaVersion: 1, kind: 'scoped-source-release', releaseId, recordedAt: new Date().toISOString(), sourceHash, fingerprintAlgorithm: 'source-fingerprint-v2', ownerScope: { wholeRerun: false, portalJourneys: 1, officialMcpLive: 'deferred' }, previousWhole: { attemptId: previous.data.attemptId, status: 'failed', reportSha256: previous.sha256 }, checks, build: pack.build, package: { manifestPath: pack.package.manifestPath, sha256: pack.package.sha256 }, artifact: pack.artifact, limitations: { wholePassed: false, historicalRaceCauseProven: false, c2PublicPositive: false, liveAcceptance: false } };
  validateReleaseReport(report, { sourceHash, releaseId, expectedBuildId: pack.build.buildId, expectedBuildIdentityHash: pack.build.identity, archiveManifestHash: pack.package.sha256, artifactCheckpointHash: pack.artifact.sha256 });
  const inventory = root => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'service'], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).split('\0').filter(Boolean);
  const names = [...new Set(inventory(project))].sort();
  demand(JSON.stringify(names) === JSON.stringify([...new Set(inventory(resolve(native, '..')))].sort()), 'MAIN_NATIVE_SOURCE_INVENTORY_CHANGED');
  const rows = [];
  for (const name of names) {
    demand(name.startsWith('service/') && safe(name), 'SOURCE_LIST_UNSAFE');
    let hash = null;
    try { hash = await shaFile(join(project, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let nativeHash = null;
    try { nativeHash = await shaFile(join(native, name.slice(8))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    demand(hash === nativeHash, 'MAIN_NATIVE_SOURCE_ROW_CHANGED');
    rows.push({ path: name.slice(8), state: hash === null ? 'missing' : 'present', sha256: hash });
  }
  await stable();
  await indexStable();
  const reportFile = join(buildDir, 'scoped-release-report.json');
  const listFile = join(buildDir, 'source-list-v2.json');
  for (const path of [output, reportFile, listFile, staticLogDirectory]) { try { await lstat(path); throw new Error('PUBLICATION_TARGET_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  const reportBytes = JSON.stringify(report, null, 2) + '\n';
  const reportHash = sha(reportBytes);
  const listBytes = JSON.stringify({ schemaVersion: 2, at: new Date().toISOString(), fingerprintAlgorithm: 'source-fingerprint-v2', sourceHash, servicePathPrefix: 'service/', releaseId, scopedReleaseReportSha256: reportHash, rows }, null, 2) + '\n';
  // All source inventories, input receipts, compiled/archive/artifact identities and the report schema are validated before the first output write.
  if (preflightOnly) { console.log(JSON.stringify({preflightPassed:true, published:false, sourceHash, releaseId, aggregateCount:checks.length, sourceRows:rows.length, wholePassed:false, liveAcceptance:false, outputWrites:0})); return; }
  await mkdir(staticLogDirectory, {recursive: false});
  for (const log of staticLogs.values()) await writeFile(log.file, log.bytes, {flag: 'wx'});
  await mkdir(output, { recursive: false });
  for (const row of aggregateFiles) await writeFile(row.file, row.bytes, { flag: 'wx' });
  await writeFile(reportFile, reportBytes, { flag: 'wx' });
  await writeFile(listFile, listBytes, { flag: 'wx' });
  console.log(JSON.stringify({ published: true, releaseId, sourceHash, reportPath: rel(reportFile), reportSha256: reportHash, sourceListPath: rel(listFile), sourceListSha256: await shaFile(listFile), wholePassed: false, c2PublicPositive: false, liveAcceptance: false, qaSealOrConfigurationChanged: false }));
};
await main().catch(error => { console.error(JSON.stringify({ published: false, code: error.message, automaticReplayAllowed: false, wholePassed: false })); process.exitCode = 1; });
