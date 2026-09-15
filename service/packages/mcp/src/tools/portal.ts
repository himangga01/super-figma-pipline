import { PORTAL_INPUT_SCHEMAS, PORTAL_TOOL_NAMES, type PortalToolName } from '@sfp/shared';

import type { RawToolSpec } from './spec.js';

const descriptions: Record<PortalToolName, string> = {
  portal_plan:
    'Analyze a Figma-to-portal request and its explicitly registered legacy/reference service roots. New without a reference selects frontend-only C4; legacy/reference strategies retain all required service layers. Does not execute repository code.',
  portal_start:
    'Start the signed portal plan. Draft operational workflows enter needs-input. Use portal_next to read evidence, then create a new portal_plan with confirmed workflow requirements before claiming a coding lease. Starting a run does not generate code by itself.',
  portal_next:
    'Claim or renew a session-bound coding lease and retrieve paginated, hash-bound source evidence and the portal blueprint. Return English Markdown documents. Learn relevant service patterns and implement every required layer.',
  portal_submit:
    'Submit bounded actual candidate source files under the coding lease. Exact original hashes are required for replacements. This stores a candidate; it does not modify the target repository.',
  portal_validate:
    'Validate a candidate or applied portal using an owner-reviewed native execution profile in a separate work copy. Docker is prohibited. Native execution uses the owner account and is not an OS sandbox. Missing profiles or required acceptance evidence keep the run incomplete.',
  portal_apply:
    'Apply a fully validated candidate only to its approved target, using exact preimage hashes and durable write intents. Reference repositories remain read-only. Completion additionally requires validation of the applied result.',
  portal_status:
    "Read the same owner's persisted portal status, evidence references and outstanding issues. Remains available when a repository is offline.",
  portal_resume:
    'Resume an interrupted portal coding/validation workflow within its original budget. Uncertain source effects require reconciliation; resume never silently overwrites them.',
  portal_cancel:
    'Fence new coding submissions and stop only native work owned by this portal run. Preserve source effects and evidence for reconciliation.',
};
export const PORTAL_TOOL_SPECS: readonly RawToolSpec[] = PORTAL_TOOL_NAMES.map(name => ({
  name,
  description: descriptions[name],
  inputSchema: PORTAL_INPUT_SCHEMAS[name],
  kind: 'local',
  serverOnlyArgs: null,
}));
