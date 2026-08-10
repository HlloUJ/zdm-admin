<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <header class="page-header">
          <t-breadcrumb
            ><t-breadcrumb-item>商品基础数据中心</t-breadcrumb-item
            ><t-breadcrumb-item>{{ config.title }}</t-breadcrumb-item></t-breadcrumb
          ><t-tag theme="primary" variant="light">平台主数据</t-tag>
        </header>
        <t-alert theme="info" class="page-tip">{{ config.tip }}</t-alert>
        <section class="filter-card">
          <t-form :data="searchForm" label-width="72px" colon
            ><div class="filter-row">
              <div class="filter-fields">
                <t-form-item :label="config.entityName"
                  ><t-input
                    v-model="searchForm.keyword"
                    clearable
                    :placeholder="`名称或${config.codeLabel}`" /></t-form-item
                ><t-form-item label="状态"
                  ><t-select v-model="searchForm.status" clearable placeholder="全部"
                    ><t-option label="启用" value="enabled" /><t-option label="停用" value="disabled" /></t-select
                ></t-form-item>
              </div>
              <div class="filter-actions">
                <t-button theme="primary" @click="search"
                  ><template #icon><t-icon name="search" /></template>查询</t-button
                ><t-button variant="base" @click="reset">重置</t-button>
              </div>
            </div></t-form
          >
        </section>
        <section class="table-card">
          <div class="table-toolbar">
            <t-button theme="primary" @click="openCreate"
              ><template #icon><t-icon name="add" /></template>新增{{ config.entityName }}</t-button
            ><span>{{ config.toolbarTip }}</span>
          </div>
          <t-table row-key="id" :data="filteredData" :columns="columns" :loading="loading" hover table-layout="fixed"
            ><template #status="{ row }"
              ><t-tag :theme="row.status === 'enabled' ? 'success' : 'default'" variant="light">{{
                row.status === 'enabled' ? '启用' : '停用'
              }}</t-tag></template
            ><template #operation="{ row }"
              ><div class="table-actions">
                <t-link @click="openEdit(row)">编辑</t-link
                ><t-link :theme="row.status === 'enabled' ? 'warning' : 'success'" @click="toggle(row)">{{
                  row.status === 'enabled' ? '停用' : '启用'
                }}</t-link>
              </div></template
            ></t-table
          >
        </section>
      </main>
    </div>
    <t-dialog
      v-model:visible="dialogVisible"
      :header="`${editingRow ? '编辑' : '新增'}${config.entityName}`"
      width="520px"
      confirm-btn="提交"
      @confirm="submit"
      ><t-form :data="form" label-width="96px" colon
        ><t-form-item :label="`${config.entityName}名称`"><t-input v-model="form.name" clearable /></t-form-item
        ><t-form-item :label="config.codeLabel"
          ><t-input v-model="form.code" clearable :placeholder="config.codePlaceholder" /></t-form-item
        ><t-form-item :label="config.extraLabel"
          ><t-input v-model="form.extra" clearable :placeholder="config.extraPlaceholder" /></t-form-item></t-form
    ></t-dialog>
  </div>
</template>

<script setup lang="ts">
import { adminFeedback } from '@/components/foundation';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import {
  createMasterData,
  listMasterData,
  updateMasterData,
  type MasterDataPayload,
  type MasterDataRecord,
} from '@/services/masterData';

type Status = 'enabled' | 'disabled';
interface MasterDataItem {
  id: number;
  dataType: string;
  code: string;
  name: string;
  extra: string;
  useCount: number;
  status: Status;
}

const config = computed(() => ({
  title: '计量单位管理',
  entityName: '计量单位',
  codeLabel: '单位编码',
  codePlaceholder: '如 mm / piece',
  extraLabel: '单位类型',
  extraPlaceholder: '如 长度 / 件数',
  tip: '计量单位是平台共享主数据。数值型属性、商品规格和库存计量统一引用单位，避免同义单位造成统计与换算错误。',
  toolbarTip: '停用单位后不可在新建属性和商品中选择，已使用数据保留原单位。',
  extraColumn: '单位类型',
  useColumn: '引用属性数',
  dataType: 'unit',
}));
const data = ref<MasterDataItem[]>([]);
const loading = ref(false);
const searchForm = reactive({ keyword: '', status: '' as '' | Status });
const applied = reactive({ ...searchForm });
const dialogVisible = ref(false);
const editingRow = ref<MasterDataItem | null>(null);
const form = reactive({ name: '', code: '', extra: '' });
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  { colKey: 'code', title: config.value.codeLabel, minWidth: 170 },
  { colKey: 'name', title: `${config.value.entityName}名称`, minWidth: 160 },
  { colKey: 'extra', title: config.value.extraColumn, minWidth: 180 },
  { colKey: 'useCount', title: config.value.useColumn, width: 120, align: 'right' },
  { colKey: 'status', title: '状态', width: 90, align: 'center' },
  { colKey: 'operation', title: '操作', width: 140, fixed: 'right' },
]);
const filteredData = computed(() =>
  data.value.filter(
    (item) =>
      item.dataType === config.value.dataType &&
      (!applied.keyword || `${item.code}${item.name}${item.extra}`.includes(applied.keyword)) &&
      (!applied.status || item.status === applied.status),
  ),
);
const normalizeStatus = (status?: MasterDataRecord['status']): Status =>
  status === 'disabled' ? 'disabled' : 'enabled';
const toMasterDataItem = (record: MasterDataRecord): MasterDataItem => ({
  id: record.id,
  dataType: record.dataType,
  name: record.name,
  code: record.code,
  extra: record.extra ?? '',
  useCount: 0,
  status: normalizeStatus(record.status),
});
const toMasterDataPayload = (status: Status): MasterDataPayload => ({
  dataType: config.value.dataType,
  name: form.name.trim(),
  code: form.code.trim(),
  extra: form.extra.trim(),
  status,
});
const loadData = async () => {
  loading.value = true;
  try {
    const records = await listMasterData();
    data.value = records.map(toMasterDataItem);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '主数据加载失败');
  } finally {
    loading.value = false;
  }
};
const search = () => Object.assign(applied, searchForm);
const reset = () => {
  searchForm.keyword = '';
  searchForm.status = '';
  search();
};
const openCreate = () => {
  editingRow.value = null;
  form.name = '';
  form.code = '';
  form.extra = '';
  dialogVisible.value = true;
};
const openEdit = (row: MasterDataItem) => {
  editingRow.value = row;
  form.name = row.name;
  form.code = row.code;
  form.extra = row.extra;
  dialogVisible.value = true;
};
const submit = async () => {
  if (!form.name.trim() || !form.code.trim()) {
    adminFeedback.warning(`请填写${config.value.entityName}名称和${config.value.codeLabel}`);
    return;
  }
  if (
    data.value.some(
      (item) => item.id !== editingRow.value?.id && (item.code === form.code.trim() || item.name === form.name.trim()),
    )
  ) {
    adminFeedback.warning('名称或编码已存在');
    return;
  }
  try {
    if (editingRow.value) {
      await updateMasterData(editingRow.value.id, toMasterDataPayload(editingRow.value.status));
    } else {
      await createMasterData(toMasterDataPayload('enabled'));
    }
    await loadData();
    dialogVisible.value = false;
    adminFeedback.success(editingRow.value ? '已保存修改' : `已新增${config.value.entityName}`);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};
const toggle = async (row: MasterDataItem) => {
  const nextStatus = row.status === 'enabled' ? 'disabled' : 'enabled';
  try {
    const updated = await updateMasterData(row.id, {
      dataType: row.dataType,
      name: row.name,
      code: row.code,
      extra: row.extra,
      status: nextStatus,
    });
    Object.assign(row, toMasterDataItem(updated));
    adminFeedback.success(nextStatus === 'enabled' ? '已启用' : '已停用');
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

onMounted(loadData);
</script>

<style scoped>
.admin-layout {
  min-height: 100vh;
  background: var(--td-bg-color-page);
}
.top-nav {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-container);
  border-bottom: 1px solid var(--td-component-border);
}
.admin-shell {
  min-height: calc(100vh - 64px);
  display: flex;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.brand-logo {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: var(--td-brand-color);
  color: #fff;
  font-weight: 700;
}
.brand-title {
  font: var(--td-font-title-medium);
}
.brand-subtitle {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
.top-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--td-text-color-secondary);
}
.page {
  min-width: 0;
  flex: 1;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xxl);
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.page-tip,
.filter-card {
  margin-bottom: 16px;
}
.filter-card,
.table-card {
  padding: 24px;
  background: var(--td-bg-color-container);
  border-radius: 6px;
  box-shadow: var(--td-shadow-1);
}
.filter-row,
.filter-fields,
.filter-actions,
.table-toolbar,
.table-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.filter-row {
  justify-content: space-between;
}
.filter-fields {
  flex: 1;
}
.filter-fields :deep(.t-form__item) {
  margin-bottom: 0;
}
.table-toolbar {
  justify-content: space-between;
  margin-bottom: 16px;
  color: var(--td-text-color-secondary);
  font-size: 13px;
}
.table-actions {
  gap: 12px;
}
</style>
