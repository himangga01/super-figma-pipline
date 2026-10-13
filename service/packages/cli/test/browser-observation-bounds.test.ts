import { setImmediate } from 'node:timers/promises';

import type { Page } from 'playwright';
import { expect, it } from 'vitest';

import { observeFigmaPage } from '../src/browser-session.js';
import { parseFigmaTarget } from '../src/figma-url.js';

const target = parseFigmaTarget('https://www.figma.com/design/FixtureFile1234?node-id=0-1');

it('abandons a stalled readiness read and dispatches no later browser calls after cancellation', async () => {
  const controller = new AbortController();
  let release!: (value: number) => void;
  const held = new Promise<number>(resolve => {
    release = resolve;
  });
  const calls: string[] = [];
  const page = {
    url: () => target.url,
    getByRole: () => ({
      count: () => {
        calls.push('count');
        return held;
      },
    }),
    getByText: () => ({
      count: async () => {
        calls.push('later-count');
        return 0;
      },
    }),
    title: async () => {
      calls.push('title');
      return 'Fixture';
    },
  } as unknown as Page;
  const result = observeFigmaPage(page, target, { signal: controller.signal }).then(
    () => 'resolved',
    error => error.message as string,
  );
  controller.abort(new Error('OWNER_CANCELLED'));
  await setImmediate();
  const beforeRelease = await Promise.race([result, Promise.resolve('pending')]);
  release(0);
  await result;
  expect(beforeRelease).toBe('OWNER_CANCELLED');
  expect(calls).toEqual(['count']);
});

it('refuses an expired observation before dispatching any browser lookup', async () => {
  let calls = 0;
  const page = {
    url: () => target.url,
    getByRole: () => {
      calls++;
      throw new Error('UNEXPECTED_BROWSER_LOOKUP');
    },
  } as unknown as Page;
  await expect(observeFigmaPage(page, target, { deadlineAt: Date.now() - 1 })).rejects.toThrow(
    'FIGMA_OBSERVATION_TIMEOUT',
  );
  expect(calls).toBe(0);
});
