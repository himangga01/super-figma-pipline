import { indexFacts } from './facts';
import type { CaseFacts, IndexedFacts } from './types';

type Packet = { path: string; sha256: string; bytes: number; count: number };
type Descriptor = Omit<CaseFacts, 'nodes' | 'geometry'> & { packetBindingHash: string; packs: { nodes: Packet[]; resources: Packet[]; geometryNodes: Packet[] } };
const digest = async (bytes: ArrayBuffer) => 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Read only current owned candidate assets. Static generated bindings are supplied by its actual case assembler. */
export async function loadOwnCaseFacts(expected: CaseFacts['binding'], signal: AbortSignal): Promise<IndexedFacts> {
  const response = await fetch('/current-facts.json', { credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
  if (!response.ok) throw Error('OWN_CASE_FACT_DESCRIPTOR_REQUIRED');
  const descriptor: Descriptor = await response.json();
  for (const key of ['caseId', 'planId', 'contextHash', 'coreResultId', 'captureId', 'documentHash'] as const) if (descriptor.binding[key] !== expected[key]) throw Error('OWN_CASE_FACT_BINDING_CHANGED');
  if (!/^sha256:[a-f0-9]{64}$/u.test(descriptor.packetBindingHash)) throw Error('OWN_CASE_PACKET_BINDING_REQUIRED');
  async function rows<T>(packets: Packet[], kind: string): Promise<T[]> {
    if (!Array.isArray(packets) || packets.length > 4096 || new Set(packets.map(packet => packet.path)).size !== packets.length) throw Error('OWN_CASE_PACKET_LIST_INVALID');
    const values = await Promise.all(packets.map(async packet => {
      if (!/^facts\/[A-Za-z0-9._-]+\.json$/u.test(packet.path) || !Number.isSafeInteger(packet.bytes) || packet.bytes <= 0 || packet.bytes > 400000 || !Number.isSafeInteger(packet.count) || packet.count < 0) throw Error('OWN_CASE_PACKET_PATH_INVALID');
      const response = await fetch('/' + packet.path, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
      if (!response.ok) throw Error('OWN_CASE_PACKET_REQUIRED');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== packet.bytes || await digest(bytes) !== packet.sha256) throw Error('OWN_CASE_PACKET_BYTES_CHANGED');
      const value = JSON.parse(new TextDecoder().decode(bytes));
      if (value.schemaVersion !== 1 || value.kind !== kind || value.bindingHash !== descriptor.packetBindingHash || !Array.isArray(value.rows) || value.rows.length !== packet.count) throw Error('OWN_CASE_PACKET_BINDING_CHANGED');
      return value.rows as T[];
    }));
    return values.flat();
  }
  const [nodes, resources, geometryNodes] = await Promise.all([rows<CaseFacts['nodes'][number]>(descriptor.packs.nodes, 'nodes'), rows<CaseFacts['geometry']['resources'][number]>(descriptor.packs.resources, 'resources'), rows<CaseFacts['geometry']['nodes'][number]>(descriptor.packs.geometryNodes, 'geometry-nodes')]);
  return indexFacts({ ...descriptor, nodes, geometry: { resources, nodes: geometryNodes } }, expected);
}
