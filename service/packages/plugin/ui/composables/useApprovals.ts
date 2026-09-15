import {
  ApprovalPromptV1Schema,
  type ApprovalDecisionV1,
  type ApprovalPromptV1,
} from '@sfp/shared';
import { computed, ref } from 'vue';

export const useApprovals = () => {
  const prompts = ref<ApprovalPromptV1[]>([]);
  const pending = new Map<
    string,
    {
      prompt: ApprovalPromptV1;
      promise: Promise<ApprovalDecisionV1>;
      resolve(value: ApprovalDecisionV1): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const remove = (id: string) => {
    const entry = pending.get(id);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    prompts.value = prompts.value.filter(prompt => prompt.approvalId !== id);
  };
  const receive = (input: ApprovalPromptV1): Promise<ApprovalDecisionV1> => {
    const prompt = ApprovalPromptV1Schema.parse(input);
    const delay = prompt.expiresAt - Date.now();
    if (delay <= 0 || delay > 900_000) return Promise.reject(new Error('APPROVAL_EXPIRED'));
    const existing = pending.get(prompt.approvalId);
    if (existing !== undefined) {
      if (
        existing.prompt.promptHash !== prompt.promptHash ||
        existing.prompt.operationId !== prompt.operationId
      )
        return Promise.reject(new Error('APPROVAL_HASH_MISMATCH'));
      return existing.promise;
    }
    if (pending.size >= 64) return Promise.reject(new Error('APPROVAL_CAPACITY_EXCEEDED'));
    let resolve!: (value: ApprovalDecisionV1) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<ApprovalDecisionV1>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const timer = setTimeout(() => {
      remove(prompt.approvalId);
      reject(new Error('APPROVAL_EXPIRED'));
    }, delay);
    pending.set(prompt.approvalId, { prompt, promise, resolve, reject, timer });
    prompts.value = [...prompts.value, prompt];
    return promise;
  };
  const decide = (id: string, decision: ApprovalDecisionV1['decision']): void => {
    const entry = pending.get(id);
    if (entry === undefined) return;
    remove(id);
    if (entry.prompt.expiresAt <= Date.now()) {
      entry.reject(new Error('APPROVAL_EXPIRED'));
      return;
    }
    entry.resolve({
      version: 1,
      type: 'approval.decision',
      approvalId: id,
      operationId: entry.prompt.operationId,
      promptHash: entry.prompt.promptHash,
      decision,
    });
  };
  const clear = () => {
    for (const [id, entry] of pending) {
      remove(id);
      entry.reject(new Error('APPROVAL_DISCONNECTED'));
    }
  };
  return { prompts: computed(() => prompts.value), receive, decide, clear };
};
