import { cp, mkdir, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';

if (!process.env.SFP_NATIVE_MODULE_POLICY || !process.env.SFP_NATIVE_MODULE_POLICY_HASH) throw Error('Actual service native module fence required');
const root = process.cwd(), base = resolve(root, 'native-workspace');
const shared = process.env.CASE_DEPENDENCY_SHARED, local = process.env.CASE_DEPENDENCY_LOCAL;
for (const value of [shared, local]) if (!value || !isAbsolute(value) || await realpath(value) !== resolve(value)) throw Error('Exact admitted screened dependency directory required');
const inside = (scope, path) => { const part = relative(scope, path); return !isAbsolute(part) && part !== '..' && !part.startsWith('../') && !part.startsWith('..\\'); };
async function copyPackages(source, target) {
  await cp(source, target, { recursive: true, dereference: false, verbatimSymlinks: true, force: false, errorOnExist: true, filter: path => relative(source, path).split(/[\\/]/u)[0] !== '.vite-temp' });
  const pending = [target]; let entries = 0;
  while (pending.length) {
    if (++entries > 500000) throw Error('Dependency entry bound exceeded');
    const path = pending.pop(), info = await lstat(path);
    if (info.isSymbolicLink()) { if (!inside(base, await realpath(path))) throw Error('Dependency link escapes new owned workspace'); }
    else if (info.isDirectory()) for (const name of await readdir(path)) pending.push(join(path, name));
    else if (!info.isFile() || info.nlink !== 1) throw Error('Unsupported dependency member');
  }
}
await mkdir(join(base, 'source'), { recursive: true });
// Copy the verified staged candidate source, not any reference frontend or private source root.
for (const name of await readdir(root)) {
  if (name === 'native-workspace') continue;
  if (name === '.env' || name === 'node_modules') throw Error('Unexpected unbound staged input');
  await cp(join(root, name), join(base, 'source', name), { recursive: true, dereference: false, errorOnExist: true, force: false });
}
if (shared !== local) await copyPackages(shared, join(base, 'node_modules'));
await copyPackages(local, join(base, 'source', 'node_modules'));
console.log(JSON.stringify({ provisioned: true, source: 'verified-staged-candidate', copiedReferenceFrontend: false, installedOrDownloaded: false }));
