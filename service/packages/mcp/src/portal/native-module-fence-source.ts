/** This exact service-owned preload is part of the approved native input configuration. */
export const NATIVE_MODULE_FENCE_PROTOCOL = 'sfp-native-module-fence-v1';
export const NATIVE_MODULE_FENCE_SOURCE = String.raw`
'use strict';
(() => {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const mod = require('node:module');
  const {fileURLToPath} = require('node:url');
  const {threadId} = require('node:worker_threads');
  const createHash=crypto.createHash.bind(crypto),open=fs.openSync.bind(fs),readFd=fs.readSync.bind(fs),close=fs.closeSync.bind(fs),fstat=fs.fstatSync.bind(fs),lstat=fs.lstatSync.bind(fs),write=fs.writeFileSync.bind(fs);
  const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  const readBounded=(filename,maximum)=>{const fd=open(filename,'r');try{const held=fstat(fd,{bigint:true});if(!held.isFile()||held.size>BigInt(maximum))throw Error('PORTAL_NATIVE_MODULE_READ_LIMIT');const bytes=Buffer.alloc(Number(held.size)+1);let count=0;while(count<bytes.length){const length=readFd(fd,bytes,count,bytes.length-count,count);if(!length)break;count+=length}if(count>maximum||count!==Number(held.size))throw Error('PORTAL_NATIVE_MODULE_CHANGED');return bytes.subarray(0,count)}finally{close(fd)}};
  const policyPath = process.env.SFP_NATIVE_MODULE_POLICY;
  const expectedHash = process.env.SFP_NATIVE_MODULE_POLICY_HASH;
  if (!policyPath || !expectedHash) throw Error('PORTAL_NATIVE_MODULE_POLICY_REQUIRED');
  const policyBytes = readBounded(policyPath,33554432);
  if (policyBytes.length > 33554432 || hash(policyBytes) !== expectedHash) throw Error('PORTAL_NATIVE_MODULE_POLICY_CHANGED');
  const policy = JSON.parse(policyBytes);
  if (policy.protocol !== 'sfp-native-module-fence-v1') throw Error('PORTAL_NATIVE_MODULE_POLICY_UNSUPPORTED');
  const key = value => {const absolute=path.resolve(value); return process.platform==='win32'?absolute.toLowerCase():absolute};
  const inside = (root,value) => {const part=path.relative(root,value); return part===''||(!path.isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+path.sep))};
  const identity = stat => String(stat.dev)+':'+String(stat.ino);
  const trace = path.join(policy.traceRoot, 'trace-'+process.pid+'-'+threadId+'.jsonl');
  let traceBytes=0, generatedBytes=0, generatedCount=0;
  const append = fs.appendFileSync.bind(fs);
  const record = value => {
    const line=JSON.stringify(value)+'\n'; traceBytes += Buffer.byteLength(line);
    if(traceBytes>8388608)throw Error('PORTAL_NATIVE_MODULE_EVIDENCE_LIMIT');
    append(trace,line,{flag:'a',mode:0o600});
  };
  const reject = code => {record({kind:'violation',code});throw Object.assign(Error(code),{code})};
  const files = new Map(policy.files.map(file=>[key(file.path),file]));
  const directories = new Map(policy.directories.map(directory=>[key(directory.path),directory.identity]));
  const observed = new Map();
  const native = fs.realpathSync.native;
  const stat = value => lstat(value,{bigint:true});
  const check = (filename, source) => {
    const canonical=native(filename), name=key(canonical), expected=files.get(name);
    let before=stat(canonical);
    if(!before.isFile()||before.isSymbolicLink())return reject('PORTAL_NATIVE_MODULE_UNSUPPORTED');
    let parent=path.dirname(canonical);
    while(true){const expectedDirectory=directories.get(key(parent));if(expectedDirectory&&identity(stat(parent))!==expectedDirectory)return reject('PORTAL_NATIVE_MODULE_CHANGED');const next=path.dirname(parent);if(next===parent)break;parent=next}
    const producer=policy.producers.find(item=>inside(item.root,canonical));
    if(!expected&&!producer)return reject('PORTAL_NATIVE_MODULE_UNBOUND');
    const maximum=expected?expected.bytes:16777216;
    if(before.size>BigInt(maximum))return reject('PORTAL_NATIVE_MODULE_CHANGED');
    const bytes=readBounded(canonical,maximum), after=stat(canonical), checksum=hash(bytes);
    if(identity(before)!==identity(after)||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||before.nlink!==after.nlink)return reject('PORTAL_NATIVE_MODULE_CHANGED');
    if(expected&&(identity(after)!==expected.identity||Number(after.size)!==expected.bytes||String(after.nlink)!==expected.links||checksum!==expected.hash))return reject('PORTAL_NATIVE_MODULE_CHANGED');
    if(source!==undefined&&source!==null&&hash(Buffer.isBuffer(source)?source:Buffer.from(source))!==checksum)return reject('PORTAL_NATIVE_MODULE_SOURCE_CHANGED');
    const prior=observed.get(name);
    if(prior&&prior!==checksum)return reject('PORTAL_NATIVE_MODULE_CHANGED');
    if(!prior){
      observed.set(name,checksum);
      if(expected)record({kind:'module',path:canonical,hash:checksum,identity:identity(after),bytes:bytes.length});
      else {
        generatedCount++;generatedBytes+=bytes.length;
        if(generatedCount>1024||generatedBytes>67108864)return reject('PORTAL_NATIVE_MODULE_EVIDENCE_LIMIT');
        const retained=path.join(policy.traceRoot,checksum.slice(7)+'.module');
        try{write(retained,bytes,{flag:'wx',mode:0o600})}catch(error){if(error.code!=='EEXIST'||hash(readBounded(retained,16777216))!==checksum)throw error}
        record({kind:'generated-module',path:canonical,hash:checksum,identity:identity(after),bytes:bytes.length,producerPath:producer.path,retained});
      }
    }
    return bytes;
  };
  record({kind:'start',protocol:policy.protocol,policyHash:expectedHash,pid:process.pid,threadId});
  const hooks=mod.registerHooks({
    resolve(specifier,context,nextResolve){
      const result=nextResolve(specifier,context);
      if(result.url.startsWith('node:'))return result;
      if(!result.url.startsWith('file:'))return reject('PORTAL_NATIVE_MODULE_UNSUPPORTED');
      check(fileURLToPath(result.url));
      return result;
    },
    load(url,context,nextLoad){
      if(url.startsWith('node:'))return nextLoad(url,context);
      if(!url.startsWith('file:'))return reject('PORTAL_NATIVE_MODULE_UNSUPPORTED');
      const filename=fileURLToPath(url), bytes=check(filename);
      const result=nextLoad(url,context);
      if(result.source!==undefined&&result.source!==null)check(filename,result.source);
      if(['module','commonjs','json'].includes(result.format))return {...result,source:bytes};
      if(result.format==='addon')return result;
      if(result.format===undefined&&['.js','.cjs','.json'].includes(path.extname(filename)))return {...result,source:bytes};
      return reject('PORTAL_NATIVE_MODULE_FORMAT_UNSUPPORTED');
    }
  });
  void hooks;
  const unsupported = () => reject('PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED');
  Object.defineProperty(mod,'registerHooks',{value:unsupported,writable:false,configurable:false});
  Object.defineProperty(mod,'register',{value:unsupported,writable:false,configurable:false});
  Object.freeze(mod._extensions);
  const originalCompile=mod.Module.prototype._compile;
  // Node24's fixed CLI bootstrap contains no application code. Compare all of its bytes.
  const nodeEvalBootstrap='\n      globalThis.module = module;\n      globalThis.exports = exports;\n      globalThis.__dirname = __dirname;\n      globalThis.require = require;\n      return (main) => main();\n    ';

  const normalizeCommonJS=value=>String(value).replace(/^\uFEFF/u,'').replace(/^#![^\r\n]*/u,'');
  Object.defineProperty(mod.Module.prototype,'_compile',{value:function(content,filename,...args){if(filename==='[eval]-wrapper'){if(content!==nodeEvalBootstrap)return reject('PORTAL_NATIVE_MODULE_SOURCE_CHANGED');record({kind:'host-bootstrap',name:'node24-eval-wrapper',hash:hash(Buffer.from(content))});return originalCompile.call(this,content,filename,...args)}const bytes=check(filename);if(hash(Buffer.from(normalizeCommonJS(content)))!==hash(Buffer.from(normalizeCommonJS(bytes.toString('utf8')))))return reject('PORTAL_NATIVE_MODULE_SOURCE_CHANGED');return originalCompile.call(this,content,filename,...args)},writable:false,configurable:false});
  const originalDlopen=process.dlopen;
  Object.defineProperty(process,'dlopen',{value:function(module,filename,...args){check(filename);return originalDlopen.call(this,module,filename,...args)},writable:false,configurable:false});

  const cp=require('node:child_process'), workers=require('node:worker_threads');
  const injected={NODE_OPTIONS:'--require '+JSON.stringify(policy.preload),SFP_NATIVE_MODULE_POLICY:policyPath,SFP_NATIVE_MODULE_POLICY_HASH:expectedHash};
  const environment = input => ({...(input===undefined?process.env:input),...injected});
  const nodeArgs = args => {
    for(let i=0;i<args.length;i++){
      const arg=String(args[i]);
      if(['-e','--eval','-p','--print'].includes(arg)||!arg.startsWith('-'))break;
      if(/^(?:--(?:require|import|loader|experimental-loader)(?:=|$)|-r)/u.test(arg)){
        if((arg==='--require'||arg==='-r')&&key(String(args[i+1]))===key(policy.preload)){i++;continue}
        return reject('PORTAL_NATIVE_MODULE_LOADER_UNSUPPORTED');
      }
    }
    return ['--require',policy.preload,...args];
  };
  const inheritedExecArgs=()=>{const result=[];for(let i=0;i<process.execArgv.length;i++){const arg=process.execArgv[i];if(['-e','--eval','-p','--print'].includes(arg)){i++;continue}if(/^--(?:eval|print)=/u.test(arg))continue;result.push(arg)}return result};
  const executable = value => {
    if(value==='node'||value==='node.exe')return {file:process.execPath,node:true};
    if(typeof value!=='string'||!path.isAbsolute(value))return reject('PORTAL_NATIVE_MODULE_CHILD_RELATIVE_EXECUTABLE');
    const file=native(value);
    if(key(file)===key(process.execPath))return {file,node:true};
    if(policy.previewListener&&key(policy.previewListener.executable)===key(file))return reject('PORTAL_NATIVE_MODULE_CHILD_CAPABILITY_REQUIRED');
    if(policy.directoryLease&&key(policy.directoryLease.executable)===key(file))return reject('PORTAL_NATIVE_MODULE_CHILD_CAPABILITY_REQUIRED');
    if(policy.hostProbes?.some(probe=>probe.files.some(item=>key(item.path)===key(file))))return reject('PORTAL_NATIVE_MODULE_CHILD_CAPABILITY_REQUIRED');
    if(!files.has(key(file)))return reject('PORTAL_NATIVE_MODULE_CHILD_UNBOUND');
    check(file);
    return {file,node:false};
  };
  const childOptions=(options,isNode)=>{
    if(options?.shell)return reject('PORTAL_NATIVE_MODULE_CHILD_SHELL_UNSUPPORTED');
    const result={...options};
    if(isNode)result.env=environment(options?.env);
    return result;
  };
  const invocation=(kind,args,options)=>record({kind:'invocation',invocationKind:kind,commandHash:hash(Buffer.from(JSON.stringify(args))),environmentHash:hash(Buffer.from(JSON.stringify(options?.env??{})))});
  let admittedSpawn=0;
  const originalSpawn=cp.ChildProcess.prototype.spawn;
  Object.defineProperty(cp.ChildProcess.prototype,'spawn',{value:function(...args){if(!admittedSpawn)return reject('PORTAL_NATIVE_MODULE_CHILD_DIRECT_SPAWN_UNSUPPORTED');return originalSpawn.apply(this,args)},writable:false,configurable:false});
  const install=(object,name,value)=>Object.defineProperty(object,name,{value,writable:false,configurable:false});
  for(const name of ['spawn','spawnSync']){
    const original=cp[name];
    install(cp,name,function(file,args,options){
      if(!Array.isArray(args)){options=args;args=[]}
      const lease=policy.directoryLease;
      const leaseCall=lease&&typeof file==='string'&&path.isAbsolute(file)&&key(file)===key(lease.executable);
      if(leaseCall&&(name!=='spawn'||JSON.stringify(args)!==JSON.stringify(lease.args)||options?.shell||options?.windowsHide!==true||JSON.stringify(options?.stdio)!==JSON.stringify(['pipe','pipe','pipe'])))return reject('PORTAL_NATIVE_MODULE_CHILD_CAPABILITY_REQUIRED');
      if(leaseCall)check(file);
      const target=leaseCall?{file:lease.executable,node:false}:executable(file),opts=childOptions(options,target.node),actualArgs=target.node?nodeArgs(args):args;
      invocation(target.node?'node-child':'native-child',[target.file,...actualArgs],opts);
      admittedSpawn++;try{return original.call(this,target.file,actualArgs,opts)}finally{admittedSpawn--}
    });
  }
  const originalExecFileForProbe=cp.execFile;
  for(const name of ['execFile','execFileSync']){
    const original=cp[name];
    const wrapped=function(file,args,options,callback){
      if(!Array.isArray(args)){callback=typeof args==='function'?args:options;options=typeof args==='object'?args:undefined;args=[]}
      if(typeof options==='function'){callback=options;options=undefined}
      const listener=policy.previewListener;
      const listenerCall=listener&&typeof file==='string'&&path.isAbsolute(file)&&key(file)===key(listener.executable);
      if(listenerCall&&(name!=='execFile'||![JSON.stringify(listener.args),JSON.stringify(listener.ipv6Args)].includes(JSON.stringify(args))||options?.shell||options?.windowsHide!==true||options?.encoding!=='utf8'||options?.timeout!==5000||options?.maxBuffer!==1048576))return reject('PORTAL_NATIVE_MODULE_CHILD_CAPABILITY_REQUIRED');
      if(listenerCall)check(file);
      const target=listenerCall?{file:listener.executable,node:false}:executable(file),opts=childOptions(options,target.node),actualArgs=target.node?nodeArgs(args):args;
      invocation(target.node?'node-child':'native-child',[target.file,...actualArgs],opts);
      admittedSpawn++;try{return original.call(this,target.file,actualArgs,opts,...(name==='execFile'&&callback?[callback]:[]))}finally{admittedSpawn--}
    };
    if(name==='execFile')Object.defineProperty(wrapped,require('node:util').promisify.custom,{value:(...args)=>{let child;const promise=new Promise((resolve,reject)=>{child=wrapped(...args,(error,stdout,stderr)=>error?reject(Object.assign(error,{stdout,stderr})):resolve({stdout,stderr}))});promise.child=child;return promise}});
    install(cp,name,wrapped);
  }
  const originalFork=cp.fork;
  install(cp,'fork',function(modulePath,args,options){
    if(!Array.isArray(args)){options=args;args=[]}
    if(options?.execPath&&key(native(options.execPath))!==key(process.execPath))return reject('PORTAL_NATIVE_MODULE_CHILD_FORK_EXECUTABLE_UNSUPPORTED');
    const opts={...options,env:environment(options?.env),execArgv:nodeArgs(options?.execArgv??inheritedExecArgs())};
    invocation('node-child',[modulePath,...args],opts);
    admittedSpawn++;try{return originalFork.call(this,modulePath,args,opts)}finally{admittedSpawn--}
  });
  const guardedExec=function(command,options,callback){
    const probe=policy.hostProbes?.find(probe=>probe.request===command);
    if(!probe)return reject('PORTAL_NATIVE_MODULE_CHILD_EXEC_UNSUPPORTED');
    if(typeof options==='function'){callback=options;options=undefined}
    if(options?.shell||options?.maxBuffer>probe.maxBufferPerStream)return reject('PORTAL_NATIVE_MODULE_CHILD_EXEC_UNSUPPORTED');
    for(const expected of probe.files){const before=stat(expected.path),bytes=readBounded(expected.path,expected.bytes),after=stat(expected.path);if(!before.isFile()||before.isSymbolicLink()||identity(before)!==expected.identity||identity(after)!==expected.identity||String(after.nlink)!==expected.links||Number(after.size)!==expected.bytes||hash(bytes)!==expected.hash||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)return reject('PORTAL_NATIVE_MODULE_CHANGED')}
    record({kind:'host-probe-start',probeId:probe.id});
    const original=originalExecFileForProbe;
    admittedSpawn++;try{return original.call(this,probe.executable,probe.args,{...options,shell:false,timeout:Math.min(options?.timeout||probe.timeoutMs,probe.timeoutMs),maxBuffer:Math.min(options?.maxBuffer??probe.maxBufferPerStream,probe.maxBufferPerStream),windowsHide:true},(error,stdout,stderr)=>{const out=Buffer.isBuffer(stdout)?stdout:Buffer.from(stdout??''),err=Buffer.isBuffer(stderr)?stderr:Buffer.from(stderr??'');record({kind:'host-probe-finish',probeId:probe.id,code:error?.code??0,signal:error?.signal??null,outputHash:hash(Buffer.concat([out,err])),outputBytes:out.length+err.length});if(callback)callback(error,stdout,stderr)})}finally{admittedSpawn--}
  };
  Object.defineProperty(guardedExec,require('node:util').promisify.custom,{value:(...args)=>{let child;const promise=new Promise((resolve,reject)=>{child=guardedExec(...args,(error,stdout,stderr)=>error?reject(Object.assign(error,{stdout,stderr})):resolve({stdout,stderr}))});promise.child=child;return promise}});
  install(cp,'exec',guardedExec);
  install(cp,'execSync',()=>reject('PORTAL_NATIVE_MODULE_CHILD_EXEC_SYNC_UNSUPPORTED'));
  const OriginalWorker=workers.Worker;
  install(workers,'Worker',class extends OriginalWorker {
    constructor(filename,options={}){
      if(options.env===workers.SHARE_ENV)return reject('PORTAL_NATIVE_MODULE_CHILD_SHARED_ENV_UNSUPPORTED');
      const opts={...options,env:environment(options.env),execArgv:nodeArgs(options.execArgv??inheritedExecArgs())};
      invocation('worker',[String(filename),Boolean(options.eval),...opts.execArgv],opts);
      super(filename,opts);
    }
  });
  mod.syncBuiltinESMExports();
  process.once('exit' ,code=>record({kind:'finish',code,loaded:observed.size}));
})();
`;
