<template>
  <div class="zdm-admin-pagination">
    <t-pagination
      :current="current"
      :page-size="pageSize"
      :total="total"
      :page-size-options="pageSizeOptions"
      @change="handleChange"
    />
  </div>
</template>

<script setup lang="ts">
import type { PageInfo } from 'tdesign-vue-next';

withDefaults(
  defineProps<{
    current: number;
    pageSize: number;
    total: number;
    pageSizeOptions?: number[];
  }>(),
  { pageSizeOptions: () => [10, 20, 50] },
);

const emit = defineEmits<{
  'update:current': [value: number];
  'update:pageSize': [value: number];
  change: [pageInfo: PageInfo];
}>();

const handleChange = (pageInfo: PageInfo) => {
  emit('update:current', pageInfo.current);
  emit('update:pageSize', pageInfo.pageSize);
  emit('change', pageInfo);
};
</script>
