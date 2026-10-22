<template>
  <t-space direction="vertical" size="large" style="width: 100%">
    <t-space break-line
      ><t-button @click="mode = 'base'">基础列表</t-button><t-button @click="mode = 'filter'">筛选列表</t-button
      ><t-button @click="mode = 'tabs'">带Tab列表</t-button
      ><t-button @click="visible = true">表单弹窗</t-button></t-space
    >
    <AdminListPage
      v-model:filter-values="values"
      :tabs="mode === 'tabs' ? tabs : []"
      :active-tab="activeTab"
      :filters="mode === 'base' ? [] : filters"
      :actions="actions"
      :selected-count="selected.length"
      :table-props="{ rowKey: 'id', data: rows, columns, pagination, selectedRowKeys: selected }"
      @tab-change="activeTab = String($event)"
      @select-change="selected = $event"
      @page-change="
        pagination.current = $event.current;
        pagination.pageSize = $event.pageSize;
      "
      @search="searches++"
      @reset="values = {}"
      @action="visible = true"
    />
    <AdminDetailPage
      title="详情范例"
      :items="[
        { label: '姓名', value: '客户示例' },
        { label: '联系电话', value: '13800000000' },
      ]"
    />
    <AdminFormDialog
      v-model:visible="visible"
      :confirmation="formConfirmation('create')"
      confirm-function="submit"
      header="表单范例"
      :data="values"
      @confirm="visible = false"
      ><t-form-item label="姓名"><t-input v-model="name" /></t-form-item
    ></AdminFormDialog>
    <span>查询次数：{{ searches }}</span>
  </t-space>
</template>
<script setup lang="ts">
import { formConfirmation } from '@/components/foundation/actions/confirmation';
import { computed, ref } from 'vue';
import { AdminListPage, AdminFormDialog, AdminDetailPage } from '@/components/foundation';
import type { ListFilter, ListAction, FilterValues } from '@/components/foundation';
const mode = ref('tabs');
const activeTab = ref('daily');
const visible = ref(false);
const name = ref('');
const values = ref<FilterValues>({});
const selected = ref<(string | number)[]>([]);
const searches = ref(0);
const tabs = [
  { value: 'daily', label: '日常客户' },
  { value: 'archived', label: '归档客户' },
];
const baseFilters: ListFilter[] = [
  { key: 'name', label: '姓名' },
  { key: 'phone', label: '联系电话' },
  { key: 'owner', label: '归属人', kind: 'select', options: [{ value: 7, label: '导购A' }] },
];
if (new URLSearchParams(location.search).has('compoundSearch'))
  baseFilters[0] = { key: 'name', label: '商品', searchScope: '商品名称/ID/编号' };
const filterCount = Number(new URLSearchParams(location.search).get('filterCount') ?? 3);
const filters: ListFilter[] = Array.from(
  { length: filterCount },
  (_, index) => baseFilters[index] ?? { key: `extra${index}`, label: `条件${index + 1}` },
);
const actions: ListAction[] = [
  { id: 'create', function: 'create', label: '新增' },
  { id: 'archive', function: 'archive', batch: true, label: '批量归档', disabled: true },
];
const rows = computed(() => Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: '客户' + (i + 1) })));
const columns = [
  { colKey: 'row-select', type: 'multiple' as const },
  { colKey: 'name', title: '姓名' },
];
const pagination = ref({ current: 1, pageSize: 10, total: 12, pageSizeOptions: [10, 20] });
</script>
