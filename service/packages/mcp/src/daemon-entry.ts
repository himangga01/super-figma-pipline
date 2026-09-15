import { enableDaemonMode } from './runtime-mode.js';

if (process.argv.includes('--help')) {
  process.stdout.write(
    'sfp-daemon: foreground local service; stop with Ctrl+C. Uses the same authenticated control and relay as MCP.\n',
  );
} else {
  enableDaemonMode();
  await import('./index.js');
}
