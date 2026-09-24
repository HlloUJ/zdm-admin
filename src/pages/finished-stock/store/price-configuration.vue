<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <header class="page-header">
          <t-breadcrumb><t-breadcrumb-item>价格配置</t-breadcrumb-item></t-breadcrumb>
        </header>
        <AdminListLayout>
          <template #toolbar>
            <div class="list-controls">
              <t-form class="zdm-admin-filter-form" label-width="auto" :data="filter" colon>
                <div class="filter-row">
                  <div class="filter-fields">
                    <t-form-item label="角色"
                      ><t-input v-model="filter.keyword" clearable placeholder="请输入角色名称"
                    /></t-form-item>
                  </div>
                  <div class="filter-actions">
                    <t-button theme="primary" @click="page = 1"
                      ><template #icon><t-icon name="search" /></template>查询</t-button
                    >
                    <t-button variant="base" @click="reset"
                      ><template #icon><t-icon name="refresh" /></template>重置</t-button
                    >
                  </div>
                </div>
              </t-form>
              <div class="table-toolbar">
                <t-button v-if="can('create')" theme="primary" @click="openCreate"
                  ><template #icon><t-icon name="add" /></template>新增</t-button
                >
              </div>
            </div>
          </template>
          <template #table>
            <t-table row-key="id" :data="visibleRows" :columns="columns" :loading="loading" hover table-layout="fixed">
              <template #index="{ rowIndex }">{{ (page - 1) * pageSize + rowIndex + 1 }}</template>
              <template #priceCoefficient="{ row }">{{ Number(row.priceCoefficient).toFixed(4) }}</template>
              <template #status="{ row }"
                ><t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">{{
                  row.status === 'enabled' ? '已启用' : '已停用'
                }}</t-tag></template
              >
              <template #createdAt="{ row }">{{ time(row.createdAt) }}</template>
              <template #operation="{ row }">
                <t-space size="small">
                  <t-link v-if="can('edit')" theme="primary" @click="openEdit(row)">编辑</t-link>
                  <t-link
                    v-if="can('toggle-status')"
                    :theme="row.status === 'enabled' ? 'warning' : 'success'"
                    @click="confirmAction = { kind: 'status', row }"
                    >{{ row.status === 'enabled' ? '停用' : '启用' }}</t-link
                  >
                  <t-link v-if="can('delete')" theme="danger" @click="confirmAction = { kind: 'delete', row }"
                    >删除</t-link
                  >
                </t-space>
              </template>
              <template #empty>暂无价格配置</template>
            </t-table>
          </template>
          <template #pagination
            ><AdminPagination v-model:current="page" v-model:page-size="pageSize" :total="filteredRows.length"
          /></template>
        </AdminListLayout>
      </main>
    </div>
    <AdminDialog
      v-model:visible="formVisible"
      :header="editing ? '编辑' : '新增'"
      width="440px"
      @confirm="save"
      @cancel="formVisible = false"
      @close="formVisible = false"
    >
      <t-form label-width="96px" :data="form" colon>
        <t-form-item label="角色" name="roleId">
          <t-select v-model="form.roleId" :disabled="Boolean(editing)" placeholder="请选择角色" clearable>
            <t-option
              v-for="role in enabledRoles"
              :key="role.id"
              :value="role.id"
              :label="role.name"
              :disabled="rows.some((item) => item.roleId === role.id && item.id !== editing?.id)"
            />
          </t-select>
        </t-form-item>
        <t-form-item label="价格系数" name="priceCoefficient"
          ><t-input-number v-model="form.priceCoefficient" :decimal-places="4" :min="0" :max="999" theme="normal"
        /></t-form-item>
      </t-form>
      <t-alert theme="info" message="角色最低可售价 = 本店成本价 × 价格系数；可在商品价格中单独手工修改。" />
    </AdminDialog>
    <AdminConfirmDialog
      :visible="Boolean(confirmAction)"
      :action="confirmAction?.kind === 'delete' ? '删除' : confirmAction?.row.status === 'enabled' ? '停用' : '启用'"
      object-type="价格配置"
      :object-name="confirmAction?.row.roleName"
      @confirm="runConfirmed"
      @cancel="confirmAction = null"
      @close="confirmAction = null"
      @update:visible="!$event && (confirmAction = null)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminListLayout,
  AdminPagination,
  adminFeedback,
  getSafeErrorMessage,
} from '@/components/foundation';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  createStorePriceConfiguration,
  deleteStorePriceConfiguration,
  listStorePriceConfigurations,
  listStorePriceRoles,
  toggleStorePriceConfiguration,
  updateStorePriceConfiguration,
  type StorePriceConfiguration,
  type StorePriceRoleOption,
} from '@/services/storeFinishedStock';

const user = getLoginUser();
const can = (action: string) => hasPermission(user, `store.price-configuration.${action}`);
const rows = ref<StorePriceConfiguration[]>([]);
const roles = ref<StorePriceRoleOption[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(10);
const filter = reactive({ keyword: '' });
const editing = ref<StorePriceConfiguration | null>(null);
const formVisible = ref(false);
const form = reactive<{ roleId: number | null; priceCoefficient: number | null }>({
  roleId: null,
  priceCoefficient: null,
});
const confirmAction = ref<{ kind: 'status' | 'delete'; row: StorePriceConfiguration } | null>(null);
const enabledRoles = computed(() => roles.value.filter((role) => role.status === 'enabled'));
const filteredRows = computed(() => rows.value.filter((row) => row.roleName.includes(filter.keyword.trim())));
const visibleRows = computed(() =>
  filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);
const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 75 },
  { colKey: 'roleName', title: '角色', minWidth: 160 },
  { colKey: 'priceCoefficient', title: '价格系数', width: 130 },
  { colKey: 'status', title: '状态', width: 100 },
  { colKey: 'createdByName', title: '创建人', width: 120 },
  { colKey: 'createdAt', title: '创建时间', width: 180 },
  { colKey: 'operation', title: '操作', width: 190, fixed: 'right' },
];
function time(value?: string) {
  return value ? value.replace('T', ' ').slice(0, 16).replaceAll('-', '/') : '—';
}
async function load() {
  loading.value = true;
  try {
    [rows.value, roles.value] = await Promise.all([listStorePriceConfigurations(), listStorePriceRoles()]);
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '价格配置加载失败'));
  } finally {
    loading.value = false;
  }
}
function reset() {
  filter.keyword = '';
  page.value = 1;
}
function openCreate() {
  editing.value = null;
  form.roleId = null;
  form.priceCoefficient = null;
  formVisible.value = true;
}
function openEdit(row: StorePriceConfiguration) {
  editing.value = row;
  form.roleId = row.roleId;
  form.priceCoefficient = Number(row.priceCoefficient);
  formVisible.value = true;
}
async function save() {
  if (
    form.roleId == null ||
    form.priceCoefficient == null ||
    form.priceCoefficient < 0 ||
    form.priceCoefficient > 999
  ) {
    adminFeedback.warning('请选择角色并填写正确的价格系数');
    return;
  }
  try {
    if (editing.value) await updateStorePriceConfiguration(editing.value.id, form.roleId, form.priceCoefficient);
    else await createStorePriceConfiguration(form.roleId, form.priceCoefficient);
    formVisible.value = false;
    adminFeedback.success('价格配置已保存');
    await load();
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '保存失败'));
  }
}
async function runConfirmed() {
  const action = confirmAction.value;
  if (!action) return;
  try {
    if (action.kind === 'delete') await deleteStorePriceConfiguration(action.row.id);
    else await toggleStorePriceConfiguration(action.row.id, action.row.status === 'enabled' ? 'disabled' : 'enabled');
    confirmAction.value = null;
    adminFeedback.success('操作成功');
    await load();
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '操作失败'));
  }
}
onMounted(load);
</script>
