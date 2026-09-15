/* eslint-disable no-await-in-loop -- exact sorted checksum publication */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { artifactRoot, sha256, publish } from './release-common.mjs';
const rows = [];
for (const name of ['artifact-manifest.v1.json', 'cli.tgz', 'mcp.tgz', 'plugin.zip'])
  rows.push(`${sha256(await readFile(join(artifactRoot, name)))}  ${name}`);
await publish(join(artifactRoot, 'SHA256SUMS'), Buffer.from(`${rows.join('\n')}\n`));
