import type { CSSProperties, ReactNode } from 'react';
import { Form, Link } from 'react-router';
import { HoneypotInputs } from 'remix-utils/honeypot/react';
import type { LandingRouteContract } from './case-contract';

export function legacyLandingRoutes(username: string | null): LandingRouteContract {
  return {
    authenticated: Boolean(username),
    login: '/login', signup: '/signup',
    notes: username ? '/users/' + encodeURIComponent(username) + '/notes' : '/resources/own-notes',
    registration: { action: '/signup', method: 'post', emailField: 'email' },
  };
}

/** Native-current geometry is supplied by the same case renderer; every action uses Epic handlers. */
export function LegacyLandingLink({ kind, routes, nodeId, style, label, children }: { kind: 'login' | 'signup' | 'notes'; routes: LandingRouteContract; nodeId: string; style: CSSProperties; label: string; children: ReactNode }) {
  return <Link to={routes[kind]} data-sfp-node={nodeId} aria-label={label} className="case-captured-control" style={style}>{children}</Link>;
}
export function LegacySignupForm({ nodeId, style, children }: { nodeId: string; style: CSSProperties; children: ReactNode }) {
  return <Form action="/signup" method="post" data-sfp-node={nodeId} className="case-captured-form" style={style}>
    <HoneypotInputs />{children}
  </Form>;
}
