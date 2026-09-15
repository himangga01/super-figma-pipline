import { expect,it } from 'vitest';
import { PORTAL_CORE_RECIPE_IDS, type PortalCorePlanBinding } from '@sfp/shared';
import { contentHash } from '../src/canonical-json.js';
import { portalCandidateHash, type PortalRun } from '../src/portal-run.js';

const hash=contentHash('candidate-fixture','value');
const binding:PortalCorePlanBinding={recipeAuthorityVersion:1,status:'ready',code:null,contractHash:hash,requirementsHash:hash,preparationId:hash,contextHash:hash,inputHash:hash,requiredResults:PORTAL_CORE_RECIPE_IDS.map(recipeId=>({recipeId,definitionHash:hash,resultId:contentHash('result-id',recipeId),resultHash:contentHash('result',recipeId)})),workItemsHash:hash,workItemCount:1,bindingHash:hash};
const plan={contextHash:hash,blueprintHash:hash,coreRecipes:binding};
const files:PortalRun['files']=['a.ts','b.ts'].map(path=>({path,action:'create',baseHash:null,contentHash:hash,encoding:'utf8',artifact:{path:'contents/'+path,hash,bytes:1}}));
const declaration={resultId:hash,resultHash:hash,outputItemId:hash,kind:'scope',files:[{path:'a.ts',hash}],assertionIds:['one','two']};

it('binds changed file/assertion references even when candidate file bytes are identical',()=>{
  const a=portalCandidateHash(files,plan,[declaration]);
  expect(portalCandidateHash(files,plan,[{...declaration,files:[{path:'b.ts',hash}]}])).not.toBe(a);
  expect(portalCandidateHash(files,plan,[{...declaration,assertionIds:['other']}])).not.toBe(a);
  expect(()=>portalCandidateHash(files,plan)).toThrow('PORTAL_CORE_DECLARATIONS_REQUIRED');
});
it('canonicalizes declaration and file/assertion ordering and keeps legacy inspection separate',()=>{
  const first={...declaration,files:[{path:'a.ts',hash},{path:'b.ts',hash}]};
  const second={...declaration,outputItemId:contentHash('other','item')};
  expect(portalCandidateHash(files,plan,[first,second])).toBe(portalCandidateHash(files.toReversed(),plan,[second,{...first,files:first.files.toReversed(),assertionIds:first.assertionIds.toReversed()}]));
  const legacy={contextHash:hash,blueprintHash:hash};
  expect(portalCandidateHash(files,legacy)).not.toBe(portalCandidateHash(files,plan,[]));
});
