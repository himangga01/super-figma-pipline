import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = (path: string) => readFile(resolve(import.meta.dirname, '../../src', path), 'utf8');

describe('production invocation authority boundary', () => {
  it('routes entry modules through the execution plane without Relay/runtime bypasses', async () => {
    const [index, leader] = await Promise.all([
      source('index.ts'),
      source('election/leader-endpoints.ts'),
    ]);

    expect(index).not.toMatch(/executeLegacyRuntime|dispatchTool\(/u);
    expect(index).not.toMatch(/from ['"]\.\/dispatch\.js['"]/u);
    expect(leader).not.toMatch(/\.relay\.sendRequest/u);
    expect(`${index}\n${leader}`).toMatch(/executionPlane|ExecutionPlane/u);
  });

  it('imports no private Task6.1 auth/key/encryption implementation', async () => {
    const entrySources = await Promise.all([
      source('index.ts'),
      source('dispatch.ts'),
      source('execution/follower-invocation-endpoint.ts').catch(() => ''),
    ]);
    expect(entrySources.join('\n')).not.toMatch(/follower-auth|local-access|request-limits/u);
    expect(await source('election/leader-endpoints.ts')).not.toMatch(/follower-auth/u);
  });

  it('keeps the legacy follower adapter byte-identical', async () => {
    const bytes = await readFile(resolve(import.meta.dirname, '../../src/election/follower.ts'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '0afa7a038644fc2e88d03cd9d4388d90b39f7829422a18ce2028588bd2fa2ad7',
    );
  });
});
