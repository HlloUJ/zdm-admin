<template>
  <AdminDialog
    :visible="visible"
    header="批量上架结果"
    width="max-content"
    dialog-class-name="zdm-operation-result-dialog"
    confirm-function="close"
    :confirmation="{ kind: 'acknowledgement', action: 'productBatchShelfResult' }"
    :cancel-btn="null"
    @update:visible="emit('update:visible', $event)"
    @confirm="emit('update:visible', false)"
    @close="emit('update:visible', false)"
  >
    <t-typography-paragraph
      >成功上架{{ result.successCount }}件，失败{{ result.failureCount }}件。</t-typography-paragraph
    >
    <t-table v-if="rows.length" :data="rows" :columns="columns" row-key="key" table-layout="auto" />
  </AdminDialog>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { AdminDialog } from '@/components/foundation';
import { groupShelfFailures, type BatchShelfResult } from '@/services/operationsBatchShelf';
const props = defineProps<{ visible: boolean; result: BatchShelfResult }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();
const rows = computed(() => groupShelfFailures(props.result.failures));
const columns = [
  { colKey: 'productIds', title: '商品ID' },
  { colKey: 'reason', title: '失败原因' },
];
</script>

<style>
/* Opt-in result layout only; native dialog/table typography and spacing remain intact. */
.zdm-operation-result-dialog {
  display: flex;
  flex-direction: column;
  min-width: min(480px, 90vw);
  max-width: min(960px, 90vw);
  max-height: calc(100dvh - 2 * var(--td-comp-margin-xxl));
}

.zdm-operation-result-dialog .t-dialog__header,
.zdm-operation-result-dialog .t-dialog__footer {
  flex-shrink: 0;
}

.zdm-operation-result-dialog .t-dialog__body {
  min-height: 0;
  overflow-wrap: anywhere;
}

.zdm-operation-result-dialog .t-table th {
  white-space: nowrap;
}

.zdm-operation-result-dialog .t-table td {
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
