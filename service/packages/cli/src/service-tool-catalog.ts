import { ALL_TOOL_SPECS } from '../../mcp/src/tools/registry.js';

export interface ServiceToolDescriptor {
  name: string;
  description: string;
  group: string;
  kind: 'local' | 'read' | 'write';
  destructive: boolean;
  inputSchema: unknown;
  handlerAuthority: string;
  confirmationRequired: false;
  approval: 'service-policy';
  executionProof: 'single-operation';
  prerequisites: string[];
}
export interface ParsedServiceTool {
  name: string;
  kind: 'local' | 'read' | 'write';
  args: Record<string, unknown>;
  targetRequirement: 'forbidden' | 'optional' | 'required';
  destructive: boolean;
}

/** Public metadata for the same closed registry used by the daemon and CLI. */
export function serviceTools(): ServiceToolDescriptor[] {
  return ALL_TOOL_SPECS.map(spec => ({
    name: spec.name,
    description: spec.description,
    group: spec.name.startsWith('portal_')
      ? 'portal-tools'
      : spec.handlerAuthority === 'plugin-handler'
        ? 'figma-tools'
        : 'service-tools',
    kind: spec.kind,
    destructive: spec.destructive === true,
    inputSchema: spec.inputSchema.toJSONSchema(),
    handlerAuthority: spec.handlerAuthority,
    confirmationRequired: false,
    approval: 'service-policy' as const,
    executionProof: 'single-operation' as const,
    prerequisites:
      spec.name === 'portal_plan' || spec.name === 'portal_validate'
        ? [
            'The selected source must satisfy the service capture and freshness requirements. Use the guided workflow by default.',
          ]
        : spec.handlerAuthority === 'plugin-handler'
          ? [
              'An authorized paired Figma target is required. Chrome page capture is a separate workflow.',
            ]
          : [
              'The service validates workspace, input-dependent target, policy and approval requirements before execution.',
            ],
  }));
}

/** No caller program or unregistered tool name can enter this parser. */
export function parseServiceTool(name: string, input: unknown): ParsedServiceTool {
  const spec = ALL_TOOL_SPECS.find(candidate => candidate.name === name);
  if (!spec) throw Object.assign(Error('SERVICE_TOOL_UNKNOWN'), { code: 'SERVICE_TOOL_UNKNOWN' });
  const parsed = spec.inputSchema.safeParse(input);
  if (!parsed.success)
    throw Object.assign(Error('SERVICE_TOOL_ARGUMENTS_INVALID'), {
      code: 'SERVICE_TOOL_ARGUMENTS_INVALID',
      issues: parsed.error.issues
        .slice(0, 30)
        .map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    });
  return {
    name: spec.name,
    kind: spec.kind,
    args: parsed.data as Record<string, unknown>,
    targetRequirement: spec.targetRequirementFor(parsed.data),
    destructive: spec.destructive === true,
  };
}
