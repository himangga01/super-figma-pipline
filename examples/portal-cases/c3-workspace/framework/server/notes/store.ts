import { DatabaseSync } from 'node:sqlite';
export type Role = 'member' | 'admin';
export interface User { id: string; username: string; role: Role }
export interface SessionUser extends User { csrf: string }
export interface Note { id: string; title: string; content: string; updatedAt: number }
interface PasswordUser extends User { password_hash: string }

import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

const derive = promisify(scrypt);
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const sameToken = (a: unknown, b: unknown): boolean => typeof a === 'string' && typeof b === 'string' &&
  /^[A-Za-z0-9_-]{43}$/u.test(a) && /^[A-Za-z0-9_-]{43}$/u.test(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function openStore(databasePath: string | undefined) {
  if (!databasePath || !isAbsolute(databasePath)) throw Error('Absolute owned DATABASE_PATH required');
  const path = resolve(databasePath);
  // Native resource admission remains responsible for all ancestor ownership and identity.
  if (resolve(realpathSync(dirname(path))) !== dirname(path)) throw Error('Database parent must be canonical');
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw Error('Regular single-link database required');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  // Runtime is pinned to Node24.21; the reference's Node22 typings omit this newer flag.
  const db = new DatabaseSync(path) as DatabaseSync & { readonly isTransaction: boolean };
  function admitSchema() {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
    if (!tables.length) return;
    if (!tables.includes('schema_version')) throw Error('Unversioned existing schema is unsupported');
    const versions = db.prepare('SELECT version FROM schema_version ORDER BY version').all();
    if (versions.length !== 1 || versions[0].version !== 1) throw Error('Unsupported schema version');
  }
  try {
    // Reject unsupported databases before PRAGMAs or DDL can alter their bytes.
    admitSchema();
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    admitSchema();
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY CHECK(version=1));
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('member','admin')));
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      content TEXT NOT NULL CHECK(length(content)<=8000), updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS notes_owner ON notes(owner_id);
    INSERT OR IGNORE INTO schema_version VALUES(1); COMMIT;`);
    db.exec('PRAGMA journal_mode=WAL;');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close(); throw error;
  }
  return {
    db,
    async createUser(username: string, password: string, role: Role = 'member') {
      if (!/^[a-z][a-z0-9_-]{2,31}$/u.test(username) || typeof password !== 'string' || password.length < 12 || password.length > 256 || !['member', 'admin'].includes(role)) throw Error('Invalid synthetic account');
      const salt = randomBytes(16).toString('hex');
      const key = await derive(password, salt, 64) as Buffer;
      db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(randomUUID(), username, `${salt}:${key.toString('hex')}`, role);
    },
    async login(username: string, password: string) {
      const user = db.prepare('SELECT * FROM users WHERE username=?').get(username) as unknown as PasswordUser | undefined;
      const [salt, encoded] = (user?.password_hash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
      const actual = await derive(password, salt, 64) as Buffer;
      if (!user || !timingSafeEqual(actual, Buffer.from(encoded, 'hex'))) return null;
      db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
      const raw = token(), csrf = token();
      db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(raw), csrf, user.id, Date.now() + 8 * 60 * 60 * 1000);
      return { raw, csrf, user: { id: user.id, username: user.username, role: user.role } };
    },
    session(raw: string | undefined): SessionUser | null {
      if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(raw)) return null;
      return db.prepare(`SELECT users.id,users.username,users.role,sessions.csrf FROM sessions
        JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?`).get(digest(raw), Date.now()) as unknown as SessionUser | undefined ?? null;
    },
    logout(raw: string) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(raw)); },
    list(owner: string): Note[] { return db.prepare('SELECT id,title,content,updated_at AS updatedAt FROM notes WHERE owner_id=? ORDER BY updated_at DESC,id').all(owner) as unknown as Note[]; },
    get(owner: string, id: string): Note | undefined { return db.prepare('SELECT id,title,content,updated_at AS updatedAt FROM notes WHERE owner_id=? AND id=?').get(owner, id) as unknown as Note | undefined; },
    create(owner: string, title: string, content: string): Note {
      const id = randomUUID();
      db.prepare('INSERT INTO notes VALUES(?,?,?,?,?)').run(id, owner, title, content, Date.now());
      return this.get(owner, id)!;
    },
    update(owner: string, id: string, title: string, content: string): Note | null {
      const changed = db.prepare('UPDATE notes SET title=?,content=?,updated_at=? WHERE owner_id=? AND id=?').run(title, content, Date.now(), owner, id).changes;
      return changed ? this.get(owner, id)! : null;
    },
    remove(owner: string, id: string) { return db.prepare('DELETE FROM notes WHERE owner_id=? AND id=?').run(owner, id).changes > 0; },
    close() { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); },
  };
}
