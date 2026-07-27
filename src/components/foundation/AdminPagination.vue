<template>
  <t-pagination
    v-model:current="innerCurrent"
    v-model:page-size="innerPageSize"
    v-bind="$attrs"
    class="admin-pagination"
    @change="handleChange"
  />
</template>

<script setup lang="ts">
import type { PageInfo } from 'tdesign-vue-next';
import { computed } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  current: number;
  pageSize: number;
}>();

const emit = defineEmits<{
  'update:current': [value: number];
  'update:pageSize': [value: number];
  change: [pageInfo: PageInfo];
}>();

const innerCurrent = computed({
  get: () => props.current,
  set: (value: number) => emit('update:current', value),
});

const innerPageSize = computed({
  get: () => props.pageSize,
  set: (value: number) => emit('update:pageSize', value),
});

const handleChange = (pageInfo: PageInfo) => {
  emit('change', pageInfo);
};
</script>
