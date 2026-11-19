<script setup>
import { computed } from 'vue';
import CategoryFlatGroup from './CategoryFlatGroupSpacing.vue';
import CategoryChoice from './CategoryChoiceSpacing.vue';
const props = defineProps({ node: { type: Object, required: true }, selected: { type: String, default: undefined } });
const emit = defineEmits(['choose']);
const deep = computed(() =>
  props.node.children.some((second) => second.children.some((third) => third.children.length)),
);
</script>
<template>
  <CategoryFlatGroup v-if="!deep" :node="node" :selected="selected" @choose="emit('choose', $event)" />
  <section v-else class="deep-category-group">
    <div class="deep-root-title">
      <CategoryChoice :node="node" :selected="selected" root @choose="emit('choose', $event)" />
    </div>
    <div class="deep-scopes">
      <section v-for="second in node.children" :key="second.key" class="deep-second-scope">
        <div class="deep-second-title">
          <CategoryChoice :node="second" :level="2" :selected="selected" @choose="emit('choose', $event)" />
        </div>
        <div class="deep-third-groups">
          <div v-for="third in second.children" :key="third.key" class="deep-third-row">
            <div class="deep-third-title">
              <CategoryChoice :node="third" :level="3" :selected="selected" @choose="emit('choose', $event)" />
            </div>
            <div class="deep-terminal-options">
              <CategoryChoice
                v-for="leaf in third.children"
                :key="leaf.key"
                :node="leaf"
                :level="4"
                :selected="selected"
                @choose="emit('choose', $event)"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
<style scoped>
.deep-category-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-l);
  padding-block: var(--td-comp-paddingTB-s);
}
.deep-second-scope {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-l);
}
.deep-third-groups {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-l);
}
.deep-third-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-l);
  align-items: start;
}
.deep-terminal-options {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  gap: var(--td-comp-margin-xs) var(--td-comp-margin-l);
  min-width: 0;
}
.deep-terminal-options :deep(.category-choice) {
  justify-self: start;
}
.deep-scopes {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-l);
}
.deep-second-title {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-xs);
  align-self: start;
}

.deep-scopes,
.deep-third-groups,
.deep-terminal-options {
  flex: 1 1 160px;
  min-width: 0;
}
.deep-root-title,
.deep-second-title,
.deep-third-title {
  max-width: 100%;
}
</style>
