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

const requiredCliGrant = Object.freeze({"receiptHash":"3b44c340c9265edd4bd21b0615321e861126ec8561ac7d9c37b13db782a578eb","auditQueryHash":"2cf2f82b1121743371e16ea495489b90bd0c5c4aab5009b9d09219bc8464a785","transactionHash":"6435b3d29ccffb1b2d56a9891727f285ad0605ff12916a671f92f22e650eb3be","committedRecordHash":"sha256:8f38abc718faff31dac9179f667c30fb31703a26dbb49d178fef16392719d1b2","requestHash":"sha256:2122e992de92fd4613060400fa5bafecdc1f5d53d6524262138392ab916698ba","configHash":"sha256:11ab730aa4877b21352614333c1df78aed445c5138980d4b18c8c687357c1085","configuredAt":"2026-10-13T15:32:02.947Z","expiresAt":"2026-10-13T23:32:02.947Z","egressHash":"3ece19bbad3fd94f5295cf9b6f610438c943539e1b9b57a723988fd95ffbb7a6","allowedClasses":["public","project-code","design-text","design-image"],"originalGrantHash":"513fb8a54728c5402ee87852c0e0e35ed9552b2b49192821180a4efc148dafcd","originalConfiguredAt":"2026-10-13T07:21:06.181Z","originalExpiresAt":"2026-10-13T15:21:06.181Z"});
const requiredPreviousConfigHash = "sha256:330e4a33233b78814b83a69a63490af954873f215e911760ef01e21405e14e2f";
const prefixed = /^sha256:[a-f0-9]{64}$/u;
const sameClasses = values => Array.isArray(values)&&values.length===4&&[...values].sort().join(',')==='design-image,design-text,project-code,public';
export function validateGrantBinding(binding, actual, egressHash, now) {
 shape(binding,['schemaVersion','kind','namespaceHash','receiptHash','auditQueryHash','transactionHash','committedRecordHash','requestHash','configHash','configuredAt','expiresAt','egressHash','allowedClasses','originalGrantHash','originalConfiguredAt','originalExpiresAt','renewed'],'GRANT_BINDING_SHAPE');
 demand(binding.schemaVersion===2&&binding.kind==='observed-same-state-cli-model-grant'&&sha.test(binding.namespaceHash)&&binding.renewed===true,'CLI_GRANT_BINDING_INVALID');
 for(const key of ['receiptHash','auditQueryHash','transactionHash','committedRecordHash','requestHash','configHash','configuredAt','expiresAt','egressHash','originalGrantHash','originalConfiguredAt','originalExpiresAt'])demand(binding[key]===requiredCliGrant[key],'CLI_GRANT_PROOF_CHANGED');
 demand(egressHash===binding.egressHash,'GRANT_BYTES_CHANGED');const configured=Date.parse(binding.configuredAt),expires=Date.parse(binding.expiresAt);
 demand(Number.isFinite(configured)&&Number.isFinite(expires)&&configured<=now&&expires>now&&expires-configured===28800000&&configured>=Date.parse(binding.originalExpiresAt),'GRANT_NOT_CURRENT');
 demand(sameClasses(binding.allowedClasses)&&sameClasses(actual.allowedClasses),'GRANT_CLASSES_CHANGED');
 demand(actual.mode==='external-model'&&actual.configuredAt===binding.configuredAt&&actual.expiresAt===binding.expiresAt&&actual.configHash===binding.configHash,'ACTUAL_GRANT_BINDING_CHANGED');return binding;
}
export function validateCliGrantAudit(binding, audit) {
 shape(audit,['schemaVersion','chainVerified','checkpointContentHash','anchorContentHash','rows','nextCursor'],'CLI_AUDIT_QUERY_SHAPE');
 demand(audit.schemaVersion===1&&audit.chainVerified===true&&prefixed.test(audit.checkpointContentHash)&&prefixed.test(audit.anchorContentHash)&&audit.nextCursor===null&&Array.isArray(audit.rows)&&audit.rows.length<=1000,'CLI_AUDIT_CHAIN_UNVERIFIED');
 const rows=audit.rows.filter(row=>typeof row.auditTransactionId==='string'&&digest(row.auditTransactionId)===binding.transactionHash);
 demand(rows.length===3&&rows.map(row=>row.stage).join(',')==='pending,cas-intent,committed','CLI_AUDIT_TRANSACTION_INCOMPLETE');
 const first=rows[0];for(const row of rows){shape(row,['schemaVersion','auditId','auditTransactionId','kind','stage','action','actionNonceClaimHash','requestHash','expectedConfigHash','desiredConfigHash','configHash','allowedClasses','expiresAt','createdAt','recordHash'],'CLI_AUDIT_ROW_SHAPE');demand(row.schemaVersion===1&&row.kind==='egress'&&row.action==='egress.configure'&&row.auditTransactionId===first.auditTransactionId&&prefixed.test(row.recordHash)&&prefixed.test(row.actionNonceClaimHash)&&row.actionNonceClaimHash===first.actionNonceClaimHash&&row.requestHash===binding.requestHash&&row.expectedConfigHash===requiredPreviousConfigHash&&sameClasses(row.allowedClasses)&&row.expiresAt===binding.expiresAt&&Number.isFinite(Date.parse(row.createdAt))&&Date.parse(row.createdAt)>=Date.parse(binding.configuredAt),'CLI_AUDIT_BINDING_CHANGED');}
 demand(rows[0].desiredConfigHash===null&&rows[0].configHash===null&&rows[1].desiredConfigHash===binding.configHash&&rows[1].configHash===null&&rows[2].desiredConfigHash===binding.configHash&&rows[2].configHash===binding.configHash&&rows[2].recordHash===binding.committedRecordHash,'CLI_AUDIT_NOT_COMMITTED');
 demand(Date.parse(rows[0].createdAt)<=Date.parse(rows[1].createdAt)&&Date.parse(rows[1].createdAt)<=Date.parse(rows[2].createdAt),'CLI_AUDIT_ORDER_CHANGED');return rows[2];
}
