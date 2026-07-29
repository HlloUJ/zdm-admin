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
                    <t-option label="正常" value="normal" />
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
                {{ row.status === 'normal' ? '正常' : '停用' }}
              </t-tag>
            </template>
            <template #remark="{ row }">
              <t-tooltip :content="row.remark" :disabled="!row.remark" placement="top-left">
                <span class="remark-cell">{{ row.remark || '-' }}</span>
              </t-tooltip>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link v-if="canEditEmployee" theme="primary" hover="color" @click="openProfileDialog(row)">
                  编辑资料
                </t-link>
                <t-link
                  v-if="canEditEmployee && !isSuperAdminEmployee(row)"
                  theme="primary"
                  hover="color"
                  @click="openPermissionDialog(row)"
                >
                  配置权限
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

          <div class="custom-pagination">
            <div class="pagination-total">共 {{ paginationTotal }} 条数据</div>
            <div class="pagination-controls">
              <t-select
                :model-value="pagination.pageSize"
                class="page-size-select"
                size="small"
                @change="handlePageSizeChange"
              >
                <t-option v-for="item in pageSizeOptions" :key="item" :label="`${item}条/页`" :value="item" />
              </t-select>
              <t-button size="small" variant="outline" :disabled="pagination.current === 1" @click="goPrevPage">
                上一页
              </t-button>
              <t-button
                v-for="pageNumber in pageNumbers"
                :key="pageNumber"
                size="small"
                :theme="pageNumber === pagination.current ? 'primary' : 'default'"
                :variant="pageNumber === pagination.current ? 'base' : 'outline'"
                class="page-number"
                @click="goPage(pageNumber)"
              >
                {{ pageNumber }}
              </t-button>
              <t-button size="small" variant="outline" :disabled="pagination.current === pageCount" @click="goNextPage">
                下一页
              </t-button>
            </div>
          </div>
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
        <t-form-item label="手机号码" name="phone" required-mark>
          <t-input
            :model-value="profileFormData.phone"
            class="phone-disabled-input"
            disabled
            readonly
            :maxlength="11"
            placeholder="请输入手机号"
          />
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
            <t-option v-for="role in operationRoleOptions" :key="role.value" :label="role.label" :value="role.value" />
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

    <t-dialog
      v-model:visible="confirmDialogVisible"
      header="系统提示"
      width="420px"
      placement="center"
      confirm-btn="确定"
      cancel-btn="取消"
      @confirm="handleConfirmSubmit"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
    >
      {{ confirmText }}
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { getLoginUser } from '@/services/auth';
import { hasPermission } from '@/services/adminPermissions';
import {
  deleteEmployee,
  listEmployees,
  updateEmployee,
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
  inviterName: string;
  registeredAt: string;
  functionPermissions: string[];
  dataPermission: '' | DataPermission;
}

interface EmployeeProfileForm {
  name: string;
  gender: Gender;
  phone: string;
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

interface PermissionAction {
  label: string;
  value: string;
}

interface PermissionPage {
  label: string;
  value: string;
  actions: PermissionAction[];
}

interface PermissionModule {
  label: string;
  value: string;
  pages: PermissionPage[];
}

const operationRoles = ref<RoleRecord[]>([]);
const loginUser = computed(() => getLoginUser());
const canCreateEmployee = computed(() =>
  hasPermission(loginUser.value, 'admin.permission-management.employee-management.create'),
);
const canEditEmployee = computed(() =>
  hasPermission(loginUser.value, 'admin.permission-management.employee-management.edit'),
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

const rolePermissionMap = computed<Record<string, string[]>>(() =>
  Object.fromEntries(
    operationRoles.value.map((role) => [
      String(role.id),
      role.functionPermissions === 'all' ? ['all'] : (role.functionPermissions?.split(',').filter(Boolean) ?? []),
    ]),
  ),
);

const buildActionNodes = (scope: string, actions: Array<{ label: string; value: string }>): PermissionAction[] =>
  actions.map((action) => ({
    label: action.label,
    value: `${scope}.${action.value}`,
  }));

const permissionModules: PermissionModule[] = [
  {
    label: '租户与门店',
    value: 'admin.tenant',
    pages: [
      {
        label: '租户管理',
        value: 'admin.tenant.tenant-management',
        actions: buildActionNodes('admin.tenant.tenant-management', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '新增', value: 'create' },
          { label: '业务开通', value: 'open-business' },
          { label: '编辑', value: 'edit' },
          { label: '停用/启用', value: 'toggle-status' },
          { label: '删除', value: 'delete' },
        ]),
      },
      {
        label: '门店管理',
        value: 'admin.tenant.tenant-store-management',
        actions: buildActionNodes('admin.tenant.tenant-store-management', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '新增', value: 'create' },
          { label: '编辑', value: 'edit' },
          { label: '停用/启用', value: 'toggle-status' },
          { label: '删除', value: 'delete' },
        ]),
      },
      {
        label: '门店分类管理',
        value: 'admin.tenant.store-category-management',
        actions: buildActionNodes('admin.tenant.store-category-management', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '添加手工分类', value: 'create' },
          { label: '添加子分类', value: 'create-child' },
          { label: '编辑', value: 'edit' },
          { label: '上移/下移', value: 'sort' },
          { label: '停用/启用', value: 'toggle-status' },
          { label: '删除', value: 'delete' },
        ]),
      },
    ],
  },
  {
    label: '成品现货管理',
    value: 'admin.finished-stock-management',
    pages: [
      {
        label: '仓库中',
        value: 'admin.finished-stock-management.warehouse',
        actions: buildActionNodes('admin.finished-stock-management.warehouse', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '发布商品', value: 'publish' },
          { label: '批量上架', value: 'batch-on-shelf' },
          { label: '编辑', value: 'edit' },
          { label: '删除', value: 'delete' },
        ]),
      },
      {
        label: '出售中',
        value: 'admin.finished-stock-management.selling',
        actions: buildActionNodes('admin.finished-stock-management.selling', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '下架', value: 'off-shelf' },
          { label: '编辑', value: 'edit' },
          { label: '删除', value: 'delete' },
        ]),
      },
    ],
  },
  {
    label: '大板管理',
    value: 'admin.slab-management',
    pages: [
      {
        label: '仓库中',
        value: 'admin.slab-management.warehouse',
        actions: buildActionNodes('admin.slab-management.warehouse', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '发布商品', value: 'publish' },
          { label: '上架', value: 'on-shelf' },
          { label: '编辑', value: 'edit' },
          { label: '删除', value: 'delete' },
        ]),
      },
      {
        label: '出售中',
        value: 'admin.slab-management.selling',
        actions: buildActionNodes('admin.slab-management.selling', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '下架', value: 'off-shelf' },
          { label: '编辑', value: 'edit' },
          { label: '删除', value: 'delete' },
        ]),
      },
    ],
  },
  {
    label: '供应商管理',
    value: 'admin.supplier-management',
    pages: [
      {
        label: '供应商管理',
        value: 'admin.supplier-management',
        actions: buildActionNodes('admin.supplier-management', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '新增', value: 'create' },
          { label: '编辑', value: 'edit' },
          { label: '停用/启用', value: 'toggle-status' },
          { label: '删除', value: 'delete' },
        ]),
      },
    ],
  },
  {
    label: '商品基础数据中心',
    value: 'admin.product-data-center',
    pages: [
      {
        label: '商品类目管理',
        value: 'admin.product-data-center.category',
        actions: buildActionNodes('admin.product-data-center.category', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '新增', value: 'create' },
          { label: '新增子类目', value: 'create-child' },
          { label: '编辑', value: 'edit' },
          { label: '停用/启用', value: 'toggle-status' },
        ]),
      },
      {
        label: '属性库管理',
        value: 'admin.product-data-center.attribute',
        actions: buildActionNodes('admin.product-data-center.attribute', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '新增', value: 'create' },
          { label: '停用/启用', value: 'toggle-status' },
        ]),
      },
      {
        label: '属性值管理',
        value: 'admin.product-data-center.attribute-value',
        actions: buildActionNodes('admin.product-data-center.attribute-value', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '新增', value: 'create' },
          { label: '停用/启用', value: 'toggle-status' },
          { label: '删除', value: 'delete' },
        ]),
      },
      {
        label: '类目属性模板',
        value: 'admin.product-data-center.category-attribute-template',
        actions: buildActionNodes('admin.product-data-center.category-attribute-template', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '关联标准属性', value: 'bind-attribute' },
          { label: '关联选项', value: 'bind-option' },
          { label: '发布', value: 'publish' },
          { label: '移除', value: 'remove' },
          { label: '设置必填', value: 'set-required' },
        ]),
      },
      {
        label: '大板品种管理',
        value: 'admin.product-data-center.slab-variety',
        actions: buildActionNodes('admin.product-data-center.slab-variety', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '新增', value: 'create' },
          { label: '编辑', value: 'edit' },
          { label: '停用/启用', value: 'toggle-status' },
          { label: '删除', value: 'delete' },
        ]),
      },
      {
        label: '成品现货工艺管理',
        value: 'admin.product-data-center.finished-stock-craft',
        actions: buildActionNodes('admin.product-data-center.finished-stock-craft', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '新增', value: 'create' },
          { label: '预览工艺图片', value: 'preview-image' },
          { label: '编辑', value: 'edit' },
          { label: '停用/启用', value: 'toggle-status' },
          { label: '删除', value: 'delete' },
        ]),
      },
    ],
  },
  {
    label: '权限管理',
    value: 'admin.permission-management',
    pages: [
      {
        label: '员工管理',
        value: 'admin.permission-management.employee-management',
        actions: buildActionNodes('admin.permission-management.employee-management', [
          { label: '查询', value: 'query' },
          { label: '重置', value: 'reset' },
          { label: '邀请员工', value: 'create' },
          { label: '编辑员工', value: 'edit' },
          { label: '停用/启用', value: 'toggle-status' },
          { label: '删除', value: 'delete' },
        ]),
      },
      {
        label: '角色管理',
        value: 'admin.permission-management.role-management',
        actions: buildActionNodes('admin.permission-management.role-management', [
          { label: '新建', value: 'create' },
          { label: '权限管理', value: 'permission' },
          { label: '编辑', value: 'edit' },
          { label: '删除', value: 'delete' },
        ]),
      },
      {
        label: '终端功能分配',
        value: 'admin.permission-management.terminal-function-allocation',
        actions: buildActionNodes('admin.permission-management.terminal-function-allocation', [
          { label: '查看', value: 'view' },
          { label: '全选', value: 'select-all' },
          { label: '清空', value: 'clear' },
          { label: '保存', value: 'save' },
          { label: '重置', value: 'reset' },
        ]),
      },
    ],
  },
];

const allPermissionValues = computed(() =>
  permissionModules.flatMap((module) => module.pages.flatMap((page) => page.actions.map((action) => action.value))),
);

const expandRolePermissions = (roleIds: string[]) => {
  const values = roleIds.flatMap((roleId) => rolePermissionMap.value[roleId] ?? []);
  if (values.includes('all')) return allPermissionValues.value;
  return Array.from(new Set(values));
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
  { colKey: 'inviterName', title: '邀请人', width: 112, align: 'left' },
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
const pageNumbers = computed(() => {
  const start = Math.max(Math.min(pagination.current - 2, pageCount.value - 4), 1);
  const end = Math.min(start + 4, pageCount.value);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
});
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
  phone: '',
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
  phone: [
    { required: true, message: '请输入手机号', type: 'error' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号', type: 'error' },
  ],
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

const resolveInviterName = (record: EmployeeRecord) => {
  const candidates = [record.inviterName, record.invitedByName, record.createdByName, record.inviter, record.createdBy];
  const inviter = candidates.map((value) => String(value ?? '').trim()).find(Boolean);
  return inviter ?? '-';
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
    inviterName: resolveInviterName(record),
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
    MessagePlugin.error(error instanceof Error ? error.message : '员工列表加载失败');
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
    MessagePlugin.error(error instanceof Error ? error.message : '邀请链接生成失败');
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
  MessagePlugin.success({ content: '复制成功', duration: 3000 });
};

const openProfileDialog = (row: EmployeeItem) => {
  activeEmployee.value = row;
  profileFormData.name = row.name;
  profileFormData.gender = row.gender;
  profileFormData.phone = row.phone;
  profileFormData.remark = row.remark;
  profileDialogVisible.value = true;
};

const closeProfileDialog = () => {
  profileDialogVisible.value = false;
  profileFormRef.value?.clearValidate();
};

const openPermissionDialog = (row: EmployeeItem) => {
  if (isSuperAdminEmployee(row)) {
    MessagePlugin.warning('超级管理员天然拥有全量权限，无需配置权限');
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
          phone: profileFormData.phone.trim(),
          remark: profileFormData.remark.trim(),
        }),
      );
      const targetIndex = employees.value.findIndex((employee) => employee.id === activeEmployee.value?.id);
      if (targetIndex !== -1) {
        employees.value.splice(targetIndex, 1, toEmployeeItem(updated));
      }
      MessagePlugin.success('资料更新成功');
    } catch (error) {
      MessagePlugin.error(error instanceof Error ? error.message : '更新失败');
      return;
    }
  }

  closeProfileDialog();
};

const handlePermissionSubmit = async () => {
  if ((await permissionFormRef.value?.validate()) !== true) return;
  if (!permissionFormData.roleIds.length) {
    MessagePlugin.warning('请选择角色');
    return;
  }
  if (!permissionFormData.dataPermission) {
    MessagePlugin.warning('请选择数据权限');
    return;
  }
  const rolePermissionValues = expandRolePermissions(permissionFormData.roleIds);

  if (activeEmployee.value) {
    try {
      const updated = await updateEmployee(
        activeEmployee.value.id,
        toEmployeePayload({
          ...activeEmployee.value,
          roleIds: [...permissionFormData.roleIds],
          dataPermission: permissionFormData.dataPermission,
          functionPermissions: Array.from(
            new Set([...rolePermissionValues, ...activeEmployee.value.functionPermissions]),
          ),
        }),
      );
      const targetIndex = employees.value.findIndex((employee) => employee.id === activeEmployee.value?.id);
      if (targetIndex !== -1) {
        employees.value.splice(targetIndex, 1, toEmployeeItem(updated));
      }
      MessagePlugin.success('权限配置成功');
    } catch (error) {
      MessagePlugin.error(error instanceof Error ? error.message : '更新失败');
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

const handlePageSizeChange = (value: unknown) => {
  pagination.pageSize = Number(value);
  pagination.current = 1;
};

const goPage = (pageNumber: number) => {
  pagination.current = pageNumber;
};

const goPrevPage = () => {
  pagination.current = Math.max(pagination.current - 1, 1);
};

const goNextPage = () => {
  pagination.current = Math.min(pagination.current + 1, pageCount.value);
};

const validateEmployeeBeforeEnable = (row: EmployeeItem) => {
  const missingRole = row.roleIds.length === 0;
  const missingDataPermission = !row.dataPermission;
  if (missingRole && missingDataPermission) {
    MessagePlugin.warning('请先为员工配置角色和数据权限后再启用');
    return false;
  }
  if (missingRole) {
    MessagePlugin.warning('请先为员工配置角色后再启用');
    return false;
  }
  if (missingDataPermission) {
    MessagePlugin.warning('请先为员工配置数据权限后再启用');
    return false;
  }
  return true;
};

const openStatusConfirm = (row: EmployeeItem) => {
  if (isSuperAdminEmployee(row)) {
    MessagePlugin.warning('超级管理员不可停用或启用');
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
    MessagePlugin.warning('超级管理员不可删除');
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
  if (confirmType.value === 'disable') return `是否停用员工【${name}】？停用后该员工无法登录后台。`;
  if (confirmType.value === 'enable') return `是否启用员工【${name}】？启用后恢复登录权限。`;
  return `是否删除员工【${name}】？删除后账号数据不可恢复。`;
});

const handleConfirmSubmit = async () => {
  if (!confirmEmployee.value) return;

  try {
    if (confirmType.value === 'delete') {
      await deleteEmployee(confirmEmployee.value.id);
      employees.value = employees.value.filter((employee) => employee.id !== confirmEmployee.value?.id);
      if (pagination.current > pageCount.value) pagination.current = pageCount.value;
      MessagePlugin.success('删除成功');
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
      MessagePlugin.success('操作成功');
    }
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
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

.phone-disabled-input :deep(.t-input) {
  background: var(--td-bg-color-component-disabled);
  cursor: not-allowed;
}

.phone-disabled-input :deep(input) {
  cursor: not-allowed;
}

.custom-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-top: var(--td-comp-margin-l);
}

.pagination-total {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.page-size-select {
  width: 112px;
}

.page-number {
  min-width: 32px;
}

@media (max-width: 1120px) {
  .filter-row,
  .custom-pagination {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-actions,
  .pagination-controls {
    flex-wrap: wrap;
  }
}

@media (max-width: 720px) {
  .filter-fields :deep(.t-form__item) {
    width: 100%;
  }
}
</style>
