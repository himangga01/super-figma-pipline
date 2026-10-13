import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../store.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(join(root, '.migration-'));
const checks = [];
for (const [label, sql] of [
  ['unsupported-version', 'CREATE TABLE schema_version(version INTEGER); INSERT INTO schema_version VALUES(2);'],
  ['multiple-versions', 'CREATE TABLE schema_version(version INTEGER); INSERT INTO schema_version VALUES(1),(2);'],
  ['empty-version', 'CREATE TABLE schema_version(version INTEGER);'],
  ['unversioned-data', "CREATE TABLE legacy_data(value TEXT); INSERT INTO legacy_data VALUES('preserve');"],
]) {
  const path = join(scratch, label + '.sqlite');
  const initial = new DatabaseSync(path); initial.exec(sql); initial.close();
  const before = await readFile(path);
  assert.throws(() => openStore(path), /unsupported/i);
  assert.deepEqual(await readFile(path), before);
  const readOnly = new DatabaseSync(path, { readOnly: true });
  assert.equal(readOnly.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('users','notes','sessions')").get().n, 0); readOnly.close();
  checks.push({ id: label + '-rejected-before-mutation', passed: true });
}
const fresh = join(scratch, 'fresh.sqlite');
const first = openStore(fresh); first.close();
const second = openStore(fresh); assert.equal(second.db.prepare('SELECT version FROM schema_version').get().version, 1); second.close();
checks.push({ id: 'fresh-and-existing-version-one-migration', passed: true });
const receipt = { at: new Date().toISOString(), reason: 'Root review identified unsupported/multiple version admission after mutation', scope: 'new-migration-only', servicePipelineAccepted: false, checks };
await writeFile(join(scratch, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...receipt, receipt: join(scratch, 'receipt.json') }, null, 2));
