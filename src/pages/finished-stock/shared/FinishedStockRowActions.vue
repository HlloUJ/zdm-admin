<template>
  <div class="table-actions">
    <t-link
      v-for="action in actions"
      :key="action.id"
      :theme="action.theme"
      hover="color"
      @click="emit('action', action.id)"
    >
      {{ action.label }}
    </t-link>
  </div>
</template>

<script setup lang="ts">
export interface FinishedStockRowAction {
  id: string;
  label: string;
  theme: 'primary' | 'default' | 'danger' | 'warning';
}

defineProps<{ actions: FinishedStockRowAction[] }>();
const emit = defineEmits<{ action: [id: string] }>();
</script>

<style scoped>
.table-actions {
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 10px;
}
</style>
