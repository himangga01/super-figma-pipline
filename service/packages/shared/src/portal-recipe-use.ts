import { z } from 'zod';
import { isBoundedDesignJson } from './design-observation.js';

const id=z.string().min(1).max(512),hash=z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const path=z.string().min(1).max(1024).refine(value=>!value.includes('\\')&&!value.includes(':')&&value.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'),'Portable target path required');
const target=z.object({nodeId:id,rootNodeId:id,selector:z.string().min(1).max(2048),route:z.string().startsWith('/').max(2048),state:id,phase:z.enum(['source','after-actions'])}).strict();
const review=z.object({
  resultId:id,rowIds:z.array(id).min(1).max(256),
  kind:z.enum(['strategy','component','inactive','material']),rationale:z.string().min(20).max(4096),
  reviewerId:id.optional(),bindingHash:hash.optional(),
}).strict().refine(row=>new Set(row.rowIds).size===row.rowIds.length,'Duplicate review row');
export const PortalRecipeUseSchema=z.unknown().refine((value):boolean=>isBoundedDesignJson(value,8_388_608,200_000),'PORTAL_RECIPE_USE_LIMIT').pipe(z.object({
  version:z.literal(1),
  targets:z.array(target).max(20_000).default([]),
  components:z.array(z.object({resultId:id,rowId:id,componentPath:path,exportName:id,consumerPath:path}).strict()).max(4096).default([]),
  cssVariables:z.array(z.object({variableId:id,cssVariable:z.string().regex(/^--[A-Za-z_][A-Za-z0-9_-]{0,127}$/u)}).strict()).max(10000).default([]),
  assets:z.array(z.object({nodeId:id,property:id,usage:z.enum(['img','background-image'])}).strict()).max(10000).default([]),
  catalogs:z.array(z.object({resultId:id,rowId:id,path}).strict()).max(20000).default([]),
  reviews:z.array(review).max(4096).default([]),
  prepared:z.object({
    version:z.literal('core-consumption-v1'),materialHash:hash,compilationHash:hash,
    contextHash:hash,blueprintHash:hash,candidateHash:hash,declarationsHash:hash,
    status:z.enum(['ready','blocked']),
    requirements:z.array(z.object({code:id,resultId:id,rowId:id,detail:z.string().max(2048)}).strict()).max(4096),
    pageCount:z.number().int().min(1).max(4096),rowCount:z.number().int().min(1).max(1_048_576),checkCount:z.number().int().min(0).max(131072),
  }).strict().optional(),
}).strict().superRefine((value,ctx)=>{
  for(const keys of [value.targets.map(row=>row.nodeId),value.components.map(row=>JSON.stringify([row.resultId,row.rowId])),value.cssVariables.map(row=>row.variableId),value.assets.map(row=>JSON.stringify([row.nodeId,row.property])),value.catalogs.map(row=>JSON.stringify([row.resultId,row.rowId]))])
    if(new Set(keys).size!==keys.length)ctx.addIssue({code:'custom',message:'PORTAL_RECIPE_USE_DUPLICATE'});
}));
export type PortalRecipeUse=z.infer<typeof PortalRecipeUseSchema>;
