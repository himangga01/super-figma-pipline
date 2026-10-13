import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { CaseScene, CapturedEmailInput } from './CaseScene';
import { composeSourceLayers } from './composition';
import type { CompositionConfig } from './composition';
import { loadOwnCaseFacts } from './load-facts';
import type { CaseFacts, IndexedFacts } from './types';

export interface LandingControls {
  signIn: string[]; home: string[]; forms: string[]; submits: string[];
  emails: Record<string, string>;
}
export interface CaseActionRenderers {
  link(input: { kind: 'login' | 'home'; nodeId: string; label: string; style: CSSProperties; children: ReactNode }): ReactNode;
  form(input: { nodeId: string; style: CSSProperties; children: ReactNode }): ReactNode;
}

/** Own current facts and real case route adapters are required; no local successful-auth state exists. */
export function BoundCaseDesign({ binding, compositionConfig, controls, breakpoint, fixedView, actions }: { binding: CaseFacts['binding']; compositionConfig: CompositionConfig; controls: LandingControls; breakpoint: number; fixedView?: string; actions: CaseActionRenderers }) {
  const [facts, setFacts] = useState<IndexedFacts | null>(null), [error, setError] = useState<Error | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    loadOwnCaseFacts(binding, controller.signal).then(value => { if (!controller.signal.aborted) setFacts(value); }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error : Error('OWN_CASE_FACT_LOAD_FAILED')); });
    return () => controller.abort();
  }, [binding]);
  const composition = useMemo(() => facts ? composeSourceLayers(facts, compositionConfig) : null, [facts, compositionConfig]);
  if (error) throw error;
  if (!facts || !composition) return <main role="status" data-current-facts-ready="false">Loading the current design.</main>;
  for (const id of [...controls.signIn, ...controls.home, ...controls.forms, ...controls.submits, ...Object.keys(controls.emails), ...Object.values(controls.emails)]) if (!facts.nodeIndex[id]) throw Error('OWN_CASE_CONTROL_NODE_REQUIRED');
  return <CaseScene facts={facts} composition={composition} desktopView="desktop" mobileView="mobile" breakpoint={breakpoint} fixedView={fixedView} renderControl={({ node, style, children }) => {
    if (controls.signIn.includes(node.id)) return actions.link({ kind: 'login', nodeId: node.id, label: 'Sign in to the workspace', style, children });
    if (controls.home.includes(node.id)) return actions.link({ kind: 'home', nodeId: node.id, label: 'Home', style, children });
    if (controls.forms.includes(node.id)) return actions.form({ nodeId: node.id, style, children });
    const placeholderId = controls.emails[node.id];
    if (placeholderId) return <CapturedEmailInput node={node} placeholderId={placeholderId} facts={facts} style={style} label={facts.nodeIndex[placeholderId].properties.characters || 'Email'} value={emails[node.id] ?? ''} onChange={value => setEmails(previous => ({ ...previous, [node.id]: value }))} />;
    if (controls.submits.includes(node.id)) return <button type="submit" className="case-captured-control" data-sfp-node={node.id} data-sfp-type={node.properties.type} data-source-name={node.properties.name} aria-label="Continue" style={style}>{children}</button>;
    return undefined;
  }} />;
}
