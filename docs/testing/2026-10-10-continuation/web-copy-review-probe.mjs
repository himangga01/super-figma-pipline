// Browser-free control-flow probe for the source hash recorded in web-copy-review.md.
// Run from the repository root. Optional first argument selects another collector source file.
// No Chrome connection, clipboard reads, or actual artifact writes are performed.
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import vm from 'node:vm';

const sourcePath = resolve(process.argv[2] ?? '.worktrees/baseline/service/packages/cli/src/figma-web-copy.ts');
const source = readFileSync(sourcePath, 'utf8');
const hash = createHash('sha256').update(source).digest('hex');
console.log(JSON.stringify({ sourcePath, sha256: hash }));
const code = stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*?;\r?\n/gms, '')
  .replace('export async function copyFigmaWebAsset', 'async function copyFigmaWebAsset');
const waitCode = stripTypeScriptTypes(readFileSync(join(dirname(sourcePath), 'logical-wait.ts'), 'utf8'), { mode: 'transform' })
  .replace('export const waitLogically', 'const waitLogically');

const target = {
  fileKey: 'ownedFixtureKey', nodeId: '1:2',
  url: 'https://www.figma.com/design/ownedFixtureKey?node-id=1-2',
};
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>';

function fixture(onCopy) {
  const stored = [], forwarded = [];
  const clipboard = {
    write: async () => { forwarded.push('write'); },
    writeText: async () => { forwarded.push('writeText'); },
  };
  class DataTransfer {
    setData(type) { forwarded.push(type); }
  }
  const context = vm.createContext({
    Buffer, Uint8Array, TextEncoder, Blob, Date, Error, Object, Reflect, String,
    Math, Promise, Array, JSON, AbortController, AbortSignal, setTimeout, clearTimeout,
    navigator: { clipboard }, DataTransfer, window: {},
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    createHash, randomBytes, join, delay,
    parseFigmaTarget: url => ({ ...target, url }),
    AtomicFileStore: class {
      async createNew(path, bytes) { stored.push({ path, bytes: bytes.length }); }
    },
  });
  vm.runInContext(waitCode + '\n' + code + ';globalThis.capture = copyFigmaWebAsset;', context);
  const locator = {
    click: async () => {}, isEnabled: async () => true,
    getAttribute: async () => 'false',
    press: async key => { if (key === 'Enter') onCopy(context); },
    evaluateAll: async () => [],
  };
  locator.getByRole = () => locator;
  const page = {
    url: () => target.url,
    evaluate: async (fn, argument) => fn(argument),
    keyboard: { press: async () => {} },
    getByRole: () => locator,
    locator: () => ({ ariaSnapshot: async () => '' }),
  };
  return { context, page, stored, forwarded };
}

let writeSettled = false;
const race = fixture(context => {
  context.navigator.clipboard.write([
    { types: ['text/plain'], getType: async () => new Blob([svg]) },
    { types: ['text/plain'], getType: async () => { await delay(600); return new Blob([svg]); } },
  ]).finally(() => { writeSettled = true; });
});
try {
  const result = await race.context.capture(race.page, target, 'svg', 'in-memory', { deadlineAt: Date.now() + 2000 });
  console.log(JSON.stringify({ probe: 'delayed-second-item', accepted: result.source, writeSettledAtReturn: writeSettled, filesWritten: race.stored.length }));
} catch (error) {
  console.log(JSON.stringify({ probe: 'delayed-second-item', rejected: error.message, writeSettled }));
}
await delay(700);

const legacy = fixture(context => {
  const data = new context.DataTransfer();
  data.setData('text/html', '<b>Figma copy payload</b>');
  data.setData('text/plain', svg);
});
try {
  const result = await legacy.context.capture(legacy.page, target, 'svg', 'in-memory', { deadlineAt: Date.now() + 2000 });
  console.log(JSON.stringify({ probe: 'legacy-mixed-mime', accepted: result.source, forwardedDataTransferTypes: legacy.forwarded }));
} catch (error) {
  console.log(JSON.stringify({ probe: 'legacy-mixed-mime', rejected: error.message, forwardedDataTransferTypes: legacy.forwarded }));
}

const stalled = fixture(() => {});
stalled.page.evaluate = () => new Promise(() => {});
const started = Date.now();
const pending = stalled.context.capture(stalled.page, target, 'svg', 'in-memory', { deadlineAt: started + 25 });
const outcome = await Promise.race([
  pending.then(() => 'resolved', () => 'rejected'),
  delay(150).then(() => 'still-pending'),
]);
console.log(JSON.stringify({ probe: 'stalled-evaluate', deadlineMs: 25, observedMs: Date.now() - started, outcome }));
