import {lstat,realpath,readlink,readdir,mkdir,copyFile,symlink,open} from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,join,dirname,isAbsolute} from 'node:path';
const hash=b=>createHash('sha256').update(b).digest('hex');
const key=p=>resolve(p).replaceAll('\\','/').toLowerCase();
const inside=(r,p)=>{const x=relative(resolve(r),resolve(p));return x===''||(!isAbsolute(x)&&x!=='..'&&!x.startsWith('../')&&!x.startsWith('..\\'));};
const safe=p=>typeof p==='string'&&p&&!isAbsolute(p)&&!p.includes(':')&&!p.includes('\\')&&!p.split('/').some(x=>['','.','..'].includes(x));
const demand=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const fileHash=async p=>{const h=createHash('sha256');for await(const b of createReadStream(p))h.update(b);return h.digest('hex');};
async function directory(p){const s=await lstat(p);demand(s.isDirectory()&&!s.isSymbolicLink()&&key(await realpath(p))===key(p),'PHYSICAL_DIRECTORY_REQUIRED');}
async function physicalTarget(root,p){demand(inside(root,p),'LINK_TARGET_ESCAPE');await directory(root);const parts=relative(root,p).split(/[\\/]/u).filter(Boolean);let current=root;for(let i=0;i<parts.length;i++){current=join(current,parts[i]);const s=await lstat(current);demand(!s.isSymbolicLink(),'LINK_TARGET_ALIAS');if(i<parts.length-1)await directory(current);else demand(s.isDirectory()||s.isFile(),'LINK_TARGET_TYPE');}const s=await lstat(p);return s.isDirectory()?'dir':'file';}
export function linkPolicy(closure,classified){
 demand(closure.complete===true&&closure.readOnly===true&&closure.linksFollowed===false&&Array.isArray(closure.links)&&closure.links.length===670,'LINK_CLOSURE_INVALID');
 demand(classified?.count===670&&classified.relativeRawTargets===670&&classified.absoluteRawTargets===0&&classified.allWithinSameCompilerWorkspace===true&&classified.compilerWorkspaceCount===1&&classified.readOnly===true&&classified.contentFollowed===false&&classified.linksChanged===false&&classified.backupCreated===false&&classified.failedIntentSha256==='19d0a2b22790ab018440b32a0268eee54cdae2c9d844e81da37a15b6aff2555c'&&classified.sourceClosureSha256==='85a5509942dd317a38b68bb5f45ff7c48c52d0d2ce95da545d9a0055db017a94'&&Array.isArray(classified.links)&&classified.links.length===670,'CLASSIFIED_LINK_PROOF_INVALID');
 const classes=new Map(classified.links.map(row=>[row.relativePath,row]));demand(classes.size===670,'CLASSIFIED_LINK_SET_INVALID');
 const links=new Map();const workspace='appdata/SuperFigmaPipeline/portal/work/compiler-VaExn2/compiler-workspace';
 for(const row of closure.links){demand(safe(row.relativePath)&&!links.has(row.relativePath)&&[workspace+'/node_modules/',workspace+'/source/node_modules/'].some(p=>row.relativePath.startsWith(p))&&typeof row.linkTarget==='string'&&!isAbsolute(row.linkTarget)&&row.targetInsideAnchor===true&&row.targetInsideWorkspace===true&&/^\d+$/u.test(row.dev)&&/^\d+$/u.test(row.ino),'LINK_NOT_EXACT_COMPILER_SCOPE');const cls=classes.get(row.relativePath);demand(cls&&cls.linkType==='SymbolicLink'&&cls.attributes==='Directory, ReparsePoint'&&cls.rawTargetAbsolute===false&&cls.compilerWorkspace===workspace&&cls.targetWithinSameCompilerWorkspace===true&&cls.dev===row.dev&&cls.ino===row.ino&&cls.rawTargetHash===hash(row.linkTarget)&&cls.originalCanonicalTargetHash===hash(row.resolvedTarget),'CLASSIFIED_LINK_ROW_CHANGED');links.set(row.relativePath,{...row,workspace,classification:cls});}
 return links;
}
export function failedIntentProof(value){demand(value?.version===1&&value.phase==='failed'&&value.previousPhase==='old-stopped'&&value.errorCode==='INVENTORY_LINK_REFUSED'&&value.automaticReplayAllowed===false&&!value.newDaemon&&!value.newPortal,'FAILED_INTENT_NOT_STOPPED_INVENTORY');return value;}
async function observedLink(root,path,policy,sourceIdentity){
 const bound=policy.get(path);demand(bound,'UNLISTED_LINK');const p=join(root,path),s=await lstat(p,{bigint:true});demand(s.isSymbolicLink(),'LINK_TYPE_CHANGED');
 if(sourceIdentity)demand(String(s.dev)===bound.dev&&String(s.ino)===bound.ino,'LINK_IDENTITY_CHANGED');
 const rawTarget=await readlink(p);demand(rawTarget===bound.linkTarget&&!isAbsolute(rawTarget),'LINK_RAW_TARGET_CHANGED');
 const target=resolve(dirname(p),rawTarget),workspace=join(root,bound.workspace);demand(inside(workspace,target),'LINK_TARGET_ESCAPE');
 if(sourceIdentity)demand(key(target)===key(bound.resolvedTarget),'LINK_BOUND_TARGET_CHANGED');
 const targetKind=await physicalTarget(workspace,target),canonicalTarget=await realpath(p);demand(targetKind==='dir'&&key(canonicalTarget)===key(target),'LINK_CANONICAL_TARGET_CHANGED');
 if(sourceIdentity&&bound.classification)demand(hash(canonicalTarget)===bound.classification.originalCanonicalTargetHash,'CLASSIFIED_CANONICAL_TARGET_CHANGED');
 return {path,kind:'link',rawTarget,rawTargetHash:hash(rawTarget),targetPath:relative(root,target).replaceAll('\\','/'),targetKind,originalLinkType:'SymbolicLink',originalAttributes:'Directory, ReparsePoint'};
}
export async function inventoryWithLinks(root,exclude,policy,{sourceIdentity=true}={}){
 await directory(root);const rows=[],seen=new Set();let count=0;const began=Date.now();
 async function walk(p){if(exclude&&key(p)===key(exclude))return;demand(inside(root,p),'INVENTORY_PATH_ESCAPE');demand(++count<=250000&&Date.now()-began<120000,'INVENTORY_BOUND');const s=await lstat(p),path=relative(root,p).replaceAll('\\','/');
  if(s.isSymbolicLink()){rows.push(await observedLink(root,path,policy,sourceIdentity));seen.add(path);return;}
  if(s.isDirectory()){await directory(p);rows.push({path,kind:'directory'});for(const name of(await readdir(p)).sort())await walk(join(p,name));}
  else{demand(s.isFile()&&s.nlink===1,'SINGLE_LINK_FILE_REQUIRED');rows.push({path,kind:'file',bytes:s.size,sha256:await fileHash(p)});}
 }
 await walk(root);demand(seen.size===policy.size,'EXPECTED_LINK_SET_CHANGED');return rows.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function copyInventoryWithLinks(source,dest,rows,policy,beforeLinks){
 await directory(source);await mkdir(dest);await directory(dest);
 for(const row of rows){if(row.path===''||row.kind==='link')continue;demand(safe(row.path)&&inside(source,join(source,row.path))&&inside(dest,join(dest,row.path)),'COPY_PATH_ESCAPE');const from=join(source,row.path),to=join(dest,row.path);
  if(row.kind==='directory'){await mkdir(to);await directory(to);}else{const s=await lstat(from);demand(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&await fileHash(from)===row.sha256,'COPY_SOURCE_CHANGED');await copyFile(from,to,constants.COPYFILE_EXCL);const fd=await open(to,'r+');try{const held=await fd.stat({bigint:true}),named=await lstat(to,{bigint:true});demand(held.isFile()&&held.nlink===1n&&!named.isSymbolicLink()&&held.dev===named.dev&&held.ino===named.ino&&key(await realpath(to))===key(to),'COPY_FLUSH_IDENTITY_CHANGED');await fd.sync();}finally{await fd.close();}const d=await lstat(to);demand(d.isFile()&&!d.isSymbolicLink()&&d.nlink===1&&await fileHash(to)===row.sha256,'COPY_DEST_CHANGED');}
 }
 // The existing recursive private ACL verifier runs while the new backup contains only physical nodes.
 await beforeLinks();
 for(const row of rows.filter(row=>row.kind==='link')){
  demand(JSON.stringify(await observedLink(source,row.path,policy,true))===JSON.stringify(row),'SOURCE_LINK_CHANGED_BEFORE_COPY');
  const to=join(dest,row.path);await directory(dirname(to));await physicalTarget(join(dest,policy.get(row.path).workspace),join(dest,row.targetPath));
  await symlink(row.rawTarget,to,row.targetKind);
  demand(JSON.stringify(await observedLink(dest,row.path,policy,false))===JSON.stringify(row),'BACKUP_LINK_MAPPING_CHANGED');
 }
 const copied=await inventoryWithLinks(dest,null,policy,{sourceIdentity:false});demand(JSON.stringify(copied)===JSON.stringify(rows),'COPY_INVENTORY_MISMATCH');return copied;
}
