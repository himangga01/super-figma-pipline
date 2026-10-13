import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.env.SFP_NATIVE_MODULE_POLICY || !['c2', 'c3'].includes(process.env.PORTAL_CASE)) throw Error('Actual service native case required');
const root = resolve(process.cwd(), 'native-workspace/source');
process.chdir(root);
// Same Node process owns the actual listener, matching the service preview PID protocol.
await import(pathToFileURL(resolve(root, process.env.PORTAL_CASE === 'c2' ? 'index.ts' : 'server.js')).href);
