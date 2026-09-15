import { createHash, randomBytes } from 'node:crypto';
import { mkdir, realpath, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { createInspection, type InspectionV1 } from '@sfp/ir';

import { AtomicFileStore } from '../../mcp/src/fs/atomic-file.js';

export const createCaptureFolder = async (root: string, fileKey: string): Promise<string> => {
  if (!/^[A-Za-z0-9]{10,128}$/u.test(fileKey)) throw new Error('CAPTURE_FILE_KEY_INVALID');
  const requested = resolve(root);
  await mkdir(requested, { recursive: true });
  const canonical = await realpath(requested);
  if (canonical !== requested)
    throw new Error('CAPTURE_ROOT_ALIAS: choose a canonical output directory');
  const folder = join(canonical, `${fileKey}-${Date.now()}-${randomBytes(4).toString('hex')}`);
  const fromRoot = relative(canonical, folder);
  if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`))
    throw new Error('CAPTURE_ROOT_INVALID');
  await mkdir(folder);
  return folder;
};

export const writeCapture = async (
  folder: string,
  name:
    | 'observation.json'
    | 'design.json'
    | 'viewport.png'
    | 'desktop.json'
    | 'project.json'
    | 'assets.json'
    | 'inspection.json',
  contents: unknown,
): Promise<string> => {
  const path = join(folder, name);
  const bytes =
    contents instanceof Uint8Array ? contents : Buffer.from(`${JSON.stringify(contents)}\n`);
  if (bytes.byteLength > 16_777_216) throw new Error('CAPTURE_TOO_LARGE');
  await new AtomicFileStore().createNew(path, bytes);
  return path;
};

export const writeInspection = async (
  folder: string,
  input: Pick<InspectionV1, 'source' | 'target' | 'fidelity'>,
  names: string[],
) => {
  const artifacts: InspectionV1['artifacts'] = {};
  for (const name of names) {
    if (!/^[a-z-]+\.(?:json|png)$/u.test(name)) throw new Error('INSPECTION_ARTIFACT_INVALID');
    // eslint-disable-next-line no-await-in-loop -- bind every artifact's actual bytes
    const bytes = await readFile(join(folder, name));
    artifacts[name] = {
      path: name,
      bytes: bytes.length,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    };
  }
  return writeCapture(
    folder,
    'inspection.json',
    createInspection({ ...input, capturedAt: new Date().toISOString(), artifacts }),
  );
};
