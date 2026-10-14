<template>
  <section class="zdm-official-list-page" :data-page-template="templateKind">
    <t-tabs v-if="tabs.length > 1" :value="activeTab" @change="emit('tabChange', $event)">
      <t-tab-panel v-for="tab in tabs" :key="tab.value" :value="tab.value" :label="tab.label" />
    </t-tabs>
    <div v-if="filters.length && filterLayout === 'official-grid'" class="zdm-official-list-page__grid-filters">
      <t-form :data="filterValues" :label-width="80" colon @submit="emit('search')" @reset="emit('reset')">
        <t-row>
          <t-col :span="10">
            <t-row :gutter="[24, 24]">
              <t-col v-for="field in filters" :key="field.key" :span="4">
                <t-form-item :label="field.label" :name="field.key">
                  <t-select
                    v-if="field.kind === 'select'"
                    style="width: 100%"
                    :value="filterValues[field.key]"
                    :options="field.options"
                    :filterable="field.filterable"
                    clearable
                    :placeholder="`请选择${field.label}`"
                    @change="setFilter(field.key, $event)"
                  />
                  <t-input
                    v-else
                    :style="{ width: '100%', minWidth: '134px' }"
                    :value="filterValues[field.key]"
                    clearable
                    :placeholder="`请输入${field.label}`"
                    @change="setFilter(field.key, $event)"
                  />
                </t-form-item>
              </t-col>
            </t-row>
          </t-col>
          <t-col :span="2" class="zdm-official-list-page__query-actions">
            <t-button theme="primary" type="submit" :style="{ marginLeft: 'var(--td-comp-margin-s)' }">查询</t-button>
            <t-button theme="default" variant="base" type="reset">重置</t-button>
          </t-col>
        </t-row>
      </t-form>
    </div>
    <div v-else-if="filters.length" class="zdm-official-list-page__filters">
      <t-form
        :data="filterValues"
        layout="inline"
        label-align="left"
        colon
        @submit="emit('search')"
        @reset="emit('reset')"
      >
        <t-form-item
          v-for="field in filters"
          :key="field.key"
          :label="field.label"
          :name="field.key"
          :label-width="`calc(${field.label.length + 1}em + var(--td-comp-paddingLR-xl))`"
        >
          <t-select
            v-if="field.kind === 'select'"
            :style="{ width: '200px' }"
            :value="filterValues[field.key]"
            :options="field.options"
            :filterable="field.filterable"
            clearable
            placeholder="请选择"
            @change="setFilter(field.key, $event)"
          />
          <t-input
            v-else
            :style="{ width: '200px' }"
            :value="filterValues[field.key]"
            clearable
            placeholder="请输入"
            @change="setFilter(field.key, $event)"
          />
        </t-form-item>
      </t-form>
      <t-space size="small">
        <t-button theme="primary" @click="emit('search')">查询</t-button>
        <t-button theme="default" @click="emit('reset')">重置</t-button>
      </t-space>
    </div>
    <t-row
      v-if="actions.length || selectedCount !== undefined"
      class="zdm-official-list-page__operations"
      justify="space-between"
      align="center"
    >
      <t-space size="small" break-line>
        <t-button
          v-for="action in actions"
          :key="action.id"
          :theme="action.theme ?? 'primary'"
          :disabled="action.disabled"
          @click="emit('action', action.id)"
        >
          <template v-if="action.icon" #icon><t-icon :name="action.icon" /></template>{{ action.label }}
        </t-button>
      </t-space>
      <span v-if="selectedCount !== undefined">已选 {{ selectedCount }} 项</span>
    </t-row>
    <t-table
      v-bind="tableProps"
      @page-change="emit('pageChange', $event)"
      @select-change="emit('selectChange', $event)"
    >
      <template v-for="(_, name) in $slots" #[name]="scope"><slot :name="name" v-bind="scope ?? {}" /></template>
    </t-table>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { PageInfo, TableProps } from 'tdesign-vue-next';
import type { FilterValues, ListAction, ListFilter, ListTab } from './types';
defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{
    tabs?: ListTab[];
    activeTab?: string;
    filterLayout?: 'inline' | 'official-grid';
    filters?: ListFilter[];
    filterValues?: FilterValues;
    actions?: ListAction[];
    selectedCount?: number;
    tableProps: TableProps;
  }>(),
  { filterLayout: 'inline', tabs: () => [], filters: () => [], filterValues: () => ({}), actions: () => [] },
);
const templateKind = computed(() =>
  props.tabs.length > 1 ? 'tab-filter-list' : props.filters.length ? 'filter-list' : 'base-list',
);
const emit = defineEmits<{
  'update:filterValues': [value: FilterValues];
  search: [];
  reset: [];
  tabChange: [value: string | number];
  action: [id: string];
  pageChange: [info: PageInfo];
  selectChange: [keys: (string | number)[]];
}>();
function setFilter(key: string, value: unknown) {
  const scalar = typeof value === 'string' || typeof value === 'number' ? value : undefined;
  emit('update:filterValues', { ...props.filterValues, [key]: scalar });
}
</script>
<style scoped>
/* common-table/index.vue:303-310: official container and table-region spacing.
   Native left-aligned inline Form + configurable toolbar are the registered project extension. */
.zdm-official-list-page {
  /* Official src/style/reset.less typography, scoped to the new page. */
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
  font-family: -apple-system, BlinkMacSystemFont, var(--td-font-family);
  background-color: var(--td-bg-color-container);
  padding: var(--td-comp-paddingTB-xxl) var(--td-comp-paddingLR-xxl);
  border-radius: var(--td-radius-medium);
}
.zdm-official-list-page > .t-tabs,
.zdm-official-list-page__filters,
.zdm-official-list-page__grid-filters,
.zdm-official-list-page__operations {
  margin-bottom: var(--td-comp-margin-xxl);
}
.zdm-official-list-page__filters {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-comp-margin-xxl);
}
.zdm-official-list-page__filters > .t-form {
  flex: 1;
  min-width: 0;
}
.zdm-official-list-page__filters > .t-space {
  flex-shrink: 0;
}

/* Official common-table query grid; opt-in preserves the inline extension. */
.zdm-official-list-page__query-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}
.zdm-official-list-page__query-actions > .t-button + .t-button {
  margin-left: var(--td-comp-margin-s);
}
</style>
