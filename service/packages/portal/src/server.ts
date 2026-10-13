import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, extname, join, relative } from 'node:path';

import { z } from 'zod';

import {
  FigmaOAuthHandoffInputSchema,
  parseFigmaOAuth,
  type FigmaOAuthStatus,
} from '../../mcp/src/control/figma-oauth-contract.js';
import { Diagnostics, diagnose, observeHttp } from '../../mcp/src/diagnostics.js';
import { PortalBridge } from './bridge.js';
import {
  parse,
  PortalError,
  publicError,
  validateWorkflow,
  WorkflowInputSchema,
  ActionSchema,
  ClientActivitySchema,
  activityFigmaScope,
  type ActivityDraft,
  type Run,
  type Workflow,
} from './contract.js';
import { ServiceJobActionSchema, ServiceJobInputSchema, type ServiceJobs } from './service-jobs.js';
import { PortalStore } from './store.js';

const MAX_BODY = 12 * 1024 * 1024;
const id = z.string().uuid();
const revision = z.number().int().positive().safe();
const mutation = new Set(['POST', 'PUT']);
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
type ActivityPatch = Partial<
  Pick<ActivityDraft, 'workflowId' | 'runId' | 'workspaceId' | 'metadata'>
>;
const workflowActivity = (workflow: Workflow): ActivityPatch => ({
  workflowId: workflow.id,
  ...(workflow.workspaceId ? { workspaceId: workflow.workspaceId } : {}),
  metadata: {
    revision: workflow.revision,
    nodeCount: workflow.graph.nodes.length,
    edgeCount: workflow.graph.edges.length,
    ...activityFigmaScope(workflow.plan.design.url),
  },
});
const runActivity = (run: Run): ActivityPatch => ({
  workflowId: run.workflowId,
  runId: run.id,
  workspaceId: run.workspaceId,
  metadata: {
    ...(run.serviceRunId ? { serviceRunId: run.serviceRunId } : {}),
    toState: run.status,
    fileCount: run.outputs.length,
    issueCount: Array.isArray(run.result?.issues) ? run.result.issues.length : 0,
  },
});
const jobActivity = (job: ReturnType<ServiceJobs['get']>): ActivityPatch => ({
  ...(job.workspaceId ? { workspaceId: job.workspaceId } : {}),
  metadata: {
    jobId: job.id,
    functionType: job.type,
    functionName: job.name,
    jobStatus: job.status,
  },
});
function equalToken(actual: string | undefined, expected: string): boolean {
  const a = Buffer.from(actual ?? ''),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}
function body(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers['content-type'] ?? ''))
    throw new PortalError('CONTENT_TYPE_REQUIRED', 'Use application/json for requests.', 415);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0,
      rejected = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        if (!rejected) {
          rejected = true;
          reject(new PortalError('BODY_TOO_LARGE', 'The request exceeds twelve MiB.', 413));
        }
        return;
      }
      if (!rejected) chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      if (rejected) return;
      try {
        resolve(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
        );
      } catch {
        reject(new PortalError('INVALID_JSON', 'The request must contain valid JSON.', 400));
      }
    });
  });
}
async function handoffForm(
  request: IncomingMessage,
): Promise<{ csrf: string; input: z.infer<typeof FigmaOAuthHandoffInputSchema> }> {
  if (
    !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/iu.test(
      request.headers['content-type'] ?? '',
    )
  )
    throw new PortalError('CONTENT_TYPE_REQUIRED', 'Use the dedicated owner consent form.', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    const chunk = Buffer.from(part);
    size += chunk.length;
    if (size > 4096) throw new PortalError('BODY_TOO_LARGE', 'The consent form is too large.', 413);
    chunks.push(chunk);
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const pairs = raw.split('&').map(field => {
      const at = field.indexOf('=');
      if (at < 0) throw new Error('field');
      return [
        decodeURIComponent(field.slice(0, at).replaceAll('+', ' ')),
        decodeURIComponent(field.slice(at + 1).replaceAll('+', ' ')),
      ];
    });
    const fields = new Set([
      'csrf',
      'providerInstanceId',
      'configurationGeneration',
      'authGeneration',
      'flowId',
    ]);
    if (
      pairs.length !== 5 ||
      new Set(pairs.map(pair => pair[0])).size !== 5 ||
      pairs.some(pair => !fields.has(pair[0]!))
    )
      throw new Error('fields');
    const value = Object.fromEntries(pairs);
    if (
      !/^[A-Za-z0-9_-]{43}$/u.test(value.csrf) ||
      !/^(?:0|[1-9]\d{0,15})$/u.test(value.configurationGeneration) ||
      !/^(?:0|[1-9]\d{0,15})$/u.test(value.authGeneration)
    )
      throw new Error('field');
    return {
      csrf: value.csrf,
      input: parseFigmaOAuth(FigmaOAuthHandoffInputSchema, {
        providerInstanceId: value.providerInstanceId,
        configurationGeneration: Number(value.configurationGeneration),
        authGeneration: Number(value.authGeneration),
        flowId: value.flowId,
      }),
    };
  } catch {
    throw new PortalError(
      'FIGMA_MCP_OAUTH_INPUT_INVALID',
      'The owner consent form is invalid.',
      400,
    );
  }
}
const authActivity = (status: FigmaOAuthStatus): ActivityPatch => ({
  metadata: {
    providerInstanceId: status.providerInstanceId,
    configurationGeneration: status.configurationGeneration,
    authGeneration: status.authGeneration,
    ...(status.flowId ? { flowId: status.flowId } : {}),
  },
});
export function createPortalServer(options: {
  store: PortalStore;
  bridge: PortalBridge;
  webRoot: string;
  diagnostics?: Diagnostics;
}) {
  const csrfToken = randomBytes(32).toString('base64url');
  const diagnostics = options.diagnostics ?? new Diagnostics(options.store.directory, 'portal');
  const server = createServer({ maxHeaderSize: 16384 }, (request, response) =>
    observeHttp(diagnostics, request, response, {}, requestId => {
      let verifiedRequest = false,
        activityTracked = false;
      let route: NonNullable<ActivityDraft['metadata']['route']> = 'unknown';
      const activityMethod = ['GET', 'HEAD', 'POST', 'PUT'].includes(request.method ?? '')
        ? (request.method as 'GET' | 'HEAD' | 'POST' | 'PUT')
        : 'other';
      response.setHeader('x-sfp-request-id', requestId);
      const audited = async <T>(
        type: ActivityDraft['type'],
        context: ActivityPatch,
        execute: () => T | Promise<T>,
        summarize: (value: T) => ActivityPatch = () => ({}),
        necessaryCleanup = false,
      ): Promise<T> => {
        let activity: Awaited<ReturnType<PortalStore['recordActivity']>> | undefined;
        try {
          activity = await options.store.recordActivity({
            type,
            source: 'server',
            status: 'started',
            actor: 'local-owner',
            sessionId: options.store.activitySessionId,
            requestId,
            ...context,
            metadata: { route, method: activityMethod, ...context.metadata },
          });
          activityTracked = true;
        } catch (error) {
          if (!necessaryCleanup) throw error;
          response.setHeader('x-sfp-activity-warning', publicError(error).code);
        }
        let value: T;
        const started = performance.now();
        diagnose('portal.operation-start', { phase: type, ...context });
        try {
          value = await execute();
        } catch (error) {
          diagnose(
            'portal.operation-error',
            { phase: type, durationMs: performance.now() - started },
            error,
            'error',
          );
          if (activity) {
            const code = publicError(error).code;
            try {
              await options.store.settleActivity(
                activity.id,
                error instanceof PortalError ||
                  ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(code)
                  ? 'failed'
                  : 'unknown',
                { metadata: { errorCode: code } },
              );
            } catch (auditError) {
              if (!necessaryCleanup) throw auditError;
              response.setHeader('x-sfp-activity-warning', publicError(auditError).code);
            }
          }
          throw error;
        }
        let summary: ActivityPatch = {};
        if (activity) {
          try {
            summary = summarize(value);
            await options.store.settleActivity(
              activity.id,
              (value as Partial<Run> | null)?.status === 'unknown'
                ? 'unknown'
                : (value as Partial<Run> | null)?.status === 'failed' ||
                    (type === 'workflow.validate' &&
                      (value as { valid?: boolean } | null)?.valid === false)
                  ? 'failed'
                  : 'succeeded',
              summary,
            );
          } catch (error) {
            if (!necessaryCleanup) throw error;
            response.setHeader('x-sfp-activity-warning', publicError(error).code);
          }
        }
        diagnose('portal.operation-finish', {
          phase: type,
          durationMs: performance.now() - started,
          ...summary,
          ...summary.metadata,
        });
        return value;
      };
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('x-frame-options', 'DENY');
      response.setHeader('referrer-policy', 'no-referrer');
      response.setHeader(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
      );
      void (async () => {
        const address = server.address();
        if (!address || typeof address === 'string')
          throw new PortalError('SERVER_NOT_READY', 'The server is not ready.', 503);
        const host = request.headers.host;
        if (host !== `127.0.0.1:${address.port}` && host !== `localhost:${address.port}`)
          throw new PortalError(
            'HOST_REJECTED',
            'The request Host must identify this local portal.',
            403,
          );
        const origin = `http://${host}`;
        if (request.headers.origin !== undefined && request.headers.origin !== origin)
          throw new PortalError('ORIGIN_REJECTED', 'Only same-origin requests are accepted.', 403);
        const fetchSite = request.headers['sec-fetch-site'];
        if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none')
          throw new PortalError('ORIGIN_REJECTED', 'Only same-origin requests are accepted.', 403);
        const method = request.method ?? 'GET';
        if (!['GET', 'HEAD', 'POST', 'PUT'].includes(method))
          throw new PortalError('METHOD_REJECTED', 'This method is unsupported.', 405);
        let nativeHandoff: Awaited<ReturnType<typeof handoffForm>> | undefined;
        if (method === 'POST' && request.url === '/api/figma-settings/auth/handoff') {
          if (
            request.headers.origin !== origin ||
            fetchSite !== 'same-origin' ||
            request.headers['sec-fetch-mode'] !== 'navigate' ||
            request.headers['sec-fetch-dest'] !== 'document'
          )
            throw new PortalError(
              'ORIGIN_REJECTED',
              'Use the same-origin owner consent document.',
              403,
            );
          nativeHandoff = await handoffForm(request);
          if (!equalToken(nativeHandoff.csrf, csrfToken))
            throw new PortalError(
              'CSRF_REJECTED',
              'Refresh the owner consent document before continuing.',
              403,
            );
        }
        if (
          mutation.has(method) &&
          !nativeHandoff &&
          !equalToken(
            typeof request.headers['x-sfp-csrf'] === 'string'
              ? request.headers['x-sfp-csrf']
              : undefined,
            csrfToken,
          )
        )
          throw new PortalError(
            'CSRF_REJECTED',
            'Refresh the portal before sending this request.',
            403,
          );
        verifiedRequest = true;
        const rawPath = request.url ?? '/';
        const routePath = rawPath.split('?')[0]!;
        if (
          !rawPath.startsWith('/') ||
          rawPath.startsWith('//') ||
          rawPath.includes('\\') ||
          rawPath.includes(String.fromCharCode(0)) ||
          routePath.includes('%') ||
          routePath.split('/').some(segment => segment === '.' || segment === '..')
        )
          throw new PortalError('PATH_REJECTED', 'Invalid request path.', 400);
        const url = new URL(rawPath, origin),
          path = url.pathname;
        if (path === '/figma-auth-consent') {
          route = 'figma-auth-consent';
          if (method !== 'GET' || url.search)
            throw new PortalError(
              'NOT_FOUND',
              'This consent document accepts only a query-free GET.',
              404,
            );
          let template: string;
          try {
            const root = await realpath(options.webRoot),
              target = await realpath(join(root, 'figma-auth-consent.html'));
            if (relative(root, target).startsWith('..')) throw new Error('path');
            template = await readFile(target, 'utf8');
            if (
              Buffer.byteLength(template) > 32768 ||
              template.split('__SFP_FIGMA_CONSENT_NONCE__').length !== 2
            )
              throw new Error('template');
          } catch {
            throw new PortalError('NOT_FOUND', 'The owner consent document is unavailable.', 404);
          }
          const nonce = randomBytes(24).toString('base64url');
          // Chrome must retain the exact Origin for the protected native same-origin POST.
          // This policy still omits Referer on the external official consent navigation.
          response.setHeader('referrer-policy', 'same-origin');
          response.setHeader(
            'content-security-policy',
            `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; connect-src 'self'; form-action 'self' https://www.figma.com/oauth/mcp; frame-ancestors 'none'; object-src 'none'; base-uri 'none'`,
          );
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end(template.replace('__SFP_FIGMA_CONSENT_NONCE__', nonce));
          return;
        }
        route =
          path === '/api/bootstrap'
            ? 'bootstrap'
            : path === '/api/health'
              ? 'health'
              : path === '/api/activities'
                ? 'activities'
                : path === '/api/workspaces'
                  ? 'workspaces'
                  : path === '/api/workflows'
                    ? 'workflows'
                    : path === '/api/workflows/validate'
                      ? 'workflow-validation'
                      : /^\/api\/workflows\/[^/]+\/runs$/u.test(path)
                        ? 'workflow-runs'
                        : /^\/api\/workflows\/[^/]+$/u.test(path)
                          ? 'workflow'
                          : path === '/api/runs'
                            ? 'runs'
                            : /^\/api\/runs\/[^/]+\/actions$/u.test(path)
                              ? 'run-actions'
                              : /^\/api\/runs\/[^/]+\/events$/u.test(path)
                                ? 'run-events'
                                : /^\/api\/runs\/[^/]+$/u.test(path)
                                  ? 'run'
                                  : 'unknown';
        if (path === '/api/activities' && method === 'GET') {
          if (new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length)
            throw new PortalError('INVALID_REQUEST', 'Duplicate activity query.');
          return json(
            response,
            200,
            options.store.listActivities(Object.fromEntries(url.searchParams)),
          );
        }
        if (path === '/api/activities' && method === 'POST') {
          const input = parse(ClientActivitySchema, await body(request));
          if (input.metadata.functionName) {
            const catalog = await (await options.bridge.jobs()).catalog();
            const descriptors =
              input.metadata.functionType === 'feature' ? catalog.features : catalog.tools;
            if (!descriptors.some(value => value.name === input.metadata.functionName))
              throw new PortalError('INVALID_REQUEST', 'Unknown activity function.');
          }
          const activity = await options.store.recordActivity({
            ...input,
            source: 'client',
            status: 'intent',
            actor: 'local-owner',
            sessionId: options.store.activitySessionId,
            requestId,
          });
          activityTracked = true;
          return json(response, 201, { activity });
        }
        if (path === '/api/bootstrap' && method === 'GET')
          return json(response, 200, { csrfToken, ...(await options.bridge.bootstrap()) });
        if (path === '/api/health' && method === 'GET')
          return json(response, 200, {
            ...(await options.bridge.bootstrap()).service,
            diagnostics: diagnostics.status(),
          });
        if (path === '/api/figma-settings') {
          route = 'figma-settings';
          if (method === 'GET')
            return json(response, 200, await (await options.bridge.settings()).get());
          if (method === 'PUT') {
            const input = await body(request);
            if (input && typeof input === 'object' && Object.hasOwn(input, 'configuration'))
              await options.bridge.assertFigmaAuthMutationAllowed();
            return json(
              response,
              200,
              await audited('figma.settings', {}, async () =>
                (await options.bridge.settings()).save(input),
              ),
            );
          }
        }
        if (path === '/api/figma-settings/auth' && method === 'GET') {
          route = 'figma-auth';
          if (url.search)
            throw new PortalError(
              'FIGMA_MCP_OAUTH_INPUT_INVALID',
              'Authorization status does not accept query parameters.',
              400,
            );
          return json(response, 200, await (await options.bridge.settings()).authStatus());
        }
        const authAction =
          /^\/api\/figma-settings\/auth\/(start|cancel|logout|refresh|handoff)$/u.exec(path);
        if (authAction && method === 'POST') {
          route = 'figma-auth';
          if (url.search)
            throw new PortalError(
              'FIGMA_MCP_OAUTH_INPUT_INVALID',
              'Authorization actions do not accept query parameters.',
              400,
            );
          const action = authAction[1] as 'start' | 'cancel' | 'logout' | 'refresh' | 'handoff';
          if (['start', 'refresh', 'handoff'].includes(action))
            await options.bridge.assertFigmaAuthMutationAllowed();
          const settings = await options.bridge.settings();
          if (action === 'handoff') {
            if (!nativeHandoff)
              throw new PortalError(
                'CONTENT_TYPE_REQUIRED',
                'Use the dedicated native owner consent form.',
                415,
              );
            let location: string | undefined;
            await audited('figma.auth.handoff', {}, () =>
              settings.authHandoff(nativeHandoff!.input, destination => {
                if (location)
                  throw new PortalError(
                    'FIGMA_MCP_OAUTH_HANDOFF_FAILED',
                    'The consent handoff was already delivered.',
                    409,
                  );
                const candidate = new URL(destination.href);
                if (
                  candidate.origin !== 'https://www.figma.com' ||
                  candidate.pathname !== '/oauth/mcp' ||
                  candidate.username ||
                  candidate.password ||
                  candidate.hash
                )
                  throw new PortalError(
                    'FIGMA_MCP_OAUTH_DESTINATION_REJECTED',
                    'The consent destination is not the approved official endpoint.',
                    409,
                  );
                location = candidate.href;
              }),
            );
            if (!location)
              throw new PortalError(
                'FIGMA_MCP_OAUTH_HANDOFF_UNAVAILABLE',
                'No current owner consent handoff is available.',
                409,
              );
            response.setHeader(
              'content-security-policy',
              "default-src 'none'; form-action https://www.figma.com/oauth/mcp; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
            );
            response.writeHead(303, { location });
            response.end();
            return;
          }
          return json(
            response,
            200,
            await audited(
              `figma.auth.${action}`,
              {},
              async () => settings.authAction(action, await body(request)),
              authActivity,
              action === 'cancel' || action === 'logout',
            ),
          );
        }
        if (path === '/api/figma-settings/probe' && method === 'POST') {
          route = 'figma-probe';
          return json(
            response,
            200,
            await audited('figma.probe', {}, async () =>
              (await options.bridge.settings()).probe(await body(request)),
            ),
          );
        }
        if (path === '/api/figma-settings/read' && method === 'POST') {
          route = 'figma-read';
          return json(
            response,
            200,
            await audited('figma.read', {}, async () =>
              (await options.bridge.settings()).read(await body(request)),
            ),
          );
        }
        if (path === '/api/service/catalog' && method === 'GET') {
          route = 'service-catalog';
          return json(response, 200, await (await options.bridge.jobs()).catalog());
        }
        if (path === '/api/service/jobs') {
          route = 'service-jobs';
          if (method === 'GET')
            return json(response, 200, { jobs: (await options.bridge.jobs()).list() });
          if (method === 'POST') {
            const input = parse(ServiceJobInputSchema, await body(request));
            return json(response, 202, {
              job: await audited(
                'service.job',
                {},
                async () => (await options.bridge.jobs()).create(input),
                jobActivity,
              ),
            });
          }
        }
        const serviceJob = /^\/api\/service\/jobs\/([^/]+)(?:\/(actions))?$/u.exec(path);
        if (serviceJob) {
          const jobId = parse(id, serviceJob[1]);
          route = serviceJob[2] ? 'service-job-actions' : 'service-job';
          if (!serviceJob[2] && method === 'GET')
            return json(response, 200, { job: (await options.bridge.jobs()).get(jobId) });
          if (serviceJob[2] && method === 'POST') {
            const input = parse(ServiceJobActionSchema, await body(request));
            return json(response, 202, {
              job: await audited(
                'service.job.action',
                { metadata: { jobId, jobAction: input.action } },
                async () => (await options.bridge.jobs()).action(jobId, input),
                jobActivity,
                input.action === 'cancel' || input.action === 'inspect',
              ),
            });
          }
        }
        if (path === '/api/workspaces' && method === 'GET')
          return json(response, 200, { workspaces: await options.bridge.workspaces() });
        if (path === '/api/workspaces' && method === 'POST')
          return json(response, 201, {
            workspace: await audited(
              'workspace.register',
              {},
              async () => options.bridge.registerWorkspace(await body(request)),
              workspace => ({ workspaceId: workspace.workspaceId }),
            ),
          });
        if (path === '/api/workflows' && method === 'GET')
          return json(response, 200, { workflows: options.store.listWorkflows() });
        if (path === '/api/workflows' && method === 'POST')
          return json(
            response,
            201,
            await audited(
              'workflow.create',
              {},
              async () =>
                options.store.createWorkflow(
                  (await options.bridge.settings()).bindWorkflow(await body(request)),
                ),
              workflowActivity,
            ),
          );
        if (path === '/api/workflows/validate' && method === 'POST')
          return json(
            response,
            200,
            await audited(
              'workflow.validate',
              {},
              async () => validateWorkflow(await body(request)),
              result => ({ metadata: { issueCount: result.issues.length } }),
            ),
          );
        const workflow = /^\/api\/workflows\/([^/]+)$/u.exec(path);
        if (workflow && method === 'GET')
          return json(response, 200, options.store.getWorkflow(parse(id, workflow[1])));
        if (workflow && method === 'PUT') {
          const input = parse(
            WorkflowInputSchema.extend({ revision }).strict(),
            (await options.bridge.settings()).bindWorkflow(await body(request)),
          );
          const { revision: expected, ...value } = input;
          return json(
            response,
            200,
            await audited(
              'workflow.update',
              { workflowId: parse(id, workflow[1]) },
              () => options.store.updateWorkflow(parse(id, workflow[1]), expected, value),
              workflowActivity,
            ),
          );
        }
        const start = /^\/api\/workflows\/([^/]+)\/runs$/u.exec(path);
        if (start && method === 'POST')
          return json(
            response,
            202,
            await audited(
              'run.start',
              { workflowId: parse(id, start[1]) },
              async () =>
                options.bridge.start(
                  parse(id, start[1]),
                  parse(z.object({ revision }).strict(), await body(request)).revision,
                ),
              runActivity,
            ),
          );
        if (path === '/api/runs' && method === 'GET')
          return json(response, 200, { runs: options.bridge.listRuns() });
        const run = /^\/api\/runs\/([^/]+)(?:\/(events|actions))?$/u.exec(path);
        if (run) {
          const runId = parse(id, run[1]);
          if (!run[2] && method === 'GET') return json(response, 200, options.bridge.getRun(runId));
          if (run[2] === 'events' && method === 'GET')
            return json(
              response,
              200,
              options.bridge.events(
                runId,
                parse(z.coerce.number().int().min(0).safe(), url.searchParams.get('after') ?? '0'),
              ),
            );
          if (run[2] === 'actions' && method === 'POST') {
            const input = parse(ActionSchema, await body(request));
            const necessaryCleanup =
              input.action === 'cancel' ||
              input.action === 'refresh' ||
              (input.action === 'resume' && input.args.reconcile === 'inspect');
            return json(
              response,
              202,
              await audited(
                'run.action',
                { runId, metadata: { actionName: input.action } },
                () => options.bridge.action(runId, input),
                runActivity,
                necessaryCleanup,
              ),
            );
          }
        }
        if (path.startsWith('/api/'))
          throw new PortalError('NOT_FOUND', 'This API route does not exist.', 404);
        if (method !== 'GET' && method !== 'HEAD')
          throw new PortalError('NOT_FOUND', 'This route does not exist.', 404);
        const file = path === '/' ? 'index.html' : path.slice(1);
        if (file === 'figma-auth-consent.html')
          throw new PortalError('NOT_FOUND', 'Use the dedicated owner consent document.', 404);
        if (
          !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(file) ||
          basename(file) !== file ||
          !mime[extname(file)]
        )
          throw new PortalError('NOT_FOUND', 'This asset does not exist.', 404);
        let bytes: Buffer;
        try {
          const root = await realpath(options.webRoot),
            target = await realpath(join(root, file));
          if (relative(root, target).startsWith('..')) throw new Error('outside');
          bytes = await readFile(target);
        } catch {
          throw new PortalError('NOT_FOUND', 'This asset does not exist.', 404);
        }
        response.writeHead(200, {
          'content-type': mime[extname(file)]!,
          'content-length': bytes.byteLength,
        });
        response.end(method === 'HEAD' ? undefined : bytes);
      })().catch(async error => {
        const safe = publicError(error);
        diagnose(
          'portal.request-error',
          { errorCode: safe.code, status: safe.status },
          error,
          safe.status >= 500 ? 'error' : 'warn',
        );
        if (!activityTracked && !safe.code.startsWith('ACTIVITY_')) {
          try {
            await options.store.recordActivity({
              type: 'request.rejected',
              source: 'server',
              status: 'failed',
              actor: verifiedRequest ? 'local-owner' : 'unverified-request',
              sessionId: options.store.activitySessionId,
              requestId,
              metadata: { route, method: activityMethod, errorCode: safe.code },
            });
          } catch (auditError) {
            if (!response.headersSent)
              response.setHeader('x-sfp-activity-warning', publicError(auditError).code);
          }
        }
        if (!response.headersSent)
          json(response, safe.status, {
            error: {
              code: safe.code,
              message: safe.message,
              ...(safe.issues ? { issues: safe.issues } : {}),
            },
          });
        else response.end();
      });
    }),
  );
  const close = server.close.bind(server);
  /* eslint-disable promise/no-promise-in-callback, promise/no-callback-in-promise -- Node's close callback must wait for the bounded diagnostics queue */
  server.close = callback =>
    close(error => {
      void options.bridge
        .close()
        .catch(closeError => {
          const failure =
            closeError instanceof Error
              ? closeError
              : Object.assign(
                  new Error('CHROME_CONNECTION_CLOSED: source cleanup failed', {
                    cause: closeError,
                  }),
                  { code: 'CHROME_CONNECTION_CLOSED' },
                );
          diagnostics.record('portal.operation-error', { phase: 'close' }, failure, 'error');
          return failure;
        })
        .then(async closeError => {
          const completed = await diagnostics.flush();
          callback?.(
            error ??
              closeError ??
              (completed
                ? undefined
                : Object.assign(Error('DIAGNOSTICS_FLUSH_UNCONFIRMED'), {
                    code: 'DIAGNOSTICS_FLUSH_UNCONFIRMED',
                  })),
          );
          return undefined;
        });
    });
  /* eslint-enable promise/no-promise-in-callback, promise/no-callback-in-promise */
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 32;
  return server;
}
