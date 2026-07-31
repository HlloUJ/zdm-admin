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
  min-height: 32px;
  margin-top: 16px;
}

.zdm-admin-pagination-bar--end {
  justify-content: flex-end;
}

.zdm-admin-pagination-bar--between {
  justify-content: space-between;
  gap: 16px;
}
</style>
