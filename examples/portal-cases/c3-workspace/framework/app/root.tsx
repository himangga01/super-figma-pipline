import type { ReactNode } from 'react';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse } from 'react-router';

export function Layout({ children }: { children: ReactNode }) {
  return <html lang="ko"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><Meta /><Links /></head>
    <body>{children}<ScrollRestoration /><Scripts /></body></html>;
}
export default function App() { return <Outlet />; }
export function ErrorBoundary({ error }: { error: unknown }) {
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <main><h1>{missing ? 'Page not found' : 'The page could not be loaded'}</h1><a href="/">Return home</a></main>;
}
