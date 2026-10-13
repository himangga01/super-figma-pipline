import { createServer } from 'node:http';
import { openStore } from './store.mjs';
import { createNotesHandler } from './handler.mjs';

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Explicit owned PORT required');
const store = openStore(process.env.DATABASE_PATH);
let handler;
const server = createServer((req, res) => handler(req, res));
server.requestTimeout = 10000; server.headersTimeout = 10000;
server.on('error', () => { store.close(); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createNotesHandler(store, { origin });
  console.log(JSON.stringify({ event: 'ready', origin }));
});
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  server.close(() => { store.close(); });
  server.closeIdleConnections();
  setTimeout(() => { server.closeAllConnections(); }, 3000).unref();
}
process.once('SIGTERM', stop); process.once('SIGINT', stop);
