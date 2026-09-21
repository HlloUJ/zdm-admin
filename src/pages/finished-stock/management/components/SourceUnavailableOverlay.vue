<template>
  <div ref="root" class="source-overlay-container">
    <slot />
    <div v-for="item in overlays" :key="item.row.id" class="source-unavailable-overlay" :style="item.style">
      <slot name="overlay" :row="item.row" />
    </div>
  </div>
</template>
<script setup lang="ts" generic="T extends { id: number | string }">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
const props = defineProps<{ rows: T[] }>();
const root = ref<HTMLElement>();
const overlays = shallowRef<{ row: T; style: Record<string, string> }[]>([]);
let observer: ResizeObserver | undefined;
function measure() {
  if (!root.value) return;
  const bounds = root.value.getBoundingClientRect();
  const elements = root.value.querySelectorAll<HTMLElement>('tr[data-source-id]');
  overlays.value = props.rows.flatMap((row) => {
    const element = Array.from(elements).find((item) => item.dataset.sourceId === String(row.id));
    if (!element) return [];
    const rect = element.getBoundingClientRect();
    const left = Math.max(rect.left, bounds.left);
    const right = Math.min(rect.right, bounds.right);
    return [
      {
        row,
        style: {
          top: `${rect.top - bounds.top}px`,
          left: `${left - bounds.left}px`,
          width: `${Math.max(0, right - left)}px`,
          height: `${rect.height}px`,
        },
      },
    ];
  });
}
async function refresh() {
  await nextTick();
  observer?.disconnect();
  if (root.value) {
    observer?.observe(root.value);
    root.value.querySelectorAll('tr[data-source-id]').forEach((row) => observer?.observe(row));
  }
  measure();
}
watch(() => props.rows, refresh, { deep: true });
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
.source-overlay-container {
  position: relative;
}
.source-unavailable-overlay {
  position: absolute;
  z-index: 32;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--td-comp-margin-s);
  color: #fff;
  background: rgb(0 0 0 / 75%);
}
</style>
