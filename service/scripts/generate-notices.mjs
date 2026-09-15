/* eslint-disable no-await-in-loop -- sorted license text is deterministic */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { installedPackages, publishDocument } from './release-common.mjs';
const sections = [
  '# Third party notices\n\nPinned upstream license texts are included in licenses/. The following notices cover installed production dependencies used by the service and bundled UI.',
];
for (const item of await installedPackages()) {
  if (item.name.startsWith('@sfp/') || item.name === 'super-figma-pipeline') continue;
  const names = (await readdir(item.path))
    .filter(name => /^(?:licen[sc]e|copying|notice)(?:[.-].*)?$/iu.test(name))
    .toSorted();
  sections.push(`## ${item.name} ${item.version}\n\nDeclared license: ${item.license}\n`);
  for (const name of names) {
    try {
      sections.push(`### ${name}\n\n${await readFile(join(item.path, name), 'utf8')}`);
    } catch (error) {
      if (error.code !== 'EISDIR') throw error;
    }
  }
}
await publishDocument('THIRD_PARTY_NOTICES.md', `${sections.join('\n\n')}\n`);
