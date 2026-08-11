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
              <t-breadcrumb-item>员工管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
        </header>

        <section class="filter-card">
          <t-form :data="filterDraft" label-width="84px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="姓名" name="name">
                  <t-input v-model="filterDraft.name" clearable placeholder="请输入" />
                </t-form-item>
                <t-form-item label="手机号码" name="phone">
                  <t-input
                    :model-value="filterDraft.phone"
                    clearable
                    :maxlength="11"
                    placeholder="请输入手机号"
                    @update:model-value="handleFilterPhoneChange"
                  />
                </t-form-item>
                <t-form-item label="角色" name="role">
                  <t-select v-model="filterDraft.role" clearable placeholder="请选择">
                    <t-option
                      v-for="role in operationRoleOptions"
                      :key="role.value"
                      :label="role.label"
                      :value="role.value"
                    />
                  </t-select>
                </t-form-item>
                <t-form-item label="状态" name="status">
                  <t-select v-model="filterDraft.status" clearable placeholder="请选择">
                    <t-option label="启用" value="normal" />
                    <t-option label="停用" value="disabled" />
                  </t-select>
                </t-form-item>
              </div>
              <div class="filter-actions">
                <t-button theme="primary" @click="handleSearch">
                  <template #icon><t-icon name="search" /></template>
                  查询
                </t-button>
                <t-button theme="default" variant="base" @click="handleReset">
                  <template #icon><t-icon name="refresh" /></template>
                  重置
                </t-button>
              </div>
            </div>
          </t-form>
        </section>

        <section class="table-card">
          <div v-if="canCreateEmployee" class="table-toolbar">
            <t-button theme="primary" :loading="inviteCreating" @click="openInviteDialog">
              <template #icon><t-icon name="add" /></template>
              邀请员工
            </t-button>
          </div>

          <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
            <template #index="{ rowIndex }">
              {{ (pagination.current - 1) * pagination.pageSize + rowIndex + 1 }}
            </template>
            <template #gender="{ row }">
              {{ genderLabel(row.gender) }}
            </template>
            <template #roles="{ row }">
              <span>{{ roleNames(row.roleIds) }}</span>
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'normal' ? 'success' : 'danger'" variant="light">
                {{ row.status === 'normal' ? '启用' : '停用' }}
              </t-tag>
            </template>
            <template #remark="{ row }">
              <t-tooltip :content="row.remark" :disabled="!row.remark" placement="bottom-left">
                <span class="remark-cell">{{ row.remark || '-' }}</span>
              </t-tooltip>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link v-if="canEditEmployee" theme="primary" hover="color" @click="openProfileDialog(row)">
                  编辑
                </t-link>
                <t-link
                  v-if="canConfigureEmployeePermission && !isSuperAdminEmployee(row)"
                  theme="primary"
                  hover="color"
                  @click="openPermissionDialog(row)"
                >
                  角色
                </t-link>
                <t-link
                  v-if="canToggleEmployeeStatus && !isSuperAdminEmployee(row)"
                  :theme="row.status === 'normal' ? 'warning' : 'success'"
                  hover="color"
                  @click="openStatusConfirm(row)"
                >
                  {{ row.status === 'normal' ? '停用' : '启用' }}
                </t-link>
                <t-link
                  v-if="canDeleteEmployee && !isSuperAdminEmployee(row)"
                  theme="danger"
                  hover="color"
                  @click="openDeleteConfirm(row)"
                >
                  删除
                </t-link>
                <span
                  v-if="
                    !canEditEmployee &&
                    !(canConfigureEmployeePermission && !isSuperAdminEmployee(row)) &&
                    !(canToggleEmployeeStatus && !isSuperAdminEmployee(row)) &&
                    !(canDeleteEmployee && !isSuperAdminEmployee(row))
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
      v-model:visible="inviteDialogVisible"
      header="邀请员工"
      width="560px"
      placement="center"
      @close="closeInviteDialog"
    >
      <div class="invite-dialog">
        <p class="invite-tip">下方链接为员工邀请链接，他人通过链接可完成员工账号入驻</p>
        <div class="invite-link-field">
          <t-textarea
            :model-value="inviteLink"
            readonly
            :autosize="{ minRows: 3, maxRows: 3 }"
            @focus="selectInviteLink"
          />
          <t-link theme="primary" hover="color" class="copy-link" @click="copyInviteLink">复制链接</t-link>
        </div>
      </div>
      <template #footer>
        <t-button theme="default" variant="base" @click="closeInviteDialog">关闭</t-button>
      </template>
    </t-dialog>

    <t-dialog
      v-model:visible="profileDialogVisible"
      header="编辑资料"
      width="560px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleProfileSubmit"
      @cancel="closeProfileDialog"
      @close="closeProfileDialog"
    >
      <t-form ref="profileFormRef" :data="profileFormData" :rules="profileFormRules" label-width="96px" colon>
        <t-form-item label="姓名" name="name" required-mark>
          <t-input v-model="profileFormData.name" clearable placeholder="请输入" />
        </t-form-item>
        <t-form-item label="性别" name="gender" required-mark>
          <t-select v-model="profileFormData.gender" clearable placeholder="请选择">
            <t-option label="男" value="male" />
            <t-option label="女" value="female" />
          </t-select>
        </t-form-item>
        <t-form-item label="备注" name="remark">
          <t-textarea
            v-model="profileFormData.remark"
            placeholder="请输入"
            :maxlength="100"
            :autosize="{ minRows: 4, maxRows: 6 }"
          />
        </t-form-item>
      </t-form>
    </t-dialog>

    <t-dialog
      v-model:visible="permissionDialogVisible"
      header="配置权限"
      width="560px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handlePermissionSubmit"
      @cancel="closePermissionDialog"
      @close="closePermissionDialog"
    >
      <t-form ref="permissionFormRef" :data="permissionFormData" :rules="permissionFormRules" label-width="96px" colon>
        <t-form-item label="角色" name="roleIds" required-mark>
          <t-select v-model="permissionFormData.roleIds" multiple clearable placeholder="请选择运营管理平台角色">
            <t-option
              v-for="role in configurableOperationRoleOptions"
              :key="role.value"
              :label="role.label"
              :value="role.value"
            />
          </t-select>
        </t-form-item>
        <t-form-item label="数据权限" name="dataPermission" required-mark>
          <t-radio-group v-model="permissionFormData.dataPermission">
            <t-radio value="self">查看自己</t-radio>
            <t-radio value="all">查看全部</t-radio>
          </t-radio-group>
        </t-form-item>
      </t-form>
    </t-dialog>

    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="confirmType === 'delete' ? '删除' : confirmType === 'disable' ? '停用' : '启用'"
      object-type="员工"
      :object-name="confirmEmployee?.name"
      @confirm="handleConfirmSubmit"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
    >
      {{ confirmText }}
    </AdminConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminPagination } from '@/components/foundation';
import { getLoginUser } from '@/services/auth';
import { hasPermission } from '@/services/adminPermissions';
import {
  fullFunctionCatalog,
  getFunctionCatalogPermissionValues,
  normalizeFunctionCatalogPermissions,
} from '@/services/functionCatalog';
import {
  deleteEmployee,
  listEmployees,
  updateEmployee,
  updateEmployeePermissions,
  type EmployeePayload,
  type EmployeeRecord,
} from '@/services/employees';
import { createEmployeeInvite } from '@/services/employeeInvites';
import { listRoles, type RoleRecord } from '@/services/roles';

type EmployeeStatus = 'normal' | 'disabled';
type Gender = 'male' | 'female' | '';
type ConfirmType = 'disable' | 'enable' | 'delete';
type DataPermission = 'self' | 'all';

interface EmployeeItem {
  id: number;
  name: string;
  gender: Exclude<Gender, ''>;
  phone: string;
  roleIds: string[];
  status: EmployeeStatus;
  remark: string;
  createdByName: string;
  registeredAt: string;
  functionPermissions: string[];
  dataPermission: '' | DataPermission;
}

interface EmployeeProfileForm {
  name: string;
  gender: Gender;
  remark: string;
}

interface EmployeePermissionForm {
  roleIds: string[];
  dataPermission: '' | DataPermission;
}

interface EmployeeFilter {
  name: string;
  phone: string;
  role: string;
  status: '' | EmployeeStatus;
}

const operationRoles = ref<RoleRecord[]>([]);
const loginUser = computed(() => getLoginUser());
const canCreateEmployee = computed(() =>
  hasPermission(loginUser.value, 'admin.permission-management.employee-management.create'),
);
const canEditEmployee = computed(() =>
  hasPermission(loginUser.value, 'admin.permission-management.employee-management.edit'),
);
const canConfigureEmployeePermission = computed(() =>
  hasPermission(loginUser.value, 'admin.permission-management.employee-management.permission'),
);
const canToggleEmployeeStatus = computed(() =>
  hasPermission(loginUser.value, 'admin.permission-management.employee-management.toggle-status'),
);
const canDeleteEmployee = computed(() =>
  hasPermission(loginUser.value, 'admin.permission-management.employee-management.delete'),
);
const operationRoleOptions = computed(() =>
  operationRoles.value.map((role) => ({
    label: role.name,
    value: String(role.id),
  })),
);
const configurableOperationRoleOptions = computed(() =>
  operationRoles.value
    .filter((role) => role.functionPermissions?.split(',').some((permission) => permission.trim()))
    .map((role) => ({
      label: role.name,
      value: String(role.id),
    })),
);

const rolePermissionMap = computed<Record<string, string[]>>(() =>
  Object.fromEntries(
    operationRoles.value.map((role) => [
      String(role.id),
      role.functionPermissions === 'all' ? ['all'] : (role.functionPermissions?.split(',').filter(Boolean) ?? []),
    ]),
  ),
);

const allPermissionValues = computed(() => getFunctionCatalogPermissionValues(fullFunctionCatalog));

const expandRolePermissions = (roleIds: string[]) => {
  const values = roleIds.flatMap((roleId) => rolePermissionMap.value[roleId] ?? []);
  if (values.includes('all')) return allPermissionValues.value.length ? allPermissionValues.value : ['all'];
  return normalizeFunctionCatalogPermissions(fullFunctionCatalog, values);
};

const employees = ref<EmployeeItem[]>([]);
const loading = ref(false);

const makeEmptyFilter = (): EmployeeFilter => ({
  name: '',
  phone: '',
  role: '',
  status: '',
});

const filterDraft = reactive<EmployeeFilter>(makeEmptyFilter());
const activeFilter = reactive<EmployeeFilter>(makeEmptyFilter());

const pagination = reactive({
  current: 1,
  pageSize: 10,
});

const pageSizeOptions = [10, 20, 50];

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 72, align: 'left' },
  { colKey: 'name', title: '姓名', width: 112, align: 'left' },
  { colKey: 'gender', title: '性别', width: 80, align: 'left' },
  { colKey: 'phone', title: '手机号码', width: 140, align: 'left' },
  { colKey: 'roles', title: '角色', width: 160, align: 'left' },
  { colKey: 'status', title: '状态', width: 88, align: 'left' },
  { colKey: 'createdByName', title: '创建人', width: 112, align: 'left' },
  { colKey: 'registeredAt', title: '注册时间', width: 160, align: 'left' },
  { colKey: 'remark', title: '备注', width: 150, align: 'left' },
  { colKey: 'operation', title: '操作', width: 200, align: 'left', fixed: 'right' },
];

const filteredEmployees = computed(() => {
  const name = activeFilter.name.trim();
  const phone = activeFilter.phone.trim();
  return employees.value.filter((employee) => {
    const nameMatched = !name || employee.name.includes(name);
    const phoneMatched = !phone || employee.phone.includes(phone);
    const roleMatched = !activeFilter.role || employee.roleIds.includes(activeFilter.role);
    const statusMatched = !activeFilter.status || employee.status === activeFilter.status;
    return nameMatched && phoneMatched && roleMatched && statusMatched;
  });
});

const paginationTotal = computed(() => filteredEmployees.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / pagination.pageSize), 1));
const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return filteredEmployees.value.slice(start, start + pagination.pageSize);
});

watch(pageCount, (count) => {
  if (pagination.current > count) pagination.current = count;
});

const profileFormRef = ref<FormInstanceFunctions>();
const permissionFormRef = ref<FormInstanceFunctions>();
const inviteDialogVisible = ref(false);
const inviteCreating = ref(false);
const inviteLink = ref('');
const profileDialogVisible = ref(false);
const permissionDialogVisible = ref(false);
const activeEmployee = ref<EmployeeItem | null>(null);
const profileFormData = reactive<EmployeeProfileForm>({
  name: '',
  gender: '',
  remark: '',
});
const permissionFormData = reactive<EmployeePermissionForm>({
  roleIds: [],
  dataPermission: '',
});

const validateRemarkLength: FormRule['validator'] = (value) => {
  const remark = typeof value === 'string' ? value : String(value ?? '');
  if (remark.length <= 100) return true;
  return { result: false, message: '备注最多输入100个字符', type: 'error' };
};

const profileFormRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入姓名', type: 'error' }],
  gender: [{ required: true, message: '请选择性别', type: 'error' }],
  remark: [{ validator: validateRemarkLength }],
};

const permissionFormRules: Record<string, FormRule[]> = {
  roleIds: [{ required: true, message: '请选择角色', type: 'error' }],
  dataPermission: [{ required: true, message: '请选择数据权限', type: 'error' }],
};

const confirmDialogVisible = ref(false);
const confirmType = ref<ConfirmType>('disable');
const confirmEmployee = ref<EmployeeItem | null>(null);

const genderLabel = (gender: Gender) => {
  if (gender === 'male') return '男';
  if (gender === 'female') return '女';
  return '';
};

const roleNames = (roleIds: string[]) =>
  roleIds
    .map((roleId) => operationRoleOptions.value.find((role) => role.value === roleId)?.label)
    .filter(Boolean)
    .join('、') || '-';

const isSuperAdminEmployee = (employee: EmployeeItem) =>
  employee.roleIds.some(
    (roleId) => operationRoles.value.find((role) => String(role.id) === roleId)?.code === 'SUPER_ADMIN',
  );

const normalizeStatus = (status: EmployeeRecord['status']): EmployeeStatus =>
  status === 'disabled' ? 'disabled' : 'normal';

const toBackendStatus = (status: EmployeeStatus): EmployeePayload['status'] =>
  status === 'disabled' ? 'disabled' : 'enabled';

const parseRoleIds = (value?: string) => value?.split(',').filter(Boolean) ?? [];

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);

  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toEmployeeItem = (record: EmployeeRecord): EmployeeItem => {
  const roleIds = parseRoleIds(record.roleIds);
  return {
    id: record.id,
    name: record.name,
    gender: record.gender ?? 'male',
    phone: record.phone,
    roleIds,
    status: normalizeStatus(record.status),
    remark: record.remark ?? '',
    createdByName: record.createdByName?.trim() || '-',
    registeredAt: formatDateTime(record.createdAt),
    functionPermissions: expandRolePermissions(roleIds),
    dataPermission: record.dataPermission ?? '',
  };
};

const toEmployeePayload = (employee: EmployeeItem): EmployeePayload => ({
  name: employee.name,
  gender: employee.gender,
  phone: employee.phone,
  status: toBackendStatus(employee.status),
  roleIds: employee.roleIds.join(','),
  dataPermission: employee.dataPermission || undefined,
  remark: employee.remark,
});

const loadPermissionCenter = async () => {
  loading.value = true;
  try {
    const [roles, records] = await Promise.all([listRoles(), listEmployees()]);
    operationRoles.value = roles.filter((role) => role.category === 'operation-platform' && role.status === 'enabled');
    employees.value = records.map(toEmployeeItem);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '员工列表加载失败');
  } finally {
    loading.value = false;
  }
};

const normalizePhone = (value: unknown) =>
  String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 11);

const handleFilterPhoneChange = (value: unknown) => {
  filterDraft.phone = normalizePhone(value);
};

const generateInviteLink = (token: string) => {
  const origin = import.meta.env.VITE_PUBLIC_APP_ORIGIN || window.location.origin;
  return `${origin}/employee-invite?token=${token}`;
};

const openInviteDialog = async () => {
  if (inviteCreating.value) return;
  inviteCreating.value = true;
  try {
    const invite = await createEmployeeInvite();
    inviteLink.value = generateInviteLink(invite.token);
    inviteDialogVisible.value = true;
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '邀请链接生成失败');
  } finally {
    inviteCreating.value = false;
  }
};

const closeInviteDialog = () => {
  inviteDialogVisible.value = false;
  inviteLink.value = '';
};

const selectInviteLink = (event: FocusEvent) => {
  (event.target as HTMLTextAreaElement | null)?.select();
};

const copyInviteLink = async () => {
  if (!inviteLink.value) return;
  try {
    await navigator.clipboard.writeText(inviteLink.value);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = inviteLink.value;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
  adminFeedback.success('已复制邀请链接');
};

const openProfileDialog = (row: EmployeeItem) => {
  activeEmployee.value = row;
  profileFormData.name = row.name;
  profileFormData.gender = row.gender;
  profileFormData.remark = row.remark;
  profileDialogVisible.value = true;
};

const closeProfileDialog = () => {
  profileDialogVisible.value = false;
  profileFormRef.value?.clearValidate();
};

const openPermissionDialog = (row: EmployeeItem) => {
  if (isSuperAdminEmployee(row)) {
    adminFeedback.warning('超级管理员天然拥有全量权限，无需配置权限');
    return;
  }
  activeEmployee.value = row;
  permissionFormData.roleIds = [...row.roleIds];
  permissionFormData.dataPermission = row.dataPermission;
  permissionDialogVisible.value = true;
};

const closePermissionDialog = () => {
  permissionDialogVisible.value = false;
  permissionFormRef.value?.clearValidate();
};

const handleProfileSubmit = async () => {
  if ((await profileFormRef.value?.validate()) !== true) return;

  if (activeEmployee.value) {
    try {
      const updated = await updateEmployee(
        activeEmployee.value.id,
        toEmployeePayload({
          ...activeEmployee.value,
          name: profileFormData.name.trim(),
          gender: profileFormData.gender as Exclude<Gender, ''>,
          remark: profileFormData.remark.trim(),
        }),
      );
      const targetIndex = employees.value.findIndex((employee) => employee.id === activeEmployee.value?.id);
      if (targetIndex !== -1) {
        employees.value.splice(targetIndex, 1, toEmployeeItem(updated));
      }
      adminFeedback.success('资料更新成功');
    } catch (error) {
      adminFeedback.error(error instanceof Error ? error.message : '更新失败');
      return;
    }
  }

  closeProfileDialog();
};

const handlePermissionSubmit = async () => {
  if ((await permissionFormRef.value?.validate()) !== true) return;
  if (!permissionFormData.roleIds.length) {
    adminFeedback.warning('请选择角色');
    return;
  }
  if (!permissionFormData.dataPermission) {
    adminFeedback.warning('请选择数据权限');
    return;
  }
  if (activeEmployee.value) {
    try {
      const updated = await updateEmployeePermissions(activeEmployee.value.id, {
        roleIds: permissionFormData.roleIds.join(','),
        dataPermission: permissionFormData.dataPermission,
      });
      const targetIndex = employees.value.findIndex((employee) => employee.id === activeEmployee.value?.id);
      if (targetIndex !== -1) {
        employees.value.splice(targetIndex, 1, toEmployeeItem(updated));
      }
      adminFeedback.success('权限配置成功');
    } catch (error) {
      adminFeedback.error(error instanceof Error ? error.message : '更新失败');
      return;
    }
  }

  closePermissionDialog();
};

const handleSearch = () => {
  Object.assign(activeFilter, filterDraft);
  pagination.current = 1;
};

const handleReset = () => {
  Object.assign(filterDraft, makeEmptyFilter());
  pagination.pageSize = 10;
  handleSearch();
};

const validateEmployeeBeforeEnable = (row: EmployeeItem) => {
  const missingRole = row.roleIds.length === 0;
  const missingDataPermission = !row.dataPermission;
  if (missingRole && missingDataPermission) {
    adminFeedback.warning('请先为员工配置角色和数据权限后再启用');
    return false;
  }
  if (missingRole) {
    adminFeedback.warning('请先为员工配置角色后再启用');
    return false;
  }
  if (missingDataPermission) {
    adminFeedback.warning('请先为员工配置数据权限后再启用');
    return false;
  }
  return true;
};

const openStatusConfirm = (row: EmployeeItem) => {
  if (isSuperAdminEmployee(row)) {
    adminFeedback.warning('超级管理员不可停用或启用');
    return;
  }
  const nextType = row.status === 'normal' ? 'disable' : 'enable';
  if (nextType === 'enable' && !validateEmployeeBeforeEnable(row)) return;

  confirmEmployee.value = row;
  confirmType.value = nextType;
  confirmDialogVisible.value = true;
};

const openDeleteConfirm = (row: EmployeeItem) => {
  if (isSuperAdminEmployee(row)) {
    adminFeedback.warning('超级管理员不可删除');
    return;
  }
  confirmEmployee.value = row;
  confirmType.value = 'delete';
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmEmployee.value = null;
};

const confirmText = computed(() => {
  const name = confirmEmployee.value?.name ?? '';
  if (confirmType.value === 'disable') return `是否停用员工“${name}”？停用后该员工无法登录后台。`;
  if (confirmType.value === 'enable') return `是否启用员工“${name}”？启用后恢复登录权限。`;
  return `是否删除员工“${name}”？删除后账号数据不可恢复。`;
});

const handleConfirmSubmit = async () => {
  if (!confirmEmployee.value) return;

  try {
    if (confirmType.value === 'delete') {
      await deleteEmployee(confirmEmployee.value.id);
      employees.value = employees.value.filter((employee) => employee.id !== confirmEmployee.value?.id);
      if (pagination.current > pageCount.value) pagination.current = pageCount.value;
      adminFeedback.actionSuccess({ action: '删除', target: confirmEmployee.value.name });
    } else {
      const updated = await updateEmployee(
        confirmEmployee.value.id,
        toEmployeePayload({
          ...confirmEmployee.value,
          status: confirmType.value === 'disable' ? 'disabled' : 'normal',
        }),
      );
      const targetIndex = employees.value.findIndex((employee) => employee.id === confirmEmployee.value?.id);
      if (targetIndex !== -1) {
        employees.value.splice(targetIndex, 1, toEmployeeItem(updated));
      }
      adminFeedback.actionSuccess({
        action: confirmType.value === 'disable' ? '停用' : '启用',
        target: confirmEmployee.value.name,
      });
    }
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
    return;
  }
  closeConfirmDialog();
};

onMounted(loadPermissionCenter);
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.filter-card,
.table-card {
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-container);
}

.filter-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}

.filter-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--td-comp-margin-l);
}

.filter-fields :deep(.t-form__item) {
  width: 260px;
  margin-bottom: 0;
}

.filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
}

.table-card {
  margin-top: var(--td-comp-margin-l);
}

.table-toolbar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin-bottom: var(--td-comp-margin-l);
}

.table-card :deep(.t-table) {
  width: 100%;
}

.table-card :deep(.t-table__th-cell),
.table-card :deep(.t-table__td-cell) {
  padding-left: 16px;
  padding-right: 16px;
}

.table-actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  white-space: nowrap;
}

.table-action-placeholder {
  color: var(--td-text-color-placeholder);
}

.remark-cell {
  display: block;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.invite-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-l);
}

.invite-tip {
  margin: 0;
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
}

.invite-link-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--td-comp-margin-m);
}

.copy-link {
  padding-top: 7px;
  white-space: nowrap;
}

@media (max-width: 1120px) {
  .filter-row {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-actions {
    flex-wrap: wrap;
  }
}

@media (max-width: 720px) {
  .filter-fields :deep(.t-form__item) {
    width: 100%;
  }
}
</style>
