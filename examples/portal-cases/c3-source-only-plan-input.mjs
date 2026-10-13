import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActualCasePlanInputs } from './case-plan-inputs.mjs';

/** Normal public source-only planning ingredients; incomplete synthetic design cannot issue a design lease. */
export async function createC3SourceOnlyPlanInputs({ referenceWorkspaceId, referenceRootPath = '.', newTargetPath = 'generated-portal', implementationRoot = fileURLToPath(new URL('.', import.meta.url)), artifactAbsolutePath, artifactPath = 'source-preparation-design.json' }) {
  if (artifactPath !== 'source-preparation-design.json') throw Error('Explicit reviewed source-only artifact path required');
  const artifactBytes = await readFile(artifactAbsolutePath), artifact = JSON.parse(artifactBytes);
  if (artifact.synthetic !== true || artifact.sourcePreparationOnly !== true || artifact.capturedFacts !== false || artifact.assetAuthority !== false) throw Error('Explicit synthetic incomplete source-only artifact required');
  const planInput = await createActualCasePlanInputs({ caseId: 'c3', referenceWorkspaceId, referenceRootPath, newTargetPath, implementationRoot });
  planInput.design = { ...planInput.design, artifactPath, artifactHash: 'sha256:' + createHash('sha256').update(artifactBytes).digest('hex'), freshness: 'allow-pinned' };
  return { planInput, intent: { sourcePreparationOnly: true, syntheticDesign: true, capturedFacts: false, designAcceptance: false, futureFreshLivePlanRequired: true, originalSourceRequestSeconds: 1800 } };
}
