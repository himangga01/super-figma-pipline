<script setup lang="ts">
const url = defineModel<string>({ required: true });
const persistent = defineModel<boolean>('persistent', { required: true });
defineProps<{ status: string; error: string | null }>();
const emit = defineEmits<{ bind: [] }>();
</script>
<template>
  <section class="mt-4 border-t border-line pt-3">
    <h2 class="font-semibold">현재 파일 연결</h2>
    <p class="mt-1 text-meta text-dim">
      현재 열려 있는 디자인의 Figma 링크를 입력하세요. 기본 연결은 원본을 수정하지 않습니다.
    </p>
    <input
      v-model="url"
      aria-label="현재 파일의 Figma 링크"
      class="mt-2 w-full rounded border border-line bg-raised px-2 py-1"
      placeholder="https://www.figma.com/design/..."
    />
    <label class="mt-2 flex gap-2 text-meta"
      ><input v-model="persistent" type="checkbox" />영구 비교를 위한 식별 정보 저장 (파일 편집 권한
      필요)</label
    >
    <button
      class="mt-2 rounded bg-brand px-3 py-2 text-white"
      :disabled="status === 'waiting-approval' || status === 'reconnecting'"
      @click="emit('bind')"
    >
      파일 확인 및 연결
    </button>
    <p v-if="status === 'waiting-approval'" class="mt-2 text-meta">
      승인 탭에서 현재 파일과 링크를 확인하세요.
    </p>
    <p v-if="status === 'reconnecting'" class="mt-2 text-meta">
      파일 식별 정보를 적용하고 다시 연결하고 있습니다.
    </p>
    <p v-if="status === 'connected'" class="mt-2 text-meta">파일 연결이 완료되었습니다.</p>
    <p v-if="error" role="alert" class="mt-2 text-meta text-danger">{{ error }}</p>
  </section>
</template>
