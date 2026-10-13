import express from 'express';
import { openStore } from './server/notes/store.mjs';
import { createNotesHandler } from './server/notes/handler.mjs';

// Independent reference-compatible entry. The generated renderer is part of this target.
// No reference workspace or historical template frontend is loaded at runtime.
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Explicit owned PORT required');
const renderer = await import('./build/server/index.js');
if (typeof renderer.app !== 'function') throw Error('Actual generated SSR app export required');
const store = openStore(process.env.DATABASE_PATH);
const app = express(); app.disable('x-powered-by');
let api;
app.use((req, res, next) => {
  if (!req.url.startsWith('/api/')) return next();
  return api(req, res, next);
});
app.use('/assets', express.static('build/client/assets', { immutable: true, maxAge: '1y', fallthrough: false }));
app.use(express.static('build/client', { maxAge: '1h' }));
app.use(renderer.app);
app.use((_error, _req, res, _next) => { res.status(500).type('text/plain').send('Application request failed'); });
const server = app.listen(port, '127.0.0.1', () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  api = createNotesHandler(store, { origin });
  console.log(JSON.stringify({ event: 'ready', origin, renderer: 'owned-generated-target' }));
});
server.requestTimeout = 10000; server.headersTimeout = 10000;
server.once('error', () => { store.close(); process.exitCode = 1; });
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  server.close(() => store.close()); server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), 3000).unref();
}
process.once('SIGTERM', stop); process.once('SIGINT', stop);
