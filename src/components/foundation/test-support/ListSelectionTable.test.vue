<template>
  <div data-table>
    <span v-for="column in columns" :key="column.colKey" :data-column="column.colKey">{{ column.type }}</span>
    <span data-selected>{{ JSON.stringify(selectedRowKeys) }}</span>
  </div>
</template>
<script setup lang="ts">
withDefaults(defineProps<{ columns?: { colKey?: string; type?: string }[]; selectedRowKeys?: (string | number)[] }>(), {
  columns: () => [],
  selectedRowKeys: () => [],
});
</script>
