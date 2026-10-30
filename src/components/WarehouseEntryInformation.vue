<template>
  <span v-if="!entry.warehouseEntryType?.trim()">-</span>
  <t-space v-else direction="vertical" size="small" align="start">
    <t-tag
      v-if="warehouseEntryLabel(entry.warehouseEntryType)"
      :theme="
        entry.warehouseEntryType === 'offShelf'
          ? 'warning'
          : entry.warehouseEntryType === 'firstEntry'
            ? 'primary'
            : 'default'
      "
      variant="light"
    >
      {{ warehouseEntryLabel(entry.warehouseEntryType) }}
    </t-tag>
    <t-tooltip
      v-if="summary"
      v-model:visible="detailTooltipVisible"
      :disabled="tooltipDisabled || !isTruncated"
      :content="summary"
      placement="bottom-left"
    >
      <t-typography-text
        ref="summaryText"
        data-entry-detail
        class="warehouse-entry-summary"
        theme="secondary"
        :content="summary"
        :ellipsis="{ row: 2 }"
      />
    </t-tooltip>
    <slot />
  </t-space>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue';
import { warehouseEntryLabel, type WarehouseEntryInformation } from '@/services/warehouseEntry';
const props = defineProps<{ entry: WarehouseEntryInformation; tooltipDisabled?: boolean }>();
const summary = computed(() => {
  const entry = props.entry;
  if (['firstEntry', 'recycleRestore'].includes(entry.warehouseEntryType || '')) return '';
  const detail = entry.warehouseEntryDetail || (entry.warehouseEntryType === 'offShelf' ? '未填写详细说明' : '');
  return [entry.warehouseEntryReason, detail].filter(Boolean).join('；');
});
const detailTooltipVisible = ref(false);
const summaryText = ref<ComponentPublicInstance>();
const isTruncated = ref(false);
let observer: ResizeObserver | undefined;
const measureTruncation = () => {
  const element = (summaryText.value?.$el as HTMLElement | undefined)?.querySelector('p');
  isTruncated.value = Boolean(
    element && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1),
  );
};
watch(
  [summary, summaryText],
  async () => {
    await nextTick();
    observer?.disconnect();
    const element = summaryText.value?.$el as HTMLElement | undefined;
    if (element && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measureTruncation);
      observer.observe(element);
    }
    measureTruncation();
  },
  { flush: 'post' },
);
onBeforeUnmount(() => observer?.disconnect());
watch(
  () => props.tooltipDisabled || !isTruncated.value,
  (disabled) => {
    if (disabled) detailTooltipVisible.value = false;
  },
);
</script>

<style scoped>
.warehouse-entry-summary {
  margin: 0;
  font: var(--td-font-body-small);
}
</style>
