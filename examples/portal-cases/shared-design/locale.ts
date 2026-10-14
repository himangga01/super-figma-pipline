import { useEffect, useState } from 'react';

export type CaseLocale = 'ko' | 'en';
const changedEvent = 'sfp-case-locale-changed';
const storageKey = (caseId: string) => 'sfp.case.' + caseId + '.locale';

/** Only the public presentation preference is retained; account/session data stays server-owned. */
export function useCaseLocale(caseId: string): [CaseLocale, (value: CaseLocale) => void] {
  const [locale, setLocale] = useState<CaseLocale>('ko');
  useEffect(() => {
    const refresh = () => {
      try { setLocale(localStorage.getItem(storageKey(caseId)) === 'en' ? 'en' : 'ko'); }
      catch { /* The current in-memory presentation still works. */ }
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ caseId: string; locale: CaseLocale }>).detail;
      if (detail?.caseId === caseId && ['ko', 'en'].includes(detail.locale)) setLocale(detail.locale);
    };
    refresh(); window.addEventListener(changedEvent, changed); window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(changedEvent, changed); window.removeEventListener('storage', refresh); };
  }, [caseId]);
  return [locale, value => {
    if (!['ko', 'en'].includes(value)) throw Error('OWN_CASE_LOCALE_INVALID');
    setLocale(value);
    try { localStorage.setItem(storageKey(caseId), value); } catch { /* Retain the selection in memory. */ }
    window.dispatchEvent(new CustomEvent(changedEvent, { detail: { caseId, locale: value } }));
  }];
}
