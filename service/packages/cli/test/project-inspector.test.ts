import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectProject } from '../src/project-inspector.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('inspection of the actual target repository', () => {
  it('returns code evidence and joins captured components and variables against that repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sfp-project-inspection-'));
    roots.push(root);
    await mkdir(join(root, 'app'));
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { next: '1', react: '1' } }),
    );
    await writeFile(join(root, '.git'), 'gitdir: /outside/main/.git/worktrees/test\n');
    await writeFile(
      join(root, 'app/page.tsx'),
      [
        "import { useState } from 'react';",
        "import Link from 'next/link';",
        "import { useQuery } from '@tanstack/react-query';",
        "import { Button } from '@/Button';",
        "// import fake from 'zustand';",
        "export default function Page() { const [open] = useState(false); return <Button aria-label='Open' variant='primary' />; }",
      ].join('\n'),
    );
    await writeFile(
      join(root, 'Button.tsx'),
      "export const Button = ({ variant }: { variant: 'primary' | 'secondary' }) => <button>{variant}</button>;",
    );
    await writeFile(join(root, 'theme.css'), ':root { --brand: #ff0000; }');
    const result = await inspectProject(root, {
      truncated: false,
      nodes: [
        {
          id: '1:1',
          name: 'Button',
          type: 'INSTANCE',
          mainComponent: { id: '2:1', name: 'Button', key: 'button-key' },
          componentProperties: { variant: { type: 'VARIANT', value: 'primary' } },
        },
      ],
      tokens: [
        {
          id: 'v1',
          name: 'brand',
          resolvedType: 'COLOR',
          variableCollectionId: 'c1',
          valuesByMode: { m1: { r: 1, g: 0, b: 0, a: 1 } },
        },
      ],
      collections: [
        { id: 'c1', name: 'Theme', defaultModeId: 'm1', modes: [{ modeId: 'm1', name: 'Light' }] },
      ],
    });
    expect(result.profile.framework).toBe('next');
    expect(result.mappings.components[0]?.candidate).toMatchObject({
      name: 'Button',
      filePath: 'Button.tsx',
      matchedProps: ['variant'],
    });
    expect(result.mappings.tokens[0]?.candidate?.token).toBe('brand');
    const categories = result.profile.conventions!.categories;
    expect(categories.routing.status).toBe('observed');
    expect(categories.dataAccess.status).toBe('observed');
    expect(categories.accessibility.evidence[0]).toMatchObject({
      filePath: 'app/page.tsx',
      line: 6,
      signal: 'aria-label',
    });
    expect(categories.state.evidence.map(row => row.signal)).toContain('useState');
    expect(categories.state.evidence.map(row => row.signal)).not.toContain('zustand');
    expect(categories.imports.evidence.some(row => row.signal === '@/Button')).toBe(true);
    expect(categories.routing.evidence[0]?.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});
