<template>
  <t-row
    v-if="hasActions || hasAuxiliary || showSelection"
    class="table-toolbar zdm-admin-list-toolbar"
    justify="space-between"
    align="center"
  >
    <t-space class="toolbar-buttons" size="small" align="center" break-line>
      <slot />
      <span v-if="showSelection" class="selection-info">已选 {{ selectedCount }} 项</span>
    </t-space>
    <t-space v-if="hasAuxiliary" class="zdm-admin-list-toolbar__auxiliary" size="small" align="center">
      <slot name="auxiliary" />
    </t-space>
  </t-row>
</template>
<script setup lang="ts">
import { computed } from 'vue';
const props = withDefaults(
  defineProps<{ hasActions?: boolean; hasAuxiliary?: boolean; hasBatchActions?: boolean; selectedCount?: number }>(),
  { hasActions: false, hasAuxiliary: false, hasBatchActions: false, selectedCount: 0 },
);
const showSelection = computed(() => props.hasActions && props.hasBatchActions && props.selectedCount > 0);
</script>
<style scoped>
.selection-info {
  margin-left: var(--td-comp-margin-s);
  color: var(--td-text-color-secondary);
}
</style>
