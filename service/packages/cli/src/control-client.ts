import { createHash, randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';

import {
  ControlStatusV1Schema,
  PublicPingV1Schema,
  hashActionRequest,
  ApprovalPromptV1Schema,
  type ApprovalDecisionV1,
  type InvocationTargetSelector,
  type ToolName,
} from '@sfp/shared';

import { resolveDefaultStateRoot } from '../../mcp/src/runtime-paths.js';
import { createFollowerAuth } from '../../mcp/src/security/follower-auth.js';
import { createStatePermissions } from '../../mcp/src/security/state-permissions.js';

const readResponse = async (response: IncomingMessage): Promise<string> => {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response) {
    const data = Buffer.from(chunk);
    bytes += data.byteLength;
    if (bytes > 33_554_432) {
      response.destroy();
      throw new Error('CONTROL_RESPONSE_TOO_LARGE');
    }
    chunks.push(data);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
};

export class ControlClient {
  readonly stateRoot: string;
  readonly baseUrl: string;
  private readonly expectedCredentialHash: string | undefined;
  constructor(
    options: { stateRoot?: string; port?: number; expectedCredentialHash?: string } = {},
  ) {
    this.expectedCredentialHash = options.expectedCredentialHash;
    this.stateRoot = options.stateRoot ?? resolveDefaultStateRoot();
    this.baseUrl = `http://127.0.0.1:${options.port ?? 3055}`;
  }
  /** A continuity fence, not a credential or an owner authorization grant. */
  async credentialHash(): Promise<string> {
    const permissions = createStatePermissions(this.stateRoot);
    await permissions.verifySecure(this.stateRoot);
    const auth = await createFollowerAuth({ stateRoot: this.stateRoot, permissions });
    const credential = await auth.authorization('control');
    if (credential === undefined) throw new Error('CONTROL_NOT_READY');
    return createHash('sha256')
      .update('sfp-control-continuity-v1\0')
      .update(credential.generation)
      .update('\0')
      .update(credential.value)
      .digest('hex');
  }
  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/ping`, {
        signal: AbortSignal.timeout(2_000),
        redirect: 'error',
      });
      return response.ok && PublicPingV1Schema.safeParse(await response.json()).success;
    } catch {
      return false;
    }
  }
  async request<T = unknown>(
    path: string,
    method = 'GET',
    body?: unknown,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    if (!path.startsWith('/control/')) throw new Error('CONTROL_PATH_INVALID');
    const permissions = createStatePermissions(this.stateRoot);
    await permissions.verifySecure(this.stateRoot);
    const auth = await createFollowerAuth({ stateRoot: this.stateRoot, permissions });
    const credential = await auth.authorization('control');
    if (credential === undefined) throw new Error('CONTROL_NOT_READY');
    const credentialHash = createHash('sha256')
      .update('sfp-control-continuity-v1\0')
      .update(credential.generation)
      .update('\0')
      .update(credential.value)
      .digest('hex');
    if (this.expectedCredentialHash !== undefined && credentialHash !== this.expectedCredentialHash)
      throw new Error('CONTROL_CREDENTIAL_CHANGED');
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 180_000),
      ...(options.signal === undefined ? [] : [options.signal]),
    ]);
    // Native HTTP honors this operation's budget instead of fetch's fixed five-minute header limit.
    const response = await new Promise<IncomingMessage>((resolveResponse, reject) => {
      const request = httpRequest(
        `${this.baseUrl}${path}`,
        {
          method,
          signal,
          headers: {
            authorization: credential.value,
            'x-sfp-leader-generation': credential.generation,
            'content-type': 'application/json',
          },
        },
        resolveResponse,
      );
      request.once('error', reject);
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });
    const text = await readResponse(response);
    const status = response.statusCode ?? 500;
    if (status < 200 || status >= 300) {
      let code = 'CONTROL_REQUEST_FAILED';
      try {
        const parsed = JSON.parse(text) as { code?: unknown };
        if (typeof parsed.code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(parsed.code))
          code = parsed.code;
      } catch {
        /* non-JSON errors remain bounded and opaque */
      }
      throw Object.assign(new Error(`${code} (${status})`), {
        code,
        status,
      });
    }
    return (text.length === 0 ? undefined : JSON.parse(text)) as T;
  }
  async status() {
    return ControlStatusV1Schema.parse(await this.request('/control/status'));
  }
  async issueOperationId(): Promise<string> {
    const result = await this.request<{ operationId: string }>('/control/operations', 'POST');
    if (
      typeof result.operationId !== 'string' ||
      !/^sfp_op1_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(result.operationId)
    )
      throw new Error('OPERATION_ID_INVALID');
    return result.operationId;
  }
  async approvals() {
    const result = await this.request<unknown[]>('/control/approvals');
    if (!Array.isArray(result) || result.length > 256) throw new Error('APPROVAL_RESPONSE_INVALID');
    return result.map(value => ApprovalPromptV1Schema.parse(value));
  }
  async decide(approvalId: string, decision: ApprovalDecisionV1['decision']): Promise<void> {
    const prompt = (await this.approvals()).find(row => row.approvalId === approvalId);
    if (prompt === undefined) throw new Error('APPROVAL_NOT_FOUND');
    await this.request(`/control/approvals/${encodeURIComponent(approvalId)}`, 'POST', {
      version: 1,
      type: 'approval.decision',
      approvalId,
      operationId: prompt.operationId,
      promptHash: prompt.promptHash,
      decision,
    });
  }
  async invoke(input: {
    name: string;
    kind: 'tool' | 'service';
    args: unknown;
    workspaceId: string | null;
    targetSelector: InvocationTargetSelector;
    approve: boolean;
    captureResult?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    emit(value: unknown): void;
    operationId?: string;
  }): Promise<unknown> {
    const servicePaths: Readonly<Record<string, string>> = {
      'snapshot.capture': '/control/snapshots/capture',
      'grounding.refresh': '/control/grounding/refresh',
      'recipe.evidence.hold': '/control/recipes/evidence/hold',
      'recipe.evidence.verify': '/control/recipes/evidence/verify',
      'recipe.evidence.release': '/control/recipes/evidence/release',
    };
    const path =
      input.kind === 'tool'
        ? '/control/tools/call'
        : Object.hasOwn(servicePaths, input.name)
          ? servicePaths[input.name]
          : undefined;
    if (!path) throw new Error('CONTROL_SERVICE_OPERATION_UNSUPPORTED');
    const operationId = input.operationId ?? (await this.issueOperationId()),
      requestId = `sfp_req1_${randomBytes(16).toString('base64url')}`;
    input.emit({ status: 'accepted-locally', operationId, requestId, name: input.name });
    const base = {
      version: 1,
      requestId,
      operationId,
      rawArgs: input.args,
      workspaceId: input.workspaceId,
      targetSelector: input.targetSelector,
    };
    const body =
      input.kind === 'tool'
        ? {
            version: 1,
            captureResult: input.captureResult ?? false,
            invocation: { ...base, toolName: input.name },
          }
        : { ...base, serviceOperationName: input.name };
    let settled = false;
    const requestController = new AbortController();
    const request = this.request(path, 'POST', body, {
      timeoutMs: input.timeoutMs ?? 900_000,
      signal: AbortSignal.any([
        requestController.signal,
        ...(input.signal === undefined ? [] : [input.signal]),
      ]),
    });
    const result = request
      .then(
        value => ({ value }),
        error => ({ error }),
      )
      .finally(() => {
        settled = true;
      });
    const seen = new Set<string>();
    const cancel = async () => {
      await this.request(`/control/operations/${encodeURIComponent(operationId)}/cancel`, 'POST', {
        version: 1,
        requestId,
        operationId,
      });
    };
    let cancelled = false;
    let lastStatus = '';
    // eslint-disable-next-line no-unmodified-loop-condition -- request completion updates this from its promise continuation
    while (!settled) {
      if (input.signal?.aborted && !cancelled) {
        cancelled = true;
        // eslint-disable-next-line no-await-in-loop -- cancellation identifies exactly this operation and origin request
        await cancel().catch(() => undefined);
      }
      try {
        // eslint-disable-next-line no-await-in-loop -- only approvals bound to this issued operation are eligible
        const prompts = await this.approvals();
        for (const prompt of prompts) {
          if (prompt.operationId !== operationId || seen.has(prompt.approvalId)) continue;
          seen.add(prompt.approvalId);
          input.emit({ status: 'approval-required', prompt });
          if (input.approve && !input.signal?.aborted) {
            // eslint-disable-next-line no-await-in-loop -- --yes authorizes this exact request, never another pending operation
            await this.decide(prompt.approvalId, 'approved');
          }
        }
        if (!settled) {
          // eslint-disable-next-line no-await-in-loop -- report daemon-owned status, not a guessed local completion
          const record = await this.request<{ status: string }>(
            `/control/operations/${encodeURIComponent(operationId)}`,
          ).catch(error => {
            if ((error as { status?: number }).status === 404) return null;
            throw error;
          });
          if (record !== null && record.status !== lastStatus) {
            lastStatus = record.status;
            input.emit({ status: record.status, operationId, requestId });
          }
        }
      } catch (error) {
        if (!settled) {
          // eslint-disable-next-line no-await-in-loop -- cancel the specific operation before abandoning its HTTP response
          await cancel().catch(() => undefined);
          requestController.abort();
          // eslint-disable-next-line no-await-in-loop -- consume the observed rejection, never leave a dangling request
          await result;
          throw error;
        }
      }
      if (!settled) {
        // eslint-disable-next-line no-await-in-loop -- bounded polling while the daemon owns execution
        await new Promise<void>(done => setTimeout(done, 300));
      }
    }
    if (input.signal?.aborted && !cancelled) await cancel().catch(() => undefined);
    const outcome = await result;
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  }
  async pairCode(): Promise<string> {
    const challenge = await this.request<{ challengeId: string; code: string }>(
      '/control/pair/challenge',
      'POST',
    );
    if (!/^[A-Z2-7]{10}$/u.test(challenge.challengeId) || !/^\d{8}$/u.test(challenge.code))
      throw new Error('PAIR_CHALLENGE_INVALID');
    return `SFP-${challenge.challengeId}-${challenge.code}`;
  }
  async allowModelData(): Promise<void> {
    const semantic = {
      mode: 'external-model' as const,
      allowedClasses: ['public', 'project-code', 'design-text', 'design-image'],
      expiresInSeconds: 28_800,
    };
    const nonce = await this.request<{ value: string }>('/control/action-nonces', 'POST', {
      action: 'egress.configure',
      requestHash: hashActionRequest('egress.configure', semantic),
    });
    await this.request('/control/egress', 'POST', {
      schemaVersion: 1,
      ...semantic,
      actionNonce: nonce.value,
    });
  }
  async workspace(path: string): Promise<string> {
    const canonical = await realpath(path);
    const existing =
      await this.request<Array<{ workspaceId: string; realPath: string }>>('/control/workspaces');
    const found = existing.find(row => row.realPath === canonical);
    if (found !== undefined) return found.workspaceId;
    const nonce = await this.request<{ value: string }>('/control/action-nonces', 'POST', {
      action: 'workspace.add',
      requestHash: hashActionRequest('workspace.add', { realPath: canonical }),
      registrationPath: canonical,
    });
    const added = await this.request<{ workspaceId: string }>('/control/workspaces', 'POST', {
      path: canonical,
      actionNonce: nonce.value,
    });
    return added.workspaceId;
  }
  async readTool(
    toolName: ToolName,
    rawArgs: unknown,
    sessionId: string,
    workspaceId: string | null = null,
  ): Promise<unknown> {
    const reads = [
      'get_metadata',
      'get_pages',
      'get_selection',
      'get_document',
      'get_node',
      'get_design_context',
      'get_styles',
      'get_variable_defs',
      'get_reactions',
      'get_component_api',
      'analyze_project',
      'scan_components',
      'component_map',
      'token_map',
      'icon_map',
    ];
    if (!reads.includes(toolName)) throw new Error('AUTOMATION_READ_ONLY');
    return this.request('/control/tools/call', 'POST', {
      version: 1,
      captureResult: false,
      invocation: {
        version: 1,
        requestId: `sfp_req1_${randomBytes(16).toString('base64url')}`,
        toolName,
        rawArgs,
        workspaceId,
        targetSelector: ['analyze_project', 'scan_components'].includes(toolName)
          ? { kind: 'none' }
          : { kind: 'session', sessionId },
      },
    });
  }
}
