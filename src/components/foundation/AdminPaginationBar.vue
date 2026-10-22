<template>
  <div>
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
