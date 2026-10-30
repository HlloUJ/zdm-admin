<template>
  <AdminDialog
    :visible="visible"
    header="批量上架结果"
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
    <t-table v-if="rows.length" :data="rows" :columns="columns" row-key="key" table-layout="fixed" />
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
