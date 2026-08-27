import { RESULT_SCHEMAS } from '../../../shared/src/result-schemas.js';

export type RuntimeAuthority = 'plugin' | 'server';

export interface RuntimeExecutionContext {
  execute(
    toolName: string,
    args: unknown,
    signal: AbortSignal,
    authority: RuntimeAuthority,
  ): Promise<unknown>;
}

export interface ToolRuntime<I = unknown, O = unknown> {
  execute(context: RuntimeExecutionContext, args: I, signal: AbortSignal): Promise<O>;
}

export interface RuntimeBinding<I = unknown, O = unknown> {
  authority: RuntimeAuthority;
  runtime: ToolRuntime<I, O>;
}

export type RuntimeRegistry = Readonly<Record<string, RuntimeBinding>>;

export const createRuntimeRegistry = (
  entries: readonly (readonly [name: string, binding: RuntimeBinding])[],
): RuntimeRegistry => {
  const registry: Record<string, RuntimeBinding> = Object.create(null) as Record<
    string,
    RuntimeBinding
  >;
  for (const [name, binding] of entries) {
    if (registry[name] !== undefined) throw new Error(`duplicate runtime: ${name}`);
    registry[name] = binding;
  }
  return Object.freeze(registry);
};

// These are the baseline tools with no same-name sandbox handler. The exported exception set below
// is derived from the finished runtime authority rather than repeating this classification.
const SERVER_AUTHORITY_NAMES = new Set([
  'save_screenshots',
  'analyze_project',
  'scan_components',
  'component_map',
  'token_map',
  'icon_map',
  'design_diff',
]);

const runtimeBinding = (toolName: string): RuntimeBinding => {
  const authority: RuntimeAuthority = SERVER_AUTHORITY_NAMES.has(toolName) ? 'server' : 'plugin';
  return Object.freeze({
    authority,
    runtime: Object.freeze({
      execute: (context: RuntimeExecutionContext, args: unknown, signal: AbortSignal) =>
        context.execute(toolName, args, signal, authority),
    }),
  });
};

for (const name of SERVER_AUTHORITY_NAMES) {
  if (RESULT_SCHEMAS[name] === undefined)
    throw new Error(`server runtime without result schema: ${name}`);
}

export const TOOL_RUNTIMES = createRuntimeRegistry(
  Object.keys(RESULT_SCHEMAS)
    .toSorted()
    .map(name => [name, runtimeBinding(name)] as const),
);

/** The canonical server-only exception set, projected from runtime authority. */
export const SERVER_ONLY_TOOLS: ReadonlySet<string> = new Set(
  Object.entries(TOOL_RUNTIMES)
    .filter(([, binding]) => binding.authority === 'server')
    .map(([name]) => name),
);

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

/** Execute one bound runtime and validate its raw value before any presentation or egress adapter. */
export const executeToolRuntime = async (
  toolName: string,
  context: RuntimeExecutionContext,
  args: unknown,
  signal: AbortSignal,
): Promise<unknown> => {
  const binding = TOOL_RUNTIMES[toolName];
  if (binding === undefined) throw new Error(`missing runtime: ${toolName}`);
  const schema = RESULT_SCHEMAS[toolName];
  if (schema === undefined) throw new Error(`missing result schema: ${toolName}`);

  const raw = await binding.runtime.execute(context, args, signal);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const code = binding.authority === 'plugin' ? 'PLUGIN_RESULT_INVALID' : 'SERVER_RESULT_INVALID';
    throw new ToolResultInvalidError(code, toolName, parsed.error.issues);
  }
  return parsed.data;
};
