import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import {
  FigmaOAuthBindingSchema,
  FigmaOAuthCleanupInputSchema,
  FigmaOAuthCodeSchema,
  FigmaOAuthConfigurationSchema,
  FigmaOAuthConfigureInputSchema,
  FigmaOAuthHandoffInputSchema,
  FigmaOAuthRefreshInputSchema,
  FigmaOAuthStartInputSchema,
  FigmaOAuthStatusSchema,
  parseFigmaOAuth,
  type FigmaOAuthBinding,
  type FigmaOAuthStatus,
} from '../../mcp/src/control/figma-oauth-contract.js';
import { parse, PortalError } from './contract.js';

export const FigmaEndpointSchema = z.enum([
  'https://mcp.figma.com/mcp',
  'http://127.0.0.1:3845/mcp',
]);
const environmentName = z
  .string()
  .max(128)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/u,
    'OAuth 토큰 값 대신 서비스 운영자가 지정한 환경 변수 이름을 입력하세요.',
  );
const legacyConfiguration = z
  .object({
    endpoint: FigmaEndpointSchema,
    oauthTokenEnv: environmentName.nullable(),
  })
  .strict()
  .refine(value => value.endpoint === 'https://mcp.figma.com/mcp' || value.oauthTokenEnv === null, {
    message: 'Desktop 서버에는 원격 OAuth 환경 변수를 사용하지 않습니다.',
  });
const configuration = z.union([legacyConfiguration, FigmaOAuthConfigurationSchema]);
const statusSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal('daemon-generation-provider'),
    providerInstanceId: z.string().uuid(),
    configurationRecognized: z.boolean(),
    oauthTokenEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
      .nullable(),
    credentialAvailable: z.boolean(),
    oauthLoginImplemented: z.boolean(),
    clientRegistration: z.literal('unverified'),
  })
  .strict();
const probeSchema = z
  .object({
    schemaVersion: z.literal(1),
    endpoint: FigmaEndpointSchema,
    checkedAt: z.string().datetime(),
    status: z.enum(['connected', 'auth-required', 'unavailable', 'cancelled']),
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,127}$/u)
      .nullable(),
    authentication: statusSchema,
    tools: z
      .array(
        z.enum([
          'get_design_context',
          'get_metadata',
          'get_variable_defs',
          'get_screenshot',
          'get_code_connect_map',
        ]),
      )
      .max(5),
    programCaptureSupported: z.boolean(),
    fullCapture: z.literal(false),
  })
  .strict();
const revision = z.number().int().nonnegative().safe();
const configurePreference = FigmaOAuthConfigureInputSchema.extend({ revision }).strict();
const readTarget = z
  .object({
    fileKey: z.string().regex(/^[A-Za-z0-9_-]{10,128}$/u),
    nodeId: z
      .string()
      .max(128)
      .regex(/^\d+:\d+$/u),
  })
  .strict();
const readTool = z.enum([
  'get_design_context',
  'get_metadata',
  'get_variable_defs',
  'get_screenshot',
  'get_code_connect_map',
]);
export const FigmaSettingsReadInputSchema = z
  .object({ revision, target: readTarget, tool: readTool })
  .strict();
const readResult = z
  .object({
    source: z.literal('official-figma-mcp'),
    endpoint: FigmaEndpointSchema,
    requestedTarget: readTarget,
    tool: readTool,
    identityBinding: z.enum(['request-only', 'desktop-active-file-unverified']),
    result: z.unknown(),
    fullCapture: z.literal(false),
    authentication: statusSchema,
    checkedAt: z.string().datetime(),
  })
  .strict();
const recordSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision,
    configuration,
    updatedAt: z.string().datetime().nullable(),
    lastProbe: z
      .object({
        settingsRevision: revision,
        result: probeSchema,
        authBinding: FigmaOAuthBindingSchema.optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();
type SettingsRecord = z.infer<typeof recordSchema>;
export interface FigmaSettingsControl {
  figmaMcpStatus?(): Promise<unknown>;
  figmaMcpProbe?(endpoint: string): Promise<unknown>;
  figmaMcpRead?(input: {
    endpoint: string;
    target: { fileKey: string; nodeId: string };
    tool: z.infer<typeof readTool>;
  }): Promise<unknown>;
  figmaMcpAuthStatus?(): Promise<unknown>;
  figmaMcpAuthConfigure?(input: unknown, beforeRequest?: () => Promise<void>): Promise<unknown>;
  figmaMcpAuthAction?(
    action: 'start' | 'cancel' | 'logout' | 'refresh',
    input: unknown,
    beforeRequest?: () => Promise<void>,
  ): Promise<unknown>;
  figmaMcpAuthHandoff?(
    input: unknown,
    deliverLocation: (location: URL) => void,
    beforeRequest?: () => Promise<void>,
  ): Promise<void>;
}
const authBinding = (status: FigmaOAuthStatus): FigmaOAuthBinding => ({
  providerInstanceId: status.providerInstanceId,
  configurationGeneration: status.configurationGeneration,
  authGeneration: status.authGeneration,
});
const sameBinding = (a: FigmaOAuthBinding | undefined, b: FigmaOAuthBinding) =>
  a?.providerInstanceId === b.providerInstanceId &&
  a.configurationGeneration === b.configurationGeneration &&
  a.authGeneration === b.authGeneration;
const safeAuthError = (error: unknown): PortalError => {
  try {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'RUN_OUTCOME_UNKNOWN' || code === 'SERVICE_JOB_OUTCOME_UNKNOWN')
      return new PortalError(
        code,
        'Review the retained unknown operation before changing authorization.',
        409,
      );
  } catch {
    /* Unknown error getters remain opaque. */
  }
  let code: z.infer<typeof FigmaOAuthCodeSchema> = 'FIGMA_MCP_OAUTH_RESPONSE_REJECTED';
  try {
    const result = FigmaOAuthCodeSchema.safeParse((error as { code?: unknown } | null)?.code);
    if (result.success) code = result.data;
  } catch {
    /* Private errors remain opaque. */
  }
  return new PortalError(
    code,
    'The official Figma authorization request could not be completed. Check the reported prerequisite or refresh its current status.',
    409,
  );
};

/** Persists public preferences only. The daemon retains and resolves every actual credential. */
export class PortalFigmaSettings {
  private queue: Promise<unknown> = Promise.resolve();
  private probing = false;
  private constructor(
    private readonly directory: string,
    private record: SettingsRecord,
    private readonly control: FigmaSettingsControl,
    private readonly admitMutation: (() => Promise<void>) | undefined,
  ) {}

  static async open(
    directory: string,
    control: FigmaSettingsControl,
    admitMutation?: () => Promise<void>,
  ): Promise<PortalFigmaSettings> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let record: SettingsRecord = {
      schemaVersion: 1,
      revision: 0,
      configuration: { endpoint: 'https://mcp.figma.com/mcp', oauthTokenEnv: null },
      updatedAt: null,
      lastProbe: null,
    };
    try {
      const path = join(directory, 'figma-settings.json');
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
        throw new Error('Invalid settings file');
      const bytes = await readFile(path);
      if (bytes.length > 65536) throw new Error('Oversized settings');
      record = recordSchema.parse(JSON.parse(bytes.toString('utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new PortalError(
          'FIGMA_SETTINGS_INVALID',
          '저장된 연결 설정을 안전하게 읽지 못했습니다. 파일을 보존하고 점검해 주세요.',
          500,
        );
    }
    return new PortalFigmaSettings(directory, record, control, admitMutation);
  }

  /* eslint-disable promise/no-callback-in-promise -- one atomic settings publication serializes revision changes */
  private write(change: (record: SettingsRecord) => void | Promise<void>): Promise<void> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.record);
      await change(next);
      const bytes = JSON.stringify(recordSchema.parse(next));
      const path = join(this.directory, `figma-settings-${randomUUID()}.tmp`);
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      await rename(path, join(this.directory, 'figma-settings.json'));
      this.record = next;
      return undefined;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  /* eslint-enable promise/no-callback-in-promise */

  async get() {
    const record = structuredClone(this.record);
    let daemon: z.infer<typeof statusSchema> | null = null;
    try {
      if (this.control.figmaMcpStatus)
        daemon = statusSchema.parse(await this.control.figmaMcpStatus());
    } catch {
      /* Old/unavailable daemons remain explicitly unverified. */
    }
    let authorization: FigmaOAuthStatus | null = null;
    try {
      if (this.control.figmaMcpAuthStatus) authorization = await this.authStatus();
    } catch {
      /* Old daemons are explicitly unsupported. */
    }
    const remote = record.configuration.endpoint === 'https://mcp.figma.com/mcp';
    const desiredApplied =
      daemon !== null &&
      ('mode' in record.configuration
        ? authorization !== null &&
          authorization.providerInstanceId === daemon.providerInstanceId &&
          JSON.stringify(record.configuration) === JSON.stringify(authorization.configuration)
        : !remote ||
          (daemon.configurationRecognized &&
            daemon.oauthTokenEnv === record.configuration.oauthTokenEnv));
    const credentialConfigured = !remote || Boolean(desiredApplied && daemon?.credentialAvailable);
    const freshProbe =
      record.lastProbe?.settingsRevision === record.revision &&
      record.lastProbe.result.endpoint === record.configuration.endpoint
        ? record.lastProbe.result
        : null;
    const probeUsesCurrentAuth =
      freshProbe !== null &&
      daemon !== null &&
      freshProbe.authentication.providerInstanceId === daemon.providerInstanceId &&
      freshProbe.authentication.oauthTokenEnv === daemon.oauthTokenEnv &&
      freshProbe.authentication.credentialAvailable === daemon.credentialAvailable &&
      (!daemon.oauthLoginImplemented ||
        (authorization !== null &&
          authorization.providerInstanceId === daemon.providerInstanceId &&
          sameBinding(record.lastProbe?.authBinding, authBinding(authorization))));
    return {
      ...record,
      daemon,
      authorization,
      authentication: {
        method: remote
          ? authorization?.configuration.mode === 'own-oauth'
            ? 'service-owned-oauth'
            : 'service-authorized-oauth-environment'
          : 'figma-desktop-server',
        desiredApplied,
        credentialConfigured,
        restartRequired: remote && daemon !== null && !desiredApplied,
        loginImplemented: daemon?.oauthLoginImplemented ?? false,
        clientRegistration: 'unverified',
      },
      readyForCaptureAttempt: Boolean(
        desiredApplied &&
        credentialConfigured &&
        probeUsesCurrentAuth &&
        freshProbe?.status === 'connected' &&
        freshProbe.programCaptureSupported,
      ),
      fullCaptureAccepted: false,
      setup: {
        daemonSupportAvailable: daemon !== null,
        selectorVariable: 'SFP_FIGMA_MCP_OAUTH_TOKEN_ENV',
        suggestedCredentialVariable: 'SFP_FIGMA_MCP_OAUTH_TOKEN',
        documentation: remote
          ? 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/'
          : 'https://developers.figma.com/docs/figma-mcp-server/local-server-installation/',
        message: remote
          ? '이 서비스에 허용된 공식 MCP OAuth 인증이 필요합니다. 토큰을 화면에 붙여 넣지 마세요. 운영자가 서비스 프로세스의 지정 환경 변수를 준비하고, 진행 중인 Chrome 작업을 마친 뒤 서비스를 다시 시작해야 설정이 적용됩니다. 이 앱의 OAuth 로그인·클라이언트 등록은 아직 구현되지 않았습니다.'
          : 'Figma Desktop의 Dev Mode에서 공식 MCP 서버를 직접 켜세요. 연결 검사는 도구 목록을 확인할 뿐이며, 이 서비스의 전체 수집에 필요한 도구 지원과 실제 파일 수집은 별도로 확인합니다.',
      },
    };
  }

  async save(raw: unknown) {
    if (raw && typeof raw === 'object' && Object.hasOwn(raw, 'configuration')) {
      let input: z.infer<typeof configurePreference>;
      try {
        input = parseFigmaOAuth(configurePreference, raw);
      } catch (error) {
        throw safeAuthError(error);
      }
      if (!this.control.figmaMcpAuthConfigure)
        throw new PortalError(
          'FIGMA_MCP_DAEMON_UNSUPPORTED',
          'The running daemon does not implement own-service authorization.',
          503,
        );
      await this.write(async current => {
        if (current.revision !== input.revision)
          throw new PortalError(
            'FIGMA_SETTINGS_CONFLICT',
            'Refresh the current connection settings before saving.',
            409,
          );
        const { revision: _revision, ...request } = input;
        await this.admitMutation?.();
        let result: FigmaOAuthStatus;
        try {
          result = parseFigmaOAuth(
            FigmaOAuthStatusSchema,
            await this.control.figmaMcpAuthConfigure!(request, this.admitMutation),
          );
        } catch (error) {
          throw safeAuthError(error);
        }
        if (
          result.providerInstanceId !== input.providerInstanceId ||
          result.configurationGeneration < input.configurationGeneration ||
          result.authGeneration < input.authGeneration ||
          JSON.stringify(result.configuration) !== JSON.stringify(input.configuration)
        )
          throw new PortalError(
            'FIGMA_MCP_OAUTH_BINDING_MISMATCH',
            'The daemon configuration did not match this reviewed request.',
            409,
          );
        current.configuration = input.configuration;
        current.revision++;
        current.updatedAt = new Date().toISOString();
        current.lastProbe = null;
      });
      return this.get();
    }
    const input = parse(
      z
        .object({
          revision,
          endpoint: FigmaEndpointSchema,
          oauthTokenEnv: environmentName.nullable(),
        })
        .strict(),
      raw,
    );
    const value = parse(legacyConfiguration, {
      endpoint: input.endpoint,
      oauthTokenEnv: input.oauthTokenEnv,
    });
    await this.write(record => {
      if (record.revision !== input.revision)
        throw new PortalError(
          'FIGMA_SETTINGS_CONFLICT',
          '연결 설정이 바뀌었습니다. 최신 설정을 다시 읽고 저장하세요.',
          409,
        );
      record.configuration = value;
      record.revision++;
      record.updatedAt = new Date().toISOString();
      record.lastProbe = null;
    });
    return this.get();
  }

  async authStatus(): Promise<FigmaOAuthStatus> {
    if (!this.control.figmaMcpAuthStatus)
      throw new PortalError(
        'FIGMA_MCP_DAEMON_UNSUPPORTED',
        'The running daemon does not implement own-service authorization.',
        503,
      );
    try {
      return parseFigmaOAuth(FigmaOAuthStatusSchema, await this.control.figmaMcpAuthStatus());
    } catch (error) {
      throw safeAuthError(error);
    }
  }
  private async currentAuth(): Promise<FigmaOAuthStatus | null> {
    if (!this.control.figmaMcpAuthStatus) return null;
    try {
      return await this.authStatus();
    } catch (error) {
      if ('mode' in this.record.configuration) throw error;
      let implemented = false;
      try {
        if (this.control.figmaMcpStatus)
          implemented = statusSchema.parse(
            await this.control.figmaMcpStatus(),
          ).oauthLoginImplemented;
      } catch {
        /* Old daemon compatibility remains explicit. */
      }
      if (implemented) throw error;
      return null;
    }
  }
  async authAction(
    action: 'start' | 'cancel' | 'logout' | 'refresh',
    raw: unknown,
  ): Promise<FigmaOAuthStatus> {
    const schema =
      action === 'start'
        ? FigmaOAuthStartInputSchema
        : action === 'refresh'
          ? FigmaOAuthRefreshInputSchema
          : FigmaOAuthCleanupInputSchema;
    if (!this.control.figmaMcpAuthAction)
      throw new PortalError(
        'FIGMA_MCP_DAEMON_UNSUPPORTED',
        'The running daemon does not implement own-service authorization.',
        503,
      );
    try {
      const input = parseFigmaOAuth<
          FigmaOAuthBinding & { deadlineAt?: number; flowId?: string | null }
        >(schema, raw),
        before = await this.authStatus();
      if (!sameBinding(input, authBinding(before)))
        throw new PortalError(
          'FIGMA_MCP_OAUTH_BINDING_MISMATCH',
          'Authorization changed. Read its current status before continuing.',
          409,
        );
      const guard = action === 'start' || action === 'refresh' ? this.admitMutation : undefined;
      await guard?.();
      const result = parseFigmaOAuth(
        FigmaOAuthStatusSchema,
        await this.control.figmaMcpAuthAction(action, input, guard),
      );
      if (
        result.providerInstanceId !== input.providerInstanceId ||
        result.configurationGeneration !== input.configurationGeneration ||
        result.authGeneration < input.authGeneration
      )
        throw new PortalError(
          'FIGMA_MCP_OAUTH_BINDING_MISMATCH',
          'The response belongs to different authorization settings.',
          409,
        );
      return result;
    } catch (error) {
      throw safeAuthError(error);
    }
  }
  async authHandoff(raw: unknown, deliverLocation: (location: URL) => void): Promise<void> {
    if (!this.control.figmaMcpAuthHandoff)
      throw new PortalError(
        'FIGMA_MCP_DAEMON_UNSUPPORTED',
        'The running daemon does not implement private authorization handoff.',
        503,
      );
    try {
      const input = parseFigmaOAuth(FigmaOAuthHandoffInputSchema, raw),
        before = await this.authStatus();
      if (
        !sameBinding(input, authBinding(before)) ||
        input.flowId !== before.flowId ||
        !before.handoffAvailable
      )
        throw new PortalError(
          'FIGMA_MCP_OAUTH_BINDING_MISMATCH',
          'Read the current owner authorization flow before continuing.',
          409,
        );
      await this.admitMutation?.();
      await this.control.figmaMcpAuthHandoff(input, deliverLocation, this.admitMutation);
    } catch (error) {
      throw safeAuthError(error);
    }
  }

  async probe(raw: unknown) {
    const input = parse(z.object({ revision }).strict(), raw);
    const record = structuredClone(this.record);
    if (record.revision !== input.revision)
      throw new PortalError('FIGMA_SETTINGS_CONFLICT', '최신 연결 설정으로 다시 검사하세요.', 409);
    if (!this.control.figmaMcpProbe)
      throw new PortalError(
        'FIGMA_MCP_DAEMON_UNSUPPORTED',
        '현재 서비스는 연결 검사를 지원하지 않습니다. 진행 중인 작업을 마친 뒤 검증된 서비스를 다시 시작하세요.',
        503,
      );
    if (this.probing)
      throw new PortalError(
        'FIGMA_MCP_PROBE_BUSY',
        '이미 연결 검사 중입니다. 결과를 확인한 뒤 다시 시도하세요.',
        409,
      );
    this.probing = true;
    try {
      const beforeAuth = await this.currentAuth();
      let result: z.infer<typeof probeSchema>;
      try {
        result = probeSchema.parse(await this.control.figmaMcpProbe(record.configuration.endpoint));
      } catch {
        throw new PortalError(
          'FIGMA_MCP_PROBE_UNAVAILABLE',
          '서비스의 공식 MCP 연결 검사 결과를 확인하지 못했습니다. 서비스 버전과 연결 상태를 확인하세요.',
          503,
        );
      }
      if (result.endpoint !== record.configuration.endpoint)
        throw new PortalError(
          'FIGMA_MCP_PROBE_MISMATCH',
          '다른 연결의 검사 결과는 현재 설정에 적용할 수 없습니다.',
          502,
        );
      const afterAuth = await this.currentAuth();
      if (
        beforeAuth &&
        (!afterAuth ||
          !sameBinding(authBinding(beforeAuth), authBinding(afterAuth)) ||
          result.authentication.providerInstanceId !== beforeAuth.providerInstanceId)
      )
        throw new PortalError(
          'FIGMA_MCP_OAUTH_SUPERSEDED',
          'Authorization changed while this probe was running. Probe the current connection again.',
          409,
        );
      await this.write(current => {
        if (current.revision !== record.revision)
          throw new PortalError(
            'FIGMA_SETTINGS_CONFLICT',
            '검사 중 연결 설정이 바뀌었습니다. 이전 결과는 새 설정에 적용하지 않았습니다.',
            409,
          );
        current.lastProbe = {
          settingsRevision: record.revision,
          result,
          ...(afterAuth ? { authBinding: authBinding(afterAuth) } : {}),
        };
      });
      return this.get();
    } finally {
      this.probing = false;
    }
  }

  async read(raw: unknown) {
    const input = parse(FigmaSettingsReadInputSchema, raw);
    const record = structuredClone(this.record);
    if (input.revision !== record.revision)
      throw new PortalError('FIGMA_SETTINGS_CONFLICT', '최신 연결 설정으로 다시 읽어 주세요.', 409);
    if (!this.control.figmaMcpRead)
      throw new PortalError(
        'FIGMA_MCP_DAEMON_UNSUPPORTED',
        '현재 서비스는 공식 MCP 읽기를 지원하지 않습니다.',
        503,
      );
    if (this.probing)
      throw new PortalError('FIGMA_MCP_PROBE_BUSY', '이미 공식 MCP 요청을 처리하고 있습니다.', 409);
    this.probing = true;
    try {
      const beforeAuth = await this.currentAuth();
      let result: z.infer<typeof readResult>;
      try {
        result = readResult.parse(
          await this.control.figmaMcpRead({
            endpoint: record.configuration.endpoint,
            target: input.target,
            tool: input.tool,
          }),
        );
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        const safeCode =
          typeof code === 'string' &&
          /^FIGMA_MCP_(?:AUTH_REQUIRED|OAUTH_ENV_REQUIRED|READ_CANCELLED|READ_TOO_LARGE|READ_PRIVATE_DATA|TOOL_UNAVAILABLE|TARGET_UNSUPPORTED|INPUT_UNSUPPORTED|TOOL_FAILED)$/u.test(
            code,
          )
            ? code
            : 'FIGMA_MCP_READ_UNAVAILABLE';
        throw new PortalError(
          safeCode,
          '공식 MCP 읽기 결과를 확인하지 못했습니다. 연결 설정과 오류 코드를 확인하세요.',
          503,
        );
      }
      if (this.record.revision !== record.revision)
        throw new PortalError(
          'FIGMA_SETTINGS_CONFLICT',
          '읽는 동안 설정이 바뀌었습니다. 최신 설정으로 다시 읽어 주세요.',
          409,
        );
      const afterAuth = await this.currentAuth();
      if (
        beforeAuth &&
        (!afterAuth ||
          !sameBinding(authBinding(beforeAuth), authBinding(afterAuth)) ||
          result.authentication.providerInstanceId !== beforeAuth.providerInstanceId)
      )
        throw new PortalError(
          'FIGMA_MCP_OAUTH_SUPERSEDED',
          'Authorization changed while this read was running. Its old response cannot be published.',
          409,
        );
      if (
        result.endpoint !== record.configuration.endpoint ||
        result.tool !== input.tool ||
        result.requestedTarget.fileKey !== input.target.fileKey ||
        result.requestedTarget.nodeId !== input.target.nodeId
      )
        throw new PortalError(
          'FIGMA_MCP_READ_MISMATCH',
          '다른 파일이나 도구의 결과는 표시할 수 없습니다.',
          502,
        );
      if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024)
        throw new PortalError(
          'FIGMA_MCP_READ_TOO_LARGE',
          '읽기 결과가 화면 미리보기 크기 제한을 초과했습니다.',
          502,
        );
      return result;
    } finally {
      this.probing = false;
    }
  }

  bindWorkflow<T>(input: T): T {
    if (!input || typeof input !== 'object' || !('plan' in input)) return input;
    const plan = input.plan;
    if (!plan || typeof plan !== 'object' || !('design' in plan)) return input;
    const design = plan.design;
    if (
      !design ||
      typeof design !== 'object' ||
      !('source' in design) ||
      design.source !== 'official-mcp' ||
      'officialEndpoint' in design
    )
      return input;
    return {
      ...input,
      plan: {
        ...plan,
        design: { ...design, officialEndpoint: this.record.configuration.endpoint },
      },
    };
  }
}
