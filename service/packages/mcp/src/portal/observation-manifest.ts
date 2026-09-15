import { contentHash } from '@sfp/ir';

import {
  PortalObservationManifestSchema,
  type PortalInteractionContract,
  type PortalObservationIdentity,
} from '../../../shared/src/portal-observations.js';
import {
  portalDesignFingerprint,
  requireCurrentPortalCapture,
  type PortalCapturedDesign,
} from './design-capture.js';
import { portalError } from './store.js';

export const isPrimitivePortalAsset = (node: any): boolean => {
  if (
    !node ||
    typeof node !== 'object' ||
    typeof node.width !== 'number' ||
    typeof node.height !== 'number' ||
    !(node.width > 0 && node.width <= 512 && node.height > 0 && node.height <= 512)
  )
    return false;
  if (node.reactions !== undefined && (!Array.isArray(node.reactions) || node.reactions.length))
    return false;
  if (node.type === 'GROUP')
    return (
      Array.isArray(node.children) &&
      node.children.length === 1 &&
      isPrimitivePortalAsset(node.children[0])
    );
  return (
    ['RECTANGLE', 'VECTOR', 'ELLIPSE', 'POLYGON', 'STAR'].includes(node.type) &&
    (!node.children || node.children.length === 0)
  );
};
export type ObservationProposal = {
  id: string;
  rootNodeId: string;
  path: string;
  state: string;
  viewport: { width: number; height: number };
  oracleHash: string;
  assertionIds: string[];
};
/** Prepared under owner authority, before execution. Root obligations never coalesce by PNG hash. */
export function preparePortalObservationManifest(
  captured: PortalCapturedDesign,
  contract: PortalInteractionContract,
  screens: ObservationProposal[],
  assets: Array<{ nodeId: string; oracleHash: string; path: string }>,
  routes: string[] = [],
) {
  requireCurrentPortalCapture(captured);
  if (contract.captureFingerprint !== portalDesignFingerprint(captured) || !contract.complete)
    throw portalError('PORTAL_INTERACTION_CONTRACT_REQUIRED');
  const raw = JSON.parse(captured.raw),
    roots = new Map<string, any>((raw.nodes ?? []).map((node: any) => [node.id, node]));
  const oracles = captured.assets.filter(value => value.query.kind === 'png');
  if (
    screens.length + assets.length !== oracles.length ||
    new Set([...screens.map(value => value.rootNodeId), ...assets.map(value => value.nodeId)])
      .size !== oracles.length
  )
    throw portalError('PORTAL_OBSERVATION_DISTINCT_ROOTS_REQUIRED');
  for (const screen of screens) {
    const oracle = oracles.find(
      value => value.query.kind === 'png' && value.query.nodeId === screen.rootNodeId,
    );
    const assertions = contract.interactions
      .filter(value => value.rootNodeId === screen.rootNodeId)
      .map(value => value.id)
      .toSorted();
    if (
      !oracle ||
      oracle.sha256 !== screen.oracleHash ||
      screen.state !== `source:${screen.rootNodeId}` ||
      JSON.stringify([...screen.assertionIds].toSorted()) !== JSON.stringify(assertions) ||
      (routes.length && !routes.includes(screen.path)) ||
      new URL(screen.path, 'http://127.0.0.1').origin !== 'http://127.0.0.1'
    )
      throw portalError('PORTAL_OBSERVATION_SOURCE_BINDING_REQUIRED');
  }
  for (const asset of assets) {
    const oracle = oracles.find(
      value => value.query.kind === 'png' && value.query.nodeId === asset.nodeId,
    );
    if (
      !oracle ||
      oracle.sha256 !== asset.oracleHash ||
      !isPrimitivePortalAsset(roots.get(asset.nodeId)) ||
      contract.interactions.some(value => value.rootNodeId === asset.nodeId)
    )
      throw portalError('PORTAL_OBSERVATION_PRIMITIVE_INVALID');
  }
  return PortalObservationManifestSchema.parse({
    version: 1,
    captureFingerprint: contract.captureFingerprint,
    scopeHash: contract.scopeHash,
    interactionContractHash: contentHash('sfp-interaction-contract-v1', contract),
    screens: screens.map(screen => ({
      id: screen.id,
      rootNodeId: screen.rootNodeId,
      captureFingerprint: contract.captureFingerprint,
      scopeHash: contract.scopeHash,
      route: screen.path,
      state: screen.state,
      viewport: screen.viewport,
      deviceScaleFactor: 1,
      assertionIds: screen.assertionIds,
      oracleHash: screen.oracleHash,
    })),
    assets: assets.map(asset => ({
      rootNodeId: asset.nodeId,
      oracleHash: asset.oracleHash,
      actualPath: asset.path,
    })),
  });
}
export function sameObservationIdentity(
  left: PortalObservationIdentity,
  right: PortalObservationIdentity,
): boolean {
  return (
    contentHash('sfp-observation-identity-v1', left) ===
    contentHash('sfp-observation-identity-v1', right)
  );
}
