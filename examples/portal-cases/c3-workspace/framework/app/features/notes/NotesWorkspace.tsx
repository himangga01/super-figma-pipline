import React, { useEffect, useRef, useState } from 'react';
import { createNotesClient } from './notes-client';
import './notes-workspace.css';
import type { User, Note } from '../../server-types';
import type { NotesClient } from './notes-client';
import type { FormEvent } from 'react';
interface NoteDraft { id: string | null; title: string; content: string }
interface Props { locale?: 'ko' | 'en'; client?: NotesClient }


const blank: NoteDraft = { id: null, title: '', content: '' };
const messages = {
  ko: { heading: '작업 노트', signIn: '로그인', username: '사용자 이름', password: '비밀번호', signOut: '로그아웃', title: '제목', content: '내용', save: '저장', create: '새 노트', remove: '삭제', refresh: '새로고침', loading: '불러오는 중', busy: '처리 중', empty: '저장된 노트가 없습니다.', failed: '요청을 완료하지 못했습니다. 다시 시도해 주세요.', expired: '세션이 만료되었습니다. 다시 로그인해 주세요.', invalid: '제목은 1~120자, 내용은 8,000자 이하로 입력해 주세요.', saved: '노트를 저장했습니다.', deleted: '노트를 삭제했습니다.', dismiss: '취소', removeQuestion: '이 노트를 삭제할까요?', account: '현재 사용자' },
  en: { heading: 'Workspace notes', signIn: 'Sign in', username: 'Username', password: 'Password', signOut: 'Sign out', title: 'Title', content: 'Content', save: 'Save', create: 'New note', remove: 'Delete', refresh: 'Refresh', loading: 'Loading', busy: 'Working', empty: 'No saved notes yet.', failed: 'The request could not be completed. Try again.', expired: 'Your session expired. Sign in again.', invalid: 'Enter a title of 1–120 characters and content of at most 8,000 characters.', saved: 'Note saved.', deleted: 'Note deleted.', dismiss: 'Cancel', removeQuestion: 'Delete this note?', account: 'Current user' },
};

function validNotes(value: unknown): Note[] {
  const data = value as { notes?: unknown };
  if (!Array.isArray(data?.notes) || data.notes.some((note: unknown) => { const item = note as Partial<Note>; return  typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.content !== 'string'; })) throw Error('INVALID_NOTES_RESPONSE');
  return data.notes as Note[];
}

/** C3 server-backed UI. It uses the owned server's same-origin API, not C4 demo state. */
export function NotesWorkspace({ locale = 'ko', client: suppliedClient }: Props) {
  const client = useRef<NotesClient>(suppliedClient ?? createNotesClient()).current;
  const copy = messages[locale] ?? messages.ko;
  const [user, setUser] = useState<User | null>(null), [ready, setReady] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]), [draft, setDraft] = useState<NoteDraft>(blank);
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const sequence = useRef(0), locked = useRef(false), titleInput = useRef<HTMLInputElement>(null), alert = useRef<HTMLParagraphElement>(null), deleteButton = useRef<HTMLButtonElement>(null);

  function clearPrivateState() { setUser(null); setNotes([]); setDraft(blank); setPassword(''); setDeleting(null); }
  function reportFailure(problem: unknown) {
    const reason = problem as { status?: number; message?: string };
    if (reason?.status === 401) { clearPrivateState(); setError(reason.message === 'INVALID_CREDENTIALS' ? (locale === 'en' ? 'Check your username and password.' : '사용자 이름과 비밀번호를 확인해 주세요.') : copy.expired); }
    else setError(copy.failed);
    requestAnimationFrame(() => alert.current?.focus());
  }
  async function execute(action: (active: () => boolean) => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    const current = ++sequence.current;
    setBusy(true); setError(''); setNotice('');
    try { await action(() => current === sequence.current); }
    catch (reason) { if (current === sequence.current) reportFailure(reason); }
    finally { if (current === sequence.current) { locked.current = false; setBusy(false); } }
  }

  useEffect(() => {
    const current = ++sequence.current;
    (async () => {
      try {
        const session = await client.session();
        const nextNotes = session.user ? validNotes(await client.list()) : [];
        if (current !== sequence.current) return;
        setUser(session.user); setNotes(nextNotes);
      } catch (reason) { if (current === sequence.current) reportFailure(reason); }
      finally { if (current === sequence.current) setReady(true); }
    })();
    return () => { sequence.current++; };
  }, [client]);

  useEffect(() => { if (deleting) requestAnimationFrame(() => deleteButton.current?.focus()); }, [deleting]);

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const attemptedPassword = password;
    setPassword('');
    execute(async active => {
      const session = await client.login(username.trim(), attemptedPassword);
      const nextNotes = validNotes(await client.list());
      if (active()) { setUser(session.user); setNotes(nextNotes); setDraft(blank); }
    });
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim() || draft.title.length > 120 || draft.content.length > 8000) { setError(copy.invalid); titleInput.current?.focus(); return; }
    const submitted = { ...draft, title: draft.title.trim() };
    execute(async active => {
      const result = submitted.id ? await client.update(submitted.id, submitted.title, submitted.content) : await client.create(submitted.title, submitted.content);
      const nextNotes = validNotes(await client.list());
      if (active()) { setDraft(result.note); setNotes(nextNotes); setNotice(copy.saved); }
    });
  }
  function remove() {
    if (!deleting) return;
    const id = deleting.id;
    execute(async active => {
      await client.remove(id);
      const nextNotes = validNotes(await client.list());
      if (active()) { setDeleting(null); setNotes(nextNotes); if (draft.id === id) setDraft(blank); setNotice(copy.deleted); titleInput.current?.focus(); }
    });
  }

  return <section className="notes-workspace" data-testid="notes-workspace" aria-labelledby="notes-heading" aria-busy={busy}>
    <header className="notes-heading"><h2 id="notes-heading">{copy.heading}</h2>{user && <div><span>{copy.account}: {user.username}</span><button type="button" disabled={busy} data-testid="notes-logout" onClick={() => execute(async active => { await client.logout(); if (active()) clearPrivateState(); })}>{copy.signOut}</button></div>}</header>
    {error && <p ref={alert} tabIndex={-1} role="alert" data-testid="notes-error">{error}</p>}
    <p className="notes-status" role="status" aria-live="polite">{busy ? copy.busy : notice}</p>
    {!ready ? <p>{copy.loading}</p> : !user ? <form onSubmit={signIn} className="notes-login" aria-label={copy.signIn}>
      <label htmlFor="notes-username">{copy.username}</label><input id="notes-username" name="username" value={username} required autoComplete="username" minLength={3} maxLength={32} disabled={busy} onChange={event => setUsername(event.target.value)} />
      <label htmlFor="notes-password">{copy.password}</label><input id="notes-password" name="password" type="password" value={password} required autoComplete="current-password" maxLength={256} disabled={busy} onChange={event => setPassword(event.target.value)} />
      <button type="submit" disabled={busy} data-testid="notes-login">{copy.signIn}</button>
    </form> : <div className="notes-columns">
      <aside><div className="notes-actions"><button type="button" disabled={busy} onClick={() => { setDraft(blank); setError(''); setNotice(''); titleInput.current?.focus(); }}>{copy.create}</button><button type="button" disabled={busy} onClick={() => execute(async active => { const next = validNotes(await client.list()); if (active()) setNotes(next); })}>{copy.refresh}</button></div>
        {!notes.length ? <p>{copy.empty}</p> : <ul>{notes.map(note => <li key={note.id}><button type="button" disabled={busy} aria-current={draft.id === note.id ? 'true' : undefined} onClick={() => { setDraft({ ...note }); setNotice(''); titleInput.current?.focus(); }}>{note.title}</button></li>)}</ul>}
      </aside>
      <form onSubmit={save} className="notes-editor" data-testid="notes-editor"><label htmlFor="notes-title">{copy.title}</label><input ref={titleInput} id="notes-title" name="title" value={draft.title} required maxLength={120} disabled={busy} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} />
        <label htmlFor="notes-content">{copy.content}</label><textarea id="notes-content" name="content" value={draft.content} maxLength={8000} disabled={busy} onChange={event => setDraft(value => ({ ...value, content: event.target.value }))} />
        <div className="notes-actions"><button type="submit" disabled={busy} data-testid="notes-save">{copy.save}</button>{draft.id && <button type="button" disabled={busy} data-testid="notes-delete" onClick={() => { if (draft.id) setDeleting({ id: draft.id, title: draft.title }); }}>{copy.remove}</button>}</div>
        {deleting && <div className="notes-delete-confirmation"><p>{copy.removeQuestion} {deleting.title}</p><button ref={deleteButton} type="button" disabled={busy} data-testid="notes-confirm-delete" onClick={remove}>{copy.remove}</button><button type="button" disabled={busy} onClick={() => { setDeleting(null); titleInput.current?.focus(); }}>{copy.dismiss}</button></div>}
      </form>
    </div>}
  </section>;
}
