import {linkPolicy,failedIntentProof,inventoryWithLinks,copyInventoryWithLinks} from './inventory-links.mjs';
import { validateReleaseReport, validateGrantBinding, validateCliGrantAudit } from './scoped-gates.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { readFile, writeFile, mkdir, readdir, lstat, realpath, copyFile, open, rename } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const ROOT = 'C:/2026_project/super-figma-pipline';
export const NATIVE = join(ROOT,'.worktrees/baseline/service');
export const ANCHOR = join(ROOT,'.worktrees/_cache/portal-cdd-export-repair-20261012');
export const STATE = join(ANCHOR,'appdata/SuperFigmaPipeline');
const PORTAL = join(ANCHOR,'portal-state');
const TOOL = join(NATIVE,'.cache/qa-cdd-diagnostics-release-r4-20261014');
const PS = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const execute = promisify(execFile);
export const hash = b => createHash('sha256').update(b).digest('hex');
const canonical = p => resolve(p).replaceAll('\\','/').toLowerCase();
export const inside = (root,path) => { const p=relative(resolve(root),resolve(path)); return p===''||(!isAbsolute(p)&&p!=='..'&&!p.startsWith('../')&&!p.startsWith('..\\')); };
function requireThat(value,code) { if(!value) throw Object.assign(new Error(code),{code}); }
export function closed(value,keys,code='CLOSED_SHAPE') { requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0'),code); }
const json = async p => JSON.parse(await readFile(p,'utf8'));
export async function fileHash(path) { const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex'); }
export async function regular(path) {const s=await lstat(path); requireThat(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1,'SINGLE_LINK_FILE_REQUIRED');return s;}
export async function directory(path) {const s=await lstat(path);requireThat(s.isDirectory()&&!s.isSymbolicLink()&&canonical(await realpath(path))===canonical(path),'PHYSICAL_DIRECTORY_REQUIRED');}
async function powershell(script,env={}) {try {return await execute(PS,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:30000,maxBuffer:1048576,env:{...process.env,...env}});}catch(e){throw Object.assign(new Error('FIXED_POWERSHELL_REFUSED'),{code:'FIXED_POWERSHELL_REFUSED',causeHash:hash(String(e.message).slice(0,4096))});}}
const SHA=/^[a-f0-9]{64}$/u;
const safeRelative = p => typeof p==='string'&&p.length>0&&!p.includes('\\')&&!p.split('/').some(x=>['','..','.'].includes(x))&&!isAbsolute(p)&&!p.includes(':');
export function nativeArtifactPath(kind,path) {
 requireThat(['mcp','cli','portal'].includes(kind)&&safeRelative(path),'NATIVE_ARTIFACT_MAPPING_INVALID');
 if(path.startsWith('dist/plugin/')){
  const known={'dist/plugin/dist/code.js':'packages/plugin/dist/code.js','dist/plugin/dist/index.html':'packages/plugin/dist/index.html','dist/plugin/manifest.json':'packages/plugin/manifest.json'};
  requireThat(kind==='mcp'&&Object.hasOwn(known,path),'UNKNOWN_STAGED_PLUGIN_MAPPING');return known[path];
 }
 return `packages/${kind}/${path}`;
}
export function publishedPackageMetadata(kind,input,cliVersion) {
 requireThat(['mcp','cli','portal'].includes(kind),'PUBLISHED_PACKAGE_KIND_INVALID');const metadata=structuredClone(input);
 requireThat(metadata&&typeof metadata==='object'&&metadata.dependencies&&typeof metadata.dependencies==='object'&&/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(metadata.version),'PUBLISHED_PACKAGE_SOURCE_INVALID');
 delete metadata.private;delete metadata.devDependencies;delete metadata.scripts;delete metadata.dependencies['@sfp/shared'];delete metadata.dependencies['@sfp/ir'];
 if(kind==='cli')metadata.dependencies['@sfp/mcp']=metadata.version;
 if(kind==='portal'){requireThat(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(cliVersion),'PUBLISHED_CLI_VERSION_INVALID');metadata.dependencies['@sfp/cli']=cliVersion;}
 return JSON.stringify(metadata,null,2)+'\n';
}
const fixedReferences = [
 {pid:26712,startedAt:1791896412965,port:3059,entry:'daemon',commandHash:'5ccf93669310bd2b91c40eefc316af33789224efa60aa91a5655eaa8ee79ce1f'},
 {pid:8952,startedAt:1791896478622,port:4315,entry:'portal',commandHash:'f8c8cec83e151dff0a43c87e13be26793eae9228783c4f61d7706ad868d48737'},
];
const untouched = [
 {pid:7460,startedAt:1791764383322,port:3055,commandHash:fixedReferences[0].commandHash},
 {pid:27636,startedAt:1791764388627,port:4310,commandHash:fixedReferences[1].commandHash},
 {pid:9932,startedAt:1791721736935,commandHash:'84b95ad976434d78ba3fba44fe268252e86c3f9dc5ceba9c3171d8f87ee4a096'},
 {pid:2072,startedAt:1791527888383,commandHash:'be0c22e63cec290a2bb874c917c5d3927b8d121fa537e999cfe9caad05a2c4a5'},
];
const physicalScript = String.raw`
$ErrorActionPreference='Stop'
$snapshot=@(Get-CimInstance Win32_Process)
$listeners=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in @(3055,3059,4310,4315)})
$ids=New-Object 'System.Collections.Generic.HashSet[int]'
foreach($taskId in @(26712,8952,7460,27636,9932,2072)+@($env:SFP_NEW_QA_PIDS.Split(',')|Where-Object {$_}|ForEach-Object {[int]$_})){[void]$ids.Add($taskId)}
do{$changed=$false;foreach($row in $snapshot){if(($row.ParentProcessId -in @(26712,8952) -or $ids.Contains([int]$row.ParentProcessId)) -and -not $ids.Contains([int]$row.ProcessId)){[void]$ids.Add([int]$row.ProcessId);$changed=$true}}}while($changed)
$rows=@();foreach($row in $snapshot|Where-Object {$ids.Contains([int]$_.ProcessId)}){
 $h=[Security.Cryptography.SHA256]::Create()
 try{$commandHash=([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$row.CommandLine)))).Replace('-','').ToLowerInvariant();$scriptHash=$null;$encoded=[regex]::Match([string]$row.CommandLine,'(?i)-EncodedCommand\s+"?([A-Za-z0-9+/=]+)');if($encoded.Success){$scriptHash=([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded.Groups[1].Value)))))).Replace('-','').ToLowerInvariant()}}finally{$h.Dispose()}
 $rows+=@{pid=[int]$row.ProcessId;parent=[int]$row.ParentProcessId;startedAt=([DateTimeOffset]$row.CreationDate).ToUnixTimeMilliseconds();executable=$row.ExecutablePath;commandHash=$commandHash;decodedScriptHash=$scriptHash}
}
@{processes=$rows;listeners=@($listeners|ForEach-Object {@{pid=[int]$_.OwningProcess;port=[int]$_.LocalPort;address=$_.LocalAddress}})}|ConvertTo-Json -Depth 6 -Compress`;
async function physical(newOwners=[]) {const r=await powershell(physicalScript,{SFP_NEW_QA_PIDS:newOwners.map(x=>x.pid).join(',')});return JSON.parse(r.stdout.replace(/^\uFEFF/u,''));}
export function assertOwner(snapshot,bound,allowAbsentListener=false) {
 const p=snapshot.processes.find(x=>x.pid===bound.pid);requireThat(p&&p.startedAt===bound.startedAt&&p.commandHash===bound.commandHash&&canonical(p.executable)==='c:/program files/nodejs/node.exe','QA_PROCESS_BINDING_CHANGED');
 const ls=snapshot.listeners.filter(x=>x.port===bound.port);
 if(allowAbsentListener&&ls.length===0)return false;
 requireThat(ls.length===1&&ls[0].pid===bound.pid&&ls[0].address==='127.0.0.1','QA_LISTENER_BINDING_CHANGED');return true;
}
function assertUntouched(snapshot) {for(const b of untouched){const p=snapshot.processes.find(x=>x.pid===b.pid);requireThat(p&&p.startedAt===b.startedAt&&p.commandHash===b.commandHash,'UNTOUCHED_PROCESS_CHANGED');if(b.port)assertOwner(snapshot,b);}}
async function oldProof() {const snap=await physical();for(const b of fixedReferences)assertOwner(snap,b);assertUntouched(snap);return snap;}
export function descendants(snapshot,roots) {const ids=new Set(roots),rows=[];let changed=true;while(changed){changed=false;for(const row of snapshot.processes)if(ids.has(row.parent)&&!ids.has(row.pid)){ids.add(row.pid);rows.push(row);changed=true;}}return rows;}
export async function bindChildren(snapshot) {
 const source=await readFile(join(NATIVE,'packages/mcp/src/fs/windows-boundary-probe-worker.ts'),'utf8');
 const marker='const WINDOWS_BOUNDARY_WORKER_SCRIPT = String.raw`',start=source.indexOf(marker);requireThat(start>=0,'BOUNDARY_SCRIPT_SOURCE_MISSING');
 const raw=source.slice(start+marker.length,source.indexOf('`;',start+marker.length));
 const allowedScriptHash=hash(raw.replaceAll('\r\n','\n'));
 requireThat(allowedScriptHash==='8cdde0ad2fb7f820492c508b5e32b301593a2f19f114c7c682cdfeefe0aae602','BOUNDARY_SCRIPT_SOURCE_HASH_CHANGED');
 const rows=descendants(snapshot,fixedReferences.map(x=>x.pid));
 for(const row of rows){const exe=canonical(row.executable);const console=exe==='c:/windows/system32/conhost.exe'&&row.commandHash==='417222c4a0ecb4d60a457ebe8e26fddf3d5406bffb16a5c59af8eeb241beca51';const boundary=exe===canonical(PS)&&row.commandHash==='c6a6361951ec0ab8ab45f9ee8de0f79973ca2c1400a4d4cc54ef56a8dc0b4310'&&row.decodedScriptHash===allowedScriptHash;requireThat(console||boundary,'UNSUPPORTED_QA_DESCENDANT');}
 return rows;
}

export async function inventory(root,exclude=null) {
 await directory(root);const entries=[];
 async function walk(p){if(exclude&&canonical(p)===canonical(exclude))return;requireThat(inside(root,p),'INVENTORY_PATH_ESCAPE');const s=await lstat(p);requireThat(!s.isSymbolicLink(),'INVENTORY_LINK_REFUSED');const path=relative(root,p).replaceAll('\\','/');if(s.isDirectory()){await directory(p);entries.push({path,kind:'directory'});for(const n of(await readdir(p)).sort())await walk(join(p,n));}else{await regular(p);entries.push({path,kind:'file',bytes:s.size,sha256:await fileHash(p)});}}
 await walk(root);return entries.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function copyInventory(source,dest,rows) {
 await directory(source);await mkdir(dest);await directory(dest);
 for(const row of rows){if(row.path==='')continue;requireThat(safeRelative(row.path)&&inside(source,join(source,row.path))&&inside(dest,join(dest,row.path)),'COPY_PATH_ESCAPE');const from=join(source,row.path),to=join(dest,row.path);if(row.kind==='directory'){await mkdir(to);await directory(to);}else{await regular(from);requireThat(await fileHash(from)===row.sha256,'COPY_SOURCE_CHANGED');const destination=await open(to,'wx',0o600);try{for await(const bytes of createReadStream(from)){let offset=0;while(offset<bytes.length){const r=await destination.write(bytes,offset,bytes.length-offset);requireThat(r.bytesWritten>0,'COPY_WRITE_STALLED');offset+=r.bytesWritten;}}await destination.sync();}finally{await destination.close();}await regular(to);requireThat(await fileHash(to)===row.sha256,'COPY_DEST_CHANGED');}}
 const copied=await inventory(dest);requireThat(JSON.stringify(copied)===JSON.stringify(rows),'COPY_INVENTORY_MISMATCH');return copied;
}
export async function validateSourceList(rows,expected,mainRoot,nativeRoot) {
 requireThat(Array.isArray(rows)&&rows.length>0,'SOURCE_LIST_EMPTY');const h=createHash('sha256');h.update('source-fingerprint-v2\0');const seen=new Set();
 for(const row of [...rows].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)){closed(row,['path','sha256']);requireThat(safeRelative(row.path)&&row.path.startsWith('service/')&&!seen.has(row.path)&&(row.sha256===null||SHA.test(row.sha256)),'SOURCE_ROW_INVALID');seen.add(row.path);const local=row.path.slice(8);const bytes=[];for(const base of [mainRoot,nativeRoot]){const p=join(base,local);requireThat(inside(base,p),'SOURCE_PATH_ESCAPE');try{await regular(p);bytes.push(await readFile(p));}catch(e){if(e.code==='ENOENT'&&row.sha256===null)bytes.push(null);else throw e;}}requireThat(bytes.every(b=>b===null?row.sha256===null:hash(b)===row.sha256),'SOURCE_BYTES_CHANGED');h.update(row.path).update(row.sha256===null?'\0missing\0':'\0present\0');if(row.sha256!==null)h.update(Buffer.from(row.sha256,'hex')).update('\0');}
 requireThat('sha256:'+h.digest('hex')===expected,'SOURCE_FINGERPRINT_MISMATCH');
}
async function pinned(path,expected,allowedRoot) {requireThat(inside(allowedRoot,path)&&SHA.test(expected),'PINNED_PATH_INVALID');await regular(path);requireThat(await fileHash(path)===expected,'PINNED_FILE_CHANGED');return json(path);}
export function scopedEvidencePathAllowed(path){return safeRelative(path)&&(path==='.worktrees/baseline/service/packages/mcp/dist/build-info.json'||['docs/testing/','.worktrees/baseline/service/artifacts/','.worktrees/_cache/'].some(prefix=>path.startsWith(prefix)));}
export async function gates(config) {
 closed(config,['version','sourceHash','releaseId','releaseReportPath','releaseReportHash','artifactCheckpointPath','artifactCheckpointHash','archiveManifestHash','sourceListPath','sourceListHash','helperManifestHash','releaseBaselineHash','expectedBuildId','expectedBuildIdentityHash']);
 requireThat(config.version===2&&/^sha256:[a-f0-9]{64}$/u.test(config.sourceHash)&&/^[a-f0-9-]{36}$/u.test(config.releaseId)&&Number.isSafeInteger(config.expectedBuildId)&&config.expectedBuildId>0&&/^sha256:[a-f0-9]{64}$/u.test(config.expectedBuildIdentityHash),'GATE_BINDING_INVALID');
 const report=validateReleaseReport(await pinned(resolve(config.releaseReportPath),config.releaseReportHash,join(ROOT,'docs/testing')),config);
 const evidenceRoot=ROOT;
 const pinRelative=async(path,expected)=>{requireThat(scopedEvidencePathAllowed(path),'SCOPED_EVIDENCE_PATH');return pinned(join(evidenceRoot,path),expected,evidenceRoot);};
 for(const check of report.checks)await pinRelative(check.receiptPath,check.sha256);
 await pinRelative(report.build.buildInfoPath,report.build.sha256);
 requireThat(canonical(join(ROOT,report.package.manifestPath))===canonical(join(NATIVE,'artifacts/artifact-manifest.v1.json'))&&canonical(join(ROOT,report.artifact.checkpointPath))===canonical(config.artifactCheckpointPath),'SCOPED_ARTIFACT_PATH_BINDING');
 const list=await pinned(resolve(config.sourceListPath),config.sourceListHash,TOOL);closed(list,['schemaVersion','at','fingerprintAlgorithm','sourceHash','servicePathPrefix','releaseId','scopedReleaseReportSha256','rows']);requireThat(list.schemaVersion===2&&list.fingerprintAlgorithm==='source-fingerprint-v2'&&list.servicePathPrefix==='service/'&&list.sourceHash===config.sourceHash&&list.releaseId===config.releaseId&&list.scopedReleaseReportSha256===config.releaseReportHash&&Array.isArray(list.rows),'SOURCE_LIST_BINDING');const rows=list.rows.map(r=>{closed(r,['path','state','sha256']);requireThat(safeRelative(r.path)&&((r.state==='present'&&SHA.test(r.sha256))||(r.state==='missing'&&r.sha256===null)),'SOURCE_LIST_ROW_INVALID');return{path:list.servicePathPrefix+r.path,sha256:r.sha256};});await validateSourceList(rows,config.sourceHash,join(ROOT,'service'),NATIVE);
 const releaseBaseline=await pinned(join(TOOL,'release-baseline-private.json'),config.releaseBaselineHash,TOOL);closed(releaseBaseline,['schemaVersion','kind','sourceHash','releaseId','retainedBaselineHash','grant']);requireThat(releaseBaseline.schemaVersion===1&&releaseBaseline.kind==='actual-scoped-release-baseline'&&releaseBaseline.sourceHash===config.sourceHash&&releaseBaseline.releaseId===config.releaseId&&releaseBaseline.retainedBaselineHash===hash(baselineBytes),'RELEASE_BASELINE_BINDING');
 requireThat(releaseBaseline.grant.namespaceHash===hash(canonical(STATE)),'GRANT_NAMESPACE_CHANGED');
 await pinned(join(TOOL,'original-grant-private.json'),releaseBaseline.grant.originalGrantHash,TOOL);
 validateCliGrantAudit(releaseBaseline.grant,await pinned(join(TOOL,'cli-grant-audit-private.json'),retainedBaseline.cliGrantProof.auditQueryHash,TOOL));await pinned(join(TOOL,'cli-grant-receipt-private.json'),retainedBaseline.cliGrantProof.receiptHash,TOOL);
 const grantHash=await fileHash(join(STATE,'egress.v1.json'));validateGrantBinding(releaseBaseline.grant,{mode:'external-model',configuredAt:releaseBaseline.grant.configuredAt,expiresAt:releaseBaseline.grant.expiresAt,allowedClasses:releaseBaseline.grant.allowedClasses,configHash:releaseBaseline.grant.configHash},grantHash,Date.now());
 activeGrant=releaseBaseline.grant;
 const checkpoint=await pinned(resolve(config.artifactCheckpointPath),config.artifactCheckpointHash,join(ROOT,'docs/testing'));requireThat(checkpoint.status==='passed'&&checkpoint.sourceHash===config.sourceHash&&checkpoint.sourceAttempt===config.releaseId&&checkpoint.tests===1&&checkpoint.passed===1&&checkpoint.failed===0&&checkpoint.skipped===0,'ARTIFACT_CHECKPOINT_NOT_SUCCESS');
 const folder=resolve(checkpoint.folder);requireThat(inside(join(NATIVE,'artifacts/focused-checks'),folder),'ARTIFACT_FOLDER_ESCAPE');const results=await pinned(join(folder,'vitest-report.json'),checkpoint.reportHash,folder);await pinned(join(folder,'test-scope.json'),checkpoint.scopeHash,folder);requireThat(results.numTotalTests===1&&results.numPassedTests===1&&results.numFailedTests===0&&results.numPendingTests===0,'ARTIFACT_TEST_NOT_SUCCESS');
 const manifest=await pinned(join(NATIVE,'artifacts/artifact-manifest.v1.json'),config.archiveManifestHash,join(NATIVE,'artifacts'));requireThat(Array.isArray(manifest.archives)&&['mcp.tgz','cli.tgz','portal.tgz'].every(n=>manifest.archives.some(a=>a.name===n)),'ARCHIVE_SET_INCOMPLETE');const closure=[];
 for(const archive of manifest.archives){requireThat(/^[a-z]+\.(?:tgz|zip)$/u.test(archive.name)&&SHA.test(archive.sha256),'ARCHIVE_NAME_INVALID');const archivePath=join('artifacts',archive.name);await regular(join(NATIVE,archivePath));requireThat(await fileHash(join(NATIVE,archivePath))===archive.sha256,'ARCHIVE_CHANGED');closure.push({path:archivePath,sha256:archive.sha256});const kind=archive.name.slice(0,-4);if(!['mcp','cli','portal'].includes(kind)||!archive.name.endsWith('.tgz'))continue;if(kind==='mcp')requireThat(archive.files.filter(r=>r.path.startsWith('dist/plugin/')).map(r=>r.path).sort().join(',')==='dist/plugin/dist/code.js,dist/plugin/dist/index.html,dist/plugin/manifest.json','STAGED_PLUGIN_CLOSURE_INCOMPLETE');for(const row of archive.files){if(!row.path.startsWith('dist/')&&!(kind==='portal'&&row.path.startsWith('web/'))&&row.path!=='package.json')continue;requireThat(safeRelative(row.path)&&SHA.test(row.sha256),'ARCHIVE_ROW_INVALID');const path=nativeArtifactPath(kind,row.path);await regular(join(NATIVE,path));let nativeHash=row.sha256;if(row.path==='package.json'){const bytes=await readFile(join(NATIVE,path));const cli=await json(join(NATIVE,'packages/cli/package.json'));requireThat(hash(publishedPackageMetadata(kind,JSON.parse(bytes),cli.version))===row.sha256,'PUBLISHED_PACKAGE_METADATA_CHANGED');nativeHash=hash(bytes);}else requireThat(await fileHash(join(NATIVE,path))===row.sha256,'COMPILED_CLOSURE_CHANGED');closure.push({path,sha256:nativeHash});}}
 closure.push({path:'artifacts/artifact-manifest.v1.json',sha256:config.archiveManifestHash});closure.sort((a,b)=>a.path.localeCompare(b.path,'en'));return {config,closure,releaseReportHash:config.releaseReportHash};
}

export function validateRetainedBaselineBytes(bytes){requireThat(hash(bytes)==='2aa8780d8b033f243623bff42288326c89920e61539d8cdd0a55fda23c03d2c3','RETAINED_BASELINE_CHANGED');return JSON.parse(bytes);}
const baselineBytes=await readFile(join(TOOL,'current-retained-state-private.json'));const retainedBaseline=validateRetainedBaselineBytes(baselineBytes);
export function assertRetainedState(db,jobs,coreRows,now=Date.now()) {
 requireThat(Array.isArray(db.runs)&&Array.isArray(db.workflows)&&Array.isArray(jobs.jobs),'PORTAL_DATABASE_INVALID');
 requireThat(!jobs.jobs.some(r=>['queued','running','awaiting-confirmation','awaiting-approval'].includes(r.status))&&!(db.activities??[]).some(r=>r.source==='server'&&r.status==='started'),'PENDING_PORTAL_PRODUCER');
 requireThat(db.runs.length===retainedBaseline.portalRuns.length&&db.workflows.length===retainedBaseline.workflows.length&&coreRows.length===retainedBaseline.coreRuns.length&&new Set(db.runs.map(r=>r.id)).size===db.runs.length&&new Set(db.workflows.map(r=>r.id)).size===db.workflows.length&&new Set(coreRows.map(r=>r.id)).size===coreRows.length,'RETAINED_ROW_SET_CHANGED');
 for(const expected of retainedBaseline.portalRuns){const r=db.runs.find(r=>r.id===expected.id);requireThat(r&&r.status===expected.status&&!['queued','active','awaiting-approval'].includes(r.status)&&hash(JSON.stringify(r))===expected.rowHash,'RETAINED_PORTAL_RUN_CHANGED');}
 for(const expected of retainedBaseline.workflows){const r=db.workflows.find(r=>r.id===expected.id);requireThat(r&&hash(JSON.stringify(r))===expected.rowHash,'RETAINED_WORKFLOW_CHANGED');}
 for(const expected of retainedBaseline.coreRuns){const row=coreRows.find(r=>r.id===expected.id),r=row?.payload;requireThat(r&&r.runId===expected.id&&r.state===expected.state&&r.deadlineAt===expected.deadlineAt&&(r.lease?.expiresAt??null)===expected.leaseExpiresAt&&(r.candidateHash??null)===expected.candidateHash&&(r.appliedHash??null)===expected.appliedHash&&!r.appliedHash&&hash(JSON.stringify(r))===expected.payloadHash&&row.sha256===expected.sha256,'RETAINED_CORE_RUN_CHANGED');const passive=r.state==='needs-input'&&r.lease===null&&r.candidateHash===null||['candidate-ready','blocked'].includes(r.state)&&r.lease===null&&typeof r.candidateHash==='string'||r.state==='generating'&&r.lease&&r.lease.expiresAt<now;requireThat(passive,'CURRENT_CORE_WORK_NOT_IDLE');}
 const unknown=jobs.jobs.filter(r=>r.status==='unknown');requireThat(unknown.length===retainedBaseline.unknownRows.length&&new Set(unknown.map(r=>r.id)).size===unknown.length,'UNKNOWN_ROW_SET_CHANGED');for(const expected of retainedBaseline.unknownRows){const r=unknown.find(r=>r.id===expected.id);requireThat(r&&hash(JSON.stringify(r))===expected.rowHash,'UNKNOWN_ROW_CHANGED');}
}
export function assertOldRuntimeBinding(status,receipt){requireThat(status.buildId===1791202532000&&status.buildIdentityHash==='sha256:cc91e5c866434c08e76f9a58a04a34c8dae73c09a22fa6b6f57a41db30ef5da7'&&receipt.sourceHash==='sha256:6f87f836d872a4ba8ab49533f6447a7c921adb6b8af3dae75ddd6241e8b8a1cb'&&receipt.releaseId==='5b1c8abd-9bd3-4e81-b5ef-125d0b4d287c'&&receipt.postRead.status.buildId===status.buildId&&receipt.postRead.status.buildIdentityHash===status.buildIdentityHash,'OLD_RUNTIME_BUILD_CHANGED');for(const expected of fixedReferences){const actual=expected.entry==='daemon'?receipt.newDaemon:receipt.newPortal;requireThat(actual.pid===expected.pid&&actual.startedAt===expected.startedAt&&actual.commandHash===expected.commandHash&&actual.port===expected.port,'OLD_RUNTIME_PROCESS_CHANGED');}return status;}
export function validateBrokerRetirement(r){requireThat(JSON.stringify(r)===JSON.stringify({"schemaVersion":1,"kind":"deadline-retired-current-coding-broker","pid":25656,"brokerAnchorHash":"5eb41943f141ed95ee3e770d0dbbc9b175855909c70b3ebf7133778f49ef0606","runId":"sfp_portal1_3af845f7c67e49e387ff8975eb18d4d8","originalDeadlineAt":1791912480455,"completedRequests":24,"pendingRpcCount":0,"processAbsent":true,"execSessionId":63450,"exitCodeObserved":0,"qaServerStopped":false,"chromeStopped":false,"portalCancelInvoked":false}),'BROKER_RETIREMENT_UNCONFIRMED');return r;}
export function assertNativeRetainedRows(rows){requireThat(rows.length===retainedBaseline.nativeAttempts.length&&new Set(rows.map(r=>r.id)).size===rows.length,'NATIVE_ROW_SET_CHANGED');for(const expected of retainedBaseline.nativeAttempts){const row=rows.find(r=>r.id===expected.id),r=row?.payload;requireThat(r&&row.sha256===expected.sha256&&hash(JSON.stringify(r))===expected.payloadHash&&r.executionClosed&&r.state==='released'&&r.processes.every(p=>p.state==='stopped'),'NATIVE_PRODUCER_NOT_SETTLED');}}
async function stateSnapshot() {
 await directory(STATE);await directory(PORTAL);const dbBytes=await readFile(join(PORTAL,'portal.json')),jobBytes=await readFile(join(PORTAL,'service-jobs.json'));const db=JSON.parse(dbBytes),jobs=JSON.parse(jobBytes),core=[];
 for(const file of await readdir(join(STATE,'portal/runs'))){requireThat(/^[a-zA-Z0-9_-]+\.json$/u.test(file),'CORE_RUN_FILE_INVALID');const p=join(STATE,'portal/runs',file);await regular(p);const envelope=await json(p);core.push({id:envelope.id,payload:envelope.payload,sha256:await fileHash(p)});}
 const native=[];for(const file of await readdir(join(STATE,'portal/environment-attempts'))){requireThat(/^[a-f0-9]{64}\.json$/u.test(file),'NATIVE_RECORD_NAME_INVALID');const p=join(STATE,'portal/environment-attempts',file);await regular(p);const row=await json(p);native.push({id:row.id,payload:row.payload,sha256:await fileHash(p)});}assertNativeRetainedRows(native);assertRetainedState(db,jobs,core);requireThat(await fileHash(join(ANCHOR,'runtime.json'))==='7d485981a63194772dcd90e9af55f3a9d86aff67a902bcbd60cc0196989fc6f9'&&await fileHash(join(ANCHOR,'runtime-recovery-a476.json'))==='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','HISTORICAL_RUNTIME_CHANGED');
 requireThat(await fileHash(join(STATE,'handoff-qa-recovery-a476-20261012/intent-private.json'))==='ff37402ffd6bcea325d8cd0562f4dbe864f0b9a27d995b0fd5d22fb32b5ee449','FAILED_INTENT_CHANGED');
 return {nativeAttempts:native.map(x=>({id:x.id,sha256:x.sha256})),jobsHash:hash(jobBytes),dbHash:hash(dbBytes),workflowRunHash:hash(JSON.stringify({workflows:db.workflows,runs:db.runs})),core:core.map(x=>({id:x.id,sha256:x.sha256})),registryHash:await fileHash(join(STATE,'workspaces.v1.json')),egressHash:await fileHash(join(STATE,'egress.v1.json')),network:await inventory(join(STATE,'network')),auth:await inventory(join(STATE,'auth')),signingKeyHash:await fileHash(join(STATE,'pairing-hmac.key')),originalRuntimeHash:await fileHash(join(ANCHOR,'runtime.json')),unknownRows:jobs.jobs.filter(x=>x.status==='unknown').map(x=>({id:x.id,sha256:hash(JSON.stringify(x))})),counts:{jobs:jobs.jobs.length,runs:db.runs.length,workflows:db.workflows.length}};
}
let activeGrant=null;
export async function sealObservedReleaseBaseline(binding) {
 closed(binding,['sourceHash','releaseId']);requireThat(/^sha256:[a-f0-9]{64}$/u.test(binding.sourceHash)&&/^[a-f0-9-]{36}$/u.test(binding.releaseId),'BASELINE_SOURCE_BINDING');await oldProof();process.env.LOCALAPPDATA=join(ANCHOR,'appdata');process.env.SFP_STATE_ROOT=STATE;
 const {ControlClient}=await import(pathToFileURL(join(NATIVE,'packages/cli/dist/library.mjs')).href),client=new ControlClient({stateRoot:STATE,port:3059});const read=async path=>{await oldProof();return client.request(path,'GET',undefined,{timeoutMs:10000,beforeRequest:oldProof});};
 const observed=await read('/control/egress'),grant={schemaVersion:2,kind:'observed-same-state-cli-model-grant',namespaceHash:hash(canonical(STATE)),...retainedBaseline.cliGrantProof,renewed:true};validateGrantBinding(grant,observed,await fileHash(join(STATE,'egress.v1.json')),Date.now());validateCliGrantAudit(grant,await read('/control/admin-audit?kind=egress&since=2026-10-13T15%3A31%3A00.000Z&limit=1000'));await stateSnapshot();
 validateGrantBinding(grant,await read('/control/egress'),await fileHash(join(STATE,'egress.v1.json')),Date.now());validateCliGrantAudit(grant,await read('/control/admin-audit?kind=egress&since=2026-10-13T15%3A31%3A00.000Z&limit=1000'));requireThat(await fileHash(join(TOOL,'original-grant-private.json'))===grant.originalGrantHash,'ORIGINAL_GRANT_ARCHIVE_CHANGED');
 const baseline={schemaVersion:1,kind:'actual-scoped-release-baseline',...binding,retainedBaselineHash:hash(baselineBytes),grant},target=join(TOOL,'release-baseline-private.json');await writeFile(target,JSON.stringify(baseline,null,2)+'\n',{flag:'wx',mode:0o600});await regular(target);await oldProof();return{sealed:true,baselineHash:await fileHash(target),renewed:true,configuredAt:grant.configuredAt,expiresAt:grant.expiresAt,liveProcessEffects:false};
}
async function clientRead(owners=fixedReferences,includePortal=true,expectedBuild=null) {
 process.env.LOCALAPPDATA=join(ANCHOR,'appdata');process.env.SFP_STATE_ROOT=STATE;
 const {ControlClient}=await import(pathToFileURL(join(NATIVE,'packages/cli/dist/library.mjs')).href);const client=new ControlClient({stateRoot:STATE,port:3059});
 const proof=async()=>{const s=await physical(owners);for(const b of owners)assertOwner(s,b);assertUntouched(s);return s;};
 const get=async p=>{await proof();return client.request(p,'GET',undefined,{timeoutMs:5000,beforeRequest:async()=>{await proof();}});};
 await proof();requireThat(await client.health(),'DAEMON_HEALTH_FAILED');const status=await get('/control/status');if(expectedBuild)requireThat(status.buildId===expectedBuild.expectedBuildId&&status.buildIdentityHash===expectedBuild.expectedBuildIdentityHash&&status.role==='leader','NEW_RUNTIME_BUILD_IDENTITY_MISMATCH');const egress=await get('/control/egress');requireThat(activeGrant,'OBSERVED_GRANT_REQUIRED');validateGrantBinding(activeGrant,egress,await fileHash(join(STATE,'egress.v1.json')),Date.now());validateCliGrantAudit(activeGrant,await get('/control/admin-audit?kind=egress&since=2026-10-13T15%3A31%3A00.000Z&limit=1000'));
 const journal=[];let cursor=null,pages=0;do{const r=await get('/control/operations?limit=1000'+(cursor?'&cursor='+encodeURIComponent(cursor):''));requireThat(Array.isArray(r.rows),'JOURNAL_INVALID');journal.push(...r.rows);cursor=r.nextCursor??null;requireThat(++pages<=20,'JOURNAL_LIMIT');}while(cursor);
 requireThat(!journal.some(x=>!['succeeded','failed','pre-egress-rejected','rejected','resolved-applied','resolved-not-applied'].includes(x.status)),'UNSETTLED_DAEMON_OPERATION');
 if(includePortal){await proof();const response=await fetch('http://127.0.0.1:4315/api/health',{redirect:'error',signal:AbortSignal.timeout(5000)});requireThat(response.ok&&response.url==='http://127.0.0.1:4315/api/health'&&!response.redirected,'PORTAL_HEALTH_FAILED');requireThat((await response.json()).available===true,'PORTAL_UNAVAILABLE');}
 await proof();return {status:{buildId:status.buildId,buildIdentityHash:status.buildIdentityHash,leaderGenerationHash:hash(status.leaderGeneration),role:status.role},egress:{mode:egress.mode,configuredAt:egress.configuredAt,expiresAt:egress.expiresAt},journalCount:journal.length};
}

const privateAclScript=String.raw`
$ErrorActionPreference='Stop'
$path=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($env:SFP_PRIVATE_TARGET))
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$item=Get-Item -LiteralPath $path -Force
if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'reparse target'}
$acl=Get-Acl -LiteralPath $path
if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value){throw 'creator owner mismatch'}
if($env:SFP_PROTECT_NEW -eq '1'){
 if(-not $item.PSIsContainer){throw 'only newly owned directory may be protected'}
 $acl.SetAccessRuleProtection($true,$false)
 foreach($rule in @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))){[void]$acl.RemoveAccessRuleSpecific($rule)}
 foreach($sid in @($owner,$system)){$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);[void]$acl.AddAccessRule($rule)}
 Set-Acl -LiteralPath $path -AclObject $acl
}
$acl=Get-Acl -LiteralPath $path
$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if($rules.Count -ne 2){throw 'private rule count'}
foreach($sid in @($owner,$system)){$r=@($rules|Where-Object {$_.IdentityReference.Value -eq $sid.Value});if($r.Count -ne 1 -or $r[0].AccessControlType -ne 'Allow' -or $r[0].FileSystemRights -ne 'FullControl'){throw 'private rule rights'}}
if($env:SFP_PROTECT_NEW -eq '1' -and -not $acl.AreAccessRulesProtected){throw 'private protection'}
if($env:SFP_PRIVATE_RECURSIVE -eq '1'){
 foreach($child in @(Get-ChildItem -LiteralPath $path -Recurse -Force)){
  if(($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'private tree reparse'}
  $childAcl=Get-Acl -LiteralPath $child.FullName
  if($childAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value){throw 'private tree owner'}
  $childRules=@($childAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
  if($childRules.Count -ne 2){throw 'private tree rules'}
  foreach($sid in @($owner,$system)){$r=@($childRules|Where-Object {$_.IdentityReference.Value -eq $sid.Value});if($r.Count -ne 1 -or $r[0].AccessControlType -ne 'Allow' -or $r[0].FileSystemRights -ne 'FullControl'){throw 'private tree rights'}}
 }
}
'PRIVATE_ACL_VERIFIED'`;
export async function privateAcl(path,protect=false,root=null,recursive=false) {requireThat(root&&inside(root,path),'PRIVATE_ACL_SCOPE');const r=await powershell(privateAclScript,{SFP_PRIVATE_TARGET:Buffer.from(path,'utf16le').toString('base64'),SFP_PROTECT_NEW:protect?'1':'0',SFP_PRIVATE_RECURSIVE:recursive?'1':'0'});requireThat(r.stdout.trim()==='PRIVATE_ACL_VERIFIED','PRIVATE_ACL_REFUSED');}
async function publish(path,value,root,exclusive=false) {requireThat(inside(root,path),'PUBLICATION_SCOPE');await directory(dirname(path));const temp=exclusive?path:path+'.'+randomUUID()+'.tmp';const f=await open(temp,'wx',0o600);try{await privateAcl(temp,false,root);await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}if(!exclusive)await rename(temp,path);await privateAcl(path,false,root);}
export function assertHelperManifestShape(m){closed(m,['version','files']);requireThat(m.version===4&&Array.isArray(m.files)&&m.files.length===5&&m.files.map(x=>x.path).sort().join(',')==='current-retained-state-private.json,replacement.mjs,scoped-gates.mjs,start-owned.ps1,stop-owned.ps1','HELPER_MANIFEST_INVALID');for(const row of m.files){closed(row,['path','sha256']);requireThat(['replacement.mjs','stop-owned.ps1','start-owned.ps1','current-retained-state-private.json','scoped-gates.mjs'].includes(row.path)&&SHA.test(row.sha256),'HELPER_FILE_INVALID');}return m;}
async function verifyHelperManifest(expected) {const path=join(TOOL,'helper-manifest.json');const m=assertHelperManifestShape(await pinned(path,expected,TOOL));for(const row of m.files){await regular(join(TOOL,row.path));requireThat(await fileHash(join(TOOL,row.path))===row.sha256,'HELPER_SOURCE_CHANGED');}return m;}
async function preflight(config) {await verifyHelperManifest(config.helperManifestHash);const gate=await gates(config);await oldProof();const live=await clientRead();const oldReceipt=await pinned(join(TOOL,'old-runtime-private.json'),'5bc5d6baf85474c51b59fb9581b6f27e84c647829cb0ee77f3a250d73a72a28f',TOOL);assertOldRuntimeBinding(live.status,oldReceipt);const state=await stateSnapshot();const broker=await pinned(join(TOOL,'broker-retirement-private.json'),'31b205ae01852b4a3030ee873825ba30d809cce89f2127fa44c860aedb710156',TOOL);validateBrokerRetirement(broker);const snapshot=await oldProof();const children=await bindChildren(snapshot);requireThat((await readFile(join(PORTAL,'server.lock'),'utf8')).trim()==='8952','OLD_PORTAL_LOCK_CHANGED');return {gate,live,state,snapshot,children,brokerReceiptHash:await fileHash(join(TOOL,'broker-retirement-private.json'))};}

let activeIntent=null,activeRoot=null;
async function stage(expected,next,extra={}) {const data=await json(activeIntent);requireThat(data.phase===expected&&!data.automaticReplayAllowed,'INTENT_STAGE_CHANGED');await publish(activeIntent,{...data,...extra,previousPhase:data.phase,phase:next,updatedAt:new Date().toISOString()},activeRoot);}
async function invokeOwnedScript(name,args) {try{return await execute(PS,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(TOOL,name),...args],{windowsHide:true,timeout:55000,maxBuffer:32768});}catch(e){throw Object.assign(new Error('OWNED_PROCESS_STAGE_REFUSED'),{code:'OWNED_PROCESS_STAGE_REFUSED',causeHash:hash(String(e.message).slice(0,4096))});}}
async function verifyClosure(rows) {for(const r of rows){requireThat(await fileHash(join(NATIVE,r.path))===r.sha256,'RELEASE_CLOSURE_CHANGED');}}
async function waitOwned(owners,bound) {const until=Date.now()+45000;while(true){const s=await physical(owners);assertUntouched(s);if(assertOwner(s,bound,true))return;requireThat(Date.now()<until,'NEW_LISTENER_DEADLINE');await new Promise(r=>setTimeout(r,250));}}
async function replace(config) {
 const failedRoot=join(STATE,'handoff-qa-cdd-diagnostics-release-r4-20261014-50fb2524-df09-419a-a123-8171f7233181');
 const failedPath=join(failedRoot,'intent-private.json');
 const failedHash='19d0a2b22790ab018440b32a0268eee54cdae2c9d844e81da37a15b6aff2555c';
 const prior=failedIntentProof(await pinned(failedPath,failedHash,STATE));
 requireThat(prior.sourceHash===config.sourceHash&&hash(JSON.stringify(prior.gateConfig))===hash(JSON.stringify(config)),'FAILED_RELEASE_BINDING_CHANGED');
 const closure=await pinned(join(failedRoot,'refused-link-closure-private.json'),'85a5509942dd317a38b68bb5f45ff7c48c52d0d2ce95da545d9a0055db017a94',STATE);
 const classified=await pinned(join(failedRoot,'classified-known-links-private.json'),'0fd53bac7419f4d5428fb4e388e578503ede7ba20f2696eeba42679c28580aba',STATE);
 const links=linkPolicy(closure,classified);
 const frozen=await pinned(join(dirname(fileURLToPath(import.meta.url)),'continuation-freeze.json'),process.argv[3],dirname(fileURLToPath(import.meta.url)));
 requireThat(frozen.version===1&&Array.isArray(frozen.files)&&frozen.files.length===3&&frozen.files.map(row=>row.path).sort().join(',')==='inventory-links.mjs,replacement-continuation.mjs,scoped-gates.mjs','CONTINUATION_FREEZE_SHAPE');
 for(const row of frozen.files){requireThat(['replacement-continuation.mjs','inventory-links.mjs','scoped-gates.mjs'].includes(row.path)&&SHA.test(row.sha256),'CONTINUATION_FILE_SHAPE');await regular(join(dirname(fileURLToPath(import.meta.url)),row.path));requireThat(await fileHash(join(dirname(fileURLToPath(import.meta.url)),row.path))===row.sha256,'CONTINUATION_CODE_CHANGED');}
 await verifyHelperManifest(config.helperManifestHash);const gate=await gates(config);
 const stoppedProof=async()=>{const snap=await physical();assertUntouched(snap);requireThat(!snap.listeners.some(x=>[3059,4315].includes(x.port)),'QA_PORT_NOT_FREE');requireThat(!snap.processes.some(x=>fixedReferences.some(b=>b.pid===x.pid)||prior.children.some(b=>b.pid===x.pid)),'OLD_PID_PRESENT_OR_REUSED');return snap;};
 const stopped=await stoppedProof();requireThat(JSON.stringify(await stateSnapshot())===JSON.stringify(prior.preflightState),'STOPPED_STATE_CHANGED');
 requireThat(await fileHash(failedPath)===failedHash,'FAILED_INTENT_CHANGED');
 for(const name of ['stopped-anchor','new-release','new-runtime-logs','new-daemon-private.json','new-portal-private.json','runtime-verified-private.json']){try{await lstat(join(failedRoot,name));throw Object.assign(new Error('FAILED_STAGE_ALREADY_PROGRESSSED'),{code:'FAILED_STAGE_ALREADY_PROGRESSSED'});}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(process.argv[2]==='preflight-stopped-only'){
  const rows=await inventoryWithLinks(ANCHOR,null,links);await stoppedProof();await gates(config);requireThat(await fileHash(failedPath)===failedHash&&JSON.stringify(await stateSnapshot())===JSON.stringify(prior.preflightState),'STOPPED_PREFLIGHT_CHANGED');
  return {preflightValidated:true,liveEffects:false,outputWrites:0,sourceHash:config.sourceHash,releaseId:config.releaseId,failedParentIntentHash:failedHash,originalFailedIntentUnmodified:true,continuationFreezeHash:process.argv[3],retainedStateHash:hash(JSON.stringify(prior.preflightState)),linkClosureHash:'85a5509942dd317a38b68bb5f45ff7c48c52d0d2ce95da545d9a0055db017a94',classifiedLinksHash:'0fd53bac7419f4d5428fb4e388e578503ede7ba20f2696eeba42679c28580aba',entries:rows.length,regularFiles:rows.filter(row=>row.kind==='file').length,links:rows.filter(row=>row.kind==='link').length,inventoryHash:hash(JSON.stringify(rows)),grantExpiresAt:activeGrant.expiresAt,sourceBrowserCleanupConfirmed:false,automaticReplayAllowed:false};
 }
 const checked={gate,state:prior.preflightState,live:prior.preflightLive,children:prior.children,brokerReceiptHash:prior.brokerReceiptHash};
 activeRoot=join(STATE,'handoff-qa-cdd-diagnostics-release-r4-20261014-'+randomUUID());await mkdir(activeRoot);await privateAcl(activeRoot,true,activeRoot);activeIntent=join(activeRoot,'intent-private.json');
 const initial={version:1,kind:'new-one-use-explicit-stopped-R4-inventory-continuation',automaticReplayAllowed:false,phase:'old-stopped',previousPhase:null,createdAt:new Date().toISOString(),sourceHash:config.sourceHash,gateConfig:config,failedParentIntentHash:failedHash,failedParentIntentPath:relative(STATE,failedPath).replaceAll('\\','/'),linkClosureHash:'85a5509942dd317a38b68bb5f45ff7c48c52d0d2ce95da545d9a0055db017a94',classifiedLinksHash:'0fd53bac7419f4d5428fb4e388e578503ede7ba20f2696eeba42679c28580aba',oldParents:fixedReferences,children:checked.children,untouched,preflightState:checked.state,preflightLive:checked.live,brokerReceiptHash:checked.brokerReceiptHash,releaseClosure:gate.closure,gracefulFlushConfirmed:false,browserSideCleanupConfirmed:false,oldStopReplayed:false};await publish(activeIntent,initial,activeRoot,true);
 await stoppedProof();requireThat(await fileHash(failedPath)===failedHash&&JSON.stringify(await stateSnapshot())===JSON.stringify(checked.state),'STOPPED_PRE_COPY_CHANGED');
 const rows=await inventoryWithLinks(ANCHOR,activeRoot,links);const snapshotRoot=join(activeRoot,'stopped-anchor');await copyInventoryWithLinks(ANCHOR,snapshotRoot,rows,links,()=>privateAcl(activeRoot,false,activeRoot,true));
 await publish(join(activeRoot,'stopped-anchor-manifest.json'),{version:2,kind:'full-regular-files-and-exact-relative-symlink-topology-backup',entries:rows,manifestHash:hash(JSON.stringify(rows)),linksFollowed:false,sourceLinkCount:670,sourceLinkRawTargetsPreserved:true,linkMapping:'relative targets resolve within corresponding copied compiler workspace; link identities are newly allocated'},activeRoot,true);
 requireThat(JSON.stringify(await inventoryWithLinks(ANCHOR,activeRoot,links))===JSON.stringify(rows),'STOPPED_SOURCE_CHANGED_AFTER_COPY');await stoppedProof();requireThat(await fileHash(failedPath)===failedHash&&JSON.stringify(await stateSnapshot())===JSON.stringify(checked.state),'STOPPED_POST_COPY_CHANGED');await stage('old-stopped','backed-up',{stoppedManifestHash:hash(JSON.stringify(rows))});
 await verifyClosure(checked.gate.closure);const releaseRoot=join(activeRoot,'new-release');await mkdir(releaseRoot);for(const r of checked.gate.closure){const dest=join(releaseRoot,r.path);await mkdir(dirname(dest),{recursive:true});await copyFile(join(NATIVE,r.path),dest,constants.COPYFILE_EXCL);requireThat(await fileHash(dest)===r.sha256,'RELEASE_COPY_CHANGED');}await publish(join(activeRoot,'new-release-manifest.json'),{sourceHash:config.sourceHash,files:checked.gate.closure},activeRoot,true);
 const logs=join(activeRoot,'new-runtime-logs');await mkdir(logs);for(const name of ['daemon.out.log','daemon.err.log','portal.out.log','portal.err.log']){const f=await open(join(logs,name),'wx',0o600);await f.close();await privateAcl(join(logs,name),false,activeRoot);}
 await gates(config);await stage('backed-up','daemon-start-dispatched');await invokeOwnedScript('start-owned.ps1',['-Intent',activeIntent,'-Component','daemon']);const daemon=await json(join(activeRoot,'new-daemon-private.json'));closed(daemon,['pid','startedAt','port','commandHash','entry']);requireThat(daemon.port===3059&&daemon.entry==='daemon'&&daemon.commandHash===fixedReferences[0].commandHash&&Number.isSafeInteger(daemon.pid)&&Number.isSafeInteger(daemon.startedAt),'NEW_DAEMON_BINDING_INVALID');await privateAcl(join(activeRoot,'new-daemon-private.json'),false,activeRoot);await waitOwned([daemon],daemon);await stage('daemon-start-dispatched','daemon-listening',{newDaemon:daemon});
 const daemonRead=await clientRead([daemon],false,config);await verifyClosure(checked.gate.closure);await stage('daemon-listening','portal-start-dispatched',{newDaemonStatus:daemonRead.status});await invokeOwnedScript('start-owned.ps1',['-Intent',activeIntent,'-Component','portal']);const web=await json(join(activeRoot,'new-portal-private.json'));closed(web,['pid','startedAt','port','commandHash','entry']);requireThat(web.port===4315&&web.entry==='portal'&&web.commandHash===fixedReferences[1].commandHash&&Number.isSafeInteger(web.pid)&&Number.isSafeInteger(web.startedAt),'NEW_PORTAL_BINDING_INVALID');await privateAcl(join(activeRoot,'new-portal-private.json'),false,activeRoot);await waitOwned([daemon,web],web);await stage('portal-start-dispatched','new-listeners',{newPortal:web});
 const post=await clientRead([daemon,web],true,config);const after=await stateSnapshot();for(const k of ['jobsHash','workflowRunHash','core','registryHash','egressHash','network','signingKeyHash','unknownRows','counts','originalRuntimeHash'])requireThat(JSON.stringify(after[k])===JSON.stringify(checked.state[k]),'POSTCHECK_RETAINED_'+k.toUpperCase());requireThat((await readFile(join(PORTAL,'server.lock'),'utf8')).trim()===String(web.pid),'NEW_PORTAL_LOCK_CHANGED');requireThat(post.status.leaderGenerationHash!==checked.live.status.leaderGenerationHash,'NEW_LEADER_GENERATION_REQUIRED');await gates(config);await verifyClosure(checked.gate.closure);const postPhysical=await physical([daemon,web]);assertOwner(postPhysical,daemon);assertOwner(postPhysical,web);assertUntouched(postPhysical);
 const receipt={version:1,failedParentIntentHash:failedHash,originalR4IntentUnmodified:true,sourceLinksFollowed:false,kind:'new-one-use-scoped-release-QA-continuation-verified',recordedAt:new Date().toISOString(),sourceHash:config.sourceHash,releaseId:config.releaseId,releaseReportHash:config.releaseReportHash,artifactCheckpointHash:config.artifactCheckpointHash,newDaemon:daemon,newPortal:web,preflightState:checked.state,postState:after,postRead:post,stoppedManifestHash:hash(JSON.stringify(rows)),originalUnknownPreserved:true,expiredGeneratingPreserved:true,originalDeadlinesPreserved:true,grantRenewed:activeGrant.renewed,wholePassed:false,portalJourneyLimit:1,namespaceCopied:false,automaticReplay:false,gracefulFlushConfirmed:false,browserSideCleanupConfirmed:false};await publish(join(activeRoot,'runtime-verified-private.json'),receipt,activeRoot,true);await stage('new-listeners','complete',{receiptHash:await fileHash(join(activeRoot,'runtime-verified-private.json'))});return {replacementVerified:true,sourceHash:config.sourceHash,daemonPid:daemon.pid,portalPid:web.pid,receiptHash:await fileHash(join(activeRoot,'runtime-verified-private.json')),privateHandoffRelative:relative(STATE,activeRoot).replaceAll('\\','/')};
}

async function main() {
 const mode=process.argv[2];requireThat(process.argv.length===4&&['preflight-stopped-only','continue-stopped-once'].includes(mode)&&SHA.test(process.argv[3]),'EXPLICIT_MODE_REQUIRED');requireThat(canonical(process.cwd())===canonical(NATIVE),'EXACT_NATIVE_CWD_REQUIRED');const configPath=join(TOOL,'approved-gates.json');await regular(configPath);const config=await json(configPath);
 try{console.log(JSON.stringify(await replace(config)));}
 catch(e){if(activeIntent){try{const r=await json(activeIntent);await publish(activeIntent,{...r,previousPhase:r.phase,phase:'failed',errorCode:e.code??'NEW_QA_REPLACEMENT_REFUSED',messageHash:hash(String(e.message).slice(0,4096)),causeHash:e.causeHash??null,automaticReplayAllowed:false,updatedAt:new Date().toISOString()},activeRoot);}catch{}}console.error(JSON.stringify({failed:true,code:e.code??'NEW_QA_REPLACEMENT_REFUSED',messageHash:hash(String(e.message).slice(0,4096)),causeHash:e.causeHash??null,livePhasePreserved:!!activeIntent,automaticReplayAllowed:false}));process.exitCode=1;}
}
if(process.argv[1]&&canonical(fileURLToPath(import.meta.url))===canonical(process.argv[1]))try{await main();}catch(e){console.error(JSON.stringify({failed:true,code:e.code??'NEW_QA_ENTRY_REFUSED',messageHash:hash(String(e.message).slice(0,4096)),automaticReplayAllowed:false}));process.exitCode=1;}
