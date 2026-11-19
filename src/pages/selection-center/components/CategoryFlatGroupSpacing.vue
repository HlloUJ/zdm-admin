<script setup>
import { computed } from 'vue';
import CategoryChoice from './CategoryChoiceSpacing.vue';
const props = defineProps({ node: { type: Object, required: true }, selected: { type: String, default: undefined } });
const emit = defineEmits(['choose']);
function paths(node, path = []) {
  if (!node.children.length) return [{ ancestors: path, leaf: node }];
  return node.children.flatMap((child) => paths(child, [...path, node]));
}
const rows = computed(() =>
  props.node.children.length
    ? paths(props.node).map((path) => ({
        ...path,
        ancestors: path.ancestors.slice(1),
      }))
    : [],
);
const clusters = computed(() => {
  const groups = [];
  for (const row of rows.value) {
    const key = row.ancestors.map((n) => n.key).join('/');
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, path: row.ancestors, leaves: [] };
      groups.push(group);
    }
    group.leaves.push(row.leaf);
  }
  return groups;
});
</script>
<template>
  <section class="flat-group" :class="{ 'single-root': !node.children.length }">
    <div class="flat-group-title">
      <CategoryChoice :node="node" :selected="selected" root @choose="emit('choose', $event)" />
    </div>
    <div v-if="clusters.length" class="flat-group-content">
      <div v-for="group in clusters" :key="group.key" class="flat-subgroup">
        <div v-if="group.path.length" class="flat-path">
          <CategoryChoice
            v-for="(ancestor, index) in group.path"
            :key="ancestor.key"
            :node="ancestor"
            :selected="selected"
            :level="index + 2"
            @choose="emit('choose', $event)"
          />
        </div>
        <div class="flat-leaves">
          <CategoryChoice
            v-for="leaf in group.leaves"
            :key="leaf.key"
            :node="leaf"
            :level="group.path.length + 2"
            :selected="selected"
            @choose="emit('choose', $event)"
          />
        </div>
      </div>
    </div>
  </section>
</template>
<style scoped>
.flat-group-content {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-s);
}
.flat-path {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-xs);
}
.flat-path > .t-icon {
  color: var(--td-text-color-placeholder);
  width: 12px;
  height: 12px;
}
.flat-leaves {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-xs) var(--td-comp-margin-s);
}
.flat-subgroup {
  min-width: 0;
}
.flat-group-title {
  margin-bottom: var(--td-comp-margin-s);
}

.flat-path {
  position: relative;
  max-width: 100%;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.flat-path > .path-level-arrow {
  flex-shrink: 0;
}
.flat-leaves {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--td-comp-margin-l);
  flex: 1 1 160px;
  min-width: 0;
}
.flat-leaves :deep(.category-choice) {
  justify-self: start;
}
</style>
