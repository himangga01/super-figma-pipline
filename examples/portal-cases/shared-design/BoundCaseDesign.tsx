import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { CaseScene, CapturedEmailInput } from './CaseScene';
import { composeSourceLayers } from './composition';
import type { CompositionConfig } from './composition';
import { loadOwnCaseFacts } from './load-facts';
import type { CaseFacts, IndexedFacts, SourceComponentRenderer } from './types';
import { useCaseLocale } from './locale';

export interface LandingControls {
  signIn: string[]; home: string[]; forms: string[]; submits: string[];
  emails: Record<string, string>;
  languages?: string[];
}
export interface CaseActionRenderers {
  link(input: { kind: 'login' | 'home'; nodeId: string; label: string; style: CSSProperties; children: ReactNode }): ReactNode;
  form(input: { nodeId: string; style: CSSProperties; children: ReactNode }): ReactNode;
}

/** Own current facts and real case route adapters are required; no local successful-auth state exists. */
export function BoundCaseDesign({ binding, compositionConfig, controls, breakpoint, fixedView, actions, wrapNode }: { binding: CaseFacts['binding']; compositionConfig: CompositionConfig; controls: LandingControls; breakpoint: number; fixedView?: string; actions: CaseActionRenderers; wrapNode?: SourceComponentRenderer }) {
  const [facts, setFacts] = useState<IndexedFacts | null>(null), [error, setError] = useState<Error | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [locale, setLocale] = useCaseLocale(binding.caseId);
  useEffect(() => {
    const controller = new AbortController();
    loadOwnCaseFacts(binding, controller.signal).then(value => { if (!controller.signal.aborted) setFacts(value); }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error : Error('OWN_CASE_FACT_LOAD_FAILED')); });
    return () => controller.abort();
  }, [binding]);
  const composition = useMemo(() => facts ? composeSourceLayers(facts, compositionConfig) : null, [facts, compositionConfig]);
  if (error) throw error;
  if (!facts || !composition) return <main role="status" data-current-facts-ready="false">Loading the current design.</main>;
  for (const id of [...controls.signIn, ...controls.home, ...controls.forms, ...controls.submits, ...(controls.languages ?? []), ...Object.keys(controls.emails), ...Object.values(controls.emails)]) if (!facts.nodeIndex[id]) throw Error('OWN_CASE_CONTROL_NODE_REQUIRED');
  const languageLabels = new Set<string>();
  for (const id of controls.languages ?? []) {
    const visit = (at: string) => {
      const node = facts.nodeIndex[at];
      if (node.properties.type === 'TEXT' && node.properties.characters?.trim() === '한국어') languageLabels.add(at);
      for (const child of node.childIds) visit(child);
    };
    visit(id);
  }
  return <CaseScene facts={facts} composition={composition} desktopView="desktop" mobileView="mobile" breakpoint={breakpoint} fixedView={fixedView} wrapNode={wrapNode} renderControl={({ node, style, children }) => {
    if (controls.languages?.includes(node.id)) return <div className="case-captured-node" data-sfp-node={node.id} data-sfp-type={node.properties.type} data-source-name={node.properties.name} style={style}>{children}<select className="case-language-select" aria-label="Language / 언어" value={locale} onChange={event => setLocale(event.target.value as 'ko' | 'en')}><option value="ko">한국어</option><option value="en">English</option></select></div>;
    if (locale === 'en' && languageLabels.has(node.id)) return <span className="case-captured-node" data-sfp-node={node.id} data-sfp-type={node.properties.type} data-source-name={node.properties.name} style={style}>English</span>;
    if (controls.signIn.includes(node.id)) return actions.link({ kind: 'login', nodeId: node.id, label: 'Sign in to the workspace', style, children });
    if (controls.home.includes(node.id)) return actions.link({ kind: 'home', nodeId: node.id, label: 'Home', style, children });
    if (controls.forms.includes(node.id)) return actions.form({ nodeId: node.id, style, children });
    const placeholderId = controls.emails[node.id];
    if (placeholderId) return <CapturedEmailInput node={node} placeholderId={placeholderId} facts={facts} style={style} label={facts.nodeIndex[placeholderId].properties.characters || 'Email'} value={emails[node.id] ?? ''} onChange={value => setEmails(previous => ({ ...previous, [node.id]: value }))} />;
    if (controls.submits.includes(node.id)) return <button type="submit" className="case-captured-control" data-sfp-node={node.id} data-sfp-type={node.properties.type} data-source-name={node.properties.name} aria-label="Continue" style={style}>{children}</button>;
    return undefined;
  }} />;
}
