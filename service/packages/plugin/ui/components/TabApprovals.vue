<script setup lang="ts">
import type { ApprovalPromptV1 } from '@sfp/shared';

import { useSharedNow } from '../composables/useSharedNow.js';

defineProps<{ prompts: readonly ApprovalPromptV1[]; fileName: string }>();
const emit = defineEmits<{ decide: [id: string, decision: 'approved' | 'rejected'] }>();
const now = useSharedNow();
const effectLabel = (effect: string): string => {
  if (effect.startsWith('figma-write')) return 'Figma 디자인 변경';
  if (effect.startsWith('filesystem-write') || effect.startsWith('server-evidence-write'))
    return '프로젝트 파일 저장 또는 변경';
  if (effect.startsWith('network')) return '외부 자산 다운로드';
  if (effect.startsWith('figma-library-import')) return '라이브러리 항목 가져오기';
  if (effect.startsWith('filesystem-read')) return '프로젝트 파일 분석';
  return '디자인 정보 읽기';
};
</script>

<template>
  <div class="space-y-3 p-2">
    <p v-if="prompts.length === 0" class="text-fg-muted">승인을 기다리는 작업이 없습니다.</p>
    <article
      v-for="prompt in prompts"
      :key="prompt.approvalId"
      class="rounded-md border border-line p-3"
    >
      <h2 class="font-semibold">{{ fileName }} · 작업 승인</h2>
      <p class="mt-2 break-words">{{ prompt.operationName }}</p>
      <p class="mt-2 break-words">{{ prompt.target.label }}</p>
      <ul class="mt-2 list-inside list-disc">
        <li v-for="effect in [...new Set(prompt.effectSummary.map(effectLabel))]" :key="effect">
          {{ effect }}
        </li>
      </ul>
      <p class="text-fg-muted mt-2 text-meta">
        {{ Math.max(0, Math.ceil((prompt.expiresAt - now.getTime()) / 1000)) }}초 후 만료
      </p>
      <div class="mt-3 flex gap-2">
        <button
          class="rounded bg-brand px-3 py-2 text-white"
          :disabled="prompt.expiresAt <= now.getTime()"
          @click="emit('decide', prompt.approvalId, 'approved')"
        >
          승인
        </button>
        <button
          class="rounded border border-line px-3 py-2"
          @click="emit('decide', prompt.approvalId, 'rejected')"
        >
          거절
        </button>
      </div>
    </article>
  </div>
</template>
