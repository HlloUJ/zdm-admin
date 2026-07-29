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
          <t-tabs v-model="activeCategory" class="role-tabs" :list="roleTabs" @change="handleTabChange" />

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
                <t-link
                  v-if="isOperationPlatformTab && canManageRolePermission && !isSuperAdminRole(row)"
                  theme="primary"
                  hover="color"
                  @click="openPermissionDialog(row)"
                >
                  权限管理
                </t-link>
                <t-link v-if="canEditRole" theme="primary" hover="color" @click="openEditDialog(row)">编辑</t-link>
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
                    !(isOperationPlatformTab && canManageRolePermission && !isSuperAdminRole(row))
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

    <t-dialog
      v-model:visible="deleteDialogVisible"
      header="系统提示"
      width="420px"
      placement="center"
      :close-on-overlay-click="true"
      confirm-btn="确认"
      cancel-btn="取消"
      @confirm="handleDeleteConfirm"
      @cancel="closeDeleteDialog"
      @close="closeDeleteDialog"
    >
      {{ deleteConfirmText }}
    </t-dialog>

    <t-dialog
      v-model:visible="permissionDialogVisible"
      header="权限配置"
      width="1040px"
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
              <t-button size="small" variant="outline" theme="primary" @click="selectAllPermissions">全选全部</t-button>
              <t-button size="small" variant="outline" @click="clearAllPermissions">清空全部</t-button>
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
            </aside>

            <div v-if="activePermissionModule" class="permission-matrix">
              <div class="permission-matrix__toolbar">
                <div>
                  <h4>{{ activePermissionModule.label }}</h4>
                  <p>
                    已选择 {{ getSelectedCount(getModuleActionValues(activePermissionModule)) }} /
                    {{ getModuleActionValues(activePermissionModule).length }}
                  </p>
                </div>
                <t-checkbox
                  :checked="isModuleAllSelected(activePermissionModule)"
                  :indeterminate="isModuleIndeterminate(activePermissionModule)"
                  @change="toggleModulePermissions(activePermissionModule, $event)"
                >
                  全选当前模块
                </t-checkbox>
              </div>

              <div class="permission-matrix__table-wrap">
                <table class="permission-matrix__table">
                  <thead>
                    <tr>
                      <th>页面/功能点</th>
                      <th>操作权限</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="page in activePermissionModule.pages" :key="page.value">
                      <td>
                        <div class="permission-page-name">{{ page.label }}</div>
                        <t-checkbox
                          size="small"
                          :checked="isPageAllSelected(page)"
                          :indeterminate="isPageIndeterminate(page)"
                          @change="togglePagePermissions(page, $event)"
                        >
                          整页权限
                        </t-checkbox>
                      </td>
                      <td>
                        <div class="permission-action-grid">
                          <t-checkbox
                            v-for="action in page.actions"
                            :key="action.value"
                            :checked="isPermissionSelected(action.value)"
                            @change="togglePermission(action.value, $event)"
                          >
                            {{ action.label }}
                          </t-checkbox>
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
import { MessagePlugin } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { getLoginUser } from '@/services/auth';
import { hasAnyPermission } from '@/services/adminPermissions';
import { createRole, deleteRole, listRoles, updateRole, type RolePayload, type RoleRecord } from '@/services/roles';

type RoleCategory = 'partner-store' | 'supplier-store' | 'operation-platform';
type DialogMode = 'create' | 'edit';

interface RoleItem {
  id: number;
  code: string;
  category: RoleCategory;
  dataScope: string;
  status: 'enabled' | 'disabled';
  name: string;
  createdAt: string;
  remark: string;
  functionPermissions: string[];
}

interface RoleForm {
  name: string;
  remark: string;
}

interface PermissionTreeNode {
  label: string;
  value: string;
  children?: PermissionTreeNode[];
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

interface RolePermissionConfig {
  functionPermissions: string[];
}

const roleTabs = [
  { label: '城市合伙人门店角色', value: 'partner-store' },
  { label: '大板供应商门店角色', value: 'supplier-store' },
  { label: '运营管理平台角色', value: 'operation-platform' },
];

const roles = ref<RoleItem[]>([]);
const loading = ref(false);

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: '22%', align: 'left' },
  { colKey: 'name', title: '角色名称', width: '28%', align: 'left' },
  { colKey: 'createdAt', title: '创建时间', width: '26%', align: 'left' },
  { colKey: 'operation', title: '操作', width: '24%', align: 'left' },
];

const actionValueMap: Record<string, string> = {
  查询: 'query',
  重置: 'reset',
  新增: 'create',
  新建: 'create',
  业务开通: 'business-open',
  编辑: 'edit',
  停用: 'disable',
  启用: 'enable',
  '停用/启用': 'toggle-status',
  删除: 'delete',
  快速编辑店铺级别: 'quick-edit-shop-level',
  添加手工分类: 'create-manual-category',
  添加子分类: 'create-child-category',
  '上移/下移': 'move',
  发布商品: 'publish-product',
  批量上架: 'batch-on-shelf',
  查看价格: 'view-price',
  上架: 'on-shelf',
  驳回: 'reject',
  批量下架: 'batch-off-shelf',
  下架: 'off-shelf',
  批量放回到仓库: 'batch-restore',
  放回到仓库: 'restore',
  批量彻底删除: 'batch-delete-permanently',
  清空回收站: 'clear-recycle-bin',
  彻底删除: 'delete-permanently',
  新增子类目: 'create-child-category',
  关联标准属性: 'link-standard-attribute',
  关联选项: 'link-option',
  发布: 'publish',
  移除: 'remove',
  设置必填: 'set-required',
  预览工艺图片: 'preview-image',
  邀请员工: 'create',
  编辑员工: 'edit',
  权限管理: 'permission',
  查看: 'view',
  全选: 'select-all',
  清空: 'clear',
  保存: 'save',
};

const buildActionNodes = (scope: string, actions: string[]) =>
  actions.map((action) => ({
    label: action,
    value: `${scope}.${actionValueMap[action] ?? action}`,
  }));

const permissionTreeData: PermissionTreeNode[] = [
  {
    label: '装点猫管理后台',
    value: 'admin',
    children: [
      {
        label: '租户与门店',
        value: 'admin.tenant',
        children: [
          {
            label: '租户管理',
            value: 'admin.tenant.tenant-management',
            children: buildActionNodes('admin.tenant.tenant-management', [
              '查询',
              '重置',
              '新增',
              '业务开通',
              '编辑',
              '停用/启用',
              '删除',
            ]),
          },
          {
            label: '门店管理',
            value: 'admin.tenant.tenant-store-management',
            children: buildActionNodes('admin.tenant.tenant-store-management', [
              '查询',
              '重置',
              '新增',
              '快速编辑店铺级别',
              '编辑',
              '停用/启用',
              '删除',
            ]),
          },
          {
            label: '门店分类管理',
            value: 'admin.tenant.store-category-management',
            children: buildActionNodes('admin.tenant.store-category-management', [
              '查询',
              '重置',
              '添加手工分类',
              '添加子分类',
              '编辑',
              '上移/下移',
              '停用/启用',
              '删除',
            ]),
          },
        ],
      },
      {
        label: '成品现货管理',
        value: 'admin.finished-stock-management',
        children: [
          {
            label: '仓库中',
            value: 'admin.finished-stock-management.warehouse',
            children: buildActionNodes('admin.finished-stock-management.warehouse', [
              '查询',
              '重置',
              '发布商品',
              '批量上架',
              '查看价格',
              '上架',
              '编辑',
              '驳回',
              '删除',
            ]),
          },
          {
            label: '出售中',
            value: 'admin.finished-stock-management.selling',
            children: buildActionNodes('admin.finished-stock-management.selling', [
              '查询',
              '重置',
              '发布商品',
              '批量下架',
              '查看价格',
              '下架',
              '编辑',
              '驳回',
              '删除',
            ]),
          },
          {
            label: '已下架',
            value: 'admin.finished-stock-management.off-shelf',
            children: buildActionNodes('admin.finished-stock-management.off-shelf', [
              '查询',
              '重置',
              '批量放回到仓库',
              '查看价格',
              '放回到仓库',
              '编辑',
              '删除',
            ]),
          },
          {
            label: '已售完',
            value: 'admin.finished-stock-management.sold-out',
            children: buildActionNodes('admin.finished-stock-management.sold-out', ['查询', '重置', '查看价格']),
          },
          {
            label: '回收站',
            value: 'admin.finished-stock-management.recycle',
            children: buildActionNodes('admin.finished-stock-management.recycle', [
              '查询',
              '重置',
              '批量放回到仓库',
              '批量彻底删除',
              '清空回收站',
              '查看价格',
              '放回到仓库',
              '彻底删除',
            ]),
          },
        ],
      },
      {
        label: '大板管理',
        value: 'admin.slab-management',
        children: [
          {
            label: '仓库中',
            value: 'admin.slab-management.warehouse',
            children: buildActionNodes('admin.slab-management.warehouse', [
              '查询',
              '重置',
              '发布商品',
              '批量上架',
              '上架',
              '编辑',
              '驳回',
              '删除',
            ]),
          },
          {
            label: '出售中',
            value: 'admin.slab-management.selling',
            children: buildActionNodes('admin.slab-management.selling', [
              '查询',
              '重置',
              '发布商品',
              '批量下架',
              '下架',
              '编辑',
              '驳回',
              '删除',
            ]),
          },
          {
            label: '已下架',
            value: 'admin.slab-management.off-shelf',
            children: buildActionNodes('admin.slab-management.off-shelf', [
              '查询',
              '重置',
              '批量放回到仓库',
              '放回到仓库',
              '编辑',
              '删除',
            ]),
          },
          {
            label: '已售完',
            value: 'admin.slab-management.sold-out',
            children: buildActionNodes('admin.slab-management.sold-out', ['查询', '重置']),
          },
          {
            label: '回收站',
            value: 'admin.slab-management.recycle',
            children: buildActionNodes('admin.slab-management.recycle', [
              '查询',
              '重置',
              '批量放回到仓库',
              '批量彻底删除',
              '清空回收站',
              '放回到仓库',
              '彻底删除',
            ]),
          },
        ],
      },
      {
        label: '供应商管理',
        value: 'admin.supplier-management',
        children: buildActionNodes('admin.supplier-management', ['查询', '重置', '新增', '编辑', '停用/启用', '删除']),
      },
      {
        label: '商品基础数据中心',
        value: 'admin.product-data-center',
        children: [
          {
            label: '商品类目管理',
            value: 'admin.product-data-center.category',
            children: buildActionNodes('admin.product-data-center.category', [
              '查询',
              '重置',
              '新增',
              '新增子类目',
              '编辑',
              '停用/启用',
            ]),
          },
          {
            label: '属性库管理',
            value: 'admin.product-data-center.attribute',
            children: buildActionNodes('admin.product-data-center.attribute', ['查询', '重置', '新增', '停用/启用']),
          },
          {
            label: '属性值管理',
            value: 'admin.product-data-center.attribute-value',
            children: buildActionNodes('admin.product-data-center.attribute-value', [
              '查询',
              '重置',
              '新增',
              '停用/启用',
              '删除',
            ]),
          },
          {
            label: '类目属性模板',
            value: 'admin.product-data-center.category-attribute-template',
            children: buildActionNodes('admin.product-data-center.category-attribute-template', [
              '查询',
              '重置',
              '关联标准属性',
              '关联选项',
              '发布',
              '移除',
              '设置必填',
            ]),
          },
          {
            label: '大板品种管理',
            value: 'admin.product-data-center.slab-variety',
            children: buildActionNodes('admin.product-data-center.slab-variety', [
              '查询',
              '重置',
              '新增',
              '编辑',
              '停用/启用',
              '删除',
            ]),
          },
          {
            label: '成品现货工艺管理',
            value: 'admin.product-data-center.finished-stock-craft',
            children: buildActionNodes('admin.product-data-center.finished-stock-craft', [
              '查询',
              '重置',
              '新增',
              '预览工艺图片',
              '编辑',
              '停用/启用',
              '删除',
            ]),
          },
        ],
      },
      {
        label: '权限管理',
        value: 'admin.permission-management',
        children: [
          {
            label: '员工管理',
            value: 'admin.permission-management.employee-management',
            children: buildActionNodes('admin.permission-management.employee-management', [
              '查询',
              '重置',
              '邀请员工',
              '编辑员工',
              '停用/启用',
              '删除',
            ]),
          },
          {
            label: '角色管理',
            value: 'admin.permission-management.role-management',
            children: [
              {
                label: '城市合伙人门店角色',
                value: 'admin.permission-management.role-management.partner-store',
                children: buildActionNodes('admin.permission-management.role-management.partner-store', [
                  '新建',
                  '编辑',
                  '删除',
                ]),
              },
              {
                label: '大板供应商门店角色',
                value: 'admin.permission-management.role-management.supplier-store',
                children: buildActionNodes('admin.permission-management.role-management.supplier-store', [
                  '新建',
                  '编辑',
                  '删除',
                ]),
              },
              {
                label: '运营管理平台角色',
                value: 'admin.permission-management.role-management.operation-platform',
                children: buildActionNodes('admin.permission-management.role-management.operation-platform', [
                  '新建',
                  '权限管理',
                  '编辑',
                  '删除',
                ]),
              },
            ],
          },
          {
            label: '终端功能分配',
            value: 'admin.permission-management.terminal-function-allocation',
            children: buildActionNodes('admin.permission-management.terminal-function-allocation', [
              '查看',
              '全选',
              '清空',
              '保存',
              '重置',
            ]),
          },
        ],
      },
    ],
  },
];

const isActionGroup = (node: PermissionTreeNode) => {
  const children = node.children ?? [];
  return children.length > 0 && children.every((child) => !child.children?.length);
};

const collectPermissionPages = (nodes: PermissionTreeNode[]): PermissionPage[] =>
  nodes.flatMap((node) => {
    if (isActionGroup(node)) {
      return [
        {
          label: node.label,
          value: node.value,
          actions: node.children?.map(({ label, value }) => ({ label, value })) ?? [],
        },
      ];
    }

    return node.children?.length ? collectPermissionPages(node.children) : [];
  });

const permissionModules: PermissionModule[] =
  permissionTreeData[0]?.children?.map((module) => ({
    label: module.label,
    value: module.value,
    pages: collectPermissionPages([module]),
  })) ?? [];

const pageSizeOptions = [10, 20, 50];
const activeCategory = ref<RoleCategory>('partner-store');
const loginUser = computed(() => getLoginUser());
const activePermissionModuleValue = ref(permissionModules[0]?.value ?? '');
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

const currentRoles = computed(() => roles.value.filter((item) => item.category === activeCategory.value));
const isOperationPlatformTab = computed(() => activeCategory.value === 'operation-platform');
const currentRolePermissionScope = computed(
  () => `admin.permission-management.role-management.${activeCategory.value}`,
);
const getRoleActionPermissions = (action: 'create' | 'permission' | 'edit' | 'delete') => {
  const legacyActionMap = {
    create: '新建',
    permission: '权限管理',
    edit: '编辑',
    delete: '删除',
  };

  return [
    `admin.permission-management.role-management.${action}`,
    `admin.permission-management.role-management.${legacyActionMap[action]}`,
    `${currentRolePermissionScope.value}.${action}`,
    `${currentRolePermissionScope.value}.${legacyActionMap[action]}`,
  ];
};
const canCreateRole = computed(() => hasAnyPermission(loginUser.value, getRoleActionPermissions('create')));
const canManageRolePermission = computed(() =>
  hasAnyPermission(loginUser.value, getRoleActionPermissions('permission')),
);
const canEditRole = computed(() => hasAnyPermission(loginUser.value, getRoleActionPermissions('edit')));
const canDeleteRole = computed(() => hasAnyPermission(loginUser.value, getRoleActionPermissions('delete')));
const paginationTotal = computed(() => currentRoles.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / pagination.pageSize), 1));
const pageNumbers = computed(() => Array.from({ length: pageCount.value }, (_, index) => index + 1));
const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return currentRoles.value.slice(start, start + pagination.pageSize);
});
const deleteConfirmText = computed(() => `是否删除角色【${deletingRole.value?.name ?? ''}】？`);
const activePermissionModule = computed(
  () => permissionModules.find((module) => module.value === activePermissionModuleValue.value) ?? permissionModules[0],
);

const normalizeCategory = (value?: string): RoleCategory =>
  value === 'partner-store' || value === 'supplier-store' || value === 'operation-platform'
    ? value
    : 'operation-platform';

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
  category: normalizeCategory(record.category),
  dataScope: record.dataScope,
  status: record.status,
  name: record.name,
  createdAt: formatDateTime(record.createdAt),
  remark: record.remark ?? '',
  functionPermissions: parsePermissions(record.functionPermissions),
});

const categoryClientCode = (category: RoleCategory) => {
  if (category === 'partner-store') return 'store';
  if (category === 'supplier-store') return 'supplier';
  return 'admin';
};

const categoryDataScope = (category: RoleCategory) => (category === 'operation-platform' ? 'all' : 'store');

const createRoleCode = (category: RoleCategory, roleName: string) =>
  `${category.replace(/-/g, '_')}_${roleName.trim().length}_${Date.now()}`.toUpperCase();

const toRolePayload = (role: RoleItem): RolePayload => ({
  name: role.name,
  code: role.code,
  category: role.category,
  clientCode: categoryClientCode(role.category),
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
    roles.value = records.filter((record) => record.category !== 'terminal-policy').map(toRoleItem);
    ensureCurrentPage();
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '角色列表加载失败');
  } finally {
    loading.value = false;
  }
};

const getModuleActionValues = (module?: PermissionModule) =>
  module?.pages.flatMap((page) => page.actions.map((action) => action.value)) ?? [];
const getPageActionValues = (page: PermissionPage) => page.actions.map((action) => action.value);
const allPermissionValues = permissionModules.flatMap((module) => getModuleActionValues(module));
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
const isPageAllSelected = (page: PermissionPage) => isAllSelected(getPageActionValues(page));
const isPageIndeterminate = (page: PermissionPage) => isIndeterminate(getPageActionValues(page));
const isModuleAllSelected = (module?: PermissionModule) => isAllSelected(getModuleActionValues(module));
const isModuleIndeterminate = (module?: PermissionModule) => isIndeterminate(getModuleActionValues(module));
const togglePermission = (value: string, checked: unknown) => setPermissionRange([value], checked);
const togglePagePermissions = (page: PermissionPage, checked: unknown) =>
  setPermissionRange(getPageActionValues(page), checked);
const toggleModulePermissions = (module: PermissionModule | undefined, checked: unknown) =>
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

const handleTabChange = () => {
  pagination.current = 1;
  closeFormDialog();
  closeDeleteDialog();
  closePermissionDialog();
};

const handlePageSizeChange = (value: unknown) => {
  pagination.pageSize = Number(value);
  pagination.current = 1;
};

const goPage = (pageNumber: number) => {
  pagination.current = pageNumber;
};

const goPrevPage = () => {
  if (pagination.current > 1) {
    pagination.current -= 1;
  }
};

const goNextPage = () => {
  if (pagination.current < pageCount.value) {
    pagination.current += 1;
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
        name: roleName,
        code: createRoleCode(activeCategory.value, roleName),
        category: activeCategory.value,
        clientCode: categoryClientCode(activeCategory.value),
        dataScope: categoryDataScope(activeCategory.value),
        status: 'enabled',
        remark: roleRemark,
        functionPermissions: '',
      });
      await loadRoles();
      pagination.current = 1;
    } else if (editingId.value) {
      const target = currentRoles.value.find((item) => item.id === editingId.value);
      if (target) {
        await updateRole(editingId.value, toRolePayload({ ...target, name: roleName, remark: roleRemark }));
        await loadRoles();
      }
    }

    closeFormDialog();
    MessagePlugin.success('操作成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openDeleteConfirm = (row: RoleItem) => {
  if (isSuperAdminRole(row)) {
    MessagePlugin.warning('超级管理员角色不可删除');
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

  try {
    await deleteRole(deletingRole.value.id);
    roles.value = roles.value.filter((item) => item.id !== deletingRole.value?.id);
    ensureCurrentPage();
    closeDeleteDialog();
    MessagePlugin.success('操作成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openPermissionDialog = (row: RoleItem) => {
  if (isSuperAdminRole(row)) {
    MessagePlugin.warning('超级管理员天然拥有全量权限，无需配置权限');
    return;
  }
  permissionRole.value = row;
  permissionDraft.functionPermissions = row.functionPermissions.includes('all')
    ? [...allPermissionValues]
    : [...row.functionPermissions];
  permissionDialogVisible.value = true;
};

const closePermissionDialog = () => {
  permissionDialogVisible.value = false;
  permissionRole.value = null;
  permissionDraft.functionPermissions = [];
};

const selectAllPermissions = () => {
  permissionDraft.functionPermissions = [...allPermissionValues];
};

const clearAllPermissions = () => {
  permissionDraft.functionPermissions = [];
};

const handlePermissionSave = async () => {
  if (!permissionRole.value) return;

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
    MessagePlugin.success('保存成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '保存失败');
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
  gap: var(--td-comp-margin-s);
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

.permission-matrix {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--td-bg-color-container);
}

.permission-matrix__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  min-height: 72px;
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-l);
  border-bottom: 1px solid var(--td-component-border);
}

.permission-matrix__toolbar h4 {
  margin: 0;
  color: var(--td-text-color-primary);
  font: var(--td-font-title-small);
}

.permission-matrix__toolbar p {
  margin: var(--td-comp-margin-xxs) 0 0;
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
}

.permission-matrix__table-wrap {
  max-height: 448px;
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

.permission-matrix__table th:first-child,
.permission-matrix__table td:first-child {
  width: 180px;
}

.permission-page-name {
  margin-bottom: var(--td-comp-margin-xs);
  color: var(--td-text-color-primary);
  font: var(--td-font-title-small);
}

.permission-action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(116px, 1fr));
  gap: var(--td-comp-margin-s) var(--td-comp-margin-l);
  align-items: start;
}

.permission-action-grid :deep(.t-checkbox) {
  min-width: 0;
}

.permission-action-grid :deep(.t-checkbox__label) {
  white-space: normal;
  word-break: break-word;
  line-height: 20px;
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
  gap: var(--td-comp-margin-xs);
}

.page-size-select {
  width: 108px;
  margin-right: var(--td-comp-margin-xs);
}

.page-number {
  min-width: 32px;
}

@media (max-width: 960px) {
  .page-header,
  .custom-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .pagination-controls {
    flex-wrap: wrap;
  }
}
</style>
