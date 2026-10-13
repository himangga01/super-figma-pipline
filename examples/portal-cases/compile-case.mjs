import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const c2 = process.env.PORTAL_CASE === 'c2';
if (!c2 && process.env.PORTAL_CASE !== 'c3') throw Error('Actual C2/C3 native case required');
const cli = c2 ? 'node_modules/@react-router/dev/bin.js' : 'node_modules/@react-router/dev/bin.cjs';
const diagnostics = join(process.cwd(), 'compiler-diagnostics'); await mkdir(diagnostics);
let stage = 0;
for (const args of [[cli, 'typegen', '--mode', 'development'], ['node_modules/typescript/lib/tsc.js', ...(c2 ? ['--noEmit'] : ['-b'])], [cli, 'build', '--mode', 'production']]) {
  const name = ['typegen', 'typecheck', 'build'][stage++];
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0, stdout = '', stderr = '';
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes <= 1048576) stdout += chunk; else child.kill('SIGTERM'); });
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes <= 1048576) stderr += chunk; else child.kill('SIGTERM'); });
    child.once('error', reject); child.once('exit', async (code, signal) => {
      try {
        const locations = [...(stdout + '\n' + stderr).matchAll(/^(.{1,512})\((\d+),(\d+)\): error (TS\d+):/gmu)].slice(0, 128).map(match => ({ path: match[1], line: Number(match[2]), column: Number(match[3]), code: match[4] }));
        const receipt = { stage: name, code, signal, outputBytes: bytes, stdoutHash: createHash('sha256').update(stdout).digest('hex'), stderrHash: createHash('sha256').update(stderr).digest('hex'), locations };
        // Full bounded compiler logs stay in declared private generated output, never public docs.
        await writeFile(join(diagnostics, name + '.private.json'), JSON.stringify({ ...receipt, stdout, stderr }) + '\n', { flag: 'wx' });
        console.log(JSON.stringify({ ...receipt, privateReceipt: 'compiler-diagnostics/' + name + '.private.json' }));
        if (code === 0 && bytes <= 1048576) done(); else reject(Error('Actual ' + name + ' compiler command failed; inspect private receipt'));
      } catch (error) { reject(error); }
    });
  });
}
console.log(JSON.stringify({ typegen: true, typecheck: true, build: true, packageScriptsInvoked: false }));
