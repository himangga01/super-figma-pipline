import { isAbsolute } from 'node:path';

import { PortalPlanArgsSchema, PortalStateSchema } from '@sfp/shared';
import { z } from 'zod';

export const nodeTypes = ['source', 'requirements', 'generation', 'validation', 'output'] as const;
export const actionNames = [
  'refresh',
  'next',
  'submit',
  'validate',
  'apply',
  'resume',
  'cancel',
  'approve',
  'reject',
] as const;
export type ActionName = (typeof actionNames)[number];
export interface Issue {
  path: string;
  message: string;
}
export class PortalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly issues?: Issue[],
  ) {
    super(message);
  }
}
const text = z.string().trim().min(1).max(128);
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u);
const coordinate = z.number().finite().min(-100000).max(100000);
export const WorkflowInputSchema = z
  .object({
    name: text,
    description: z.string().max(2048).default(''),
    workspaceId: z.string().uuid().nullable(),
    plan: PortalPlanArgsSchema.refine(
      p => p.design.source === 'chrome' || p.design.source === 'official-mcp',
      'The web portal supports Chrome and official Figma MCP sources',
    ),
    graph: z
      .object({
        nodes: z
          .array(
            z
              .object({
                id: key,
                type: z.enum(nodeTypes),
                label: text,
                position: z.object({ x: coordinate, y: coordinate }).strict(),
                config: z
                  .object({
                    profileId: z
                      .string()
                      .regex(/^[a-z][a-z0-9-]{0,63}$/u)
                      .optional(),
                  })
                  .strict()
                  .default({}),
              })
              .strict(),
          )
          .max(40),
        edges: z.array(z.object({ id: key, source: key, target: key }).strict()).max(80),
        viewport: z
          .object({ x: coordinate, y: coordinate, zoom: z.number().min(0.2).max(3) })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;
export interface Workflow extends WorkflowInput {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export type RunStatus =
  | 'queued'
  | 'active'
  | 'awaiting-input'
  | 'awaiting-agent'
  | 'awaiting-approval'
  | 'failed'
  | 'unknown'
  | 'completed'
  | 'cancelled';
export interface RunNode {
  nodeId: string;
  type: (typeof nodeTypes)[number];
  status: 'pending' | 'active' | 'waiting' | 'completed' | 'failed' | 'unknown';
  message: string;
}
export interface RunEvent {
  sequence: number;
  at: string;
  type: string;
  message: string;
  data: unknown;
}
export interface Run {
  id: string;
  workflowId: string;
  workflowRevision: number;
  workflowName: string;
  workspaceId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  planId: string | null;
  serviceRunId: string | null;
  operationId: string | null;
  nodes: RunNode[];
  graph: WorkflowInput['graph'];
  result: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  approvals: Array<Record<string, unknown>>;
  actions: Array<{ action: ActionName; enabled: boolean; reason: string }>;
  outputs: Array<Record<string, unknown>>;
}
export interface StoredRun extends Run {
  unresolvedOperation?: { id: string | null; name: string | null };
  workflow: Workflow;
  events: RunEvent[];
  nextSequence: number;
}
export interface Workspace {
  workspaceId: string;
  realPath: string;
  availability?: string | undefined;
  unavailableReason?: string | undefined;
}
export const WorkspaceSchema = z
  .object({
    workspaceId: z.string().uuid(),
    realPath: z.string().min(1).max(4096),
    availability: z.string().max(128).optional(),
    unavailableReason: z.string().max(512).optional(),
  })
  .strip();
export const WorkspaceRegistrationSchema = z
  .object({
    folder: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .refine(
        value =>
          !Array.from(value).some(character => character.charCodeAt(0) < 32) &&
          !/^[/\\]{2}/u.test(value) &&
          (process.platform === 'win32' ? /^[A-Za-z]:[/\\]/u.test(value) : isAbsolute(value)),
        '이미 존재하는 로컬 폴더의 전체 경로를 입력해 주세요.',
      ),
  })
  .strict();
export const BrowserConnectionSchema = z.enum([
  'not-requested',
  'awaiting-browser',
  'initializing',
  'connected',
  'unavailable',
  'unknown',
]);
export const browserConnectionMessages: Record<z.infer<typeof BrowserConnectionSchema>, string> = {
  'not-requested':
    '아직 Chrome 연결을 요청하지 않았습니다. Figma 파일을 Chrome에 열고 준비가 끝나면 실행하세요.',
  'awaiting-browser':
    'Chrome 연결 또는 사용자의 허용을 기다립니다. Chrome의 원격 제어 요청 창을 직접 확인해 주세요.',
  initializing:
    'Chrome 연결을 준비하고 있습니다. 상태를 새로고침하고 진행 중인 실행 결과를 확인해 주세요.',
  connected:
    'Chrome 연결을 확인했습니다. 파일 수집의 성공 여부는 실행 결과에서 별도로 확인해야 합니다.',
  unavailable:
    'Chrome 연결을 사용할 수 없습니다. Chrome의 원격 연결 설정과 기존 실행 결과를 확인해 주세요.',
  unknown: 'Chrome 연결 상태를 확인하지 못했습니다. 서비스를 확인한 뒤 상태를 새로고침해 주세요.',
};
export const ClientActivityTypeSchema = z.enum([
  'guide.open',
  'guide.close',
  'guide.step',
  'setup.open',
  'setup.apply',
  'draft.edit',
  'view.change',
  'node.select',
  'node.add',
  'node.remove',
  'node.move',
  'graph.connect',
  'graph.disconnect',
  'graph.zoom',
  'graph.reset',
  'workflow.select',
  'workflow.new',
  'workflow.save.intent',
  'run.start.intent',
  'run.action.intent',
  'workspace.register.intent',
  'decision.review.open',
  'decision.review.apply',
  'agent.handoff.copy',
  'connection.refresh',
  'connection.settings.intent',
  'connection.probe.intent',
  'service.job.intent',
  'service.job.action.intent',
  'service.input.edit',
  'error',
]);
export const ActivityTypeSchema = z.enum([
  ...ClientActivityTypeSchema.options,
  'workspace.register',
  'workflow.create',
  'workflow.update',
  'workflow.validate',
  'run.start',
  'run.action',
  'request.rejected',
  'service.connection',
  'service.capture',
  'service.run-state',
  'figma.settings',
  'figma.probe',
  'figma.read',
  'figma.auth.configure',
  'figma.auth.start',
  'figma.auth.cancel',
  'figma.auth.logout',
  'figma.auth.refresh',
  'figma.auth.handoff',
  'service.job',
  'service.job.action',
  'service.job-state',
]);
const activityField = z.enum([
  'name',
  'description',
  'workspaceId',
  'case',
  'designUrl',
  'collector',
  'freshness',
  'targetPath',
  'stack',
  'profileId',
  'requirements',
  'workflowDecisions',
  'nodes',
  'edges',
  'viewport',
]);
const activityCount = z.number().int().min(0).max(100000);
const activityCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
const activityState = z.enum([
  ...PortalStateSchema.options,
  'queued',
  'active',
  'awaiting-input',
  'awaiting-agent',
  'awaiting-approval',
  'unknown',
]);
export const ClientActivityMetadataSchema = z
  .object({
    field: activityField.optional(),
    hasValue: z.boolean().optional(),
    functionType: z.enum(['tool', 'feature']).optional(),
    functionName: z
      .string()
      .regex(/^[a-z][a-z0-9_.-]{0,127}$/u)
      .optional(),
    jobId: z.string().uuid().optional(),
    jobAction: z
      .enum(['approve', 'reject', 'cancel', 'inspect', 'prepare-recovery', 'abandon-local'])
      .optional(),
    nodeId: key.optional(),
    nodeType: z.enum(nodeTypes).optional(),
    actionName: z.enum(actionNames).optional(),
    errorCode: activityCode.optional(),
    figmaFileKey: z
      .string()
      .regex(/^[A-Za-z0-9]{10,128}$/u)
      .optional(),
    figmaNodeId: z
      .string()
      .max(512)
      .regex(/^I?\d+:\d+(?:;I?\d+:\d+)*$/u)
      .optional(),
    changedFields: z.array(activityField).max(20).optional(),
    nodeCount: activityCount.optional(),
    edgeCount: activityCount.optional(),
    step: z.number().int().min(1).max(12).optional(),
    view: z.enum(['builder', 'live', 'activities', 'settings', 'functions', 'admin']).optional(),
    changeCount: activityCount.optional(),
  })
  .strict();
export const ActivityMetadataSchema = ClientActivityMetadataSchema.extend({
  providerInstanceId: z.string().uuid().optional(),
  configurationGeneration: z.number().int().nonnegative().safe().optional(),
  authGeneration: z.number().int().nonnegative().safe().optional(),
  flowId: z.string().uuid().optional(),
  jobStatus: z
    .enum([
      'queued',
      'running',
      'awaiting-confirmation',
      'awaiting-approval',
      'succeeded',
      'failed',
      'cancelled',
      'unknown',
    ])
    .optional(),
  rejectionCount: z.number().int().positive().safe().optional(),
  fromState: activityState.optional(),
  toState: activityState.optional(),
  runStatus: activityState.optional(),
  fileCount: activityCount.optional(),
  issueCount: activityCount.optional(),
  revision: activityCount.optional(),
  serviceRunId: z
    .string()
    .regex(/^sfp_portal1_[a-f0-9]{32}$/u)
    .optional(),
  captureComplete: z.boolean().optional(),
  liveVerified: z.boolean().optional(),
  browserConnection: BrowserConnectionSchema.optional(),
  statusAvailable: z.boolean().optional(),
  route: z
    .enum([
      'bootstrap',
      'health',
      'workspaces',
      'workflows',
      'workflow',
      'workflow-validation',
      'workflow-runs',
      'runs',
      'run',
      'run-actions',
      'run-events',
      'activities',
      'figma-settings',
      'figma-probe',
      'figma-read',
      'figma-auth',
      'figma-auth-consent',
      'service-catalog',
      'service-jobs',
      'service-job',
      'service-job-actions',
      'asset',
      'unknown',
    ])
    .optional(),
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'other']).optional(),
  operation: z
    .enum([
      'portal_plan',
      'portal_start',
      'portal_next',
      'portal_submit',
      'portal_validate',
      'portal_apply',
      'portal_status',
      'portal_resume',
      'portal_cancel',
    ])
    .optional(),
}).strict();
const activityIds = {
  workflowId: z.string().uuid().optional(),
  runId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
};
export const ClientActivitySchema = z
  .object({
    type: ClientActivityTypeSchema,
    ...activityIds,
    metadata: ClientActivityMetadataSchema.default({}),
  })
  .strict();
export const ActivityDraftSchema = z
  .object({
    type: ActivityTypeSchema,
    source: z.enum(['client', 'server', 'service']),
    status: z.enum(['intent', 'started', 'succeeded', 'failed', 'unknown', 'observed']),
    actor: z.enum(['local-owner', 'unverified-request']),
    sessionId: z.string().uuid(),
    requestId: z.string().uuid(),
    ...activityIds,
    metadata: ActivityMetadataSchema.default({}),
  })
  .strict();
export const ActivitySchema = ActivityDraftSchema.extend({
  id: z.string().uuid(),
  sequence: z.number().int().positive().safe(),
  at: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type Activity = z.infer<typeof ActivitySchema>;
export type ActivityDraft = z.infer<typeof ActivityDraftSchema>;
export const ActivityQuerySchema = z
  .object({
    after: z.coerce.number().int().min(0).safe().default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    type: ActivityTypeSchema.optional(),
    workflowId: z.string().uuid().optional(),
    runId: z.string().uuid().optional(),
    source: ActivityDraftSchema.shape.source.optional(),
    status: ActivityDraftSchema.shape.status.optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export function activityFigmaScope(
  value: unknown,
): Pick<z.infer<typeof ActivityMetadataSchema>, 'figmaFileKey' | 'figmaNodeId'> {
  try {
    const url = new URL(String(value));
    const fileKey = /^\/(?:design|file)\/([A-Za-z0-9]{10,128})(?:\/|$)/u.exec(url.pathname)?.[1];
    if (
      url.protocol !== 'https:' ||
      !['www.figma.com', 'figma.com'].includes(url.hostname) ||
      !fileKey
    )
      return {};
    const nodeId = url.searchParams.get('node-id')?.replace(/^(\d+)-(\d+)$/u, '$1:$2');
    return {
      figmaFileKey: fileKey,
      ...(nodeId && /^I?\d+:\d+(?:;I?\d+:\d+)*$/u.test(nodeId) && nodeId.length <= 512
        ? { figmaNodeId: nodeId }
        : {}),
    };
  } catch {
    return {};
  }
}
export const ActionSchema = z
  .object({ action: z.enum(actionNames), args: z.record(z.string(), z.unknown()).default({}) })
  .strict();
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new PortalError(
      'INVALID_REQUEST',
      'The request does not match the supported schema.',
      400,
      result.error.issues.slice(0, 30).map(i => ({ path: i.path.join('.'), message: i.message })),
    );
  return result.data;
}
export function defaultWorkflow(): WorkflowInput {
  const plan = PortalPlanArgsSchema.parse({
    case: 'new-blank',
    design: { source: 'chrome', collector: 'page-api' },
    targetPath: 'generated-frontend',
  });
  return {
    name: 'Figma 생성 워크플로',
    description: '',
    workspaceId: null,
    plan,
    graph: {
      nodes: nodeTypes.map((type, i) => ({
        id: type,
        type,
        label: ['Figma 소스', '요구사항 분석', '프런트엔드 생성', '검증', '적용 및 결과'][i]!,
        position: [
          { x: 80, y: 120 },
          { x: 380, y: 120 },
          { x: 680, y: 120 },
          { x: 380, y: 330 },
          { x: 680, y: 330 },
        ][i]!,
        config: type === 'validation' ? { profileId: 'node-frontend' } : {},
      })),
      edges: nodeTypes
        .slice(1)
        .map((type, i) => ({ id: `edge-${i}`, source: nodeTypes[i]!, target: type })),
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  };
}
export function validateWorkflow(input: unknown): { valid: boolean; issues: Issue[] } {
  let value: WorkflowInput;
  try {
    value = parse(WorkflowInputSchema, input);
  } catch (e) {
    return {
      valid: false,
      issues:
        e instanceof PortalError ? (e.issues ?? []) : [{ path: '', message: 'Invalid workflow' }],
    };
  }
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (!value.workspaceId) add('workspaceId', 'Choose a registered workspace before execution.');
  const nodes = new Map(value.graph.nodes.map(n => [n.id, n]));
  if (nodes.size !== value.graph.nodes.length) add('graph.nodes', 'Node IDs must be unique.');
  if (new Set(value.graph.edges.map(e => e.id)).size !== value.graph.edges.length)
    add('graph.edges', 'Edge IDs must be unique.');
  for (const type of nodeTypes)
    if (value.graph.nodes.filter(n => n.type === type).length !== 1)
      add('graph.nodes', `Execution requires exactly one ${type} node.`);
  const outgoing = new Map<string, string[]>();
  const pairs = new Set<string>();
  for (const edge of value.graph.edges) {
    const source = nodes.get(edge.source),
      target = nodes.get(edge.target);
    if (!source || !target) add('graph.edges', 'Edges must reference existing nodes.');
    else if (nodeTypes.indexOf(target.type) !== nodeTypes.indexOf(source.type) + 1)
      add(
        'graph.edges',
        'Unsupported transition. Connect source, requirements, generation, validation and output in order.',
      );
    const pair = `${edge.source}/${edge.target}`;
    if (pairs.has(pair)) add('graph.edges', 'Duplicate connections are unsupported.');
    pairs.add(pair);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of outgoing.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (value.graph.nodes.some(n => visit(n.id)))
    add('graph.edges', 'The workflow contains a cycle.');
  if (value.graph.edges.length !== 4)
    add(
      'graph.edges',
      'Connect all five stages with four edges. Branches are not supported by the current service.',
    );
  for (let i = 0; i < nodeTypes.length - 1; i++) {
    const a = value.graph.nodes.find(n => n.type === nodeTypes[i]),
      b = value.graph.nodes.find(n => n.type === nodeTypes[i + 1]);
    if (a && b && !pairs.has(`${a.id}/${b.id}`))
      add('graph.edges', `Connect ${a.type} to ${b.type}.`);
  }
  for (const node of value.graph.nodes)
    if (node.type !== 'validation' && node.config.profileId)
      add('graph.nodes', 'Only validation nodes accept a native profile.');
  return { valid: issues.length === 0, issues };
}
export function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 35) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, 10000).map(v => safeValue(v, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) =>
            !/^(?:authorization|cookie|password|secret|credential|credentials|apiKey|accessToken|refreshToken|clientSecret)$/iu.test(
              k,
            ),
        )
        .map(([k, v]) => [k, safeValue(v, depth + 1)]),
    );
  return value;
}
export function publicError(error: unknown): PortalError {
  const observed = (error as { code?: unknown } | null)?.code;
  const code =
    typeof observed === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(observed)
      ? observed
      : 'SERVICE_UNAVAILABLE';
  const messages: Record<string, string> = {
    LOCAL_CAPTURE_RECOVERY_UNAVAILABLE:
      '로컬 실행 또는 소스 정리를 확인하지 못했습니다. 기존 unknown 결과와 증거를 유지하고 진행 중인 작업을 확인해 주세요.',
    LOCAL_CAPTURE_WORKSPACE_UNAVAILABLE:
      '원래 작업 공간의 현재 식별을 확인하지 못했습니다. 등록된 작업 공간과 기존 증거를 확인해 주세요.',
    LOCAL_CAPTURE_RECOVERY_CONFIRMATION_INVALID:
      '확인이 만료됐거나 원래 작업과 일치하지 않습니다. 현재 기록을 다시 검토하고 직접 확인해 주세요.',
    LOCAL_CAPTURE_PRE_EFFECT_FAILURE:
      '수집 변경을 시작하기 전에 요청이 실패했습니다. 요청 ID로 서버 로그의 원인을 확인해 주세요.',
    CHROME_SOURCE_CLEANUP_UNCONFIRMED:
      '이전 Chrome 소스 작업 또는 정리가 아직 확인되지 않았습니다. 원래 결과와 증거를 유지하고 진행 상태를 확인해 주세요.',
    ACTIVITY_CAPACITY:
      '활동 기록 용량에 도달했습니다. 기존 기록은 유지됩니다. 기록을 보존한 뒤 운영자에게 새 기록 공간을 준비해 달라고 요청해 주세요.',
    ACTIVITY_WRITE_FAILED:
      '작업 기록을 저장하지 못했습니다. 이미 처리된 작업일 수 있으므로 기존 상태를 먼저 확인해 주세요.',
    SERVICE_UNAVAILABLE:
      '서비스에 연결할 수 없습니다. 로컬 서비스를 시작한 뒤 상태를 새로고침해 주세요.',
    CONTROL_NOT_READY:
      '서비스 연결 준비가 끝나지 않았습니다. 로컬 서비스를 확인한 뒤 다시 시도해 주세요.',
    CONTROL_AUTH_BUSY:
      '서비스가 다른 요청을 처리하고 있습니다. 기존 실행 상태를 먼저 확인한 뒤 상태를 새로고침해 주세요.',
    CONTROL_CREDENTIAL_CHANGED:
      '서비스 연결 정보가 바뀌었습니다. 로컬 포털과 서비스의 실행 상태를 확인해 주세요.',
    ENOENT: '폴더가 존재하지 않습니다. 먼저 로컬 폴더를 만든 뒤 전체 경로를 입력해 주세요.',
    ENOTDIR: '파일이 아닌 폴더를 선택해 주세요.',
    EACCES: '폴더에 접근할 수 없습니다. 현재 사용자에게 폴더 접근 권한이 있는지 확인해 주세요.',
    EPERM: '이 작업에 필요한 권한이 없습니다. 폴더와 서비스 접근 권한을 확인해 주세요.',
    INVALID_REQUEST: '입력값을 확인해 주세요. 표시된 항목을 수정한 뒤 다시 시도하세요.',
    INVALID_JSON: '요청을 읽을 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
    CSRF_REJECTED: '화면을 새로고침한 뒤 다시 시도해 주세요.',
    ORIGIN_REJECTED: '이 포털과 같은 주소에서 보낸 요청만 사용할 수 있습니다.',
    HOST_REJECTED: '로컬 포털 주소로 다시 접속해 주세요.',
    WORKSPACE_UNAVAILABLE: '사용 가능한 작업 폴더를 등록하거나 선택해 주세요.',
    WORKSPACE_ROOT_UNAVAILABLE:
      '등록된 폴더가 이동되었거나 바뀌었습니다. 기존 등록을 점검한 뒤 다시 선택해 주세요.',
    WORKSPACE_REGISTRATION_UNCONFIRMED:
      '등록 결과를 확인하지 못했습니다. 폴더 목록을 새로고침하고 중복 등록 전에 확인해 주세요.',
    WORKSPACE_REGISTRATION_UNAVAILABLE:
      '이 서비스 연결에서는 폴더를 등록할 수 없습니다. 서비스를 확인한 뒤 새로고침해 주세요.',
    REVISION_CONFLICT:
      '저장된 워크플로가 변경되었습니다. 최신 내용을 다시 불러온 뒤 저장해 주세요.',
    WORKFLOW_INVALID: '실행에 필요한 설정이 부족합니다. 준비 항목과 워크플로 설정을 확인해 주세요.',
    FIGMA_TAB_NOT_FOUND:
      '해당 Figma 파일을 Chrome에 열어 주세요. 기존 실행 결과를 확인한 뒤 새 실행을 시작하세요.',
    FIGMA_LOGIN_REQUIRED: 'Chrome에서 Figma에 직접 로그인한 뒤 해당 파일을 열어 주세요.',
    CHROME_CONNECTION_REQUIRED:
      'Chrome 연결이 필요합니다. 원격 제어 허용 창과 기존 실행 결과를 확인해 주세요.',
    CHROME_INITIALIZATION_TIMEOUT:
      'Chrome 연결 준비가 시간 안에 끝나지 않았습니다. 허용 창과 기존 실행 결과를 먼저 확인해 주세요.',
    RUN_OUTCOME_UNKNOWN:
      '이전 작업의 결과가 아직 확정되지 않았습니다. 기존 작업을 확인하고 해결한 뒤 새 실행을 시작하세요.',
    RECONCILIATION_REQUIRED:
      '결과가 확정되지 않은 작업을 먼저 조회하고 확인해야 계속할 수 있습니다.',
    RUN_BUSY: '이 워크플로에서 작업이 진행 중입니다. 기존 실행을 먼저 확인해 주세요.',
    RUN_LIMIT:
      '동시에 진행할 수 있는 작업 수에 도달했습니다. 진행 중인 작업이 끝난 뒤 다시 시도해 주세요.',
    APPROVAL_NOT_FOUND: '현재 실행에 유효한 승인 요청이 없습니다. 실행 상태를 새로고침해 주세요.',
    ACTION_UNAVAILABLE:
      '현재 실행 상태에서 사용할 수 없는 작업입니다. 실행 결과와 다음 단계를 확인해 주세요.',
  };
  return new PortalError(
    code,
    messages[code] ??
      (error instanceof PortalError
        ? error.message
        : '요청을 완료하지 못했습니다. 새 작업을 실행하기 전에 기존 실행 결과를 확인해 주세요.'),
    error instanceof PortalError
      ? error.status
      : ['ENOENT', 'ENOTDIR'].includes(code)
        ? 400
        : ['EACCES', 'EPERM'].includes(code)
          ? 403
          : 503,
    error instanceof PortalError ? error.issues : undefined,
  );
}
