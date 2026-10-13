import { readFile, writeFile, mkdir, readdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { deriveCurrentCaseLandingControls } from './derive-case-controls.mjs';
import { indexFacts } from './shared-design/facts.ts';

const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const portable = path => typeof path === 'string' && !isAbsolute(path) && !path.includes('\\') && !path.includes(':') && path.split('/').every(part => part && part !== '.' && part !== '..');
const protectedPath = path => path.split('/').some(part => ['node_modules', '.git', '.cache', '.react-router', 'build'].includes(part)) || /(?:^|\/)\.env(?:$|\.(?!(?:example|sample|template)$))/u.test(path) || /\.(?:sqlite(?:-wal|-shm)?|db)$/iu.test(path);
const prefixed = value => /^[a-f0-9]{64}$/u.test(value ?? '') ? 'sha256:' + value : value;

/** Copy approved authored/legacy source into NEW owned assembly. This never writes the registered target. */
export async function composeOwnedCaseCandidate({ caseId, admission, ownedOutputParent, outputRoot, baseRoot, baseFiles, capsuleRoot, capsuleManifestHash, implementationRoot = fileURLToPath(new URL('.', import.meta.url)), codePins, landingControls }) {
  assert(['c2', 'c3'].includes(caseId));
  const capsuleBytes = await readFile(join(capsuleRoot, 'capsule-files-manifest.json'));
  assert.equal(sha(capsuleBytes), capsuleManifestHash, 'Exact own capsule materialization manifest required');
  const capsule = JSON.parse(capsuleBytes), binding = capsule.binding;
  assert.equal(binding.caseId, caseId); assert.equal(admission.planId, binding.planId); assert.equal(admission.contextHash, binding.contextHash);
  assert(Number.isSafeInteger(admission.originalDeadlineAt) && Date.now() < admission.originalDeadlineAt && Number.isSafeInteger(admission.leaseExpiresAt) && Date.now() < admission.leaseExpiresAt, 'Original live coding context required');
  assert(typeof admission.publicContextReceiptHash === 'string' && /^sha256:[a-f0-9]{64}$/u.test(admission.publicContextReceiptHash), 'Controller current public coding-context receipt required');
  // These are consistency checks. Only the service can admit the actual lease/submission.
  const output = resolve(outputRoot), parent = resolve(ownedOutputParent), within = relative(parent, output);
  assert(within && !within.startsWith('..') && !isAbsolute(within));
  assert.equal((await realpath(parent)).toLowerCase(), parent.toLowerCase());
  assert.equal((await realpath(dirname(output))).toLowerCase(), dirname(output).toLowerCase());
  assert.equal(await lstat(output).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false, 'Candidate output must be new');
  const files = new Map(), references = capsule.assetReferences;
  async function readPinned(root, path, expected) {
    expected = prefixed(expected); assert(portable(path) && /^sha256:[a-f0-9]{64}$/u.test(expected));
    const full = resolve(root, path), rel = relative(resolve(root), full);
    assert(rel && !rel.startsWith('..') && !isAbsolute(rel));
    const info = await lstat(full); assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1);
    assert.equal((await realpath(full)).toLowerCase(), full.toLowerCase());
    const bytes = await readFile(full); assert.equal(sha(bytes), expected); return bytes;
  }
  assert(Array.isArray(baseFiles) && baseFiles.length && new Set(baseFiles.map(file => file.path)).size === baseFiles.length);
  for (const file of baseFiles) {
    assert(!protectedPath(file.path), 'No dependency/private/generated state in authored baseline');
    if (caseId === 'c3') assert.equal(prefixed(file.sha256 ?? file.hash), prefixed(codePins['c3-workspace/framework/' + file.path]), 'C3 baseline must be the reviewed authored framework, never reference frontend');
    files.set(file.path, await readPinned(baseRoot, file.path, file.sha256 ?? file.hash));
  }
  for (const file of capsule.files) files.set(file.path, await readPinned(capsuleRoot, file.path, file.sha256));
  const own = async (from, to) => { assert(codePins[from], 'Reviewed exact authored code pin required: ' + from); files.set(to, await readPinned(implementationRoot, from, codePins[from])); };
  const commonRoot = 'shared-design';
  for (const name of await readdir(join(implementationRoot, commonRoot))) if (/\.(?:ts|tsx|css)$/u.test(name)) await own(commonRoot + '/' + name, 'app/design/rendering/' + name);
  const preview = JSON.parse(files.get('current-case-design.json').toString('utf8'));
  const factsDescriptor = JSON.parse(files.get('public/current-facts.json').toString('utf8'));
  const unpack = packets => packets.flatMap(packet => JSON.parse(files.get('public/' + packet.path).toString('utf8')).rows);
  const nodes = unpack(factsDescriptor.packs.nodes);
  indexFacts({ ...factsDescriptor, nodes, geometry: { nodes: unpack(factsDescriptor.packs.geometryNodes), resources: unpack(factsDescriptor.packs.resources) } }, binding);
  const controls = landingControls ?? deriveCurrentCaseLandingControls(nodes);
  const ids = new Set(nodes.map(node => node.id));
  for (const id of [...controls.signIn, ...controls.home, ...controls.forms, ...controls.submits, ...Object.keys(controls.emails), ...Object.values(controls.emails)]) assert(ids.has(id), 'Only this case current source controls may bind');
  files.set('app/design/current-case-binding.ts', Buffer.from('export const currentCaseDesign = ' + JSON.stringify({ binding, composition: preview.composition, controls, breakpoint: preview.responsiveBreakpoint }) + ' as const;\n'));
  const commonImports = `import { Link, useLocation } from 'react-router';\nimport { BoundCaseDesign } from './rendering/BoundCaseDesign';\nimport { currentCaseDesign } from './current-case-binding';\n`;
  if (caseId === 'c3') {
    const rootSource = files.get('app/root.tsx')?.toString('utf8'); assert(rootSource?.includes('<body>'), 'Reviewed independent root seam required');
    files.set('app/root.tsx', Buffer.from(rootSource.replace('<body>', '<body style={{margin:0}}>')));
    files.set('app/design/current-design.tsx', Buffer.from(commonImports + `export default function CurrentDesign() { const path = useLocation().pathname.slice(1); return <BoundCaseDesign binding={currentCaseDesign.binding} compositionConfig={{templates: {...currentCaseDesign.composition.templates}, heroes: [...currentCaseDesign.composition.heroes], videos: [...currentCaseDesign.composition.videos], dividers: [...currentCaseDesign.composition.dividers]}} controls={{signIn:[...currentCaseDesign.controls.signIn],home:[...currentCaseDesign.controls.home],forms:[...currentCaseDesign.controls.forms],submits:[...currentCaseDesign.controls.submits],emails:{...currentCaseDesign.controls.emails}}} breakpoint={currentCaseDesign.breakpoint} fixedView={['guide','mobile','desktop'].includes(path) ? path : undefined} actions={{link:({kind,nodeId,label,style,children})=><Link to={kind==='home'?'/':'/notes'} data-sfp-node={nodeId} aria-label={label} className="case-captured-control" style={style}>{children}</Link>,form:({nodeId,style,children})=><form method="get" action="/notes" data-sfp-node={nodeId} className="case-captured-form" style={style}>{children}</form>}} />; }\n`));
    files.set('app/routes.ts', Buffer.from(`import { index, route, type RouteConfig } from '@react-router/dev/routes';\nexport default [index('routes/home.tsx'),route('guide','routes/guide.tsx'),route('mobile','routes/mobile.tsx'),route('desktop','routes/desktop.tsx'),route('notes','routes/notes.tsx')] satisfies RouteConfig;\n`));
    for (const name of ['guide', 'mobile', 'desktop']) files.set('app/routes/' + name + '.tsx', Buffer.from(`export { default } from './home';\n`));
    files.set('app/routes/home.tsx', Buffer.from(`import CurrentDesign from '../design/current-design';\nexport const meta=()=>[{title:'Notes workspace'}];\nexport default function Home(){return <CurrentDesign/>;}\n`));
    await own('c3-workspace/backend/acceptance/application-journey.mjs', 'acceptance/application-journey.mjs');
    await own('c3-workspace/backend/acceptance/http-negatives.mjs', 'acceptance/http-negatives.mjs');
  } else {
    for (const path of ['app/root.tsx','app/components/cdd/case-contract.ts','app/components/cdd/LegacyLandingActions.tsx','app/routes/resources+/own-notes.ts','app/routes/_marketing/index.tsx','app/routes/_marketing/guide.tsx','app/routes/_marketing/mobile.tsx','app/routes/_marketing/desktop.tsx']) await own('c2-epic/design-extension/' + path, path);
    files.set('app/components/cdd/CurrentLegacyDesign.tsx', Buffer.from(`import { useLocation } from 'react-router';\nimport { BoundCaseDesign } from '../../design/rendering/BoundCaseDesign';\nimport { currentCaseDesign } from '../../design/current-case-binding';\nimport { LegacyLandingLink, LegacySignupForm } from './LegacyLandingActions';\nimport type { LandingRouteContract } from './case-contract';\nexport default function CurrentLegacyDesign({routes}:{routes:LandingRouteContract}) {const path=useLocation().pathname.slice(1);return <BoundCaseDesign binding={currentCaseDesign.binding} compositionConfig={{templates:{...currentCaseDesign.composition.templates},heroes:[...currentCaseDesign.composition.heroes],videos:[...currentCaseDesign.composition.videos],dividers:[...currentCaseDesign.composition.dividers]}} controls={{signIn:[...currentCaseDesign.controls.signIn],home:[...currentCaseDesign.controls.home],forms:[...currentCaseDesign.controls.forms],submits:[...currentCaseDesign.controls.submits],emails:{...currentCaseDesign.controls.emails}}} breakpoint={currentCaseDesign.breakpoint} fixedView={['guide','mobile','desktop'].includes(path)?path:undefined} actions={{link:({kind,nodeId,label,style,children})=>kind==='home'?<a href="/" data-sfp-node={nodeId} aria-label={label} className="case-captured-control" style={style}>{children}</a>:<LegacyLandingLink kind={routes.authenticated?'notes':'login'} routes={routes} nodeId={nodeId} label={routes.authenticated?'Open your notes':label} style={style}>{children}</LegacyLandingLink>,form:({nodeId,style,children})=><LegacySignupForm nodeId={nodeId} style={style}>{children}</LegacySignupForm>}}/>;}\n`));
    for (const [from, to] of [['c2-epic/index.ts','index.ts'],['c2-epic/server/app.ts','server/app.ts'],['c2-epic/server/origin-guard.ts','server/origin-guard.ts'],['c2-epic/server/native-environment.ts','server/native-environment.ts'],['c2-epic/epic-journey.mjs','acceptance/epic-journey.mjs'],['migrate-case.mjs','acceptance/migrate-case.mjs']]) await own(from, to);
  }
  for (const name of ['native-case-entry.mjs','provision-case.mjs','compile-case.mjs','serve-case.mjs']) await own(name, 'acceptance/' + name);
  assert(Date.now() < admission.originalDeadlineAt && Date.now() < admission.leaseExpiresAt, 'Original coding deadline expired during assembly');
  await mkdir(output);
  for (const [path, bytes] of files) { assert(portable(path)); await mkdir(dirname(join(output,path)),{recursive:true}); await writeFile(join(output,path),bytes,{flag:'wx'}); }
  const manifest = {schemaVersion:1,caseId,binding,sourceRuntimeHash:capsule.sourceRuntimeHash,files:[...files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes),encoding:/\.(?:png|gif|jpe?g|woff2?)$/u.test(path)?'base64':'utf8'})),assetReferences:references,capsuleManifestHash,codePins,publicContextReceiptHash:admission.publicContextReceiptHash,registeredTargetWritten:false,leaseOrAuthenticationValuesCopied:false,referenceFrontendCopied:caseId==='c3'?false:null,c3EntryIsWorkspaceNavigation:caseId==='c3',signupSuccessClaimed:false,serviceAcceptance:false};
  await writeFile(join(output,'case-candidate-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return {output,manifest};
}
