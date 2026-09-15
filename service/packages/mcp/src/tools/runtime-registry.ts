import type { ProgressReporter, RuntimeExecutionScope, ToolName } from '@sfp/shared';
import { PORTAL_TOOL_NAMES } from '@sfp/shared';

import { RESULT_SCHEMAS } from '../../../shared/src/result-schemas.js';

export type ExecutionAuthority = 'plugin-direct' | 'server-adapter';

export interface RuntimeActionContext {
  operationId: string;
  actionNonce: string;
}

export interface PinnedPluginRuntimePort {
  execute(
    scope: RuntimeExecutionScope,
    toolName: ToolName,
    args: unknown,
    signal: AbortSignal,
    reporter?: ProgressReporter,
    action?: Readonly<RuntimeActionContext>,
  ): Promise<unknown>;
}

export interface ServerAdapterRuntimePort {
  execute(
    scope: RuntimeExecutionScope,
    toolName: ToolName,
    args: unknown,
    signal: AbortSignal,
    plugin: PinnedPluginRuntimePort,
    reporter?: ProgressReporter,
    action?: Readonly<RuntimeActionContext>,
  ): Promise<unknown>;
}

export interface ToolRuntime<I = unknown, O = unknown> {
  execute(
    scope: RuntimeExecutionScope,
    args: I,
    signal: AbortSignal,
    reporter?: ProgressReporter,
    action?: Readonly<RuntimeActionContext>,
  ): Promise<O>;
}

export interface RuntimeBinding<I = unknown, O = unknown> {
  execution: ExecutionAuthority;
  runtime: ToolRuntime<I, O>;
}

export type RuntimeRegistry = Readonly<Record<string, RuntimeBinding>>;

export const BASELINE_SERVER_ADAPTER_NAMES = Object.freeze([
  ...PORTAL_TOOL_NAMES,
  'export_tokens',
  'export_frames_to_pdf',
  'doctor',
  'ping',
  'get_screenshot',
  'get_design_context',
  'save_screenshots',
  'save_image_fills',
  'export_pdf',
  'export_video',
  'analyze_project',
  'scan_components',
  'component_map',
  'token_map',
  'icon_map',
  'import_image',
  'design_diff',
] as const satisfies readonly ToolName[]);

const SERVER_ADAPTER_NAMES = new Set<ToolName>(BASELINE_SERVER_ADAPTER_NAMES);

// Handler parity is deliberately independent from execution routing. These seven tools have no
// same-name sandbox handler, while seven additional tools are daemon adapters around a handler.
const SERVER_HANDLER_NAMES = new Set<ToolName>([
  ...PORTAL_TOOL_NAMES,
  'export_tokens',
  'export_frames_to_pdf',
  'doctor',
  'save_screenshots',
  'analyze_project',
  'scan_components',
  'component_map',
  'token_map',
  'icon_map',
  'design_diff',
]);

export const createRuntimeRegistry = (
  entries: readonly (readonly [name: string, binding: RuntimeBinding])[],
): RuntimeRegistry => {
  const registry: Record<string, RuntimeBinding> = Object.create(null) as Record<
    string,
    RuntimeBinding
  >;
  for (const [name, binding] of entries) {
    if (registry[name] !== undefined) throw new Error(`duplicate runtime: ${name}`);
    registry[name] = Object.freeze(binding);
  }
  return Object.freeze(registry);
};

export type ToolResultInvalidCode = 'PLUGIN_RESULT_INVALID' | 'SERVER_RESULT_INVALID';

export class ToolResultInvalidError extends Error {
  readonly code: ToolResultInvalidCode;
  readonly toolName: string;
  readonly issues: readonly string[];

  constructor(
    code: ToolResultInvalidCode,
    toolName: string,
    issues: readonly { path: PropertyKey[]; message: string }[],
  ) {
    super(`[${code}] ${toolName} returned a result outside its canonical schema`);
    this.name = 'ToolResultInvalidError';
    this.code = code;
    this.toolName = toolName;
    this.issues = issues.map(
      issue => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`,
    );
  }
}

const validateResult = (toolName: string, raw: unknown, code: ToolResultInvalidCode): unknown => {
  const schema = RESULT_SCHEMAS[toolName];
  if (schema === undefined) throw new Error(`missing result schema: ${toolName}`);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ToolResultInvalidError(code, toolName, parsed.error.issues);
  return parsed.data;
};

/** Validate a raw plugin subcall before any server adapter is allowed to inspect it. */
export const createValidatedPinnedPluginRuntimePort = (
  raw: PinnedPluginRuntimePort,
): PinnedPluginRuntimePort =>
  Object.freeze({
    execute: async (
      scope: RuntimeExecutionScope,
      toolName: ToolName,
      args: unknown,
      signal: AbortSignal,
      reporter?: ProgressReporter,
      action?: Readonly<RuntimeActionContext>,
    ) =>
      validateResult(
        toolName,
        await raw.execute(scope, toolName, args, signal, reporter, action),
        'PLUGIN_RESULT_INVALID',
      ),
  });

/** Bind the closed execution authority to injected ports without putting Relay/session lookup here. */
export const createBoundRuntimeRegistry = (
  pinnedPlugin: PinnedPluginRuntimePort,
  serverAdapter: ServerAdapterRuntimePort,
): RuntimeRegistry => {
  const validatedPlugin = createValidatedPinnedPluginRuntimePort(pinnedPlugin);
  return createRuntimeRegistry(
    Object.keys(RESULT_SCHEMAS)
      .toSorted()
      .map(name => {
        const toolName = name as ToolName;
        const execution: ExecutionAuthority = SERVER_ADAPTER_NAMES.has(toolName)
          ? 'server-adapter'
          : 'plugin-direct';
        const runtime: ToolRuntime = Object.freeze({
          execute: (
            scope: RuntimeExecutionScope,
            args: unknown,
            signal: AbortSignal,
            reporter?: ProgressReporter,
            action?: Readonly<RuntimeActionContext>,
          ) =>
            execution === 'plugin-direct'
              ? validatedPlugin.execute(scope, toolName, args, signal, reporter, action)
              : serverAdapter.execute(
                  scope,
                  toolName,
                  args,
                  signal,
                  validatedPlugin,
                  reporter,
                  action,
                ),
        });
        return [name, Object.freeze({ execution, runtime })] as const;
      }),
  );
};

const unboundPlugin: PinnedPluginRuntimePort = Object.freeze({
  execute: async () => {
    throw new Error('pinned plugin runtime port is not bound');
  },
});

const unboundServerAdapter: ServerAdapterRuntimePort = Object.freeze({
  execute: async () => {
    throw new Error('server adapter runtime port is not bound');
  },
});

/** Static closed-world authority. Production planes use createBoundRuntimeRegistry. */
export const TOOL_RUNTIMES = createBoundRuntimeRegistry(unboundPlugin, unboundServerAdapter);

export type FakePinnedPluginHandler = (
  scope: RuntimeExecutionScope,
  toolName: ToolName,
  args: unknown,
  signal: AbortSignal,
  reporter: ProgressReporter,
) => Promise<unknown>;

const unavailableReporter: ProgressReporter = Object.freeze({
  report: () => undefined,
  throwIfCancelled: () => undefined,
});

/** Task7C fake only; Task9A owns the real plugin consumer and listener lifecycle. */
export const createFakePinnedPluginRuntimePort = (
  handler?: FakePinnedPluginHandler,
): PinnedPluginRuntimePort =>
  Object.freeze({
    execute: async (
      scope: RuntimeExecutionScope,
      toolName: ToolName,
      args: unknown,
      signal: AbortSignal,
      reporter: ProgressReporter = unavailableReporter,
    ) => {
      if (handler === undefined) {
        throw Object.assign(new Error('pinned plugin runtime is unavailable'), {
          code: 'PINNED_PLUGIN_RUNTIME_UNAVAILABLE',
        });
      }
      reporter.throwIfCancelled();
      return handler(scope, toolName, args, signal, reporter);
    },
  });

/** The canonical server-only handler exception set, independent from execution routing. */
export const SERVER_ONLY_TOOLS: ReadonlySet<string> = new Set(SERVER_HANDLER_NAMES);

/** Validate one already-produced legacy-path result during the staged 7A migration. */
export const validateToolRuntimeResult = (
  toolName: string,
  execution: ExecutionAuthority,
  raw: unknown,
): unknown =>
  validateResult(
    toolName,
    raw,
    execution === 'plugin-direct' ? 'PLUGIN_RESULT_INVALID' : 'SERVER_RESULT_INVALID',
  );

/** Execute one bound runtime and validate the adapter's final semantic result. */
export const executeToolRuntime = async (
  toolName: string,
  scope: RuntimeExecutionScope,
  args: unknown,
  signal: AbortSignal,
  registry: RuntimeRegistry = TOOL_RUNTIMES,
  reporter?: ProgressReporter,
  action?: Readonly<RuntimeActionContext>,
): Promise<unknown> => {
  const binding = registry[toolName];
  if (binding === undefined) throw new Error(`missing runtime: ${toolName}`);
  const raw = await binding.runtime.execute(scope, args, signal, reporter, action);
  return validateToolRuntimeResult(toolName, binding.execution, raw);
};
