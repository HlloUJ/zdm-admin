<template>
  <section class="zdm-official-list-page" :data-page-template="templateKind">
    <t-tabs v-if="tabs.length > 1" :value="activeTab" @change="emit('tabChange', $event)">
      <t-tab-panel v-for="tab in tabs" :key="tab.value" :value="tab.value" :label="tab.label" />
    </t-tabs>
    <div v-if="filters.length && filterLayout === 'adaptive-grid'" class="zdm-official-list-page__grid-filters">
      <t-form
        class="zdm-admin-filter-form zdm-standard-query"
        :data="filterValues"
        :label-width="80"
        colon
        @submit="emit('search')"
        @reset="emit('reset')"
      >
        <div class="filter-row">
          <div class="filter-fields">
            <t-form-item v-for="field in filters" :key="field.key" :label="field.label" :name="field.key">
              <slot :name="`filter-${field.key}`" :field="field" :value="filterValues[field.key]">
                <t-select
                  v-if="field.kind === 'select'"
                  style="width: 100%"
                  :value="filterValues[field.key]"
                  :options="field.options"
                  :filterable="field.filterable"
                  clearable
                  :placeholder="controlPlaceholder(field.label, 'select')"
                  @change="setFilter(field.key, $event)"
                />
                <t-input
                  v-else
                  :value="filterValues[field.key]"
                  clearable
                  :data-query-search-scope="field.searchScope"
                  :placeholder="controlPlaceholder(field.searchScope ?? field.label, 'input')"
                  @change="setFilter(field.key, $event)"
                />
              </slot>
            </t-form-item>
          </div>
          <div class="filter-actions">
            <t-button theme="primary" type="submit">查询</t-button>
            <t-button theme="default" variant="base" type="reset">重置</t-button>
          </div>
        </div>
      </t-form>
    </div>
    <div v-else-if="filters.length && filterLayout === 'official-grid'" class="zdm-official-list-page__grid-filters">
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
                    :placeholder="controlPlaceholder(field.label, 'select')"
                    @change="setFilter(field.key, $event)"
                  />
                  <t-input
                    v-else
                    :style="{ width: '100%', minWidth: '134px' }"
                    :value="filterValues[field.key]"
                    clearable
                    :data-query-search-scope="field.searchScope"
                    :placeholder="controlPlaceholder(field.searchScope ?? field.label, 'input')"
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
            :placeholder="controlPlaceholder(field.label, 'select')"
            @change="setFilter(field.key, $event)"
          />
          <t-input
            v-else
            :style="{ width: '200px' }"
            :value="filterValues[field.key]"
            clearable
            :data-query-search-scope="field.searchScope"
            :placeholder="controlPlaceholder(field.searchScope ?? field.label, 'input')"
            @change="setFilter(field.key, $event)"
          />
        </t-form-item>
      </t-form>
      <t-space size="small">
        <t-button theme="primary" @click="emit('search')">查询</t-button>
        <t-button theme="default" @click="emit('reset')">重置</t-button>
      </t-space>
    </div>
    <AdminListToolbar
      class="zdm-official-list-page__operations"
      :has-actions="actions.length > 0"
      :has-auxiliary="auxiliaryActions.length > 0"
      :has-batch-actions="actions.some((action) => action.batch)"
      :selected-count="selectedCount ?? 0"
    >
      <t-button
        v-for="action in actions"
        :key="action.id"
        :theme="action.theme ?? 'primary'"
        :disabled="action.disabled"
        @click="emit('action', action.id)"
      >
        <template v-if="action.icon" #icon><t-icon :name="action.icon" /></template>{{ action.label }}
      </t-button>
      <template #auxiliary>
        <t-button
          v-for="action in auxiliaryActions"
          :key="action.id"
          theme="default"
          variant="outline"
          :disabled="action.disabled"
          @click="emit('action', action.id)"
        >
          <template v-if="action.icon" #icon><t-icon :name="action.icon" /></template>{{ action.label }}
        </t-button>
      </template>
    </AdminListToolbar>
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
import AdminListToolbar from '../AdminListToolbar.vue';
import { controlPlaceholder } from '@/utils/controlPlaceholder';
import { computed } from 'vue';
import type { PageInfo, TableProps } from 'tdesign-vue-next';
import type { FilterValues, ListAction, ListFilter, ListTab } from './types';
defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{
    tabs?: ListTab[];
    activeTab?: string;
    filterLayout?: 'adaptive-grid' | 'inline' | 'official-grid';
    filters?: ListFilter[];
    filterValues?: FilterValues;
    actions?: ListAction[];
    auxiliaryActions?: ListAction[];
    selectedCount?: number;
    tableProps: TableProps;
  }>(),
  {
    filterLayout: 'adaptive-grid',
    tabs: () => [],
    filters: () => [],
    filterValues: () => ({}),
    actions: () => [],
    auxiliaryActions: () => [],
  },
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

<style src="./query-layout.css"></style>
