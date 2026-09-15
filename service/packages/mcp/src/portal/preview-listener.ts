import { execFile } from 'node:child_process';
import { join } from 'node:path';
/** A fixed read-only host query. Its executable identity and bytes are approved with the profile. */
export const previewListenerInvocation = (family: 'tcp' | 'tcpv6' = 'tcp') => ({
  protocol: 'windows-preview-listener-v1' as const,
  executable: join(process.env.SystemRoot!, 'System32', 'netstat.exe'),
  args: ['-ano', '-p', family],
});
export function matchingPreviewListenerPids(output: string, url: string): number[] {
  const parsed = new URL(url),
    port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const addresses =
    parsed.hostname === '[::1]'
      ? new Set(['[::1]', '[::]'])
      : parsed.hostname === '127.0.0.1'
        ? new Set(['127.0.0.1', '0.0.0.0', '[::]'])
        : new Set(['127.0.0.1', '0.0.0.0', '[::1]', '[::]']);
  const pids: number[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s*TCP(?:v6)?\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/u.exec(line);
    if (!match) continue;
    const at = match[1]!.lastIndexOf(':');
    if (match[1]!.slice(at + 1) === port && addresses.has(match[1]!.slice(0, at)))
      pids.push(Number(match[2]));
  }
  return pids;
}
export async function assertOwnedPreviewListener(pid: number, url: string): Promise<void> {
  if (process.platform !== 'win32') throw Error('PORTAL_PREVIEW_LISTENER_HOST_UNSUPPORTED');
  const families =
    new URL(url).hostname === '[::1]' ? (['tcpv6'] as const) : (['tcp', 'tcpv6'] as const);
  const outputs = await Promise.all(
    families.map(family => {
      const invocation = previewListenerInvocation(family);
      return new Promise<string>((resolve, reject) =>
        execFile(
          invocation.executable,
          invocation.args,
          { encoding: 'utf8', timeout: 5000, maxBuffer: 1048576, windowsHide: true },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        ),
      );
    }),
  );
  const pids = matchingPreviewListenerPids(outputs.join('\n'), url);
  if (!pids.length || pids.some(value => value !== pid))
    throw Error('PORTAL_PREVIEW_LISTENER_NOT_OWNED');
}
