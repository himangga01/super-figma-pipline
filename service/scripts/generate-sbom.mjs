import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { root, sha256, isoTime, installedPackages, publishDocument } from './release-common.mjs';
const packages = await installedPackages();
const lock = await readFile(join(root, 'pnpm-lock.yaml'));
const document = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: 'Super Figma Pipeline installed production dependency inventory',
  documentNamespace: `https://super-figma-pipeline.local/spdx/${sha256(lock)}`,
  creationInfo: { created: isoTime, creators: ['Tool: sfp-generate-sbom'] },
  documentComment:
    'Installed production dependencies, including bundled plugin/CLI dependencies. Platform optional packages absent on this builder are not represented. Exact resolution is pinned by pnpm-lock.yaml.',
  packages: packages.map(item => ({
    SPDXID: `SPDXRef-${sha256(`${item.name}@${item.version}`).slice(0, 24)}`,
    name: item.name,
    versionInfo: item.version,
    downloadLocation: item.resolved,
    filesAnalyzed: false,
    licenseDeclared: item.license,
    licenseConcluded: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
  })),
  relationships: packages.map(item => ({
    spdxElementId: 'SPDXRef-DOCUMENT',
    relationshipType: 'DESCRIBES',
    relatedSpdxElement: `SPDXRef-${sha256(`${item.name}@${item.version}`).slice(0, 24)}`,
  })),
};
await publishDocument('SBOM.spdx.json', `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`SBOM: ${packages.length} installed production packages\n`);
