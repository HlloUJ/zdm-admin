<template>
  <AdminListPage v-bind="state" @select-change="emit('selectChange', $event)" />
</template>
<script setup lang="ts">
import AdminListPage from '../official/AdminListPage.vue';
import type { ListAction } from '../official/types';
defineProps<{
  state: {
    actions: ListAction[];
    activeTab?: string;
    selectionColumnKey?: string;
    tableProps: {
      rowKey: string;
      columns: { colKey: string; type?: 'single' | 'multiple' }[];
      selectedRowKeys: (string | number)[];
    };
  };
}>();
const emit = defineEmits<{ selectChange: [keys: (string | number)[]] }>();
</script>
