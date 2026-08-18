<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>权限管理</t-breadcrumb-item>
              <t-breadcrumb-item>角色管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
        </header>

        <section class="table-card">
          <div v-if="canCreateRole" class="table-toolbar">
            <t-button theme="primary" @click="openCreateDialog">
              <template #icon><t-icon name="add" /></template>
              新增
            </t-button>
          </div>

          <t-table
            row-key="id"
            :data="pageData"
            :columns="columns"
            :loading="loading"
            hover
            table-layout="fixed"
            class="role-table"
          >
            <template #index="{ rowIndex }">
              {{ (pagination.current - 1) * pagination.pageSize + rowIndex + 1 }}
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link v-if="canEditRole" theme="primary" hover="color" @click="openEditDialog(row)">编辑</t-link>
                <t-link
                  v-if="canManageRolePermission && !isSuperAdminRole(row)"
                  theme="primary"
                  hover="color"
                  @click="openPermissionDialog(row)"
                >
                  权限
                </t-link>
                <t-link
                  v-if="canDeleteRole && !isSuperAdminRole(row)"
                  theme="danger"
                  hover="color"
                  @click="openDeleteConfirm(row)"
                >
                  删除
                </t-link>
                <span
                  v-if="
                    !canEditRole &&
                    !(canDeleteRole && !isSuperAdminRole(row)) &&
                    !(canManageRolePermission && !isSuperAdminRole(row))
                  "
                  class="table-action-placeholder"
                >
                  -
                </span>
              </div>
            </template>
          </t-table>

          <AdminPagination
            v-model:current="pagination.current"
            v-model:page-size="pagination.pageSize"
            :total="paginationTotal"
            :page-size-options="pageSizeOptions"
          />
        </section>
      </main>
    </div>

    <t-dialog
      v-model:visible="formDialogVisible"
      :header="dialogMode === 'create' ? '新增' : '编辑'"
      width="520px"
      placement="center"
      :close-on-overlay-click="true"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleSubmit"
      @cancel="closeFormDialog"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="96px" colon>
        <t-form-item label="角色名称" name="name" required-mark>
          <t-input v-model="formData.name" clearable placeholder="请输入" />
        </t-form-item>
        <t-form-item label="备注" name="remark">
          <t-textarea
            v-model="formData.remark"
            placeholder="请输入"
            :maxlength="100"
            :autosize="{ minRows: 4, maxRows: 6 }"
          />
        </t-form-item>
      </t-form>
    </t-dialog>

    <AdminConfirmDialog
      v-model:visible="deleteDialogVisible"
      action="删除"
      object-type="角色"
      :object-name="deletingRole?.name"
      @confirm="handleDeleteConfirm"
      @cancel="closeDeleteDialog"
      @close="closeDeleteDialog"
    >
      {{ deleteConfirmText }}
    </AdminConfirmDialog>

    <t-dialog
      v-model:visible="permissionDialogVisible"
      header="权限配置"
      width="min(1560px, calc(100vw - 48px))"
      placement="center"
      :close-on-overlay-click="true"
      confirm-btn="保存"
      cancel-btn="取消"
      @confirm="handlePermissionSave"
      @cancel="closePermissionDialog"
      @close="closePermissionDialog"
    >
      <div class="permission-dialog">
        <section class="permission-section">
          <div class="permission-section__header">
            <h3>功能权限</h3>
            <div class="permission-shortcuts">
              <t-button
                size="small"
                variant="outline"
                theme="primary"
                :disabled="!permissionModules.length"
                @click="selectAllPermissions"
              >
                全选全部
              </t-button>
              <t-button
                size="small"
                variant="outline"
                :disabled="!permissionModules.length"
                @click="clearAllPermissions"
              >
                清空全部
              </t-button>
            </div>
          </div>
          <div class="permission-layout">
            <aside class="permission-module-list">
              <button
                v-for="module in permissionModules"
                :key="module.value"
                type="button"
                class="permission-module-item"
                :class="{ 'permission-module-item--active': module.value === activePermissionModuleValue }"
                @click="activePermissionModuleValue = module.value"
              >
                <span>{{ module.label }}</span>
                <span
                  >{{ getSelectedCount(getModuleActionValues(module)) }}/{{
                    getModuleActionValues(module).length
                  }}</span
                >
              </button>
              <div v-if="!permissionModules.length" class="permission-module-empty">
                <span>暂无功能模块</span>
                <small>模块梳理并验证通过后，将显示在这里</small>
              </div>
            </aside>

            <div class="permission-matrix">
              <div class="permission-matrix__toolbar">
                <div class="matrix-toolbar-right">
                  <t-checkbox
                    :checked="isModuleAllSelected(activePermissionModule)"
                    :indeterminate="isModuleIndeterminate(activePermissionModule)"
                    :disabled="!activePermissionModule"
                    @change="toggleModulePermissions(activePermissionModule, $event)"
                  >
                    全选当前模块
                  </t-checkbox>
                  <span v-if="activePermissionModule" class="module-selection-count">
                    已下放 {{ getSelectedCount(getModuleActionValues(activePermissionModule)) }} /
                    {{ getModuleActionValues(activePermissionModule).length }}
                  </span>
                  <span v-else class="module-selection-count">暂无功能模块</span>
                </div>
              </div>

              <div class="permission-matrix__table-wrap">
                <table class="permission-matrix__table">
                  <thead>
                    <tr>
                      <th class="permission-menu-column">二级菜单</th>
                      <th class="permission-third-menu-column">三级菜单</th>
                      <th class="permission-page-column">页面</th>
                      <th class="permission-tab-column">页面 Tab</th>
                      <th class="permission-action-column">操作权限</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in activePermissionRows" :key="row.key">
                      <td v-if="row.showMenu" class="permission-menu-cell" :rowspan="row.menuRowspan">
                        <t-tag v-if="row.direct" class="permission-level-tag" variant="light">一级菜单直达</t-tag>
                        <span v-else class="permission-menu-name">{{ row.menuLabel }}</span>
                      </td>
                      <td v-if="row.showThirdMenu" class="permission-third-menu-cell" :rowspan="row.thirdMenuRowspan">
                        <span v-if="row.thirdMenuLabel" class="permission-third-menu-name">{{
                          row.thirdMenuLabel
                        }}</span>
                        <span v-else class="permission-empty-value">—</span>
                      </td>
                      <td v-if="row.showPage" class="permission-page-cell" :rowspan="row.pageRowspan">
                        <div class="permission-page-name">{{ row.pageLabel }}</div>
                        <div v-if="row.pageNote" class="permission-page-note">{{ row.pageNote }}</div>
                      </td>
                      <td class="permission-tab-cell">
                        <span v-if="row.tabLabels.length" class="permission-tab-text">
                          {{ row.tabLabels.join('、') }}
                        </span>
                        <span v-else class="permission-empty-value">—</span>
                      </td>
                      <td class="permission-action-cell">
                        <t-checkbox
                          v-if="row.actions.length"
                          class="permission-row-toggle"
                          size="small"
                          :checked="isRowAllSelected(row)"
                          :indeterminate="isRowIndeterminate(row)"
                          @change="toggleRowPermissions(row, $event)"
                        >
                          {{ row.selectionLabel }}
                        </t-checkbox>
                        <div v-if="row.actions.length" class="permission-action-grid">
                          <t-checkbox
                            v-for="action in row.actions"
                            :key="action.value"
                            :checked="isPermissionSelected(action.value)"
                            @change="togglePermission(row, action.value, $event)"
                          >
                            {{ action.label }}
                          </t-checkbox>
                        </div>
                        <span v-else class="permission-empty-action">暂无独立权限项</span>
                      </td>
                    </tr>
                    <tr v-if="!activePermissionRows.length" class="permission-matrix-empty-row">
                      <td colspan="5">
                        <div class="permission-matrix-empty">
                          <strong>暂无功能目录数据</strong>
                          <span>完成一个业务模块的梳理、实现和验证后，再将该模块加入全量功能目录</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { requireCreatorOwnership } from '@/composables/useCreatorOwnershipGuard';
import { adminFeedback, AdminConfirmDialog, AdminPagination } from '@/components/foundation';
import {
  collectFunctionCatalogRows,
  getRuntimeFunctionCatalog,
  getFunctionCatalogPermissionValues,
  getFunctionModulePermissionValues,
  getRowViewPermissionValue,
  normalizeFunctionCatalogPermissions,
  type FunctionCatalogRow,
  type FunctionModule,
} from '@/services/functionCatalog';
import { getLoginUser } from '@/services/auth';
import { hasAnyPermission } from '@/services/adminPermissions';
import { sortByCreatedAtDesc } from '@/services/recordSorting';
import { createRole, deleteRole, listRoles, updateRole, type RolePayload, type RoleRecord } from '@/services/roles';

type DialogMode = 'create' | 'edit';

interface RoleItem {
  id: number;
  code: string;
  dataScope: string;
  status: 'enabled' | 'disabled';
  name: string;
  createdByName: string;
  createdByAccountId?: number;
  createdAt: string;
  remark: string;
  functionPermissions: string[];
}

interface RoleForm {
  name: string;
  remark: string;
}

interface RolePermissionConfig {
  functionPermissions: string[];
}

const roles = ref<RoleItem[]>([]);
const loading = ref(false);

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: '14%', align: 'left' },
  { colKey: 'name', title: '角色名称', width: '24%', align: 'left' },
  { colKey: 'createdByName', title: '创建人', width: '16%', align: 'left' },
  { colKey: 'createdAt', title: '创建时间', width: '24%', align: 'left' },
  { colKey: 'operation', title: '操作', width: '22%', align: 'left' },
];

const permissionModules = computed(() => getRuntimeFunctionCatalog('admin'));

const pageSizeOptions = [10, 20, 50];
const loginUser = computed(() => getLoginUser());
const activePermissionModuleValue = ref(permissionModules.value[0]?.value ?? '');
const pagination = reactive({
  current: 1,
  pageSize: 10,
});

const formRef = ref<FormInstanceFunctions>();
const formDialogVisible = ref(false);
const deleteDialogVisible = ref(false);
const permissionDialogVisible = ref(false);
const dialogMode = ref<DialogMode>('create');
const editingId = ref<number | null>(null);
const deletingRole = ref<RoleItem | null>(null);
const permissionRole = ref<RoleItem | null>(null);
const formData = reactive<RoleForm>({
  name: '',
  remark: '',
});
const permissionDraft = reactive<RolePermissionConfig>({
  functionPermissions: [],
});

const formRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入角色名称', type: 'error' }],
};

const getRoleActionPermissions = (action: 'create' | 'permission' | 'edit' | 'delete') => {
  return [`admin.permission-management.role-management.${action}`];
};
const canCreateRole = computed(() => hasAnyPermission(loginUser.value, getRoleActionPermissions('create')));
const canManageRolePermission = computed(() =>
  hasAnyPermission(loginUser.value, getRoleActionPermissions('permission')),
);
const canEditRole = computed(() => hasAnyPermission(loginUser.value, getRoleActionPermissions('edit')));
const canDeleteRole = computed(() => hasAnyPermission(loginUser.value, getRoleActionPermissions('delete')));
const paginationTotal = computed(() => roles.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / pagination.pageSize), 1));
const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return roles.value.slice(start, start + pagination.pageSize);
});
const deleteConfirmText = computed(
  () =>
    `是否删除角色“${deletingRole.value?.name ?? ''}”？删除后，使用该角色的用户将被清空角色并自动停用账号，无法继续登录。请及时为相关用户重新分配角色。`,
);
const activePermissionModule = computed(
  () =>
    permissionModules.value.find((module) => module.value === activePermissionModuleValue.value) ??
    permissionModules.value[0],
);
const activePermissionRows = computed(() => collectFunctionCatalogRows(activePermissionModule.value));

const parsePermissions = (value?: string) => (value ? value.split(',').filter(Boolean) : []);

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);

  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toRoleItem = (record: RoleRecord): RoleItem => ({
  id: record.id,
  code: record.code,
  dataScope: record.dataScope,
  status: record.status,
  name: record.name,
  createdByName: record.createdByName || '-',
  createdByAccountId: record.createdByAccountId,
  createdAt: formatDateTime(record.createdAt),
  remark: record.remark ?? '',
  functionPermissions: parsePermissions(record.functionPermissions),
});

const createRoleCode = (roleName: string) => `OPERATION_PLATFORM_${roleName.trim().length}_${Date.now()}`.toUpperCase();

const toRolePayload = (role: RoleItem): RolePayload => ({
  name: role.name,
  code: role.code,
  dataScope: role.dataScope,
  status: role.status,
  remark: role.remark,
  functionPermissions: role.functionPermissions.join(','),
});

const isSuperAdminRole = (row: RoleItem) => row.code === 'SUPER_ADMIN';

const loadRoles = async () => {
  loading.value = true;
  try {
    const records = await listRoles();
    roles.value = sortByCreatedAtDesc(records.filter((record) => record.status === 'enabled')).map(toRoleItem);
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '角色列表加载失败');
  } finally {
    loading.value = false;
  }
};

const getModuleActionValues = (module?: FunctionModule) => getFunctionModulePermissionValues(module);
const getRowActionValues = (row: FunctionCatalogRow) => row.actions.map((action) => action.value);
const allPermissionValues = computed(() => getFunctionCatalogPermissionValues(permissionModules.value));
const getSelectedCount = (values: string[]) =>
  values.filter((value) => permissionDraft.functionPermissions.includes(value)).length;
const getCheckedValue = (checked: unknown) => {
  if (typeof checked === 'boolean') return checked;
  if (checked && typeof checked === 'object' && 'checked' in checked) {
    return Boolean((checked as { checked?: boolean }).checked);
  }

  return Boolean(checked);
};

const setPermissionValues = (values: string[]) => {
  permissionDraft.functionPermissions = Array.from(new Set(values));
};

const setPermissionRange = (values: string[], checked: unknown) => {
  const isChecked = getCheckedValue(checked);
  const nextValues = isChecked
    ? [...permissionDraft.functionPermissions, ...values]
    : permissionDraft.functionPermissions.filter((value) => !values.includes(value));

  setPermissionValues(nextValues);
};

const isPermissionSelected = (value: string) => permissionDraft.functionPermissions.includes(value);
const isAllSelected = (values: string[]) => values.length > 0 && values.every(isPermissionSelected);
const isIndeterminate = (values: string[]) => {
  const selectedCount = getSelectedCount(values);
  return selectedCount > 0 && selectedCount < values.length;
};
const isRowAllSelected = (row: FunctionCatalogRow) => isAllSelected(getRowActionValues(row));
const isRowIndeterminate = (row: FunctionCatalogRow) => isIndeterminate(getRowActionValues(row));
const isModuleAllSelected = (module?: FunctionModule) => isAllSelected(getModuleActionValues(module));
const isModuleIndeterminate = (module?: FunctionModule) => isIndeterminate(getModuleActionValues(module));
const togglePermission = (row: FunctionCatalogRow, value: string, checked: unknown) => {
  const isChecked = getCheckedValue(checked);
  const viewPermission = getRowViewPermissionValue(row);
  if (!isChecked && value === viewPermission) {
    setPermissionRange(getRowActionValues(row), false);
    return;
  }
  setPermissionRange(isChecked && viewPermission ? [viewPermission, value] : [value], isChecked);
};
const toggleRowPermissions = (row: FunctionCatalogRow, checked: unknown) =>
  setPermissionRange(getRowActionValues(row), checked);
const toggleModulePermissions = (module: FunctionModule | undefined, checked: unknown) =>
  setPermissionRange(getModuleActionValues(module), checked);

const resetFormData = () => {
  formData.name = '';
  formData.remark = '';
};

const fillFormData = (row: RoleItem) => {
  formData.name = row.name;
  formData.remark = row.remark;
};

const ensureCurrentPage = () => {
  if (pagination.current > pageCount.value) {
    pagination.current = pageCount.value;
  }
};

const openCreateDialog = () => {
  dialogMode.value = 'create';
  editingId.value = null;
  resetFormData();
  formDialogVisible.value = true;
};

const openEditDialog = (row: RoleItem) => {
  if (!requireCreatorOwnership(row)) return;
  dialogMode.value = 'edit';
  editingId.value = row.id;
  fillFormData(row);
  formDialogVisible.value = true;
};

const closeFormDialog = () => {
  formDialogVisible.value = false;
  formRef.value?.clearValidate();
};

const handleSubmit = async () => {
  const result = await formRef.value?.validate();
  if (result !== true) return;

  const roleName = formData.name.trim();
  const roleRemark = formData.remark.trim().slice(0, 100);

  try {
    if (dialogMode.value === 'create') {
      await createRole({
        name: roleName,
        code: createRoleCode(roleName),
        dataScope: 'all',
        status: 'enabled',
        remark: roleRemark,
        functionPermissions: '',
      });
      await loadRoles();
      pagination.current = 1;
    } else if (editingId.value) {
      const target = roles.value.find((item) => item.id === editingId.value);
      if (target) {
        await updateRole(editingId.value, toRolePayload({ ...target, name: roleName, remark: roleRemark }));
        await loadRoles();
      }
    }

    closeFormDialog();
    if (dialogMode.value === 'create') {
      adminFeedback.created(roleName);
    } else {
      adminFeedback.success('已保存角色');
    }
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openDeleteConfirm = (row: RoleItem) => {
  if (!requireCreatorOwnership(row)) return;
  if (isSuperAdminRole(row)) {
    adminFeedback.warning('超级管理员角色不可删除');
    return;
  }
  deletingRole.value = row;
  deleteDialogVisible.value = true;
};

const closeDeleteDialog = () => {
  deleteDialogVisible.value = false;
  deletingRole.value = null;
};

const handleDeleteConfirm = async () => {
  if (!deletingRole.value) return;
  const target = deletingRole.value;

  try {
    await deleteRole(target.id);
    roles.value = roles.value.filter((item) => item.id !== target.id);
    ensureCurrentPage();
    closeDeleteDialog();
    adminFeedback.deleted(target.name);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openPermissionDialog = (row: RoleItem) => {
  if (!requireCreatorOwnership(row)) return;
  if (isSuperAdminRole(row)) {
    adminFeedback.warning('超级管理员天然拥有全量权限，无需配置权限');
    return;
  }
  permissionRole.value = row;
  activePermissionModuleValue.value = permissionModules.value[0]?.value ?? '';
  permissionDraft.functionPermissions = row.functionPermissions.includes('all')
    ? [...allPermissionValues.value]
    : normalizeFunctionCatalogPermissions(permissionModules.value, row.functionPermissions);
  permissionDialogVisible.value = true;
};

const closePermissionDialog = () => {
  permissionDialogVisible.value = false;
  permissionRole.value = null;
  permissionDraft.functionPermissions = [];
};

const selectAllPermissions = () => {
  permissionDraft.functionPermissions = [...allPermissionValues.value];
};

const clearAllPermissions = () => {
  permissionDraft.functionPermissions = [];
};

const handlePermissionSave = async () => {
  if (!permissionRole.value) return;
  if (!permissionModules.value.length) {
    adminFeedback.warning('全量功能目录暂未发布，无法保存功能权限');
    return;
  }

  try {
    const updated = await updateRole(
      permissionRole.value.id,
      toRolePayload({ ...permissionRole.value, functionPermissions: [...permissionDraft.functionPermissions] }),
    );
    const targetIndex = roles.value.findIndex((item) => item.id === permissionRole.value?.id);
    if (targetIndex !== -1) {
      roles.value.splice(targetIndex, 1, toRoleItem(updated));
    }
    closePermissionDialog();
    adminFeedback.success('角色功能权限已保存');
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '保存失败');
  }
};

onMounted(loadRoles);
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.table-card {
  background: var(--td-bg-color-container);
  border-radius: 6px;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  border: 1px solid var(--td-component-border);
}

.role-table :deep(th),
.role-table :deep(td) {
  padding-right: 32px !important;
  padding-left: 32px !important;
  text-align: left;
}

.role-table :deep(.t-table__th-cell-inner) {
  justify-content: flex-start;
  padding-right: 0 !important;
  padding-left: 0 !important;
}

.role-table :deep(.t-table__cell--title) {
  justify-content: flex-start;
}

.role-tabs {
  margin-bottom: var(--td-comp-margin-l);
}

.role-tabs :deep(.t-tabs__nav-item) {
  color: var(--td-text-color-secondary);
}

.role-tabs :deep(.t-is-active) {
  color: var(--td-brand-color);
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: var(--td-comp-margin-s);
  flex-wrap: wrap;
}

.table-action-placeholder {
  color: var(--td-text-color-placeholder);
}

.permission-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-l);
}

.permission-section {
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
}

.permission-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-m);
}

.permission-section__header h3 {
  margin: 0;
  color: var(--td-text-color-primary);
  font: var(--td-font-title-medium);
}

.permission-shortcuts {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.permission-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 520px;
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
  overflow: hidden;
}

.permission-module-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-s);
  overflow: auto;
  background: var(--td-bg-color-secondarycontainer);
  border-right: 1px solid var(--td-component-border);
}

.permission-module-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  width: 100%;
  min-height: 38px;
  padding: 0 var(--td-comp-paddingLR-s);
  border: 0;
  border-radius: 4px;
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.permission-module-item span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-module-item span:last-child {
  flex: 0 0 auto;
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
}

.permission-module-item:hover {
  background: var(--td-bg-color-container-hover);
}

.permission-module-item--active {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}

.permission-module-item--active span:last-child {
  color: var(--td-brand-color);
}

.permission-module-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--td-comp-margin-xs);
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-m);
  color: var(--td-text-color-secondary);
  text-align: center;
}

.permission-module-empty small {
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
  line-height: 20px;
}

.permission-matrix {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--td-bg-color-container);
}

.permission-matrix__toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--td-comp-margin-l);
  min-height: 48px;
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-l);
  border-bottom: 1px solid var(--td-component-border);
}

.matrix-toolbar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--td-comp-margin-l);
  flex-wrap: nowrap;
}

.module-selection-count {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
  white-space: nowrap;
}

.permission-matrix__table-wrap {
  max-height: 472px;
  overflow: auto;
}

.permission-matrix__table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.permission-matrix__table th,
.permission-matrix__table td {
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-l);
  border-bottom: 1px solid var(--td-component-border);
  text-align: left;
  vertical-align: top;
}

.permission-matrix__table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--td-text-color-secondary);
  font: var(--td-font-title-small);
  background: var(--td-bg-color-secondarycontainer);
}

.permission-menu-column,
.permission-menu-cell {
  width: 12%;
  border-right: 1px solid var(--td-component-border);
}

.permission-third-menu-column,
.permission-third-menu-cell {
  width: 12%;
  border-right: 1px solid var(--td-component-border);
}

.permission-page-column,
.permission-page-cell {
  width: 16%;
  border-right: 1px solid var(--td-component-border);
}

.permission-tab-column,
.permission-tab-cell {
  width: 12.8625%;
  border-right: 1px solid var(--td-component-border);
}

.permission-action-column,
.permission-action-cell {
  width: 47.1375%;
}

.permission-menu-name,
.permission-third-menu-name,
.permission-tab-text {
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
}

.permission-level-tag {
  white-space: nowrap;
}

.permission-page-name {
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
  font-weight: 400;
}

.permission-page-note {
  margin-top: var(--td-comp-margin-xs);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
  line-height: 20px;
}

.permission-row-toggle {
  margin-bottom: var(--td-comp-margin-s);
}

.permission-empty-value,
.permission-empty-action {
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
}

.permission-action-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-s) var(--td-comp-margin-l);
  align-items: start;
}

.permission-action-grid :deep(.t-checkbox) {
  flex: 0 0 auto;
  min-width: 0;
}

.permission-action-grid :deep(.t-checkbox__label) {
  white-space: normal;
  word-break: break-word;
  line-height: 20px;
}

.permission-matrix-empty-row td {
  height: 416px;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  vertical-align: middle;
}

.permission-matrix-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--td-comp-margin-xs);
  color: var(--td-text-color-secondary);
  text-align: center;
}

.permission-matrix-empty strong {
  color: var(--td-text-color-primary);
  font: var(--td-font-title-small);
}

@media (max-width: 960px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
