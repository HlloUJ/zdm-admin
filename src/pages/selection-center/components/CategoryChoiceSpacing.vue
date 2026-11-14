<script setup>
defineProps({
  node: { type: Object, required: true },
  selected: { type: String, default: undefined },
  root: Boolean,
  level: { type: Number, default: 1 },
});
const emit = defineEmits(['choose']);
</script>
<template>
  <t-button
    data-button-control="category-choice"
    class="category-choice"
    :class="{ 'root-choice': root, 'secondary-level-choice': (level === 2 || level === 3) && node.children.length > 0 }"
    :data-category-level="level"
    size="small"
    variant="text"
    :theme="selected === node.key ? 'primary' : 'default'"
    :aria-pressed="selected === node.key"
    @click="emit('choose', node)"
    ><span class="category-label">{{ node.label }}</span
    ><t-icon
      v-if="node.children.length && (level === 2 || (root && node.children.every((child) => !child.children.length)))"
      class="level-connector"
      name="chevron-right"
  /></t-button>
</template>
<style scoped>
.category-choice {
  max-width: 100%;
  height: auto;
  min-height: var(--td-comp-size-xs);
  white-space: normal;
  overflow-wrap: anywhere;
  flex-shrink: 0;
  font: var(--td-font-body-medium);
}
.category-choice :deep(.t-button__text) {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  white-space: normal;
}
.category-choice.root-choice {
  font: var(--td-font-mark-medium);
}

.category-choice.secondary-level-choice:not([aria-pressed='true'], :disabled) {
  color: var(--td-text-color-secondary);
}
.category-choice[data-category-level='4']:not([aria-pressed='true'], :disabled) {
  color: var(--td-text-color-primary);
}
.category-choice .level-connector {
  flex-shrink: 0;
  margin-left: var(--td-comp-margin-xs);
}

/* Immediate feedback for this approved category-only refinement. */
.category-choice,
.category-choice :deep(*) {
  transition: none;
  animation: none;
}
</style>
