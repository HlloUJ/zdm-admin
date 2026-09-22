<template>
  <div ref="root" class="slab-row-warnings">
    <slot />
    <t-alert
      v-for="item in positions"
      :key="item.id"
      class="slab-row-warning"
      :style="item.style"
      theme="warning"
      :message="errors[item.id]"
      :close-btn="true"
      @close="emit('close', item.id)"
    />
  </div>
</template>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
const props = defineProps<{ errors: Record<number, string>; rows: unknown[] }>();
const emit = defineEmits<{ close: [id: number] }>();
const root = ref<HTMLElement>();
const positions = shallowRef<{ id: number; style: Record<string, string> }[]>([]);
let observer: ResizeObserver | undefined;
function measure() {
  if (!root.value) return;
  const bounds = root.value.getBoundingClientRect();
  positions.value = Array.from(root.value.querySelectorAll<HTMLElement>('tr[data-shelf-error-id]')).map((row) => {
    const rect = row.getBoundingClientRect();
    const left = Math.max(bounds.left, rect.left) + 8;
    const right = Math.min(bounds.right, rect.right) - 8;
    return {
      id: Number(row.dataset.shelfErrorId),
      style: {
        top: `${rect.top - bounds.top + 6}px`,
        left: `${left - bounds.left}px`,
        width: `${Math.max(0, right - left)}px`,
      },
    };
  });
}
async function refresh() {
  await nextTick();
  observer?.disconnect();
  if (root.value) {
    observer?.observe(root.value);
    root.value.querySelectorAll('tr').forEach((row) => observer?.observe(row));
  }
  measure();
}
watch(() => [props.errors, props.rows], refresh, { deep: true });
onMounted(() => {
  observer = new ResizeObserver(measure);
  void refresh();
  root.value?.addEventListener('scroll', measure, true);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  root.value?.removeEventListener('scroll', measure, true);
});
</script>
<style scoped>
.slab-row-warnings {
  position: relative;
}
.slab-row-warnings :deep(tr[data-shelf-error-id] > td) {
  padding-top: 40px;
}
.slab-row-warning {
  position: absolute;
  z-index: 31;
  box-sizing: border-box;
  align-items: center;
  padding: 3px 8px;
  font-size: 11px;
  line-height: 18px;
}
.slab-row-warning :deep(.t-alert__message) {
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slab-row-warning :deep(.t-alert__icon) {
  font-size: 14px;
}
.slab-row-warning :deep(.t-alert__icon),
.slab-row-warning :deep(.t-alert__close) {
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 18px;
}
</style>
