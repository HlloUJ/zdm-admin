<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <AdminPageHeader :breadcrumbs="['租户与门店', '门店管理']" badge="租户业务开通后生成店铺" />

        <AdminListLayout class="store-list-layout">
          <template #toolbar>
            <div class="list-controls">
              <t-tabs v-if="showStoreTabRail" v-model="activeTab" :list="storeTabs" />
              <t-form :data="searchForm" label-width="84px" colon>
                <div class="filter-row">
                  <div class="filter-fields">
                    <t-form-item label="店铺名称" name="shopName">
                      <t-input v-model="searchForm.shopName" clearable placeholder="请输入" />
                    </t-form-item>
                    <t-form-item label="店铺类型" name="shopType">
                      <t-select v-model="searchForm.shopType" clearable placeholder="请选择">
                        <t-option
                          v-for="item in shopTypeOptions"
                          :key="item.value"
                          :label="item.label"
                          :value="item.value"
                        />
                      </t-select>
                    </t-form-item>
                    <t-form-item label="租户姓名" name="tenantName">
                      <t-select v-model="searchForm.tenantName" clearable filterable placeholder="请选择">
                        <t-option
                          v-for="item in tenantOptions"
                          :key="item.name"
                          :label="item.name"
                          :value="item.name"
                        />
                      </t-select>
                    </t-form-item>
                    <t-form-item v-if="activeTab === 'operating'" label="状态" name="status">
                      <t-select v-model="searchForm.status" clearable placeholder="请选择">
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
              <div v-if="activeTab === 'operating' && canCreate" class="table-toolbar">
                <t-button theme="primary" @click="openCreateDialog">
                  <template #icon><t-icon name="add" /></template>
                  新增
                </t-button>
              </div>
            </div>
          </template>

          <template #table>
            <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
              <template #index="{ rowIndex }">
                {{ (pagination.current - 1) * pagination.pageSize + rowIndex + 1 }}
              </template>
              <template #shopType="{ row }">
                <t-tag :class="['shop-type-tag', row.shopType]" variant="light">
                  {{ shopTypeLabel(row.shopType) }}
                </t-tag>
              </template>
              <template #storeLevelId="{ row }">
                <div class="level-cell">
                  <span>{{ shopLevelLabel(row.storeLevelId) }}</span>
                  <t-button
                    v-if="activeTab === 'operating' && canEditLevel"
                    class="level-edit-button"
                    shape="square"
                    size="small"
                    variant="text"
                    theme="primary"
                    aria-label="修改门店级别"
                    @click="openLevelDialog(row)"
                  >
                    <t-icon name="check-circle" />
                  </t-button>
                </div>
              </template>
              <template #manager="{ row }">
                {{ row.manager || '-' }}
              </template>
              <template #status="{ row }">
                <t-tag
                  :theme="row.status === 'normal' ? 'success' : row.status === 'archived' ? 'default' : 'danger'"
                  variant="light"
                >
                  {{ row.status === 'normal' ? '正常' : row.status === 'archived' ? '已归档' : '停用' }}
                </t-tag>
              </template>
              <template #createdBy="{ row }">
                {{ row.createdBy || '-' }}
              </template>
              <template #operation="{ row }">
                <div v-if="activeTab === 'operating'" class="table-actions">
                  <t-link v-if="canEdit" theme="primary" hover="color" @click="openEditDialog(row)">编辑</t-link>
                  <t-link
                    v-if="canToggle"
                    :theme="row.status === 'normal' ? 'warning' : 'success'"
                    hover="color"
                    @click="openStatusConfirm(row)"
                  >
                    {{ row.status === 'normal' ? '停用' : '启用' }}
                  </t-link>
                  <t-link v-if="canArchive" theme="warning" hover="color" @click="openArchiveConfirm(row)">归档</t-link>
                </div>
                <div v-else class="table-actions">
                  <t-link v-if="canRestore" theme="success" hover="color" @click="openRestoreConfirm(row)"
                    >恢复运营</t-link
                  >
                  <t-link v-if="canDelete" theme="danger" hover="color" @click="openDeleteConfirm(row)">删除</t-link>
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

    <AdminDialog
      v-model:visible="formDialogVisible"
      :header="dialogMode === 'create' ? '新增' : '编辑'"
      width="620px"
      @confirm="handleSubmit"
      @cancel="closeFormDialog"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="96px" colon>
        <template v-if="dialogMode === 'create'">
          <t-form-item label="选择租户" name="tenantName" required-mark>
            <t-select
              v-model="formData.tenantName"
              clearable
              filterable
              placeholder="请选择"
              @change="handleTenantChange"
            >
              <t-option v-for="item in tenantOptions" :key="item.name" :label="item.name" :value="item.name" />
            </t-select>
          </t-form-item>
          <t-form-item label="店铺类型" name="shopType" required-mark>
            <t-select
              v-model="formData.shopType"
              :popup-visible="shopTypePopupVisible"
              clearable
              placeholder="请选择"
              @popup-visible-change="handleShopTypePopupVisibleChange"
            >
              <t-option
                v-for="item in availableShopTypeOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </t-select>
          </t-form-item>
        </template>
        <t-form-item label="店铺名称" name="shopName" required-mark>
          <t-input v-model="formData.shopName" clearable placeholder="请输入" />
        </t-form-item>
        <t-form-item label="门店地址" name="region" required-mark>
          <t-cascader
            v-model="formData.region"
            :options="chinaRegionOptions"
            :keys="chinaRegionKeys"
            clearable
            filterable
            placeholder="请选择省 / 市 / 区"
          />
        </t-form-item>
        <t-form-item label="详细地址" name="detailAddress" required-mark>
          <t-input v-model="formData.detailAddress" clearable placeholder="请输入" />
        </t-form-item>
        <t-form-item v-if="dialogMode === 'create'" label="店铺级别" name="storeLevelId" required-mark>
          <t-select v-model="formData.storeLevelId" clearable filterable placeholder="请选择">
            <t-option v-for="item in shopLevelOptions" :key="item.value" :label="item.label" :value="item.value" />
          </t-select>
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
    </AdminDialog>

    <AdminDialog
      v-model:visible="levelDialogVisible"
      header="店铺级别"
      width="420px"
      @confirm="handleLevelSubmit"
      @cancel="closeLevelDialog"
      @close="closeLevelDialog"
    >
      <t-form ref="levelFormRef" :data="levelFormData" :rules="levelFormRules" label-width="96px" colon>
        <t-form-item label="店铺级别" name="storeLevelId" required-mark>
          <t-select v-model="levelFormData.storeLevelId" clearable filterable placeholder="请选择">
            <t-option v-for="item in shopLevelOptions" :key="item.value" :label="item.label" :value="item.value" />
          </t-select>
        </t-form-item>
      </t-form>
    </AdminDialog>

    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="confirmAction"
      :danger="confirmState.type === 'delete'"
      object-type="门店"
      :object-name="confirmState.row?.shopName"
      @confirm="handleConfirm"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
    >
      {{ confirmState.content }}
    </AdminConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref, watch } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { requireCreatorOwnership } from '@/composables/useCreatorOwnershipGuard';
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import {
  adminFeedback,
  AdminConfirmDialog,
  AdminDialog,
  AdminListLayout,
  AdminPageHeader,
  AdminPagination,
} from '@/components/foundation';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  archiveStore,
  createStore,
  deleteStore,
  listStores,
  restoreStore,
  updateStore,
  updateStoreLevelSelection,
  updateStoreStatus,
  type StorePayload,
  type StoreRecord,
} from '@/services/stores';
import { sortByCreatedAtDesc } from '@/services/recordSorting';
import { listTenants, type TenantRecord } from '@/services/tenants';
import { listStoreLevelOptions, type StoreLevelRecord } from '@/services/storeLevels';
import {
  chinaRegionKeys,
  chinaRegionOptions,
  getChinaRegionLabel,
  normalizeChinaRegionCode,
} from '@/utils/chinaRegions';

type ShopType = 'cityPartner' | 'slabSupplier' | 'finishedSupplier' | 'factory';
type StoreStatus = 'normal' | 'disabled' | 'archived';
type StoreTab = 'operating' | 'archived';
type ConfirmType = 'enable' | 'disable' | 'archive' | 'restore' | 'delete';
const permissionPrefix = 'admin.tenant.tenant-store-management';
const loginUser = computed(() => getLoginUser());
const activeTab = ref<StoreTab>('operating');
const allStoreTabs: { label: string; value: StoreTab }[] = [
  { label: '运营中', value: 'operating' },
  { label: '已归档', value: 'archived' },
];
const { visibleTabs: storeTabs, showTabRail: showStoreTabRail } = usePermissionTabs({
  tabs: allStoreTabs,
  activeTab,
  canAccess: (tab) => hasPermission(loginUser.value, `${permissionPrefix}.${tab.value}.view`),
});
const hasStoreAction = (scope: StoreTab, action: string) =>
  hasPermission(loginUser.value, `${permissionPrefix}.${scope}.${action}`);
const canCreate = computed(() => hasStoreAction('operating', 'create'));
const canEditLevel = computed(() => hasStoreAction('operating', 'edit-level'));
const canEdit = computed(() => hasStoreAction('operating', 'edit'));
const canToggle = computed(() => hasStoreAction('operating', 'toggle-status'));
const canArchive = computed(() => hasStoreAction('operating', 'archive'));
const canRestore = computed(() => hasStoreAction('archived', 'restore'));
const canDelete = computed(() => hasStoreAction('archived', 'delete'));

interface TenantOption {
  id: number;
  name: string;
  businesses: ShopType[];
}

interface StoreItem {
  id: number;
  shopName: string;
  shopType: ShopType;
  storeLevelId: number;
  manager: string;
  region: string;
  detailAddress: string;
  address: string;
  tenantName: string;
  status: StoreStatus;
  createdAt: string;
  createdBy: string;
  remark?: string;
}

interface StoreForm {
  tenantName: string;
  shopType: ShopType | '';
  shopName: string;
  region: string;
  detailAddress: string;
  storeLevelId: number | undefined;
  remark: string;
}

const shopTypeOptions: { label: string; value: ShopType }[] = [
  { label: '城市合伙人', value: 'cityPartner' },
  { label: '大板供应商', value: 'slabSupplier' },
  { label: '成品供应商', value: 'finishedSupplier' },
  { label: '工厂', value: 'factory' },
];

const storeLevelRecords = ref<StoreLevelRecord[]>([]);
const shopLevelOptions = computed(() => storeLevelRecords.value.map((item) => ({ label: item.name, value: item.id })));

const tenantOptions = ref<TenantOption[]>([]);

const shopTypeLabel = (type: ShopType) => shopTypeOptions.find((item) => item.value === type)?.label ?? '';
const shopLevelLabel = (levelId: number) =>
  shopLevelOptions.value.find((item) => item.value === levelId)?.label ?? `级别#${levelId}`;
const tableData = ref<StoreItem[]>([]);
const loading = ref(false);

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 80, align: 'left' },
  { colKey: 'shopName', title: '店铺名称', minWidth: 180, align: 'left' },
  { colKey: 'shopType', title: '店铺类型', width: 130, align: 'center' },
  { colKey: 'storeLevelId', title: '店铺级别', width: 140, align: 'center' },
  { colKey: 'manager', title: '店长', width: 110, align: 'center' },
  { colKey: 'address', title: '门店地址', minWidth: 260, align: 'left' },
  { colKey: 'tenantName', title: '租户姓名', width: 120, align: 'center' },
  { colKey: 'status', title: '状态', width: 100, align: 'center' },
  { colKey: 'createdBy', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 170, align: 'center' },
  { colKey: 'operation', title: '操作', width: 190, align: 'left', fixed: 'right' },
];

const searchForm = reactive({
  shopName: '',
  shopType: '' as ShopType | '',
  tenantName: '',
  status: '' as StoreStatus | '',
});
const appliedSearchForm = reactive({ ...searchForm });

const pageSizeOptions = [10, 20, 50];
const pagination = reactive({
  current: 1,
  pageSize: 10,
});

const formRef = ref<FormInstanceFunctions>();
const formDialogVisible = ref(false);
const shopTypePopupVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const formData = reactive<StoreForm>({
  tenantName: '',
  shopType: '',
  shopName: '',
  region: '',
  detailAddress: '',
  storeLevelId: undefined,
  remark: '',
});

const formRules: Record<string, FormRule[]> = {
  tenantName: [{ required: true, message: '请选择租户', type: 'error' }],
  shopType: [{ required: true, message: '请选择店铺类型', type: 'error' }],
  shopName: [{ required: true, message: '请输入店铺名称', type: 'error' }],
  region: [{ required: true, message: '请选择门店地址', type: 'error' }],
  detailAddress: [{ required: true, message: '请输入详细地址', type: 'error' }],
  storeLevelId: [{ required: true, message: '请选择店铺级别', type: 'error' }],
  remark: [{ max: 100, message: '备注最多可输入100个字符', type: 'error' }],
};

const levelFormRef = ref<FormInstanceFunctions>();
const levelDialogVisible = ref(false);
const levelEditingId = ref<number | null>(null);
const levelFormData = reactive({
  storeLevelId: undefined as number | undefined,
});
const levelFormRules: Record<string, FormRule[]> = {
  storeLevelId: [{ required: true, message: '请选择店铺级别', type: 'error' }],
};

const confirmDialogVisible = ref(false);
const confirmState = reactive<{
  content: string;
  type: ConfirmType;
  row: StoreItem | null;
}>({
  content: '',
  type: 'disable',
  row: null,
});
const confirmAction = computed(
  () => ({ enable: '启用', disable: '停用', archive: '归档', restore: '恢复运营', delete: '删除' })[confirmState.type],
);

const selectedTenant = computed(() => tenantOptions.value.find((item) => item.name === formData.tenantName));
const availableShopTypeOptions = computed(() => {
  if (!selectedTenant.value) return [];
  return shopTypeOptions.filter((item) => selectedTenant.value?.businesses.includes(item.value));
});

const filteredData = computed(() => {
  const shopName = appliedSearchForm.shopName.trim();
  return tableData.value.filter((item) => {
    const nameMatched = !shopName || item.shopName.includes(shopName);
    const typeMatched = !appliedSearchForm.shopType || item.shopType === appliedSearchForm.shopType;
    const tenantMatched = !appliedSearchForm.tenantName || item.tenantName === appliedSearchForm.tenantName;
    const statusMatched = !appliedSearchForm.status || item.status === appliedSearchForm.status;
    return nameMatched && typeMatched && tenantMatched && statusMatched;
  });
});

const paginationTotal = computed(() => filteredData.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / pagination.pageSize), 1));
const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return filteredData.value.slice(start, start + pagination.pageSize);
});

const parseBusinessTypes = (value?: string): ShopType[] =>
  (value?.split(',').filter(Boolean) as ShopType[] | undefined) ?? [];

const normalizeStatus = (status: StoreRecord['status']): StoreStatus =>
  status === 'archived' ? 'archived' : status === 'disabled' ? 'disabled' : 'normal';

const toBackendStatus = (status: StoreStatus): StorePayload['status'] =>
  status === 'disabled' ? 'disabled' : 'enabled';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);

  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toTenantOption = (record: TenantRecord): TenantOption => ({
  id: record.id,
  name: record.name,
  businesses: parseBusinessTypes(record.businessTypes),
});

const normalizeShopType = (value: string): ShopType =>
  shopTypeOptions.some((item) => item.value === value) ? (value as ShopType) : 'cityPartner';

const toStoreItem = (record: StoreRecord): StoreItem => {
  const tenant = tenantOptions.value.find((item) => item.id === record.tenantId);
  const detailAddress = record.detailAddress ?? record.address ?? '';

  return {
    id: record.id,
    shopName: record.name,
    shopType: normalizeShopType(record.type),
    storeLevelId: record.storeLevelId ?? 0,
    manager: record.manager ?? '',
    region: normalizeChinaRegionCode(record.region ?? ''),
    detailAddress,
    address: record.address ?? `${getChinaRegionLabel(record.region ?? '')}${detailAddress}`,
    tenantName: tenant?.name ?? `租户#${record.tenantId}`,
    status: normalizeStatus(record.status),
    createdAt: formatDateTime(record.createdAt),
    createdBy: record.createdBy ?? '',
    remark: record.remark ?? '',
  };
};

const toStorePayload = (status: StoreStatus, storeLevelId: number, manager = ''): StorePayload => {
  const tenant = selectedTenant.value;
  if (!tenant || !formData.shopType) {
    throw new Error('请选择租户和店铺类型');
  }

  const detailAddress = formData.detailAddress.trim();
  return {
    tenantId: tenant.id,
    name: formData.shopName.trim(),
    type: formData.shopType,
    storeLevelId,
    manager,
    region: formData.region,
    detailAddress,
    address: `${getChinaRegionLabel(formData.region)}${detailAddress}`,
    status: toBackendStatus(status),
    remark: formData.remark.trim(),
  };
};

const loadStorePage = async () => {
  loading.value = true;
  try {
    const [tenants, levels, stores] = await Promise.all([
      listTenants(),
      activeTab.value === 'operating' ? listStoreLevelOptions() : Promise.resolve([]),
      listStores(activeTab.value),
    ]);
    tenantOptions.value = tenants.map(toTenantOption);
    storeLevelRecords.value = levels;
    tableData.value = sortByCreatedAtDesc(stores).map(toStoreItem);
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '门店列表加载失败');
  } finally {
    loading.value = false;
  }
};

const resetFormData = () => {
  formData.tenantName = '';
  formData.shopType = '';
  formData.shopName = '';
  formData.region = '';
  formData.detailAddress = '';
  formData.storeLevelId = undefined;
  formData.remark = '';
};

const fillFormData = (row: StoreItem) => {
  formData.tenantName = row.tenantName;
  formData.shopType = row.shopType;
  formData.shopName = row.shopName;
  formData.region = row.region;
  formData.detailAddress = row.detailAddress;
  formData.storeLevelId = row.storeLevelId;
  formData.remark = row.remark ?? '';
};

const ensureCurrentPage = () => {
  if (pagination.current > pageCount.value) {
    pagination.current = pageCount.value;
  }
};

const handleSearch = () => {
  Object.assign(appliedSearchForm, searchForm);
  pagination.current = 1;
};

const handleReset = () => {
  searchForm.shopName = '';
  searchForm.shopType = '';
  searchForm.tenantName = '';
  searchForm.status = '';
  pagination.pageSize = 10;
  handleSearch();
};

const handleTenantChange = () => {
  shopTypePopupVisible.value = false;
  if (formData.shopType && !availableShopTypeOptions.value.some((item) => item.value === formData.shopType)) {
    formData.shopType = '';
  }
};

const handleShopTypePopupVisibleChange = (visible: boolean) => {
  if (visible && !selectedTenant.value) {
    shopTypePopupVisible.value = false;
    adminFeedback.warning('请先选择租户');
    return;
  }

  shopTypePopupVisible.value = visible;
};

const openCreateDialog = () => {
  dialogMode.value = 'create';
  editingId.value = null;
  resetFormData();
  formDialogVisible.value = true;
};

const openEditDialog = (row: StoreItem) => {
  if (!requireCreatorOwnership({ createdByName: row.createdBy })) return;
  dialogMode.value = 'edit';
  editingId.value = row.id;
  fillFormData(row);
  formDialogVisible.value = true;
};

const closeFormDialog = () => {
  formDialogVisible.value = false;
  shopTypePopupVisible.value = false;
  formRef.value?.clearValidate();
};

const handleSubmit = async () => {
  const result = await formRef.value?.validate();
  if (result !== true) return;

  if (!formData.region) return;
  const action = dialogMode.value === 'create' ? '新增' : '编辑';
  const targetName = formData.shopName.trim();
  try {
    if (dialogMode.value === 'create') {
      if (!formData.storeLevelId) return;
      await createStore(toStorePayload('normal', formData.storeLevelId));
      await loadStorePage();
      pagination.current = 1;
    } else if (editingId.value) {
      const current = tableData.value.find((item) => item.id === editingId.value);
      await updateStore(
        editingId.value,
        toStorePayload(current?.status ?? 'normal', current?.storeLevelId ?? 0, current?.manager ?? ''),
      );
      await loadStorePage();
    }

    closeFormDialog();
    if (dialogMode.value === 'create') {
      adminFeedback.created(targetName);
    } else {
      adminFeedback.actionSuccess({ action, target: targetName });
    }
  } catch (error) {
    if (error instanceof Error && error.message === '店铺名称已存在') {
      formRef.value?.setValidateMessage({
        shopName: [{ type: 'error', message: error.message }],
      });
    }
    adminFeedback.actionError({ action, target: targetName, error, fallback: '请稍后重试' });
  }
};

const openLevelDialog = (row: StoreItem) => {
  if (!requireCreatorOwnership({ createdByName: row.createdBy })) return;
  levelEditingId.value = row.id;
  levelFormData.storeLevelId = row.storeLevelId;
  levelDialogVisible.value = true;
};

const closeLevelDialog = () => {
  levelDialogVisible.value = false;
  levelEditingId.value = null;
  levelFormRef.value?.clearValidate();
};

const handleLevelSubmit = async () => {
  const result = await levelFormRef.value?.validate();
  if (result !== true || !levelFormData.storeLevelId) return;

  const target = tableData.value.find((item) => item.id === levelEditingId.value);
  if (!target) return;

  try {
    const updated = await updateStoreLevelSelection(target.id, levelFormData.storeLevelId);
    const targetIndex = tableData.value.findIndex((item) => item.id === target.id);
    if (targetIndex !== -1) {
      tableData.value.splice(targetIndex, 1, toStoreItem(updated));
    }

    closeLevelDialog();
    adminFeedback.success('已调整店铺等级');
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openStatusConfirm = (row: StoreItem) => {
  if (!requireCreatorOwnership({ createdByName: row.createdBy })) return;
  const isNormal = row.status === 'normal';
  confirmState.type = isNormal ? 'disable' : 'enable';
  confirmState.row = row;
  confirmState.content = `是否${isNormal ? '停用' : '启用'}店铺“${row.shopName}”？`;
  confirmDialogVisible.value = true;
};

const openArchiveConfirm = (row: StoreItem) => {
  if (!requireCreatorOwnership({ createdByName: row.createdBy })) return;
  confirmState.type = 'archive';
  confirmState.row = row;
  confirmState.content = '归档后，该门店的全部员工将无法登录或切换到该门店。';
  confirmDialogVisible.value = true;
};

const openRestoreConfirm = (row: StoreItem) => {
  if (!requireCreatorOwnership({ createdByName: row.createdBy })) return;
  confirmState.type = 'restore';
  confirmState.row = row;
  confirmState.content = `是否恢复门店“${row.shopName}”运营？`;
  confirmDialogVisible.value = true;
};

const openDeleteConfirm = (row: StoreItem) => {
  if (!requireCreatorOwnership({ createdByName: row.createdBy })) return;
  confirmState.type = 'delete';
  confirmState.row = row;
  confirmState.content = '门店删除后，该门店的经营数据永久不可恢复，请谨慎操作';
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};

const handleConfirm = async () => {
  if (!confirmState.row) return;
  const target = confirmState.row;
  const action = confirmAction.value;

  try {
    if (confirmState.type === 'delete') {
      await deleteStore(target.id);
      tableData.value = tableData.value.filter((item) => item.id !== target.id);
    } else if (confirmState.type === 'archive') {
      await archiveStore(target.id);
      tableData.value = tableData.value.filter((item) => item.id !== target.id);
    } else if (confirmState.type === 'restore') {
      await restoreStore(target.id);
      tableData.value = tableData.value.filter((item) => item.id !== target.id);
    } else {
      const updated = await updateStoreStatus(
        confirmState.row.id,
        toBackendStatus(confirmState.type === 'enable' ? 'normal' : 'disabled'),
      );
      const targetIndex = tableData.value.findIndex((item) => item.id === confirmState.row?.id);
      if (targetIndex !== -1) {
        tableData.value.splice(targetIndex, 1, toStoreItem(updated));
      }
    }

    closeConfirmDialog();
    if (action === '删除') {
      adminFeedback.deleted(target.shopName);
    } else {
      adminFeedback.actionSuccess({ action, target: target.shopName });
    }
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.actionError({ action, target: target.shopName, error, fallback: '请稍后重试' });
  }
};

watch(activeTab, () => {
  searchForm.status = '';
  appliedSearchForm.status = '';
  pagination.current = 1;
  void loadStorePage();
});

onMounted(loadStorePage);
</script>

<style scoped>
.store-list-layout {
  min-width: 0;
}

.store-list-layout :deep(.zdm-admin-list-layout__filters),
.store-list-layout :deep(.zdm-admin-list-layout__content) {
  min-width: 0;
}

.list-controls {
  display: grid;
  width: 100%;
  gap: var(--td-comp-margin-l);
}

:deep(.zdm-admin-list-layout__toolbar) {
  display: block;
  min-height: 0;
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

.table-toolbar {
  display: flex;
  align-items: center;
}

.shop-type-tag.cityPartner {
  color: #0052d9;
  background: #d9e8ff;
}

.shop-type-tag.slabSupplier {
  color: #07843b;
  background: #d8f5e3;
}

.shop-type-tag.finishedSupplier {
  color: #b65d00;
  background: #ffe7c2;
}

.shop-type-tag.factory {
  color: #c9353f;
  background: #ffe1e2;
}

.level-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 92px;
}

.level-edit-button {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

.level-cell:hover .level-edit-button,
.level-cell:focus-within .level-edit-button {
  opacity: 1;
  pointer-events: auto;
}

.table-actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--td-comp-margin-m);
}

:deep(.t-dialog__body) {
  padding-top: var(--td-comp-paddingTB-l);
}

@media (max-width: 1080px) {
  .filter-row {
    flex-direction: column;
    align-items: stretch;
  }

  .filter-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
</style>
