<template>
  <t-tag size="small" variant="light" :theme="status === 'selling' ? 'success' : 'default'">{{
    status === 'selling' ? '已上架' : '仓库中'
  }}</t-tag>
</template>
<script setup lang="ts">
defineProps<{ status: string }>();
</script>
