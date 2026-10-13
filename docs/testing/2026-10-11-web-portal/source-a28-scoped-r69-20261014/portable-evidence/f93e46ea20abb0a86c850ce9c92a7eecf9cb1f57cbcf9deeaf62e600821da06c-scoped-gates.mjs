import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const sha = /^[a-f0-9]{64}$/u;
const source = /^sha256:[a-f0-9]{64}$/u;
function demand(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }); }
function shape(value, keys, code) { demand(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0'), code); }
export const requiredChecks = Object.freeze(['reviewed-35-integration', 'artifact-precision-targeted', 'c2-r50-targeted', 'changed-source-types', 'changed-source-lint-format', 'diagnostics-contracts', 'provenance', 'build-package']);
export function validateReleaseReport(report, config) {
  shape(report, ['schemaVersion', 'kind', 'releaseId', 'recordedAt', 'sourceHash', 'fingerprintAlgorithm', 'ownerScope', 'previousWhole', 'checks', 'build', 'package', 'artifact', 'limitations'], 'SCOPED_REPORT_SHAPE');
  demand(report.schemaVersion === 1 && report.kind === 'scoped-source-release' && report.releaseId === config.releaseId && report.sourceHash === config.sourceHash && source.test(report.sourceHash) && report.fingerprintAlgorithm === 'source-fingerprint-v2' && Number.isFinite(Date.parse(report.recordedAt)), 'SCOPED_REPORT_BINDING');
  shape(report.ownerScope, ['wholeRerun', 'portalJourneys', 'officialMcpLive'], 'SCOPED_OWNER_SHAPE');
  demand(report.ownerScope.wholeRerun === false && report.ownerScope.portalJourneys === 1 && report.ownerScope.officialMcpLive === 'deferred', 'SCOPED_OWNER_OVERRIDE');
  shape(report.previousWhole, ['attemptId', 'status', 'reportSha256'], 'SCOPED_PREVIOUS_SHAPE');
  demand(report.previousWhole.status === 'failed' && sha.test(report.previousWhole.reportSha256), 'SCOPED_PREVIOUS_WHOLE');
  shape(report.limitations, ['wholePassed', 'historicalRaceCauseProven', 'c2PublicPositive', 'liveAcceptance'], 'SCOPED_LIMITS_SHAPE');
  demand(report.limitations.wholePassed === false && report.limitations.historicalRaceCauseProven === false && report.limitations.liveAcceptance === false && typeof report.limitations.c2PublicPositive === 'boolean', 'SCOPED_VERIFICATION_LIMITS');
  shape(report.build, ['buildInfoPath', 'sha256', 'buildId', 'identity'], 'SCOPED_BUILD_SHAPE');
  shape(report.package, ['manifestPath', 'sha256'], 'SCOPED_PACKAGE_SHAPE');
  shape(report.artifact, ['checkpointPath', 'sha256'], 'SCOPED_ARTIFACT_SHAPE');
  demand(report.build.buildId === config.expectedBuildId && report.build.identity === config.expectedBuildIdentityHash && report.package.sha256 === config.archiveManifestHash && report.artifact.sha256 === config.artifactCheckpointHash, 'SCOPED_COMPILED_BINDING');
  demand(Array.isArray(report.checks) && report.checks.length === requiredChecks.length && report.checks.map(row => row.name).sort().join(',') === [...requiredChecks].sort().join(','), 'SCOPED_CHECK_SET');
  for (const row of report.checks) {
    const keys = ['name', 'kind', 'receiptPath', 'sha256', 'sourceBinding', 'status'];
    if (Object.hasOwn(row, 'scope')) keys.push('scope');
    shape(row, keys, 'SCOPED_CHECK_SHAPE');
    demand(typeof row.receiptPath === 'string' && typeof row.kind === 'string' && sha.test(row.sha256) && row.status === 'passed' && ['current-source', 'reviewed-exact-files'].includes(row.sourceBinding), 'SCOPED_CHECK_NOT_SUCCESS');
  }
  return report;
}
export function validateGrantBinding(binding, actual, egressHash, now) {
  shape(binding, ['schemaVersion', 'kind', 'namespaceHash', 'originalGrantHash', 'originalConfiguredAt', 'originalExpiresAt', 'configuredAt', 'expiresAt', 'allowedClasses', 'egressHash', 'renewed', 'grantJobId', 'grantJobRowHash'], 'GRANT_BINDING_SHAPE');
  demand(binding.schemaVersion === 1 && binding.kind === 'observed-same-state-model-grant' && sha.test(binding.namespaceHash), 'GRANT_BINDING_INVALID');
  demand(binding.originalGrantHash === '01773157b0c30fe511f81811b6b62cea24647770ba5f61f14769d943ca2f39f1' && sha.test(binding.egressHash) && egressHash === binding.egressHash, 'GRANT_BYTES_CHANGED');
  demand(binding.originalConfiguredAt === '2026-10-12T23:00:48.660Z' && binding.originalExpiresAt === '2026-10-13T07:00:48.660Z', 'ORIGINAL_GRANT_HISTORY_CHANGED');
  const configured = Date.parse(binding.configuredAt), expires = Date.parse(binding.expiresAt);
  demand(Number.isFinite(configured) && Number.isFinite(expires) && configured <= now && expires > now && expires - configured === 28800000, 'GRANT_NOT_CURRENT');
  demand(Array.isArray(binding.allowedClasses) && binding.allowedClasses.length === 4 && [...binding.allowedClasses].sort().join(',') === 'design-image,design-text,project-code,public', 'GRANT_CLASSES_CHANGED');
  demand(actual.mode === 'external-model' && actual.configuredAt === binding.configuredAt && actual.expiresAt === binding.expiresAt && JSON.stringify([...actual.allowedClasses].sort()) === JSON.stringify([...binding.allowedClasses].sort()), 'ACTUAL_GRANT_BINDING_CHANGED');
  demand(typeof binding.renewed === 'boolean', 'GRANT_RENEWAL_INVALID');
  if (binding.renewed) demand(configured >= Date.parse(binding.originalExpiresAt) && typeof binding.grantJobId === 'string' && /^[a-f0-9-]{36}$/u.test(binding.grantJobId) && sha.test(binding.grantJobRowHash), 'GRANT_PUBLIC_REQUEST_REQUIRED');
  else demand(binding.configuredAt === binding.originalConfiguredAt && binding.expiresAt === binding.originalExpiresAt && binding.grantJobId === null && binding.grantJobRowHash === null, 'GRANT_RENEWAL_HISTORY_INVALID');
  return binding;
}
export function validateGrantJob(binding, jobs) {
  if (!binding.renewed) return;
  const rows = jobs.jobs.filter(row => row.id === binding.grantJobId);
  demand(rows.length === 1 && rows[0].status === 'succeeded' && digest(JSON.stringify(rows[0])) === binding.grantJobRowHash, 'GRANT_JOB_NOT_SUCCESS');
  demand(rows[0].type === 'feature' && rows[0].name === 'egress.allow', 'GRANT_JOB_FEATURE_CHANGED');
}
