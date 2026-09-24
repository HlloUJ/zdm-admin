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

        <AdminListLayout class="role-list-layout">
          <template #toolbar>
            <div class="list-controls">
              <t-tabs
                v-if="isInternalAdministration && managementTabs.length > 1"
                v-model="managedClient"
                :list="managementTabs"
                @change="handleManagedClientChange"
              />

              <div v-if="canCreateRole" class="table-toolbar">
                <t-button theme="primary" @click="openCreateDialog">
                  <template #icon><t-icon name="add" /></template>
                  新增
                </t-button>
              </div>
            </div>
          </template>
          <template #table>
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
                  <t-link
                    v-if="canEditRole && canMaintainRole(row)"
                    theme="primary"
                    hover="color"
                    @click="openEditDialog(row)"
                    >编辑</t-link
                  >
                  <t-link
                    v-if="canManageRolePermission && !isSuperAdminRole(row) && canMaintainRole(row)"
                    theme="primary"
                    hover="color"
                    @click="openPermissionDialog(row)"
                  >
                    权限
                  </t-link>
                  <t-link
                    v-if="canDeleteRole && !isSuperAdminRole(row) && canMaintainRole(row)"
                    theme="danger"
                    hover="color"
                    @click="openDeleteConfirm(row)"
                  >
                    删除
                  </t-link>
                  <span
                    v-if="
                      !canMaintainRole(row) ||
                      (!canEditRole &&
                        !(canDeleteRole && !isSuperAdminRole(row)) &&
                        !(canManageRolePermission && !isSuperAdminRole(row)))
                    "
                    class="table-action-placeholder"
                  >
                    -
                  </span>
                </div>
              </template>
            </t-table>
          </template>
          <template #pagination>
            <AdminPagination
              v-model:current="pagination.current"
              v-model:page-size="pagination.pageSize"
              :total="paginationTotal"
              :page-size-options="pageSizeOptions"
            />
          </template>
        </AdminListLayout>
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
      <PermissionAssignmentMatrix
        v-model="permissionDraft.functionPermissions"
        v-model:active-module="activePermissionModuleValue"
        :modules="permissionModules"
      />
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import PermissionAssignmentMatrix from '@/components/permission/PermissionAssignmentMatrix.vue';
import { adminFeedback, AdminConfirmDialog, AdminListLayout, AdminPagination } from '@/components/foundation';
import {
  filterFunctionCatalogByAudience,
  filterFunctionCatalogByPermissions,
  getFunctionCatalogPermissionValues,
  normalizeFunctionCatalogPermissions,
  type FunctionModule,
} from '@/services/functionCatalog';
import { getLoginUser } from '@/services/auth';
import { hasAnyPermission, hasPermission } from '@/services/adminPermissions';
import { sortByCreatedAtDesc } from '@/services/recordSorting';
import {
  createRole,
  deleteRole,
  getRolePermissionScope,
  listRoles,
  updateRole,
  type RolePayload,
  type RolePermissionScope,
  type RoleRecord,
} from '@/services/roles';

type DialogMode = 'create' | 'edit';

interface RoleItem {
  createdByClientCode?: 'admin' | 'supply-chain' | null;
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
const parsePermissions = (value?: string) => (value ? value.split(',').filter(Boolean) : []);

const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  { colKey: 'index', title: '序号', width: 100, align: 'left' },
  { colKey: 'name', title: '角色名称', minWidth: 160, align: 'left' },
  { colKey: 'createdByName', title: '创建人', width: 140, align: 'left' },
  { colKey: 'createdAt', title: '创建时间', width: 220, align: 'left' },
  {
    colKey: 'operation',
    title: '操作',
    width: 180,
    align: 'left',
  },
]);

const rolePermissionScope = ref<RolePermissionScope>({ audience: 'admin', functionPermissions: 'all' });
const permissionModules = computed(() => {
  const modules = filterFunctionCatalogByAudience(rolePermissionScope.value.audience);
  const permissions = parsePermissions(rolePermissionScope.value.functionPermissions);
  return permissions.includes('all') ? modules : filterFunctionCatalogByPermissions(modules, permissions);
});
const allPermissionValues = computed(() => getFunctionCatalogPermissionValues(permissionModules.value));

const pageSizeOptions = [10, 20, 50];
const loginUser = computed(() => getLoginUser());
const managedClient = ref<'admin' | 'supply-chain'>(
  loginUser.value.clientCode === 'supply-chain' ? 'supply-chain' : 'admin',
);
const managementPermissionPrefix = computed(
  () => `admin.permission-management.role-management${managedClient.value === 'supply-chain' ? '.supply-chain' : ''}`,
);
const managementTabs = computed(() =>
  [
    { label: '运营管理平台', value: 'admin', permission: 'admin.permission-management.role-management.view' },
    {
      label: '供应链协同系统',
      value: 'supply-chain',
      permission: 'admin.permission-management.role-management.supply-chain.view',
    },
  ].filter((tab) => hasPermission(loginUser.value, tab.permission)),
);
const isInternalAdministration = computed(
  () => !loginUser.value.tenantId && !loginUser.value.storeId && loginUser.value.clientCode !== 'supply-chain',
);

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
  return [`${managementPermissionPrefix.value}.${action}`];
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
const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);

  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toRoleItem = (record: RoleRecord): RoleItem => ({
  id: record.id,
  createdByClientCode: record.createdByClientCode,
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

const createRoleCode = (roleName: string) => `ROLE_${roleName.trim().length}_${Date.now()}`.toUpperCase();

const toRolePayload = (role: RoleItem): RolePayload => ({
  name: role.name,
  code: role.code,
  dataScope: role.dataScope,
  status: role.status,
  remark: role.remark,
  functionPermissions: role.functionPermissions.join(','),
});

const canMaintainRole = (row: RoleItem) =>
  loginUser.value.clientCode !== 'supply-chain' || row.createdByClientCode === 'supply-chain';

const isSuperAdminRole = (row: RoleItem) => row.code === 'SUPER_ADMIN';

const loadRoles = async () => {
  loading.value = true;
  try {
    const [records, scope] = await Promise.all([
      listRoles(managedClient.value),
      hasPermission(loginUser.value, `${managementPermissionPrefix.value}.permission`)
        ? getRolePermissionScope(managedClient.value)
        : Promise.resolve<RolePermissionScope>({ audience: managedClient.value, functionPermissions: '' }),
    ]);
    rolePermissionScope.value = scope;
    activePermissionModuleValue.value = permissionModules.value[0]?.value ?? '';
    roles.value = sortByCreatedAtDesc(records.filter((record) => record.status === 'enabled')).map(toRoleItem);
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '角色列表加载失败');
  } finally {
    loading.value = false;
  }
};

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
        clientCode: managedClient.value,
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

const handleManagedClientChange = () => {
  roles.value = [];
  pagination.current = 1;
  formDialogVisible.value = false;
  permissionDialogVisible.value = false;
  deleteDialogVisible.value = false;
  void loadRoles();
};
onMounted(() => {
  if (isInternalAdministration.value)
    managedClient.value = managementTabs.value[0]?.value === 'supply-chain' ? 'supply-chain' : 'admin';
  void loadRoles();
});
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.role-list-layout {
  grid-template-columns: minmax(0, 1fr);
}

.list-controls {
  min-width: 0;
  display: grid;
  width: 100%;
  gap: var(--td-comp-margin-l);
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
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: var(--td-comp-margin-s);
  flex-wrap: nowrap;
  white-space: nowrap;
}

.table-action-placeholder {
  color: var(--td-text-color-placeholder);
}

@media (max-width: 960px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
