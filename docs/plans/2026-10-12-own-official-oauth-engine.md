# Own-service official Figma OAuth engine

Date: October 12, 2026 (Asia/Seoul).
Read [the current authorization analysis](../analysis/official-mcp-authorization.md), [canonical service analysis](../service-analysis.md), and [repository instructions](../../AGENTS.md).

The service's requested official-MCP workflow still lacks its own login lifecycle. Implement and verify a small session-only engine independently of portal/control wiring. Initial ownership is two new MCP files: `src/official-figma-oauth.ts` and `test/official-figma-oauth.test.ts`. Main/native remain frozen for the recovery integration/check; this candidate stays managed-only until independently reviewed.

The engine must support explicit begin, one-use callback completion, cancel/logout, bounded refresh and a private bearer getter. Require an explicitly configured eligible service client, accepted client authentication and an approved loopback callback before creating an authorization URL or contacting a server. Missing configuration is a typed blocked state. Neither user configuration nor a test fixture establishes actual Figma client eligibility. Never borrow another application's credentials or identity, silently register a client, automatically retry a consumed authorization code, open a browser, or approve consent.

Use the installed SDK's explicit lower-level authorization/exchange/refresh functions with positive authentication-method validation. Validate official issuer/resource/destination metadata, callback identity, state, PKCE, original expiry, cancellation and concurrent/superseded transactions. Keep tokens, verifiers, codes and raw URLs out of status/error/log objects. Session-only secrets remain private and are cleared on cancellation/logout/expiry; persistence and frontend callback wiring are separate later work.

Verify with injected clocks and intercepted fixture requests, including missing gates, mismatched issuer/resource/callback, duplicate or expired callbacks, cancellation and logout during exchanges, refresh races, unsupported authentication methods, one-use code failure and private-value absence. These fixtures must not contact the live official server or count as authenticated capture. Actual login still requires the service's accepted client/redirect/authentication contract and operator consent. Full capture and the required Chrome/MCP parity remain unverified.
