import type { ApprovalPromptV1 } from '@sfp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useApprovals } from '../../ui/composables/useApprovals.js';

const prompt = (): ApprovalPromptV1 => ({
  version: 1,
  type: 'approval.prompt',
  approvalId: `sfp_ap1_${'A'.repeat(22)}`,
  operationId: 'operation-1',
  operationKind: 'tool',
  operationName: 'create_frame',
  channel: 'plugin-session',
  promptHash: `sha256:${'a'.repeat(64)}`,
  effectSummary: ['figma-write:non-destructive'],
  target: { label: 'Current file', fileIdentityHash: `sha256:${'b'.repeat(64)}`, targetCount: 1 },
  issuedAt: Date.now(),
  expiresAt: Date.now() + 60_000,
});
afterEach(() => vi.useRealTimers());

describe('approval UI lifetime', () => {
  it('binds a human decision to the displayed operation and shares duplicate deliveries', async () => {
    const state = useApprovals();
    const request = prompt();
    const result = state.receive(request);
    expect(state.receive(request)).toBe(result);
    state.decide(request.approvalId, 'approved');
    state.decide(request.approvalId, 'rejected');
    await expect(result).resolves.toMatchObject({
      decision: 'approved',
      operationId: request.operationId,
      promptHash: request.promptHash,
    });
    expect(state.prompts.value).toEqual([]);
  });
  it('expires without approval and rejects an identity-changing duplicate', async () => {
    vi.useFakeTimers();
    const state = useApprovals(),
      request = prompt();
    const result = state.receive(request);
    const expired = result.catch(error => error as Error);
    await expect(
      state.receive({ ...request, promptHash: `sha256:${'c'.repeat(64)}` }),
    ).rejects.toThrow('APPROVAL_HASH_MISMATCH');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await expired).toMatchObject({ message: 'APPROVAL_EXPIRED' });
    expect(state.prompts.value).toEqual([]);
  });
  it('clears pending decisions when the paired connection ends', async () => {
    const state = useApprovals();
    const request = state.receive(prompt());
    const rejected = request.catch(error => error as Error);
    state.clear();
    expect(await rejected).toMatchObject({ message: 'APPROVAL_DISCONNECTED' });
    expect(state.prompts.value).toEqual([]);
  });
});
