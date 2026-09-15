/* eslint-disable no-await-in-loop -- resource streams and reversible observations require ordered bounded reads. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { contentHash, storedChecksum } from '@sfp/ir';
import { selectors } from 'playwright';
import type { Page, Route } from 'playwright';

import {
  PortalConsumptionBatchSchema,
  PortalConsumptionActualSchema,
  PortalConsumptionObservationSchema,
  type PortalConsumptionBatch,
  type PortalConsumptionCheck,
  type PortalConsumptionObservation,
  type PortalConsumptionActual,
} from '../../../shared/src/portal-consumption.js';
import { matchesConsumptionValue } from './recipes/consumption-values.js';

type SourceScope = { rootNodeId: string; route: string; state: string };
const resourceKey = (url: string) => {
  const value = new URL(url);
  value.hash = '';
  return value.href;
};
export const consumptionCheckHash = (
  check: Omit<PortalConsumptionCheck, 'expectedHash'> | PortalConsumptionCheck,
) => {
  const { expectedHash: _ignored, ...value } = check as PortalConsumptionCheck;
  return contentHash('sfp-portal-consumption-check-v1', value);
};
export const consumptionBatchHash = (batch: PortalConsumptionBatch) =>
  contentHash('sfp-portal-consumption-batch-v1', batch);
interface Resource {
  hash: string;
  bytes: number;
  ambiguous: boolean;
}
/**
 * Every delivered body for a given URL must agree. A later hidden preload cannot relabel earlier
 * pixels.
 */
export class PortalConsumptionResources {
  private readonly pages = new WeakMap<Page, Map<string, Resource>>();
  private readonly pageSignals = new WeakMap<Page, AbortController>();
  private tail: Promise<unknown> = Promise.resolve();
  private bytes = 0;
  private entries = 0;
  constructor(
    private readonly origin: string,
    private readonly signal: AbortSignal,
  ) {}
  assertActive() {
    this.signal.throwIfAborted();
  }
  assertPageOrigin(page: Page) {
    if (new URL(page.url()).origin !== this.origin)
      throw Error('PORTAL_CONSUMPTION_ORIGIN_MISMATCH');
  }
  async handle(route: Route): Promise<void> {
    const request = route.request(),
      url = new URL(request.url());
    if (request.resourceType() !== 'image' || url.origin !== this.origin) {
      await route.continue();
      return;
    }
    const task = this.tail.then(async () => {
      try {
        this.signal.throwIfAborted();
        if (++this.entries > 8192) throw Error('PORTAL_CONSUMPTION_RESOURCE_LIMIT');
        const page = request.frame().page();
        if (page.isClosed()) throw Error('PORTAL_CONSUMPTION_PAGE_CLOSED');
        let pageSignal = this.pageSignals.get(page);
        if (!pageSignal) {
          pageSignal = new AbortController();
          this.pageSignals.set(page, pageSignal);
          const owned = pageSignal;
          page.once('close', () => owned.abort());
        }
        let target = url.href;
        const headers = await request.allHeaders();
        delete headers['if-none-match'];
        delete headers['if-modified-since'];
        delete headers.range;
        headers['accept-encoding'] = 'identity';
        const signal = AbortSignal.any([
          this.signal,
          pageSignal.signal,
          AbortSignal.timeout(15000),
        ]);
        let response: Response | undefined;
        for (let redirects = 0; redirects <= 5; redirects++) {
          response = await fetch(target, { method: 'GET', headers, redirect: 'manual', signal });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirects === 5) throw Error('PORTAL_CONSUMPTION_RESOURCE_REDIRECT');
          target = new URL(location, target).href;
          if (new URL(target).origin !== this.origin)
            throw Error('PORTAL_CONSUMPTION_RESOURCE_ORIGIN');
        }
        if (!response || !response.ok || !response.body)
          throw Error('PORTAL_CONSUMPTION_RESOURCE_RESPONSE');
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > 16777216) {
          await response.body.cancel();
          throw Error('PORTAL_CONSUMPTION_RESOURCE_LIMIT');
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = response.body.getReader();
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            size += next.value.length;
            this.bytes += next.value.length;
            if (size > 16777216 || this.bytes > 536870912)
              throw Error('PORTAL_CONSUMPTION_RESOURCE_LIMIT');
            chunks.push(next.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        const body = Buffer.concat(chunks, size),
          hash = storedChecksum(body),
          key = resourceKey(url.href),
          values = this.pages.get(page) ?? new Map<string, Resource>();
        const prior = values.get(key);
        values.set(key, {
          hash,
          bytes: size,
          ambiguous: Boolean(prior?.ambiguous || (prior && prior.hash !== hash)),
        });
        this.pages.set(page, values);
        const outputHeaders = Object.fromEntries(response.headers);
        delete outputHeaders['content-encoding'];
        delete outputHeaders['content-length'];
        delete outputHeaders['transfer-encoding'];
        outputHeaders['cache-control'] = 'no-store';
        await route.fulfill({ status: response.status, headers: outputHeaders, body });
      } catch {
        await route.abort('failed').catch(() => {});
      }
      return undefined;
    });
    this.tail = task.catch(() => {});
    await task;
  }
  async resolve(page: Page, url: string): Promise<Resource> {
    if (url.startsWith('data:')) {
      if (url.length > 25165824) throw Error('PORTAL_CONSUMPTION_RESOURCE_LIMIT');
      const match = /^data:(image\/[a-z0-9.+-]+)(;base64)?,([\s\S]*)$/iu.exec(url);
      if (!match) throw Error('PORTAL_CONSUMPTION_DATA_UNSUPPORTED');
      let bytes: Buffer;
      if (match[2]) {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(match[3]!))
          throw Error('PORTAL_CONSUMPTION_DATA_INVALID');
        bytes = Buffer.from(match[3]!, 'base64');
      } else {
        const raw = match[3]!,
          target = Buffer.allocUnsafe(Math.min(raw.length * 3, 16777217));
        let offset = 0;
        for (let index = 0; index < raw.length;) {
          let part: Buffer;
          if (raw[index] === '%') {
            const code = raw.slice(index + 1, index + 3);
            if (!/^[a-f0-9]{2}$/iu.test(code)) throw Error('PORTAL_CONSUMPTION_DATA_INVALID');
            part = Buffer.from([Number.parseInt(code, 16)]);
            index += 3;
          } else {
            const code = raw.codePointAt(index)!;
            part = Buffer.from(String.fromCodePoint(code), 'utf8');
            index += code > 65535 ? 2 : 1;
          }
          if (offset + part.length > 16777216) throw Error('PORTAL_CONSUMPTION_RESOURCE_LIMIT');
          target.set(part, offset);
          offset += part.length;
        }
        bytes = target.subarray(0, offset);
      }
      if (bytes.length > 16777216) throw Error('PORTAL_CONSUMPTION_RESOURCE_LIMIT');
      const values = this.pages.get(page) ?? new Map<string, Resource>(),
        key = 'data:' + storedChecksum(url),
        prior = values.get(key);
      if (prior) return prior;
      this.bytes += bytes.length;
      if (this.bytes > 536870912 || ++this.entries > 8192)
        throw Error('PORTAL_CONSUMPTION_RESOURCE_LIMIT');
      const value = { hash: storedChecksum(bytes), bytes: bytes.length, ambiguous: false };
      values.set(key, value);
      this.pages.set(page, values);
      return value;
    }
    if (new URL(url).origin !== this.origin) throw Error('PORTAL_CONSUMPTION_RESOURCE_ORIGIN');
    await this.tail;
    const value = this.pages.get(page)?.get(resourceKey(url));
    if (!value || value.ambiguous) throw Error('PORTAL_CONSUMPTION_RESOURCE_NOT_PROVEN');
    return value;
  }
}
const blank = (kind: PortalConsumptionActual['kind']): PortalConsumptionActual => ({
  kind,
  value: null,
  resourceHash: null,
  resourceBytes: null,
  resourceUrl: null,
  fontAvailable: null,
  sourceNodeId: null,
  dependency: null,
});
/** Plain browser values only. Expectations remain in the approved server spec, not page globals. */
const OBSERVE_BODY = ` const roots=document.querySelectorAll('[data-sfp-root='+JSON.stringify(input.rootId)+']'),matches=document.querySelectorAll(input.selector);
 if(roots.length!==1||matches.length!==1||!roots[0].contains(matches[0]))throw Error('PORTAL_CONSUMPTION_SCOPE_MISMATCH');
 const root=roots[0],element=matches[0];if(['IFRAME','FRAME'].includes(element.tagName))throw Error('PORTAL_CONSUMPTION_IFRAME_UNSUPPORTED');if(!elementIds.has(element))elementIds.set(element,documentId+'-'+(++elementSequence));const elementIdentity=elementIds.get(element);if(input.phase==='after-actions'&&root.getAttribute('data-sfp-state')!==input.state)throw Error('PORTAL_CONSUMPTION_STATE_MISMATCH');
 const exposed=target=>{for(let at=target;at;at=at.parentElement){const style=getComputedStyle(at);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false}const box=target.getBoundingClientRect();if(box.width<=0||box.height<=0)return false;const x=Math.max(0,Math.min(innerWidth-1,box.x+box.width/2)),y=Math.max(0,Math.min(innerHeight-1,box.y+box.height/2));const hit=document.elementFromPoint(x,y);return !!hit&&(hit===target||target.contains(hit)||(getComputedStyle(target).pointerEvents==='none'&&hit.contains(target)))};
 element.scrollIntoView({block:'nearest',inline:'nearest'});if(!exposed(root)||!exposed(element))throw Error('PORTAL_CONSUMPTION_ELEMENT_HIDDEN');
 const expected=input.expectation,style=getComputedStyle(element);let value=null,resourceUrl=null,fontAvailable=null,sourceNodeId=null;
 if(expected.kind==='property'){
  value=expected.property==='textContent'?element.textContent:style.getPropertyValue(expected.property);if(value===null||value.length>16384)throw Error('PORTAL_CONSUMPTION_VALUE_LIMIT');
  if(expected.value.kind==='font'){
   const family=expected.value.value,generics=['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace','emoji','math','fangsong'];
   fontAvailable=generics.includes(family.toLowerCase())||Array.from(document.fonts).some(face=>face.family.replace(/^['"]|['"]$/g,'')===family&&face.status==='loaded');
   if(!fontAvailable){try{const font=new FontFace('sfp-availability-probe','local('+JSON.stringify(family)+')');await Promise.race([font.load(),new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),1000))]);fontAvailable=font.status==='loaded';}catch{fontAvailable=false}}
  }
 }else if(expected.kind==='component'){
  sourceNodeId=element.getAttribute('data-sfp-node')??element.getAttribute('data-sfp-root');
 }else{
  if(expected.usage==='img'){if(!(element instanceof HTMLImageElement)||!element.complete||!element.naturalWidth||!element.naturalHeight)throw Error('PORTAL_CONSUMPTION_IMAGE_NOT_LOADED');resourceUrl=element.currentSrc||element.src;}
  else{const match=/^url\\(["']?([\\s\\S]*?)["']?\\)$/.exec(style.backgroundImage);if(!match)throw Error('PORTAL_CONSUMPTION_BACKGROUND_UNSUPPORTED');resourceUrl=match[1];if(/^0(?:px|%)?(?:\\s|$)/.test(style.backgroundSize))throw Error('PORTAL_CONSUMPTION_BACKGROUND_EMPTY');if(!['padding-box','border-box','content-box'].includes(style.backgroundOrigin)||!['border-box','padding-box','content-box'].includes(style.backgroundClip))throw Error('PORTAL_CONSUMPTION_BACKGROUND_UNSUPPORTED');
   const image=document.createElement('img');image.src=resourceUrl;await Promise.race([image.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('PORTAL_CONSUMPTION_IMAGE_NOT_LOADED')),2000))]);
   const number=value=>Number.parseFloat(value)||0,px=number(style.paddingLeft)+number(style.paddingRight),py=number(style.paddingTop)+number(style.paddingBottom),bx=number(style.borderLeftWidth)+number(style.borderRightWidth),by=number(style.borderTopWidth)+number(style.borderBottomWidth);
   const w=style.backgroundOrigin==='border-box'?element.offsetWidth:style.backgroundOrigin==='content-box'?element.clientWidth-px:element.clientWidth,h=style.backgroundOrigin==='border-box'?element.offsetHeight:style.backgroundOrigin==='content-box'?element.clientHeight-py:element.clientHeight;
   const measure=(value,total)=>value==='auto'?null:/^[0-9.]+px$/.test(value)?number(value):/^[0-9.]+%$/.test(value)?number(value)*total/100:NaN;
   let width,height;const size=style.backgroundSize;if(size==='cover'||size==='contain'){const factor=size==='cover'?Math.max(w/image.naturalWidth,h/image.naturalHeight):Math.min(w/image.naturalWidth,h/image.naturalHeight);width=image.naturalWidth*factor;height=image.naturalHeight*factor;}else{const parts=size.split(/\\s+/);width=measure(parts[0],w);height=measure(parts[1]??'auto',h);if(width===null&&height===null){width=image.naturalWidth;height=image.naturalHeight}else if(width===null)width=height*image.naturalWidth/image.naturalHeight;else if(height===null)height=width*image.naturalHeight/image.naturalWidth;}
   if(!Number.isFinite(width)||!Number.isFinite(height))throw Error('PORTAL_CONSUMPTION_BACKGROUND_UNSUPPORTED');if(width<=0||height<=0)throw Error('PORTAL_CONSUMPTION_BACKGROUND_EMPTY');
   const position=(value,area,size)=>/^-?[0-9.]+px$/.test(value)?number(value):/^-?[0-9.]+%$/.test(value)?number(value)*(area-size)/100:NaN;
   const x=position(style.backgroundPositionX,w,width),y=position(style.backgroundPositionY,h,height),repeat=style.backgroundRepeat.split(' '),repeatX=repeat[0]==='repeat'||repeat[0]==='repeat-x',repeatY=(repeat[1]??repeat[0])==='repeat'||repeat[0]==='repeat-y';
   if(!Number.isFinite(x)||!Number.isFinite(y)||repeat.some(value=>!['repeat','no-repeat','repeat-x','repeat-y'].includes(value)))throw Error('PORTAL_CONSUMPTION_BACKGROUND_UNSUPPORTED');
   const clipW=style.backgroundClip==='content-box'?element.clientWidth-px:style.backgroundClip==='border-box'?element.offsetWidth:element.clientWidth,clipH=style.backgroundClip==='content-box'?element.clientHeight-py:style.backgroundClip==='border-box'?element.offsetHeight:element.clientHeight;
   const left=mode=>mode==='border-box'?0:number(style.borderLeftWidth)+(mode==='content-box'?number(style.paddingLeft):0),top=mode=>mode==='border-box'?0:number(style.borderTopWidth)+(mode==='content-box'?number(style.paddingTop):0),originX=left(style.backgroundOrigin),originY=top(style.backgroundOrigin),clipX=left(style.backgroundClip),clipY=top(style.backgroundClip);
   if((!repeatX&&(originX+x+width<=clipX||originX+x>=clipX+clipW))||(!repeatY&&(originY+y+height<=clipY||originY+y>=clipY+clipH)))throw Error('PORTAL_CONSUMPTION_BACKGROUND_EMPTY');}
  if(!resourceUrl||resourceUrl.length>25165824||(!resourceUrl.startsWith('data:')&&resourceUrl.length>4096))throw Error('PORTAL_CONSUMPTION_RESOURCE_LIMIT');
 }
 if(!element.isConnected||!root.contains(element)||document.querySelectorAll(input.selector).length!==1||document.querySelector(input.selector)!==element||!exposed(element))throw Error('PORTAL_CONSUMPTION_STATE_CHANGED');
 return {value,resourceUrl,fontAvailable,sourceNodeId,elementIdentity};`;
const PROBE_BODY = ` const root=document.querySelector('[data-sfp-root='+JSON.stringify(input.rootId)+']'),element=document.querySelector(input.selector);if(!root||!element||!root.contains(element)||elementIds.get(element)!==input.elementIdentity)throw Error('PORTAL_CONSUMPTION_SCOPE_MISMATCH');
 const read=()=>getComputedStyle(element).getPropertyValue(input.property),before=read();const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 let target=element;
 for(let depth=0;target&&depth<=64;depth++,target=target.parentElement){
  const oldStyle=target.getAttribute('style'),other=Array.from(target.style).filter(name=>name!==input.variable).map(name=>[name,target.style.getPropertyValue(name),target.style.getPropertyPriority(name)]),old=target.style.getPropertyValue(input.variable),oldPriority=target.style.getPropertyPriority(input.variable),had=Array.from(target.style).includes(input.variable),hadStyle=target.hasAttribute('style'),variableBefore=getComputedStyle(target).getPropertyValue(input.variable);if(variableBefore.length>16384)throw Error('PORTAL_CONSUMPTION_VALUE_LIMIT');let changed=before;
  try{target.style.setProperty(input.variable,input.sentinel,'important');await wait();changed=read();}
  finally{if(had)target.style.setProperty(input.variable,old,oldPriority);else target.style.removeProperty(input.variable);if(!hadStyle&&target.style.length===0)target.removeAttribute('style');else{const currentOther=Array.from(target.style).filter(name=>name!==input.variable).map(name=>[name,target.style.getPropertyValue(name),target.style.getPropertyPriority(name)]);if(oldStyle!==null&&JSON.stringify(currentOther)===JSON.stringify(other))target.setAttribute('style',oldStyle)}let restored=read();for(let attempt=0;attempt<20&&restored!==before;attempt++){await new Promise(resolve=>setTimeout(resolve,25));restored=read();}if(target.style.getPropertyValue(input.variable)!==old||target.style.getPropertyPriority(input.variable)!==oldPriority||restored!==before)throw Error('PORTAL_CONSUMPTION_RESTORE_FAILED');}
  if(changed!==before)return {cssVariable:input.variable,ancestorDepth:depth,before,variableBefore,sentinel:input.sentinel,changed,restored:true};
  if(target===root)break;
 }
 return null;`;
const MOTION_BODY = `const {sourceId,targetId}=input;
          const records=[],seen=new Set(),now=performance.now.bind(performance),frame=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window),styleOf=getComputedStyle.bind(window),animations=document.getAnimations.bind(document);
          const push=Function.call.bind(Array.prototype.push),rect=Function.call.bind(Element.prototype.getBoundingClientRect),property=Function.call.bind(CSSStyleDeclaration.prototype.getPropertyValue),timing=Function.call.bind(KeyframeEffect.prototype.getTiming),keyframes=Function.call.bind(KeyframeEffect.prototype.getKeyframes),effectOf=Function.call.bind(Object.getOwnPropertyDescriptor(Animation.prototype,'effect').get),finished=Function.call.bind(Object.getOwnPropertyDescriptor(Animation.prototype,'finished').get);
          const started=now(); let stopped=false,overflow=false; const frames=new Set();
          const schedule=callback=>{const id=frame(()=>{frames.delete(id);callback()});frames.add(id)};
          const collect=()=>{ if(stopped)return; for(const animation of animations({subtree:true})) if(!seen.has(animation)){
            seen.add(animation); const effect=effectOf(animation),target=effect.target,box=target?rect(target):null;
            const marker=target?.closest('[data-sfp-node],[data-sfp-root]'),id=marker?.getAttribute('data-sfp-node')??marker?.getAttribute('data-sfp-root');
            if(![sourceId,targetId].includes(id)||!box||!box.width||!box.height||styleOf(target).visibility==='hidden')continue;
            if(records.length>=128){stopped=true;overflow=true;break} const record={duration:timing(effect).duration,easing:timing(effect).easing,frames:keyframes(effect),start:now(),elapsed:null,samples:[]};if(record.frames.length>256){stopped=true;overflow=true;break}push(records,record);
            finished(animation).then(()=>record.elapsed=now()-record.start).catch(()=>{});
            const sample=()=>{ if(stopped)return;if(record.samples.length<128){const style=styleOf(target),box=rect(target);push(record.samples,{x:String(box.x),y:String(box.y),opacity:property(style,'opacity'),transform:property(style,'transform'),left:property(style,'left'),top:property(style,'top'),width:property(style,'width'),height:property(style,'height')})}if(record.elapsed===null&&now()-record.start<10000)schedule(sample)};sample();
          } if(now()-started<10000)schedule(collect); }; schedule(collect);
          return { finish(){stopped=true;for(const id of frames)cancel(id);frames.clear();if(overflow)throw Error('INTERACTION_MOTION_OBSERVATION_LIMIT');return records} };
`;
const VISIBLE_BODY = `const values=document.querySelectorAll(input.selector);if(values.length!==1)throw Error('INTERACTION_SOURCE_NOT_VISIBLE');const element=values[0],roots=input.rootId?document.querySelectorAll('[data-sfp-root='+JSON.stringify(input.rootId)+']'):[document.documentElement];if(roots.length!==1||!roots[0].contains(element))throw Error('INTERACTION_SOURCE_NOT_VISIBLE');element.scrollIntoView({block:'nearest',inline:'nearest'});for(let at=element;at;at=at.parentElement){const style=getComputedStyle(at);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)throw Error('INTERACTION_SOURCE_NOT_VISIBLE')}const box=element.getBoundingClientRect();if(box.width<=0||box.height<=0)throw Error('INTERACTION_SOURCE_NOT_VISIBLE');const x=Math.max(0,Math.min(innerWidth-1,box.x+box.width/2)),y=Math.max(0,Math.min(innerHeight-1,box.y+box.height/2));const hit=document.elementFromPoint(x,y);if(!hit||!(hit===element||element.contains(hit)||(getComputedStyle(element).pointerEvents==='none'&&hit.contains(element))))throw Error('INTERACTION_SOURCE_NOT_VISIBLE');return true;`;
const selectorEngineName = 'sfpconsumption' + randomUUID().replaceAll('-', '');
const ENGINE_SOURCE = `(() => {
 const jobs=new Map(),motions=new Map(),elementIds=new WeakMap();let elementSequence=0;const documentId=String(Date.now())+'-'+String(Math.random());
 const observe=async input=>{${OBSERVE_BODY}};
 const probe=async input=>{${PROBE_BODY}};
 const motionStart=input=>{${MOTION_BODY}};
 const visible=input=>{${VISIBLE_BODY}};
 const result=value=>{const node=document.createElement('span');const text=JSON.stringify(value);if(text.length>26000000)throw Error('PORTAL_CONSUMPTION_VALUE_LIMIT');node.setAttribute('data-sfp-result',text);return node};
 return {query(root,encoded){
  if(encoded.length>65536)throw Error('PORTAL_CONSUMPTION_INPUT_LIMIT');const raw=atob(encoded.replace(/-/g,'+').replace(/_/g,'/'));const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
  if(typeof input.id!=='string'||!/^[-a-f0-9]{36}$/.test(input.id))throw Error('PORTAL_CONSUMPTION_JOB_INVALID');
  if(input.op==='visible')return result({value:visible(input.args)});
  if(input.op==='motion-start'){if(motions.size>=16||motions.has(input.id))throw Error('INTERACTION_MOTION_OBSERVATION_LIMIT');motions.set(input.id,motionStart(input.args));return result({value:true});}
  if(input.op==='motion-finish'){const motion=motions.get(input.id);if(!motion)throw Error('INTERACTION_MOTION_OBSERVATION_MISSING');motions.delete(input.id);return result({value:motion.finish()});}
  if(input.op==='observe'||input.op==='probe'){
   if(jobs.size>=16||jobs.has(input.id))throw Error('PORTAL_CONSUMPTION_JOB_LIMIT');const entry={done:false};jobs.set(input.id,entry);(input.op==='observe'?observe:probe)(input.args).then(value=>{entry.done=true;entry.value=value},error=>{entry.done=true;entry.error=String(error.message)});return result({pending:true});
  }
  if(input.op==='poll'){const entry=jobs.get(input.id);if(!entry)throw Error('PORTAL_CONSUMPTION_JOB_MISSING');if(!entry.done)return result({pending:true});jobs.delete(input.id);return result(entry.error?{error:entry.error}:{value:entry.value});}
  throw Error('PORTAL_CONSUMPTION_OPERATION_UNSUPPORTED');
 },queryAll(root,encoded){const node=this.query(root,encoded);return node?[node]:[]}};
})()`;
let registered: Promise<void> | undefined;
export const preparePortalConsumptionObserver = async () => {
  registered ??= selectors.register(
    selectorEngineName,
    { content: ENGINE_SOURCE },
    { contentScript: true },
  );
  await registered;
};
const queryIsolated = async (page: Page, input: unknown) => {
  await preparePortalConsumptionObserver();
  const encoded = Buffer.from(JSON.stringify(input)).toString('base64url'),
    handle = await page.$(selectorEngineName + '=' + encoded);
  if (!handle) throw Error('PORTAL_CONSUMPTION_OBSERVER_UNAVAILABLE');
  try {
    const text = await handle.getAttribute('data-sfp-result');
    if (!text || text.length > 26000000) throw Error('PORTAL_CONSUMPTION_VALUE_LIMIT');
    return JSON.parse(text) as { pending?: boolean; value?: unknown; error?: string };
  } finally {
    await handle.dispose();
  }
};
const isolated = async (page: Page, op: 'observe' | 'probe', args: unknown) => {
  const id = randomUUID();
  await queryIsolated(page, { id, op, args });
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await queryIsolated(page, { id, op: 'poll' });
    if (result.error) throw Error(result.error);
    if (!result.pending) return result.value;
    await delay(25);
  }
  throw Error('PORTAL_CONSUMPTION_OBSERVER_TIMEOUT');
};
const observeElement = (
  page: Page,
  check: PortalConsumptionCheck,
  phase: 'source' | 'after-actions',
) =>
  isolated(page, 'observe', {
    selector: check.selector,
    rootId: check.rootNodeId,
    phase,
    state: check.state,
    expectation:
      check.expectation.kind === 'property'
        ? {
            kind: 'property',
            property: check.expectation.property,
            value:
              check.expectation.value.kind === 'font'
                ? check.expectation.value
                : { kind: check.expectation.value.kind },
          }
        : check.expectation.kind === 'asset'
          ? { kind: 'asset', usage: check.expectation.usage }
          : { kind: 'component' },
  }) as Promise<{
    value: string | null;
    resourceUrl: string | null;
    fontAvailable: boolean | null;
    sourceNodeId: string | null;
    elementIdentity: string;
  }>;
const sentinelFor = (check: PortalConsumptionCheck): string | null => {
  const expected = check.expectation;
  if (expected.kind !== 'property') return null;
  if (
    expected.property === 'font-style' &&
    expected.value.kind === 'text' &&
    ['normal', 'italic'].includes(expected.value.value)
  )
    return expected.value.value === 'normal' ? 'italic' : 'normal';
  if (expected.value.kind === 'color') return 'rgba(3, 247, 19, 0.317)';
  if (expected.value.kind === 'font')
    return expected.value.value === 'monospace' ? 'serif' : 'monospace';
  if (expected.value.kind === 'number') {
    if (expected.property === 'opacity') return expected.value.value > 0.5 ? '0.123' : '0.987';
    if (expected.property === 'font-weight') return expected.value.value > 500 ? '100' : '900';
    return String(Math.abs(expected.value.value) + 137) + expected.value.unit;
  }
  return null;
};
const probeVariable = (
  page: Page,
  check: PortalConsumptionCheck,
  sentinel: string,
  elementIdentity: string,
) =>
  isolated(page, 'probe', {
    selector: check.selector,
    rootId: check.rootNodeId,
    property: check.expectation.kind === 'property' ? check.expectation.property : '',
    variable: check.expectation.kind === 'property' ? check.expectation.cssVariable : '',
    sentinel,
    elementIdentity,
  }) as Promise<PortalConsumptionActual['dependency']>;
export async function observePortalConsumption(
  page: Page,
  batchInput: PortalConsumptionBatch,
  scope: SourceScope,
  phase: 'source' | 'after-actions',
  resources: PortalConsumptionResources,
): Promise<PortalConsumptionObservation[]> {
  const batch = PortalConsumptionBatchSchema.parse(batchInput),
    observations: PortalConsumptionObservation[] = [];
  let observationBytes = 0;
  for (const check of batch.checks.filter(
    value => value.rootNodeId === scope.rootNodeId && value.phase === phase,
  )) {
    resources.assertActive();
    let actual: PortalConsumptionActual | null = null,
      reason: string | null = null,
      passed = false;
    try {
      resources.assertPageOrigin(page);
      if (consumptionCheckHash(check) !== check.expectedHash)
        throw Error('PORTAL_CONSUMPTION_EXPECTATION_CHANGED');
      const url = new URL(page.url());
      if (
        url.pathname + url.search + url.hash !== check.route ||
        (phase === 'source' && (check.route !== scope.route || check.state !== scope.state))
      )
        throw Error('PORTAL_CONSUMPTION_STATE_MISMATCH');
      const read = await observeElement(page, check, phase);
      actual = Object.assign(blank(check.expectation.kind), {
        value: read.value,
        fontAvailable: read.fontAvailable,
        sourceNodeId: read.sourceNodeId,
      });
      if (check.expectation.kind === 'property') {
        if (
          read.value === null ||
          !matchesConsumptionValue(check.expectation.value, read.value) ||
          (check.expectation.value.kind === 'font' && !read.fontAvailable)
        )
          throw Error('PORTAL_CONSUMPTION_PROPERTY_MISMATCH');
        if (check.expectation.cssVariable) {
          const sentinel = sentinelFor(check);
          if (sentinel === null) throw Error('PORTAL_CONSUMPTION_CSS_VARIABLE_UNSUPPORTED');
          actual.dependency = await probeVariable(page, check, sentinel, read.elementIdentity);
          if (!actual.dependency) throw Error('PORTAL_CONSUMPTION_CSS_VARIABLE_UNUSED');
        }
      } else if (check.expectation.kind === 'asset') {
        if (!read.resourceUrl) throw Error('PORTAL_CONSUMPTION_RESOURCE_NOT_PROVEN');
        const resource = await resources.resolve(page, read.resourceUrl);
        actual.resourceHash = resource.hash;
        actual.resourceBytes = resource.bytes;
        actual.resourceUrl = read.resourceUrl.startsWith('data:')
          ? 'data:' + resource.hash
          : read.resourceUrl;
        if (resource.hash !== check.expectation.hash || resource.bytes !== check.expectation.bytes)
          throw Error('PORTAL_CONSUMPTION_RESOURCE_MISMATCH');
      } else if (read.sourceNodeId !== check.expectation.sourceNodeId)
        throw Error('PORTAL_CONSUMPTION_COMPONENT_ASSOCIATION_MISMATCH');
      if (
        check.expectation.kind === 'asset' ||
        (check.expectation.kind === 'property' && check.expectation.cssVariable)
      ) {
        const current = await observeElement(page, check, phase);
        if (
          current.elementIdentity !== read.elementIdentity ||
          current.value !== read.value ||
          current.resourceUrl !== read.resourceUrl
        )
          throw Error('PORTAL_CONSUMPTION_STATE_CHANGED');
      }
      resources.assertPageOrigin(page);
      const currentUrl = new URL(page.url());
      if (currentUrl.pathname + currentUrl.search + currentUrl.hash !== check.route)
        throw Error('PORTAL_CONSUMPTION_STATE_CHANGED');
      actual = PortalConsumptionActualSchema.parse(actual);
      passed = true;
    } catch (error) {
      resources.assertActive();
      if (page.isClosed()) throw error;
      const message = error instanceof Error ? error.message : '';
      if (
        message.includes('PORTAL_CONSUMPTION_RESTORE_FAILED') ||
        message.includes('PORTAL_CONSUMPTION_OBSERVER_TIMEOUT')
      )
        throw error;
      reason =
        /PORTAL_CONSUMPTION_[A-Z_]+/u.exec(message)?.[0] ?? 'PORTAL_CONSUMPTION_OBSERVATION_FAILED';
    }
    const { expectation: _expectation, selector: _selector, ...binding } = check;
    const observation = PortalConsumptionObservationSchema.parse({
      ...binding,
      actual,
      actualHash: contentHash('sfp-portal-consumption-actual-v1', actual),
      passed,
      reason,
    });
    observationBytes += Buffer.byteLength(JSON.stringify(observation));
    if (observationBytes > 4194304) throw Error('PORTAL_CONSUMPTION_REPORT_CAPACITY');
    observations.push(observation);
  }
  return observations;
}

export const assertIsolatedPortalSourceVisible = async (
  page: Page,
  selector: string,
  rootId?: string,
) => {
  await queryIsolated(page, {
    id: randomUUID(),
    op: 'visible',
    args: { selector, rootId: rootId ?? null },
  });
};
export interface PortalMotionObservation {
  finish(): Promise<unknown>;
  dispose(): Promise<void>;
}
export const beginPortalMotionObservation = async (
  page: Page,
  sourceId: string,
  targetId: string | null,
): Promise<PortalMotionObservation> => {
  const id = randomUUID();
  await queryIsolated(page, { id, op: 'motion-start', args: { sourceId, targetId } });
  let done: Promise<unknown> | undefined;
  const finish = () =>
    (done ??= (async () => {
      const result = await queryIsolated(page, { id, op: 'motion-finish' });
      if (result.error) throw Error(result.error);
      return result.value;
    })());
  return {
    finish,
    dispose: async () => {
      await finish().catch(() => {});
    },
  };
};
