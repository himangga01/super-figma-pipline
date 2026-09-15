<script lang="ts">
export type PairingUiStatus =
  | 'unpaired'
  | 'entering'
  | 'exchange-pending'
  | 'wrong'
  | 'expired'
  | 'used'
  | 'rate-limited'
  | 'hello-pending'
  | 'connected'
  | 'reconnecting'
  | 'resume-expired'
  | 'protocol-mismatch';

export type PairingSubmission = { challengeId: string; code: string } | { pairCode: string };
</script>

<script setup lang="ts">
import type { PairErrorCode } from '@sfp/shared';
import { computed, onBeforeUnmount, ref } from 'vue';

const props = defineProps<{
  status: PairingUiStatus;
  errorCode: PairErrorCode | null;
  attemptsRemaining: number | null;
}>();

const emit = defineEmits<{
  submit: [input: PairingSubmission];
  cancel: [];
}>();

const challengeId = ref('');
const secret = ref('');
const secretElement = ref<HTMLInputElement | null>(null);

const pending = computed(
  () => props.status === 'exchange-pending' || props.status === 'hello-pending',
);
const showForm = computed(
  () =>
    props.status !== 'connected' &&
    props.status !== 'reconnecting' &&
    props.status !== 'protocol-mismatch' &&
    props.status !== 'hello-pending',
);

const ERROR_COPY: Record<PairErrorCode, string> = {
  PAIR_BODY_INVALID: 'Enter the exact challenge ID and eight-digit code.',
  PAIR_CODE_WRONG: 'That pairing code is incorrect.',
  PAIR_CODE_EXPIRED: 'That pairing code has expired. Create a new challenge and try again.',
  PAIR_CODE_USED: 'That pairing code has already been used. Create a new challenge.',
  PAIR_RATE_LIMITED: 'Too many pairing attempts. Wait before trying again.',
  PAIR_INTERNAL: 'Pairing could not be completed. Try again.',
  PAIR_CREDENTIAL_REQUIRED: 'Pairing credentials are required.',
  PAIR_TICKET_INVALID: 'The pairing ticket was rejected. Pair again.',
  PAIR_TICKET_EXPIRED: 'The pairing ticket expired. Pair again.',
  PAIR_TICKET_USED: 'The pairing ticket was already used. Pair again.',
  PAIR_RESUME_INVALID: 'The saved session cannot be resumed. Pair again.',
  PAIR_RESUME_EXPIRED: 'The saved session expired. Pair again.',
  PAIR_RESUME_USED: 'The saved session was already rotated. Pair again.',
  PAIR_GENERATION_MISMATCH: 'This plugin instance changed. Pair again.',
  PAIR_HELLO_PENDING: 'Authentication is already in progress.',
};

const statusCopy = computed(() => {
  if (props.errorCode !== null) return ERROR_COPY[props.errorCode];
  switch (props.status) {
    case 'unpaired':
    case 'entering':
      return 'Enter the challenge ID and eight-digit code shown by the local Figwright service.';
    case 'exchange-pending':
      return 'Exchanging the one-time pairing code…';
    case 'wrong':
      return 'That pairing code is incorrect.';
    case 'expired':
      return 'That pairing code has expired. Create a new challenge and try again.';
    case 'used':
      return 'That pairing code has already been used. Create a new challenge.';
    case 'rate-limited':
      return 'Too many pairing attempts. Wait before trying again.';
    case 'hello-pending':
      return 'Authenticating this plugin instance…';
    case 'connected':
      return 'Paired and connected.';
    case 'reconnecting':
      return 'Reconnecting with the saved session…';
    case 'resume-expired':
      return 'The saved session expired. Pair again.';
    case 'protocol-mismatch':
      return 'Update the plugin to match the local Figwright service.';
  }
  return 'Pairing is unavailable.';
});

const clearSecret = (): void => {
  secret.value = '';
  // Vue normally reflects the ref on its next render. Clear the node synchronously as well: cancel
  // and scope disposal are security boundaries at which no detached DOM reference may retain it.
  if (secretElement.value !== null) secretElement.value.value = '';
};

const submit = (): void => {
  const submittedSecret = secret.value;
  const input: PairingSubmission = submittedSecret.startsWith('SFP-')
    ? { pairCode: submittedSecret }
    : { challengeId: challengeId.value, code: submittedSecret };

  // The emitted value is handed directly to the short-lived exchange. The input is scrubbed before
  // any async parent handler can run, so a pending request never leaves the code painted in the DOM.
  clearSecret();
  emit('submit', input);
};

const cancel = (): void => {
  clearSecret();
  emit('cancel');
};

// Scrub the actual input element's bound value before Vue detaches it. This matters to callers that
// retain a DOM reference for a frame and is stronger than merely removing the node from the document.
onBeforeUnmount(clearSecret);
</script>

<template>
  <div class="divide-y divide-line px-1.5">
    <section class="pb-3.5">
      <p class="text-meta font-medium tracking-wide text-dim uppercase">Pairing</p>
      <p
        class="mt-1.5 rounded-md bg-raised p-2 wrap-break-word"
        :class="
          status === 'connected'
            ? 'text-success'
            : status === 'protocol-mismatch'
              ? 'text-danger'
              : 'text-dim'
        "
        role="status"
      >
        {{ statusCopy }}
      </p>
      <p v-if="attemptsRemaining !== null" class="mt-1 text-meta text-warning tabular-nums">
        {{ attemptsRemaining }} attempt{{ attemptsRemaining === 1 ? '' : 's' }} remaining
      </p>
    </section>

    <form v-if="showForm" class="space-y-2.5 pt-3" autocomplete="off" @submit.prevent="submit">
      <label class="block">
        <span class="mb-1 block text-meta text-dim">Challenge ID</span>
        <input
          v-model="challengeId"
          data-testid="pair-challenge"
          class="w-full rounded-md border border-line bg-raised px-2 py-1.5 font-mono text-panel text-fg outline-none focus:border-line-strong"
          :disabled="pending"
          inputmode="text"
          maxlength="10"
          spellcheck="false"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-meta text-dim">Eight-digit code or full SFP code</span>
        <input
          ref="secretElement"
          v-model="secret"
          data-testid="pair-secret"
          class="w-full rounded-md border border-line bg-raised px-2 py-1.5 font-mono text-panel text-fg outline-none focus:border-line-strong"
          :disabled="pending"
          type="password"
          inputmode="text"
          autocomplete="one-time-code"
          maxlength="24"
          spellcheck="false"
        />
      </label>
      <div class="flex gap-2">
        <button
          class="flex-1 rounded-md bg-brand px-2 py-1.5 font-medium text-white disabled:opacity-50"
          type="submit"
          :disabled="pending"
        >
          {{ pending ? 'Exchanging…' : 'Pair' }}
        </button>
        <button
          data-testid="pair-cancel"
          class="rounded-md border border-line px-2 py-1.5 text-dim hover:text-fg"
          type="button"
          @click="cancel"
        >
          Cancel
        </button>
      </div>
    </form>

    <button
      v-else-if="pending"
      data-testid="pair-cancel"
      class="mt-3 rounded-md border border-line px-2 py-1.5 text-dim hover:text-fg"
      type="button"
      @click="cancel"
    >
      Cancel
    </button>
  </div>
</template>
