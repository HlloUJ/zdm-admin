<template>
  <header class="page-header">
    <slot name="breadcrumb" />
    <slot name="header-action" />
  </header>
  <AdminListLayout v-if="tabs.length" class="finished-list-layout">
    <template #toolbar>
      <div class="list-controls">
        <t-tabs v-if="showTabs" :value="activeTab" class="status-tabs" @change="emit('tab-change', String($event))">
          <t-tab-panel v-for="tab in tabs" :key="tab.value" :value="tab.value" :label="tab.label" />
        </t-tabs>
        <t-form class="zdm-admin-filter-form" label-width="auto" :data="filter" colon>
          <div class="filter-row">
            <div class="filter-fields">
              <t-form-item label="商品">
                <t-input
                  :value="filter.keyword"
                  clearable
                  placeholder="商品名称 / ID"
                  @change="emit('filter-change', 'keyword', String($event || ''))"
                  @enter="emit('search')"
                />
              </t-form-item>
              <t-form-item label="商品分类"><slot name="category-filter" /></t-form-item>
              <t-form-item label="供应商">
                <t-select
                  :value="filter.supplier"
                  clearable
                  placeholder="请选择"
                  @change="emit('filter-change', 'supplier', String($event || ''))"
                >
                  <t-option v-for="item in supplierOptions" :key="item" :label="item" :value="item" />
                </t-select>
              </t-form-item>
            </div>
            <div class="filter-actions">
              <t-button theme="primary" @click="emit('search')">
                <template #icon><t-icon name="search" /></template>查询
              </t-button>
              <t-button theme="default" variant="base" @click="emit('reset')">
                <template #icon><t-icon name="refresh" /></template>重置
              </t-button>
            </div>
          </div>
        </t-form>
        <div v-if="showToolbar" class="table-toolbar">
          <div class="toolbar-buttons">
            <t-button
              v-for="action in toolbarActions"
              :key="action.id"
              :theme="action.theme"
              :variant="action.variant"
              :class="action.className"
              :disabled="action.disabled"
              @click="emit('toolbar-action', action.id)"
            >
              <template v-if="action.icon" #icon><t-icon :name="action.icon" /></template>
              {{ action.label }}
            </t-button>
          </div>
          <div class="selection-info">已选 {{ selectedCount }} 项</div>
        </div>
      </div>
    </template>
    <template #table><slot name="table" /></template>
    <template #pagination>
      <AdminPagination
        :current="page"
        :page-size="pageSize"
        :total="total"
        :page-size-options="pageSizeOptions"
        @update:current="emit('update:page', $event)"
        @update:page-size="emit('update:pageSize', $event)"
      />
    </template>
  </AdminListLayout>
  <t-empty v-else-if="emptyDescription" :description="emptyDescription" />
</template>

<script setup lang="ts">
import { AdminListLayout, AdminPagination } from '@/components/foundation';

export interface FinishedStockToolbarAction {
  id: string;
  label: string;
  theme: 'primary' | 'default' | 'danger' | 'warning';
  variant?: 'base' | 'outline' | 'text';
  icon?: string;
  className?: string;
  disabled?: boolean;
}

withDefaults(
  defineProps<{
    tabs: { value: string; label: string }[];
    activeTab: string;
    showTabs?: boolean;
    filter: { keyword: string; category: string; supplier: string };
    supplierOptions: string[];
    toolbarActions: FinishedStockToolbarAction[];
    showToolbar?: boolean;
    selectedCount: number;
    page: number;
    pageSize: number;
    total: number;
    pageSizeOptions?: number[];
    emptyDescription?: string;
  }>(),
  { showTabs: true, showToolbar: true, pageSizeOptions: () => [10, 20, 50], emptyDescription: '' },
);

const emit = defineEmits<{
  'tab-change': [value: string];
  'filter-change': [field: 'keyword' | 'supplier', value: string];
  search: [];
  reset: [];
  'toolbar-action': [id: string];
  'update:page': [value: number];
  'update:pageSize': [value: number];
}>();
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}
.finished-list-layout {
  grid-template-columns: minmax(0, 1fr);
}
.list-controls {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: var(--td-comp-margin-l);
}
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-m);
}
.filter-fields {
  display: grid;
  flex: 1;
  grid-template-columns: 258px 230px 240px;
  gap: var(--td-comp-margin-m);
}
.filter-fields :deep(.t-form__item) {
  margin-bottom: 0;
}
.filter-actions {
  display: flex;
  flex: 0 0 auto;
  align-self: flex-start;
  gap: var(--td-comp-margin-s);
}
.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toolbar-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}
.selection-info {
  color: #6b7280;
  font-size: 13px;
}
:deep(.finished-stock-table .t-table__empty-row > td) {
  padding-inline: 0;
}
.brown-button {
  color: #fff;
  background: #8b5e34;
  border-color: #8b5e34;
}
.deep-danger-button {
  background: #8a1f11;
  border-color: #8a1f11;
}
@media (max-width: 1180px) {
  .filter-fields {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }
}
@media (max-width: 860px) {
  .filter-row {
    display: block;
  }
  .filter-fields {
    grid-template-columns: 1fr;
  }
  .filter-actions {
    margin-top: 12px;
  }
}
</style>
