import { createHash } from 'node:crypto';

import { ControlStatusV1Schema, type ControlStatusV1 } from '@sfp/shared';

export interface ControlStatusSessionSnapshot {
  pairedPluginCount: number;
  active: null | {
    sessionId: string;
    fileName: string | null;
    pageName: string | null;
    fileIdentityKind: 'figma-file-key' | 'document-plugin-uuid' | 'unstable-readonly';
    pluginVersion: string;
    pluginGeneration: string;
    editorType: 'figma' | 'figjam' | 'dev';
    capabilities: readonly string[];
  };
}

export interface ControlStatusSource {
  serverVersion: string;
  buildId: number;
  buildIdentityHash: `sha256:${string}` | null;
  leaderGeneration(): string;
  role(): 'leader' | 'follower' | 'unknown' | 'conflicted';
  sessions(): ControlStatusSessionSnapshot;
}

export const hashPluginGeneration = (generation: string): `sha256:${string}` =>
  `sha256:${createHash('sha256')
    .update('sfp-control-status-plugin-generation-v1', 'utf8')
    .update(Buffer.from([0]))
    .update(generation, 'utf8')
    .digest('hex')}`;

export const createControlStatusEndpoint =
  (source: ControlStatusSource) => async (): Promise<Readonly<ControlStatusV1>> => {
    const snapshot = source.sessions();
    const activePlugin =
      snapshot.active === null
        ? null
        : {
            sessionId: snapshot.active.sessionId,
            fileName: snapshot.active.fileName,
            pageName: snapshot.active.pageName,
            fileIdentityKind: snapshot.active.fileIdentityKind,
            pluginVersion: snapshot.active.pluginVersion,
            pluginGenerationHash: hashPluginGeneration(snapshot.active.pluginGeneration),
            editorType: snapshot.active.editorType,
            capabilities: Object.freeze([...snapshot.active.capabilities]),
          };
    return Object.freeze(
      ControlStatusV1Schema.parse({
        schemaVersion: 1,
        serverVersion: source.serverVersion,
        buildId: source.buildId,
        buildIdentityHash: source.buildIdentityHash,
        leaderGeneration: source.leaderGeneration(),
        role: source.role(),
        pairedPluginCount: snapshot.pairedPluginCount,
        activePlugin,
      }),
    );
  };
