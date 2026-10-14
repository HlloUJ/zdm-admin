<template>
  <div :class="['zdm-admin-pagination-bar', `zdm-admin-pagination-bar--${align}`]">
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    align?: 'end' | 'between';
  }>(),
  { align: 'end' },
);
</script>

<style scoped>
.zdm-admin-pagination-bar {
  display: flex;
  align-items: center;
  min-height: var(--td-comp-size-m);
  margin-top: var(--td-comp-margin-xxl);
}

.zdm-admin-pagination-bar--end {
  justify-content: flex-end;
}

.zdm-admin-pagination-bar--between {
  justify-content: space-between;
  gap: var(--td-comp-margin-xxl);
}
</style>
