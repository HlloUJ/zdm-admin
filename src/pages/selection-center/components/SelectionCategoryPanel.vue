<script setup>
import { ref, computed, watch } from 'vue';
import CategoryFlatGroup from './CategoryFlatGroupSpacingDeep.vue';
const props = defineProps({
  types: { type: Array, default: () => ['finished', 'accessory'] },
  selectedCategory: { type: Object, default: null },
  visible: Boolean,
  trees: { type: Object, required: true },
  maxHeight: { type: Number, default: 560 },
  maxWidth: { type: Number, default: 1200 },
});
const emit = defineEmits(['choose']);
const activeType = ref(props.selectedCategory?.type || props.types[0] || 'finished');
const partitions = computed(() =>
  [
    {
      type: 'finished',
      label: '成品现货',
      roots: props.trees.finished,
    },
    {
      type: 'accessory',
      label: '配件',
      roots: props.trees.accessory,
    },
  ].filter((partition) => props.types.includes(partition.type)),
);
watch(
  () => [props.visible, props.types.join(',')],
  () => {
    if (props.visible)
      activeType.value = props.types.includes(props.selectedCategory?.type)
        ? props.selectedCategory.type
        : props.types[0];
  },
);
</script>
<template>
  <t-config-provider :global-config="{ animation: { exclude: ['ripple'] } }"
    ><div class="selection-category-panel" :style="{ maxHeight: maxHeight + 'px', width: maxWidth + 'px' }">
      <div class="catalog-hover-tabs" role="tablist" aria-label="商品分类类型">
        <t-button
          v-for="partition in partitions"
          :key="partition.type"
          data-button-control="category-choice"
          variant="text"
          size="small"
          :theme="activeType === partition.type ? 'primary' : 'default'"
          role="tab"
          :aria-selected="activeType === partition.type"
          :aria-controls="'approved-catalog-' + partition.type"
          @mouseenter="activeType = partition.type"
          @focus="activeType = partition.type"
          @click="activeType = partition.type"
          >{{ partition.label }}</t-button
        >
      </div>
      <div class="catalog-hover-content">
        <section
          v-for="partition in partitions.filter((item) => item.type === activeType)"
          :id="'approved-catalog-' + partition.type"
          :key="partition.type"
          role="tabpanel"
          :aria-label="partition.label + '类目'"
        >
          <div class="design-root-grid">
            <CategoryFlatGroup
              v-for="node in partition.roots"
              :key="node.key"
              :node="node"
              :selected="selectedCategory?.key"
              @choose="emit('choose', { ...$event, type: partition.type })"
            />
          </div>
        </section>
      </div></div
  ></t-config-provider>
</template>
<style>
.selection-category-panel {
  box-sizing: border-box;
  width: min(1200px, calc(100vw - 96px));
  background: var(--td-bg-color-container);
  color: var(--td-text-color-primary);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-large);
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
}
.selection-category-panel .catalog-hover-tabs {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-xl);
  border-bottom: 1px solid var(--td-component-stroke);
  padding-bottom: var(--td-comp-paddingTB-m);
  margin-bottom: var(--td-comp-margin-m);
}
.selection-category-panel .catalog-hover-tabs .t-button {
  font: var(--td-font-mark-medium);
}
.selection-category-panel .catalog-hover-content {
  min-height: 200px;
}
.selection-category-panel .design-root-grid {
  display: grid;
  gap: var(--td-comp-margin-m);
}
.selection-category-panel .flat-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-l);
  padding-block: var(--td-comp-paddingTB-s);
}
.selection-category-panel .flat-group-title {
  max-width: 100%;
  margin: 0;
}
.selection-category-panel .flat-group-content {
  flex-flow: row wrap;
  gap: var(--td-comp-margin-m);
  flex: 1 1 160px;
  min-width: 0;
}
.selection-category-panel .flat-subgroup {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-comp-margin-l);
  width: 100%;
}
.selection-category-panel .catalog-hover-tabs .t-button,
.selection-category-panel .catalog-hover-tabs .t-button * {
  transition: none;
  animation: none;
}

.selection-category-panel {
  display: flex;
  flex-direction: column;
  max-height: min(560px, calc(100dvh - 32px));
  overflow: hidden;
}
.selection-category-panel .catalog-hover-tabs {
  flex-shrink: 0;
}
.selection-category-panel .catalog-hover-content {
  min-height: 0;
  overflow: hidden auto;
  scrollbar-gutter: stable;
  scrollbar-width: auto;
}

.selection-category-panel .catalog-hover-content::-webkit-scrollbar {
  width: 6px;
}
.selection-category-panel .catalog-hover-content::-webkit-scrollbar-thumb {
  background: var(--td-scrollbar-color, var(--td-text-color-disabled));
  border-radius: var(--td-radius-small);
}
</style>

<style>
/* Keep ancestor text at the same body size across shallow and deep layouts. */
.selection-category-panel .catalog-hover-content .flat-path .category-choice {
  font: var(--td-font-body-medium);
}
</style>
