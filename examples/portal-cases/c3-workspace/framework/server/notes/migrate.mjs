import { openStore } from './store.mjs';
const store = openStore(process.env.DATABASE_PATH);
try { console.log(JSON.stringify({ schemaVersion: store.db.prepare('SELECT version FROM schema_version').get()?.version })); }
finally { store.close(); }
