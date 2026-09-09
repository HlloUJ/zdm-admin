<template>
  <t-tooltip :content="tooltip">
    <button
      type="button"
      class="price-source-badge"
      :class="source === 'auto' ? 'is-auto' : 'is-manual'"
      :disabled="readonly"
      :aria-label="source === 'auto' ? '跟随配置，点击切换手工价格' : '手工价格，点击切换跟随配置'"
      @click="toggle"
    >
      {{ source === 'auto' ? '跟' : '手' }}
    </button>
  </t-tooltip>
  <AdminDialog
    v-model:visible="confirmVisible"
    header="更改价格浮动方式"
    confirm-btn="确认"
    @confirm="confirmToggle"
    @cancel="confirmVisible = false"
  >
    <p>{{ source === 'auto' ? '确定更改价格不跟随价格配置浮动？' : '确定更改价格跟随价格配置浮动？' }}</p>
  </AdminDialog>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { AdminDialog, adminFeedback } from '@/components/foundation';
const props = defineProps<{
  source?: 'auto' | 'manual';
  available: boolean;
  readonly?: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();
const confirmVisible = ref(false);
const tooltip = computed(() => {
  return props.source === 'auto'
    ? '当前价格/系数，跟随价格配置浮动，可点击更改为【不跟随价格配置浮动】'
    : '当前价格/系数，不跟随价格配置浮动，可点击更改为【跟随价格配置浮动】';
});
const toggle = () => {
  if (props.readonly) return;
  if (props.source !== 'auto' && !props.available) {
    adminFeedback.warning('暂无有效价格配置，无法切换为跟随配置');
    return;
  }
  confirmVisible.value = true;
};
const confirmToggle = () => {
  confirmVisible.value = false;
  emit('toggle');
};
</script>
<style scoped>
.price-source-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-top: 5px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.15s;
}
.is-auto {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}
.is-auto:hover {
  background: var(--td-brand-color-focus);
}
.is-manual {
  color: var(--td-warning-color);
  background: var(--td-warning-color-light);
}
.is-manual:hover {
  background: var(--td-warning-color-focus);
}
.price-source-badge:focus-visible {
  outline: 2px solid var(--td-brand-color);
  outline-offset: 2px;
}
.price-source-badge:disabled {
  cursor: default;
  opacity: 0.65;
}
</style>
