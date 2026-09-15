import { canonicalJson, contentHash } from '@sfp/ir';
import { type DesignJson, type PortalCoreRecipeRow } from '@sfp/shared';
import { z } from 'zod';

import { PortalRecipeUseSchema, type PortalRecipeUse } from '../../../../shared/src/portal-recipe-use.js';
import { PortalConsumptionBatchSchema, PortalConsumptionObservationSchema, PortalConsumptionPropertySchema, type PortalConsumptionCheck, type PortalConsumptionBatch, type PortalConsumptionObservation } from '../../../../shared/src/portal-consumption.js';
import type { PortalObservationManifest } from '../../../../shared/src/portal-observations.js';
import { consumptionCheckHash, consumptionBatchHash } from '../preview-consumption.js';
import { isPrimitivePortalAsset } from '../observation-manifest.js';
import { portalError } from '../store.js';
import type { NativeCommand } from '../native-runner.js';
import { inspectCoreComponentReference } from './consumption-components.js';
import { verifyCoreCatalogExport, type ConsumptionPage, type loadCoreConsumptionInput } from './consumption-input.js';
import { sourceBindingProperty, sourceBindingValue, sourceSolidPaint, matchesConsumptionValue } from './consumption-values.js';
import { coreHash } from './core-source.js';

export type CoreConsumptionInput=Awaited<ReturnType<typeof loadCoreConsumptionInput>>;
type Node=CoreConsumptionInput['observation']['nodes'][number];
type Row=PortalCoreRecipeRow;
type Scope={rootNodeId:string;route:string;state:string;selector:string;phase:'source'|'after-actions'};
export type CoreSourceProof={kind:string;evidenceHash:`sha256:${string}`;data:DesignJson};
export interface CoreRowCoverage {resultId:string;rowId:string;rowHash:string;checks:string[];visualRoots:string[];interactions:string[];proofs:string[];}
export interface CoreConsumptionCompilation {
  input:CoreConsumptionInput;use:PortalRecipeUse;checks:PortalConsumptionCheck[];proofs:CoreSourceProof[];
  pages:Array<{page:ConsumptionPage;rows:CoreRowCoverage[]}>;
  hash:`sha256:${string}`;
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const key=(resultId:string,rowId:string)=>JSON.stringify([resultId,rowId]);
const safeCode=(cause:unknown)=>object(cause)&&typeof cause.code==='string'?cause.code:'PORTAL_CONSUMPTION_SOURCE_UNPROVEN';
const json=(value:unknown)=>JSON.parse(canonicalJson(value)) as DesignJson;

/** Expected values come only from actual signed rows/capture, never a selector/binding proposal. */
export function compileCoreConsumption(input:CoreConsumptionInput,useInput:unknown,manifest?:PortalObservationManifest):CoreConsumptionCompilation {
  const use=PortalRecipeUseSchema.parse(useInput??{version:1});
  const screens=manifest?.screens??[],primitiveAssets=manifest?.assets??[];
  const nodes=new Map(input.observation.nodes.map(node=>[node.id,node]));
  const rows=new Map(input.pages.flatMap(page=>page.page.rows.map(row=>[key(page.resultId,row.id),{page,row}] as const)));
  const checks:PortalConsumptionCheck[]=[],checkIds=new Set<string>(),allProofs=new Map<string,CoreSourceProof>(),reviewProofs=new Map<number,string>(),coverage=new Map<string,CoreRowCoverage>();
  const requirements:Array<{code:string;resultId:string;rowId:string;detail:string}>=[];
  const usedTargets=new Set<string>(),usedComponents=new Set<string>(),usedAssets=new Set<string>(),usedCatalogs=new Set<string>(),usedReviews=new Set<number>(),usedVariables=new Set<string>();
  const reviewBindings=new Map<number,string>();
  const addRequirement=(page:ConsumptionPage,row:Row,code:string,detail=code)=>{
    if(requirements.length>=4096)throw portalError('PORTAL_CONSUMPTION_REQUIREMENT_LIMIT');
    requirements.push({code,resultId:page.resultId,rowId:row.id,detail:detail.slice(0,2048)});
  };
  const getCoverage=(page:ConsumptionPage,row:Row)=>{
    const id=key(page.resultId,row.id);let result=coverage.get(id);
    if(!result){result={resultId:page.resultId,rowId:row.id,rowHash:coreHash(row),checks:[],visualRoots:[],interactions:[],proofs:[]};coverage.set(id,result);}
    return result;
  };
  const proof=(entry:CoreRowCoverage,kind:string,data:unknown)=>{
    const value=json(data),evidenceHash=contentHash('sfp-core-consumption-source-proof-v1',{kind,data:value});
    if(!allProofs.has(evidenceHash))allProofs.set(evidenceHash,{kind,data:value,evidenceHash});
    entry.proofs.push(evidenceHash);return evidenceHash;
  };
  const rootFor=(nodeId:string)=>{
    let node=nodes.get(nodeId);const seen=new Set<string>();
    while(node?.parentId){if(seen.has(node.id)||seen.size>128)throw portalError('PORTAL_CONSUMPTION_NODE_GRAPH');seen.add(node.id);node=nodes.get(node.parentId);}
    return node?.id;
  };
  const inactive=(node:Node)=>{
    const rect=(value:unknown)=>object(value)&&['x','y','width','height'].every(key=>typeof value[key]==='number'&&Number.isFinite(value[key]))&&Number(value.width)>0&&Number(value.height)>0?value as {x:number;y:number;width:number;height:number}:null;
    const rendered=rect(node.properties.absoluteRenderBounds);
    const chain:unknown[]=[];const seen=new Set<string>();let at:Node|undefined=node;
    while(at){if(seen.has(at.id)||seen.size>128)throw portalError('PORTAL_CONSUMPTION_NODE_GRAPH');seen.add(at.id);chain.push({nodeId:at.id,visible:at.properties.visible??null,opacity:at.properties.opacity??null});if(at.properties.visible===false||at.properties.opacity===0)return chain;
      const clip=at.properties.clipsContent===true?rect(at.properties.absoluteBoundingBox):null;
      if(at.id!==node.id&&rendered&&clip&&(rendered.x+rendered.width<=clip.x||rendered.x>=clip.x+clip.width||rendered.y+rendered.height<=clip.y||rendered.y>=clip.y+clip.height)){chain.push({nodeId:node.id,rendered,clippingAncestor:at.id,clip});return chain;}
      at=at.parentId?nodes.get(at.parentId):undefined;}
    return null;
  };
  const review=(page:ConsumptionPage,row:Row,kind:PortalRecipeUse['reviews'][number]['kind'],entry:CoreRowCoverage)=>{
    const matches=use.reviews.map((value,index)=>({value,index})).filter(({value})=>value.resultId===page.resultId&&value.rowIds.includes(row.id)&&value.kind===kind);
    if(matches.length!==1){addRequirement(page,row,'PORTAL_CONSUMPTION_REVIEW_REQUIRED',`An exact ${kind} review is required for this retained row.`);return;}
    const {value,index}=matches[0]!;
    if(reviewProofs.has(index)){entry.proofs.push(reviewProofs.get(index)!);return;}
    const selected=value.rowIds.map(rowId=>rows.get(key(page.resultId,rowId)));
    if(selected.some(value=>!value)){addRequirement(page,row,'PORTAL_CONSUMPTION_REVIEW_NOT_BOUND');return;}
    const binding={ownerId:input.plan.ownerId,workspaceId:input.plan.workspaceId,contextHash:input.plan.coreRecipes!.contextHash,blueprintHash:input.plan.blueprintHash,candidateHash:input.run.candidateHash,declarationsHash:input.run.coreDeclarationsHash,resultId:page.resultId,resultHash:page.resultHash,kind,rationale:value.rationale,
      files:[...new Map(selected.flatMap(value=>value!.page.files).map(file=>[file.path,file])).values()],
      rows:selected.map(value=>({rowId:value!.row.id,rowHash:coreHash(value!.row),pageHash:value!.page.pageHash})).toSorted((a,b)=>a.rowId<b.rowId?-1:a.rowId>b.rowId?1:0),
      sourceHashes:input.plan.profiles.map(profile=>({sourceId:profile.graph.sourceId,inventoryHash:profile.graph.sourceInventory?.hash,graphHash:coreHash(profile.graph)}))};
    const bindingHash=contentHash('sfp-core-consumption-review-v1',binding);
    if((value.reviewerId!==undefined&&value.reviewerId!==input.plan.ownerId)||(value.bindingHash!==undefined&&value.bindingHash!==bindingHash)){
      addRequirement(page,row,'PORTAL_CONSUMPTION_REVIEW_CHANGED');return;
    }
    usedReviews.add(index);reviewBindings.set(index,bindingHash);reviewProofs.set(index,proof(entry,'owner-review',{...binding,reviewerId:input.plan.ownerId,bindingHash}));
  };
  const primitive=(page:ConsumptionPage,row:Row,nodeId:string,entry:CoreRowCoverage)=>{
    const rootId=rootFor(nodeId),asset=primitiveAssets.find(asset=>asset.rootNodeId===rootId);
    if(!asset)return false;
    const raw=(input.observation.raw.nodes as unknown[]|undefined)?.find(node=>object(node)&&node.id===rootId);
    if(!isPrimitivePortalAsset(raw)||!page.files.some(file=>file.path===asset.actualPath&&input.files.get(file.path)?.hash===file.hash)){
      addRequirement(page,row,'PORTAL_CONSUMPTION_PRIMITIVE_DECLARATION_REQUIRED');return true;
    }
    entry.visualRoots.push(rootId!);proof(entry,'manifest-primitive',{asset,sourceRootHash:coreHash(raw),files:page.files});return true;
  };
  const scopeFor=(page:ConsumptionPage,row:Row,nodeId:string,entry:CoreRowCoverage):Scope|null=>{
    const node=nodes.get(nodeId),rootId=rootFor(nodeId);
    if(!node||!rootId){addRequirement(page,row,'PORTAL_CONSUMPTION_NODE_MISSING');return null;}
    if(primitive(page,row,nodeId,entry))return null;
    const hidden=inactive(node);
    const later=input.plan.interactionContract?.interactions.some(item=>item.destinationNodeId===nodeId);
    const proposed=use.targets.find(target=>target.nodeId===nodeId);
    if(hidden&&!later){proof(entry,'source-inactive',{nodeId,ancestors:hidden});review(page,row,'inactive',entry);return null;}
    const screen=screens.find(screen=>screen.rootNodeId===rootId);
    if(!screen){addRequirement(page,row,'PORTAL_CONSUMPTION_OBSERVATION_REQUIRED');return null;}
    entry.visualRoots.push(rootId);
    if(proposed){
      usedTargets.add(nodeId);
      if(proposed.rootNodeId!==rootId || (proposed.phase==='source'&&(proposed.route!==screen.route||proposed.state!==screen.state))){addRequirement(page,row,'PORTAL_CONSUMPTION_TARGET_NOT_BOUND');return null;}
      if(proposed.phase==='after-actions' && !input.plan.interactionContract?.interactions.some(item=>item.rootNodeId===rootId&&item.destinationNodeId===nodeId)){
        addRequirement(page,row,'PORTAL_CONSUMPTION_STATE_NOT_BOUND');return null;
      }
      return proposed;
    }
    if(hidden){addRequirement(page,row,'PORTAL_CONSUMPTION_VISIBLE_STATE_REQUIRED');return null;}
    return {rootNodeId:rootId,route:screen.route,state:screen.state,phase:'source',selector:nodeId===rootId?`[data-sfp-root=${JSON.stringify(nodeId)}]`:`[data-sfp-node=${JSON.stringify(nodeId)}]`};
  };
  const emit=(page:ConsumptionPage,row:Row,entry:CoreRowCoverage,scope:Scope,expectation:PortalConsumptionCheck['expectation'])=>{
    if(checks.length>=131072)throw portalError('PORTAL_CONSUMPTION_CHECK_LIMIT');
    const identity={resultId:page.resultId,resultHash:page.resultHash,rowId:row.id,rowHash:entry.rowHash,...scope,expectation};
    const checkId=contentHash('sfp-core-consumption-check-id-v1',identity);
    if(!checkIds.has(checkId)){checkIds.add(checkId);checks.push({...identity,checkId,expectedHash:consumptionCheckHash({...identity,checkId})});}
    entry.checks.push(checkId);return checkId;
  };
  const association=(page:ConsumptionPage,row:Row,nodeId:string,entry:CoreRowCoverage)=>{
    const scope=scopeFor(page,row,nodeId,entry);if(scope)emit(page,row,entry,scope,{kind:'component',sourceNodeId:nodeId});return scope;
  };
  const catalog=(page:ConsumptionPage,row:Row,entry:CoreRowCoverage)=>{
    const binding=use.catalogs.find(value=>value.resultId===page.resultId&&value.rowId===row.id);
    if(!binding){addRequirement(page,row,'PORTAL_CONSUMPTION_CATALOG_REQUIRED');return;}
    usedCatalogs.add(key(page.resultId,row.id));
    try{proof(entry,'catalog-export',verifyCoreCatalogExport(page,row.id,binding.path,input.files));}
    catch(cause){addRequirement(page,row,safeCode(cause));}
  };
  const activeBindings=new Map<string,Array<{modeSelections:any[];coverage:CoreRowCoverage}>>();
  const mappedCss=new Map<string,string>();
  for(const {row} of rows.values())if(row.kind==='mapping'&&row.mappingKind==='token'&&object(row.material.value)){
    const value=row.material.value,candidate=value.candidate;
    if(typeof value.sourceId==='string'&&object(candidate)&&typeof candidate.cssVar==='string'){
      const variable=/^(?:var\(\s*)?(--[A-Za-z_][A-Za-z0-9_-]*)(?:\s*\))?$/u.exec(candidate.cssVar)?.[1];
      if(variable)mappedCss.set(value.sourceId,variable);
    }
  }
  // Resolve actual bound mode values before linking token/catalog and mapping rows to their use.
  for(const {page,row} of rows.values())if(row.kind==='binding'){
    const entry=getCoverage(page,row),binding=row.observation,node=nodes.get(binding.nodeId);
    if(!node||binding.status!=='resolved'){addRequirement(page,row,'PORTAL_CONSUMPTION_BINDING_UNRESOLVED');continue;}
    const scope=scopeFor(page,row,node.id,entry);
    if(scope){
      const property=sourceBindingProperty(binding.property,String(node.properties.type));let value=sourceBindingValue(binding.property,binding.value,String(node.properties.type));
      const paint=/^(?:\/)?(fills|strokes)\/(\d+)\/color$/u.exec(binding.property);
      if(paint&&value?.kind==='color'){const paints=node.properties[paint[1]!],selected=Array.isArray(paints)?paints[Number(paint[2])]:null;if(object(selected)&&typeof selected.opacity==='number')value={kind:'color',value:[value.value[0],value.value[1],value.value[2],value.value[3]*selected.opacity]};}
      if(!property||!value||!PortalConsumptionPropertySchema.safeParse(property).success){addRequirement(page,row,'PORTAL_CONSUMPTION_PROPERTY_UNSUPPORTED');continue;}
      const supplied=use.cssVariables.find(value=>value.variableId===binding.variableId);
      const cssVariable=mappedCss.get(binding.variableId)??supplied?.cssVariable;
      if(supplied){usedVariables.add(binding.variableId);if(mappedCss.has(binding.variableId)&&supplied.cssVariable!==cssVariable){addRequirement(page,row,'PORTAL_CONSUMPTION_TOKEN_REFERENCE_CHANGED');continue;}}
      emit(page,row,entry,scope,{kind:'property',property:PortalConsumptionPropertySchema.parse(property),value,...(cssVariable?{cssVariable}:{})});
    }
    for(const variableId of new Set([binding.variableId,...binding.aliasChain])){
      const prior=activeBindings.get(variableId)??[];prior.push({modeSelections:binding.modeSelections,coverage:entry});activeBindings.set(variableId,prior);
    }
    proof(entry,'bound-source-mode',{binding});
  }
  for(const {page,row} of rows.values()){
    const entry=getCoverage(page,row);if(row.kind==='binding')continue;
    if(row.kind==='scope'){
      const node=nodes.get(row.nodeId);
      if(!node||coreHash(node.properties)!==row.propertiesHash){addRequirement(page,row,'PORTAL_CONSUMPTION_SOURCE_ROW_CHANGED');continue;}
      const scope=association(page,row,row.nodeId,entry);
      if(scope){
        const values=node.properties,type=String(values.type);
        for(const property of ['width','height','minWidth','maxWidth','minHeight','maxHeight','opacity','cornerRadius','topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius','fontSize','fontWeight','itemSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft','characters']){
          if(values[property]===undefined)continue;const css=sourceBindingProperty(property,type),value=sourceBindingValue(property,values[property],type);
          if(css&&value&&PortalConsumptionPropertySchema.safeParse(css).success)emit(page,row,entry,scope,{kind:'property',property:PortalConsumptionPropertySchema.parse(css),value});
        }
        if(object(values.fontName)&&typeof values.fontName.family==='string'){
          emit(page,row,entry,scope,{kind:'property',property:'font-family',value:{kind:'font',value:values.fontName.family}});
          if(typeof values.fontName.style==='string'){
            const style=values.fontName.style.toLowerCase().replace(/[ -]/gu,'');
            emit(page,row,entry,scope,{kind:'property',property:'font-style',value:{kind:'text',value:style.includes('italic')?'italic':'normal'}});
            const weight=style.replace('italic',''),known:Record<string,number>={thin:100,extralight:200,light:300,regular:400,normal:400,medium:500,semibold:600,bold:700,extrabold:800,black:900};
            if(values.fontWeight===undefined&&known[weight]!==undefined)emit(page,row,entry,scope,{kind:'property',property:'font-weight',value:{kind:'number',value:known[weight]!,unit:''}});
          }
        }
        for(const [source,property] of [['lineHeight','line-height'],['letterSpacing','letter-spacing']] as const){
          const metric=values[source];if(!object(metric))continue;
          if(metric.unit==='AUTO'&&source==='lineHeight')emit(page,row,entry,scope,{kind:'property',property,value:{kind:'text',value:'normal'}});
          else if(typeof metric.value==='number'&&Number.isFinite(metric.value)&&(metric.unit==='PIXELS'||(metric.unit==='PERCENT'&&typeof values.fontSize==='number'))){
            const value=metric.unit==='PERCENT'?metric.value*Number(values.fontSize)/100:metric.value;
            emit(page,row,entry,scope,{kind:'property',property,value:{kind:'number',value,unit:'px'}});
          } else addRequirement(page,row,'PORTAL_CONSUMPTION_TEXT_METRIC_UNSUPPORTED');
        }
        if(!['VECTOR','BOOLEAN_OPERATION'].includes(type)){
          const fill=sourceSolidPaint(values.fills);
          if(fill)emit(page,row,entry,scope,{kind:'property',property:type==='TEXT'?'color':'background-color',value:fill});
          const stroke=sourceSolidPaint(values.strokes);
          if(stroke)emit(page,row,entry,scope,{kind:'property',property:'border-top-color',value:stroke});
        }
        if(row.componentApi||row.overrides)review(page,row,'component',entry);
      }
      proof(entry,'source-scope',{nodeId:node.id,propertiesHash:row.propertiesHash});
    } else if(row.kind==='variable'||row.kind==='token-export'){
      const variableId=row.kind==='variable'?row.variableId:row.sourceId;
      const bound=(activeBindings.get(variableId)??[]).filter(binding=>binding.modeSelections.some(mode=>mode.collectionId===row.collectionId&&mode.modeId===row.modeId));
      if(bound.length){for(const item of bound){entry.checks.push(...item.coverage.checks);entry.visualRoots.push(...item.coverage.visualRoots);entry.proofs.push(...item.coverage.proofs);}proof(entry,'active-catalog-mode',{rowHash:coreHash(row),modeId:row.modeId});}
      else catalog(page,row,entry);
    } else if(row.kind==='collection'||row.kind==='style'){
      catalog(page,row,entry);
    } else if(row.kind==='style-audit'){
      const scope=scopeFor(page,row,row.nodeId,entry),node=nodes.get(row.nodeId);
      if(scope&&node){
        const material=object(row.material.value)?row.material.value:null;
        const candidate=material?.actual??material?.value??material;
        const value=sourceSolidPaint(candidate);
        if(value&&['fills','strokes'].includes(row.property))emit(page,row,entry,scope,{kind:'property',property:row.property==='strokes'?'border-top-color':node.properties.type==='TEXT'?'color':'background-color',value});
        else {review(page,row,'material',entry);proof(entry,'visual-material',{sourceHash:row.material.hash,property:row.property});}
      }
    } else if(row.kind==='asset'){
      if(row.property==='root-oracle'){
        const observed=screens.find(value=>value.rootNodeId===row.nodeId);
        const asset=primitiveAssets.find(value=>value.rootNodeId===row.nodeId);
        if((observed?.oracleHash??asset?.oracleHash)!==row.contentHash)addRequirement(page,row,'PORTAL_CONSUMPTION_ORACLE_REQUIRED');
        else {entry.visualRoots.push(row.nodeId);proof(entry,'source-root-oracle',{nodeId:row.nodeId,oracleHash:row.contentHash});}
      } else {
        const scope=scopeFor(page,row,row.nodeId,entry);
        if(scope){
          if(!row.contentHash||!row.bytes||row.status!=='verified-bytes'){addRequirement(page,row,'PORTAL_CONSUMPTION_ASSET_UNVERIFIED');continue;}
          const binding=use.assets.find(value=>value.nodeId===row.nodeId&&value.property===row.property);
          if(binding)usedAssets.add(JSON.stringify([binding.nodeId,binding.property]));
          emit(page,row,entry,scope,{kind:'asset',usage:binding?.usage??'img',hash:row.contentHash,bytes:row.bytes});
        }
      }
    } else if(row.kind==='mapping'){
      if(row.mappingKind==='component'){
        const binding=use.components.find(value=>value.resultId===page.resultId&&value.rowId===row.id);
        if(!binding)addRequirement(page,row,'PORTAL_CONSUMPTION_COMPONENT_BINDING_REQUIRED');
        else {
          usedComponents.add(key(page.resultId,row.id));
          if(![binding.componentPath,binding.consumerPath].every(path=>page.files.some(file=>file.path===path&&input.files.get(path)?.hash===file.hash)))addRequirement(page,row,'PORTAL_CONSUMPTION_COMPONENT_FILE_REQUIRED');
          else try{proof(entry,'component-reference',inspectCoreComponentReference(input.files,binding));}catch(cause){addRequirement(page,row,safeCode(cause));}
        }
        review(page,row,'component',entry);
      } else if(row.mappingKind==='token'){
        const sourceId=object(row.material.value)&&typeof row.material.value.sourceId==='string'?row.material.value.sourceId:row.mappingId;
        for(const active of activeBindings.get(sourceId)??[]){entry.checks.push(...active.coverage.checks);entry.visualRoots.push(...active.coverage.visualRoots);entry.proofs.push(...active.coverage.proofs);}
        if(!entry.checks.length)review(page,row,'material',entry);
        proof(entry,'canonical-token-mapping',{canonicalHash:row.canonicalHash,codeSourceHash:row.codeSourceHash});
      } else {review(page,row,'component',entry);proof(entry,'canonical-icon-mapping',{canonicalHash:row.canonicalHash,codeSourceHash:row.codeSourceHash});}
    } else if(row.kind==='mapping-member'){
      const nodeId=object(row.material.value)?row.material.value.nodeId:row.material.value;
      if(typeof nodeId==='string')association(page,row,nodeId,entry);else addRequirement(page,row,'PORTAL_CONSUMPTION_MAPPING_MEMBER_UNSUPPORTED');
      proof(entry,'mapping-member',{mappingRowId:row.mappingRowId,index:row.index,materialHash:row.material.hash});
    } else if(row.kind==='interaction'){
      const required=input.plan.interactionContract?.interactions.filter(item=>item.sourceNodeId===row.nodeId)??[];
      if(required.length!==row.expectations.length)addRequirement(page,row,'PORTAL_CONSUMPTION_INTERACTION_COVERAGE');
      entry.interactions.push(...required.map(item=>item.id));entry.visualRoots.push(...required.map(item=>item.rootNodeId));proof(entry,'source-interaction',{rawHash:row.observation.rawHash,expectations:row.expectations});
    } else if(row.kind==='source-context'){
      const profile=input.plan.profiles[row.context.sourceIndex];
      if(!profile||profile.graph.sourceId!==row.context.sourceId||coreHash(profile.graph)!==row.context.members[row.context.sourceIndex]?.graphHash)addRequirement(page,row,'PORTAL_CONSUMPTION_SOURCE_CONTEXT_CHANGED');
      proof(entry,'qualified-source-context',{context:row.context});
    } else if(row.kind==='strategy'){
      review(page,row,'strategy',entry);proof(entry,'strategy-material',{sourceHash:row.sourceHash,materialHash:row.material.hash});
    } else if(row.kind==='obligation'){
      if(['implement-root','construct-component','construct-icon'].includes(row.obligation.kind)&&nodes.has(row.obligation.itemId))association(page,row,row.obligation.itemId,entry);
      else review(page,row,'strategy',entry);
      proof(entry,'required-obligation',{obligation:row.obligation});
    } else if(row.kind==='issue')addRequirement(page,row,'PORTAL_CONSUMPTION_BLOCKED_SOURCE');
    else addRequirement(page,row,'PORTAL_CONSUMPTION_ROW_UNSUPPORTED');
  }
  for(const index of use.reviews.keys())if(!usedReviews.has(index))throw portalError('PORTAL_CONSUMPTION_REVIEW_NOT_BOUND');
  if(use.targets.some(value=>!usedTargets.has(value.nodeId))||use.components.some(value=>!usedComponents.has(key(value.resultId,value.rowId)))||use.assets.some(value=>!usedAssets.has(JSON.stringify([value.nodeId,value.property])))||use.catalogs.some(value=>!usedCatalogs.has(key(value.resultId,value.rowId)))||use.cssVariables.some(value=>!usedVariables.has(value.variableId)))throw portalError('PORTAL_CONSUMPTION_BINDING_UNUSED');
  for(const entry of coverage.values()){
    entry.checks=[...new Set(entry.checks)].toSorted();entry.visualRoots=[...new Set(entry.visualRoots)].toSorted();entry.interactions=[...new Set(entry.interactions)].toSorted();
    if(!entry.checks.length&&!entry.visualRoots.length&&!entry.interactions.length&&!entry.proofs.length){
      const missing=requirements.filter(value=>value.resultId===entry.resultId&&value.rowId===entry.rowId);
      if(!missing.length)throw portalError('PORTAL_CONSUMPTION_ROW_UNCOVERED');
      proof(entry,'unresolved-row',{requirements:missing});
    }
  }
  const preparedUse=PortalRecipeUseSchema.parse({...use,reviews:use.reviews.map((value,index)=>({...value,reviewerId:input.plan.ownerId,bindingHash:reviewBindings.get(index)}))});
  const pages=input.pages.map(page=>({page,rows:page.page.rows.map(row=>getCoverage(page,row))}));
  const hash=contentHash('sfp-core-consumption-compilation-v1',{materialHash:input.materialHash,manifest:manifest??null,checks,pages:pages.map(value=>({pageHash:value.page.pageHash,rows:value.rows})),proofs:[...allProofs.values()],reviews:preparedUse.reviews,requirements});
  preparedUse.prepared={version:'core-consumption-v1',materialHash:input.materialHash,compilationHash:hash,contextHash:input.plan.coreRecipes!.contextHash!,blueprintHash:input.plan.blueprintHash,candidateHash:input.run.candidateHash!,declarationsHash:input.run.coreDeclarationsHash!,status:requirements.length?'blocked':'ready',requirements,pageCount:pages.length,rowCount:coverage.size,checkCount:checks.length};
  return {input,use:PortalRecipeUseSchema.parse(preparedUse),checks,pages,proofs:[...allProofs.values()],hash};
}

/** Validate actual observations independently; a worker-passed flag alone never supplies proof. */
export function verifyConsumptionObservations(batch:PortalConsumptionBatch,values:unknown):Map<string,PortalConsumptionObservation>{
  const observations=z.array(PortalConsumptionObservationSchema).max(4096).parse(values);
  if(observations.length!==batch.checks.length||new Set(observations.map(value=>value.checkId)).size!==observations.length)throw portalError('PORTAL_CONSUMPTION_OBSERVATION_SET');
  const result=new Map<string,PortalConsumptionObservation>();
  for(const check of batch.checks){
    const observed=observations.find(value=>value.checkId===check.checkId)!;
    const {expectation:_expectation,selector:_selector,...identity}=check;
    const {actual,actualHash,passed,reason,...received}=observed;
    if(canonicalJson(identity)!==canonicalJson(received)||consumptionCheckHash(check)!==check.expectedHash||!passed||reason!==null||!actual||actualHash!==contentHash('sfp-portal-consumption-actual-v1',actual))throw portalError('PORTAL_CONSUMPTION_OBSERVATION_FAILED');
    if(check.expectation.kind==='property'){
      if(actual.value===null||!matchesConsumptionValue(check.expectation.value,actual.value)||(check.expectation.value.kind==='font'&&actual.fontAvailable!==true))throw portalError('PORTAL_CONSUMPTION_VALUE_MISMATCH');
      if(check.expectation.cssVariable&&(!actual.dependency||actual.dependency.cssVariable!==check.expectation.cssVariable||!actual.dependency.restored||actual.dependency.before!==actual.value||actual.dependency.changed===actual.value))throw portalError('PORTAL_CONSUMPTION_TOKEN_UNUSED');
    } else if(check.expectation.kind==='asset'){
      if(actual.resourceHash!==check.expectation.hash||actual.resourceBytes!==check.expectation.bytes||!actual.resourceUrl)throw portalError('PORTAL_CONSUMPTION_ASSET_MISMATCH');
    } else if(actual.sourceNodeId!==check.expectation.sourceNodeId)throw portalError('PORTAL_CONSUMPTION_COMPONENT_UNOBSERVED');
    result.set(check.checkId,observed);
  }
  return result;
}
export function consumptionBatch(compilation:CoreConsumptionCompilation,checks:PortalConsumptionCheck[]):PortalConsumptionBatch{
  return PortalConsumptionBatchSchema.parse({version:1,contextHash:compilation.input.plan.coreRecipes!.contextHash,blueprintHash:compilation.input.plan.blueprintHash,declarationsHash:compilation.input.run.coreDeclarationsHash,captureFingerprint:compilation.input.plan.design.capture!.designFingerprint,candidateHash:compilation.input.run.candidateHash,checks});
}
export {consumptionBatchHash};

/** Split only disjoint source roots; a single-root overflow is explicit and never truncated. */
export function attachCoreConsumption(commands:NativeCommand[],compiled:CoreConsumptionCompilation){
  const output:NativeCommand[]=[],added:Array<{from:string;to:string}>=[],used=new Set<string>();
  for(const command of commands){
    if(!command.preview){output.push(command);continue;}
    const {consumption:_untrusted,...base}=command.preview.spec;
    const groups:Array<typeof base.screens>=[];let current:typeof base.screens=[];
    for(const screen of base.screens){
      const possible=[...current,screen];
      const selected=compiled.checks.filter(check=>possible.some(screen=>screen.rootNodeId===check.rootNodeId));
      try{if(selected.length)consumptionBatch(compiled,selected);current=possible;}
      catch{
        if(!current.length)throw portalError('PORTAL_CONSUMPTION_SINGLE_ROOT_CAPACITY');
        groups.push(current);current=[screen];
        const single=compiled.checks.filter(check=>check.rootNodeId===screen.rootNodeId);
        try{if(single.length)consumptionBatch(compiled,single);}catch{throw portalError('PORTAL_CONSUMPTION_SINGLE_ROOT_CAPACITY');}
      }
    }
    if(current.length||!groups.length)groups.push(current);
    if(groups.length>1&&(command.produces??[]).some(value=>!value.path.startsWith('.sfp-native-preview/')))
      throw portalError('PORTAL_CONSUMPTION_SPLIT_OUTPUT_CONFLICT');
    for(const [index,screens] of groups.entries()){
      const id=index===0?command.id:command.id.slice(0,43)+'-core-'+contentHash('sfp-core-command-v1',{id:command.id,index}).slice(7,19);
      if(index)added.push({from:command.id,to:id});
      const selected=compiled.checks.filter(check=>screens.some(screen=>screen.rootNodeId===check.rootNodeId));
      for(const check of selected){if(used.has(check.checkId))throw portalError('PORTAL_CONSUMPTION_DUPLICATE_ROOT');used.add(check.checkId);}
      output.push({...command,id,preview:{...command.preview,spec:{...base,screens,assets:index?[]:base.assets,outputDirectory:'.sfp-native-preview/'+id,...(selected.length?{consumption:consumptionBatch(compiled,selected)}:{})}},produces:[...(command.produces??[]).filter(value=>!value.path.startsWith('.sfp-native-preview/')),{path:'.sfp-native-preview/'+id,kind:'generated-output'}]});
    }
  }
  if(output.length>32)throw portalError('PORTAL_CONSUMPTION_COMMAND_LIMIT');
  if(used.size!==compiled.checks.length)throw portalError('PORTAL_CONSUMPTION_CHECK_COVERAGE');
  return {commands:output,added};
}
