import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createStatePermissions } from '../../mcp/src/security/state-permissions.js';
import { ControlClient } from './control-client.js';
import { runtimePaths } from './server-session.js';

/** A short-lived one-use code is delivered through the owner's local development bundle only. */
export const prepareDesktopPlugin = async (client: ControlClient): Promise<string> => {
  const permissions = createStatePermissions(client.stateRoot);
  const folder = join(client.stateRoot, 'desktop-plugin');
  await permissions.verifySecure(client.stateRoot);
  await mkdir(folder, { mode: 0o700 }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
  await permissions.ensureSecure(folder);
  const { pluginRoot: source } = await runtimePaths();
  const code = await client.pairCode();
  const html = await readFile(join(source, 'dist/index.html'), 'utf8');
  const seeded = html.replace(
    '<head>',
    `<head><script id="sfp-pair-bootstrap" type="application/json">${JSON.stringify({ pairCode: code })}</script>`,
  );
  if (seeded === html) throw new Error('PLUGIN_BUILD_HEAD_MISSING');
  const publish = async (name: string, bytes: string | Uint8Array): Promise<void> => {
    const temporary = join(folder, `.${name}.${randomBytes(12).toString('hex')}.tmp`);
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
      await permissions.ensureSecure(temporary);
      await permissions.verifySecure(temporary);
      await rename(temporary, join(folder, name));
    } finally {
      await unlink(temporary).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
  };
  await publish('code.js', await readFile(join(source, 'dist/code.js')));
  await publish('index.html', seeded);
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  await publish(
    'manifest.json',
    `${JSON.stringify({ ...manifest, main: 'code.js', ui: 'index.html' }, null, 2)}\n`,
  );
  return join(folder, 'manifest.json');
};
