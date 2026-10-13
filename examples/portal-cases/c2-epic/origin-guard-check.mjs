import assert from 'node:assert/strict';
import { epicMutationOriginGuard } from './origin-guard.mjs';
const origin = 'http://127.0.0.1:48225';
const handler = epicMutationOriginGuard(origin);
const checks = [];
for (const [method, header, expected] of [['POST', origin, 200], ['POST', 'https://foreign.invalid', 403], ['POST', undefined, 403], ['DELETE', origin + '/', 403], ['GET', undefined, 200]]) {
  let status = 0; const res = { status(value) { status = value; return this; }, json() {} };
  handler({ method, headers: { origin: header } }, res, () => { status = 200; });
  assert.equal(status, expected); checks.push({ method, originCase: header === origin ? 'exact' : header === undefined ? 'absent' : 'foreign', expected, passed: true });
}
assert.throws(() => epicMutationOriginGuard('file:///tmp'), /origin|required/i);
console.log(JSON.stringify({ scope: 'new-c2-middleware-only', servicePipelineAccepted: false, epicJourneyExecuted: false, checks }, null, 2));
