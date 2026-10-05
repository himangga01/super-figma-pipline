import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import { waitForDurableAdmission } from '../../src/execution/admission-wait.js';

it('returns immediately for a durable record or an already settled producer', async () => {
  let reads = 0;
  await waitForDurableAdmission(() => ++reads > 0);
  expect(reads).toBe(1);
});

it('bounds memory and polling while durable admission is delayed', async () => {
  const module = new URL('../../src/execution/admission-wait.ts', import.meta.url).href;
  const code = `
    import {waitForDurableAdmission} from ${JSON.stringify(module)};
    let ready=false, polls=0, returned=false;
    global.gc();
    const before=process.memoryUsage().heapUsed;
    const pending=waitForDurableAdmission(()=>{polls++;return ready;}).then(()=>{returned=true;});
    await new Promise(resolve=>setTimeout(resolve,500));
    global.gc();
    const growth=process.memoryUsage().heapUsed-before;
    const premature=returned;
    ready=true;
    await pending;
    console.log(JSON.stringify({growth,polls,premature,returned}));
  `;
  const result = await promisify(execFile)(
    process.execPath,
    ['--expose-gc', '--max-old-space-size=64', '--input-type=module', '-e', code],
    { windowsHide: true, timeout: 10_000, maxBuffer: 65_536 },
  );
  const observed = JSON.parse(result.stdout) as {
    growth: number;
    polls: number;
    premature: boolean;
    returned: boolean;
  };
  expect(observed.premature).toBe(false);
  expect(observed.returned).toBe(true);
  expect(observed.growth).toBeLessThan(4 * 1024 * 1024);
  expect(observed.polls).toBeLessThan(80);
});
