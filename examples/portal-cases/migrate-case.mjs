import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { lstat } from 'node:fs/promises';
if (!process.env.SFP_NATIVE_MODULE_POLICY || !process.env.SFP_NATIVE_MODULE_POLICY_HASH || !process.env.DATABASE_PATH || !isAbsolute(process.env.DATABASE_PATH)) throw Error('Actual native broker database required');
try { await lstat(join(process.cwd(), '.env')); throw Error('Nonexample environment file forbidden'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const env = { ...process.env, DATABASE_URL: 'file:' + process.env.DATABASE_PATH.replaceAll('\\', '/'), PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' };
const child = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { cwd: process.cwd(), env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let bytes = 0;
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { bytes += chunk.length; if (bytes > 1048576) { child.kill('SIGTERM'); process.exitCode = 1; } });
child.once('error', () => { process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
