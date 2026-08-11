<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>租户管理</t-breadcrumb-item>
              <t-breadcrumb-item>门店管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">租户业务开通后生成店铺</t-tag>
        </header>

        <section class="filter-card">
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
                    <t-option v-for="item in tenantOptions" :key="item.name" :label="item.name" :value="item.name" />
                  </t-select>
                </t-form-item>
                <t-form-item label="状态" name="status">
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
        </section>

        <section class="table-card">
          <div class="table-toolbar">
            <t-button theme="primary" @click="openCreateDialog">
              <template #icon><t-icon name="add" /></template>
              新增
            </t-button>
          </div>

          <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
            <template #index="{ rowIndex }">
              {{ (pagination.current - 1) * pagination.pageSize + rowIndex + 1 }}
            </template>
            <template #shopType="{ row }">
              <t-tag :class="['shop-type-tag', row.shopType]" variant="light">
                {{ shopTypeLabel(row.shopType) }}
              </t-tag>
            </template>
            <template #shopLevel="{ row }">
              <div class="level-cell">
                <span>{{ shopLevelLabel(row.shopLevel) }}</span>
                <t-button
                  class="level-edit-button"
                  shape="square"
                  size="small"
                  variant="text"
                  theme="primary"
                  aria-label="快速编辑店铺级别"
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
              <t-tag :theme="row.status === 'normal' ? 'success' : 'danger'" variant="light">
                {{ row.status === 'normal' ? '正常' : '停用' }}
              </t-tag>
            </template>
            <template #createdBy="{ row }">
              {{ row.createdBy || '-' }}
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link theme="primary" hover="color" @click="openEditDialog(row)">编辑</t-link>
                <t-link
                  :theme="row.status === 'normal' ? 'warning' : 'success'"
                  hover="color"
                  @click="openStatusConfirm(row)"
                >
                  {{ row.status === 'normal' ? '停用' : '启用' }}
                </t-link>
                <t-link theme="danger" hover="color" @click="openDeleteConfirm(row)">删除</t-link>
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
      width="620px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
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
            <t-select v-model="formData.shopType" clearable placeholder="请选择">
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
          <t-cascader v-model="formData.region" :options="regionOptions" clearable placeholder="请选择" />
        </t-form-item>
        <t-form-item label="详细地址" name="detailAddress" required-mark>
          <t-input v-model="formData.detailAddress" clearable placeholder="请输入" />
        </t-form-item>
        <t-form-item v-if="dialogMode === 'create'" label="店铺级别" name="shopLevel" required-mark>
          <t-select v-model="formData.shopLevel" clearable placeholder="请选择">
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
    </t-dialog>

    <t-dialog
      v-model:visible="levelDialogVisible"
      header="店铺级别"
      width="420px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleLevelSubmit"
      @cancel="closeLevelDialog"
      @close="closeLevelDialog"
    >
      <t-form ref="levelFormRef" :data="levelFormData" :rules="levelFormRules" label-width="96px" colon>
        <t-form-item label="店铺级别" name="shopLevel" required-mark>
          <t-select v-model="levelFormData.shopLevel" clearable placeholder="请选择">
            <t-option v-for="item in shopLevelOptions" :key="item.value" :label="item.label" :value="item.value" />
          </t-select>
        </t-form-item>
      </t-form>
    </t-dialog>

    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="confirmState.type === 'delete' ? '删除' : confirmState.type === 'disable' ? '停用' : '启用'"
      object-type="店铺"
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
import { computed, onMounted, reactive, ref } from 'vue';

import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminPagination } from '@/components/foundation';
import {
  createStore,
  deleteStore,
  listStores,
  updateStore,
  type StorePayload,
  type StoreRecord,
} from '@/services/stores';
import { listTenants, type TenantRecord } from '@/services/tenants';

type ShopType = 'cityPartner' | 'slabSupplier' | 'finishedSupplier' | 'factory';
type ShopLevel = 'level1' | 'level2' | 'level3';
type StoreStatus = 'normal' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';

interface TenantOption {
  id: number;
  name: string;
  businesses: ShopType[];
}

interface StoreItem {
  id: number;
  shopName: string;
  shopType: ShopType;
  shopLevel: ShopLevel;
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
  shopLevel: ShopLevel | '';
  remark: string;
}

const shopTypeOptions: { label: string; value: ShopType }[] = [
  { label: '城市合伙人', value: 'cityPartner' },
  { label: '大板供应商', value: 'slabSupplier' },
  { label: '成品供应商', value: 'finishedSupplier' },
  { label: '工厂', value: 'factory' },
];

const shopLevelOptions: { label: string; value: ShopLevel }[] = [
  { label: '1级', value: 'level1' },
  { label: '2级', value: 'level2' },
  { label: '3级', value: 'level3' },
];

const tenantOptions = ref<TenantOption[]>([]);

const regionOptions = [
  {
    label: '广东省',
    value: 'guangdong',
    children: [
      {
        label: '广州市',
        value: 'guangzhou',
        children: [
          { label: '天河区', value: 'tianhe' },
          { label: '番禺区', value: 'panyu' },
        ],
      },
      {
        label: '佛山市',
        value: 'foshan',
        children: [
          { label: '禅城区', value: 'chancheng' },
          { label: '南海区', value: 'nanhai' },
        ],
      },
    ],
  },
  {
    label: '浙江省',
    value: 'zhejiang',
    children: [
      {
        label: '杭州市',
        value: 'hangzhou',
        children: [
          { label: '西湖区', value: 'xihu' },
          { label: '滨江区', value: 'binjiang' },
        ],
      },
      {
        label: '宁波市',
        value: 'ningbo',
        children: [
          { label: '鄞州区', value: 'yinzhou' },
          { label: '海曙区', value: 'haishu' },
        ],
      },
    ],
  },
  {
    label: '江苏省',
    value: 'jiangsu',
    children: [
      {
        label: '苏州市',
        value: 'suzhou',
        children: [
          { label: '工业园区', value: 'sip' },
          { label: '吴中区', value: 'wuzhong' },
        ],
      },
      {
        label: '南京市',
        value: 'nanjing',
        children: [
          { label: '建邺区', value: 'jianye' },
          { label: '秦淮区', value: 'qinhuai' },
        ],
      },
    ],
  },
];

const shopTypeLabel = (type: ShopType) => shopTypeOptions.find((item) => item.value === type)?.label ?? '';
const shopLevelLabel = (level: ShopLevel) => shopLevelOptions.find((item) => item.value === level)?.label ?? '';

const regionLabel = (value: string) => {
  for (const province of regionOptions) {
    for (const city of province.children) {
      const district = city.children.find((item) => item.value === value);
      if (district) return `${province.label}${city.label}${district.label}`;
    }
  }
  return '';
};

const tableData = ref<StoreItem[]>([]);
const loading = ref(false);

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 80, align: 'left' },
  { colKey: 'shopName', title: '店铺名称', minWidth: 180, align: 'left' },
  { colKey: 'shopType', title: '店铺类型', width: 130, align: 'center' },
  { colKey: 'shopLevel', title: '店铺级别', width: 140, align: 'center' },
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
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const formData = reactive<StoreForm>({
  tenantName: '',
  shopType: '',
  shopName: '',
  region: '',
  detailAddress: '',
  shopLevel: '',
  remark: '',
});

const formRules: Record<string, FormRule[]> = {
  tenantName: [{ required: true, message: '请选择租户', type: 'error' }],
  shopType: [{ required: true, message: '请选择店铺类型', type: 'error' }],
  shopName: [{ required: true, message: '请输入店铺名称', type: 'error' }],
  region: [{ required: true, message: '请选择门店地址', type: 'error' }],
  detailAddress: [{ required: true, message: '请输入详细地址', type: 'error' }],
  shopLevel: [{ required: true, message: '请选择店铺级别', type: 'error' }],
  remark: [{ max: 100, message: '备注最多可输入100个字符', type: 'error' }],
};

const levelFormRef = ref<FormInstanceFunctions>();
const levelDialogVisible = ref(false);
const levelEditingId = ref<number | null>(null);
const levelFormData = reactive({
  shopLevel: '' as ShopLevel | '',
});
const levelFormRules: Record<string, FormRule[]> = {
  shopLevel: [{ required: true, message: '请选择店铺级别', type: 'error' }],
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

const selectedTenant = computed(() => tenantOptions.value.find((item) => item.name === formData.tenantName));
const availableShopTypeOptions = computed(() => {
  if (!selectedTenant.value) return shopTypeOptions;
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

const normalizeStatus = (status: StoreRecord['status']): StoreStatus => (status === 'disabled' ? 'disabled' : 'normal');

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

const normalizeShopLevel = (value?: string): ShopLevel =>
  shopLevelOptions.some((item) => item.value === value) ? (value as ShopLevel) : 'level1';

const toStoreItem = (record: StoreRecord): StoreItem => {
  const tenant = tenantOptions.value.find((item) => item.id === record.tenantId);
  const detailAddress = record.detailAddress ?? record.address ?? '';

  return {
    id: record.id,
    shopName: record.name,
    shopType: normalizeShopType(record.type),
    shopLevel: normalizeShopLevel(record.shopLevel),
    manager: record.manager ?? '',
    region: record.region ?? '',
    detailAddress,
    address: record.address ?? `${regionLabel(record.region ?? '')}${detailAddress}`,
    tenantName: tenant?.name ?? `租户#${record.tenantId}`,
    status: normalizeStatus(record.status),
    createdAt: formatDateTime(record.createdAt),
    createdBy: record.createdBy ?? '',
    remark: record.remark ?? '',
  };
};

const toStorePayload = (status: StoreStatus, shopLevel: ShopLevel, manager = ''): StorePayload => {
  const tenant = selectedTenant.value;
  if (!tenant || !formData.shopType) {
    throw new Error('请选择租户和店铺类型');
  }

  const detailAddress = formData.detailAddress.trim();
  return {
    tenantId: tenant.id,
    name: formData.shopName.trim(),
    type: formData.shopType,
    shopLevel,
    manager,
    region: formData.region,
    detailAddress,
    address: `${regionLabel(formData.region)}${detailAddress}`,
    status: toBackendStatus(status),
    remark: formData.remark.trim(),
  };
};

const toStorePayloadFromItem = (item: StoreItem): StorePayload => {
  const tenant = tenantOptions.value.find((option) => option.name === item.tenantName);
  if (!tenant) {
    throw new Error('未找到门店所属租户');
  }

  return {
    tenantId: tenant.id,
    name: item.shopName,
    type: item.shopType,
    shopLevel: item.shopLevel,
    manager: item.manager,
    region: item.region,
    detailAddress: item.detailAddress,
    address: item.address,
    status: toBackendStatus(item.status),
    remark: item.remark ?? '',
    createdBy: item.createdBy,
  };
};

const loadStorePage = async () => {
  loading.value = true;
  try {
    const [tenants, stores] = await Promise.all([listTenants(), listStores()]);
    tenantOptions.value = tenants.map(toTenantOption);
    tableData.value = stores.map(toStoreItem);
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
  formData.shopLevel = '';
  formData.remark = '';
};

const fillFormData = (row: StoreItem) => {
  formData.tenantName = row.tenantName;
  formData.shopType = row.shopType;
  formData.shopName = row.shopName;
  formData.region = row.region;
  formData.detailAddress = row.detailAddress;
  formData.shopLevel = row.shopLevel;
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
  if (formData.shopType && !availableShopTypeOptions.value.some((item) => item.value === formData.shopType)) {
    formData.shopType = '';
  }
};

const openCreateDialog = () => {
  dialogMode.value = 'create';
  editingId.value = null;
  resetFormData();
  formDialogVisible.value = true;
};

const openEditDialog = (row: StoreItem) => {
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

  if (!formData.region) return;
  try {
    if (dialogMode.value === 'create') {
      if (!formData.shopLevel) return;
      await createStore(toStorePayload('normal', formData.shopLevel));
      await loadStorePage();
      pagination.current = 1;
    } else if (editingId.value) {
      const current = tableData.value.find((item) => item.id === editingId.value);
      await updateStore(
        editingId.value,
        toStorePayload(current?.status ?? 'normal', current?.shopLevel ?? 'level1', current?.manager ?? ''),
      );
      await loadStorePage();
    }

    closeFormDialog();
    if (dialogMode.value === 'create') {
      adminFeedback.created(formData.shopName.trim());
    } else {
      adminFeedback.success('已保存店铺');
    }
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openLevelDialog = (row: StoreItem) => {
  levelEditingId.value = row.id;
  levelFormData.shopLevel = row.shopLevel;
  levelDialogVisible.value = true;
};

const closeLevelDialog = () => {
  levelDialogVisible.value = false;
  levelEditingId.value = null;
  levelFormRef.value?.clearValidate();
};

const handleLevelSubmit = async () => {
  const result = await levelFormRef.value?.validate();
  if (result !== true || !levelFormData.shopLevel) return;

  const target = tableData.value.find((item) => item.id === levelEditingId.value);
  if (!target) return;

  try {
    const updated = await updateStore(
      target.id,
      toStorePayloadFromItem({ ...target, shopLevel: levelFormData.shopLevel }),
    );
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
  const isNormal = row.status === 'normal';
  confirmState.type = isNormal ? 'disable' : 'enable';
  confirmState.row = row;
  confirmState.content = `是否${isNormal ? '停用' : '启用'}店铺“${row.shopName}”？`;
  confirmDialogVisible.value = true;
};

const openDeleteConfirm = (row: StoreItem) => {
  confirmState.type = 'delete';
  confirmState.row = row;
  confirmState.content = `是否删除店铺“${row.shopName}”？`;
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};

const handleConfirm = async () => {
  if (!confirmState.row) return;
  const target = confirmState.row;

  try {
    if (confirmState.type === 'delete') {
      await deleteStore(target.id);
      tableData.value = tableData.value.filter((item) => item.id !== target.id);
    } else {
      const updated = await updateStore(
        confirmState.row.id,
        toStorePayloadFromItem({
          ...confirmState.row,
          status: confirmState.type === 'enable' ? 'normal' : 'disabled',
        }),
      );
      const targetIndex = tableData.value.findIndex((item) => item.id === confirmState.row?.id);
      if (targetIndex !== -1) {
        tableData.value.splice(targetIndex, 1, toStoreItem(updated));
      }
    }

    closeConfirmDialog();
    if (confirmState.type === 'delete') {
      adminFeedback.deleted(target.shopName);
    } else {
      adminFeedback.success(confirmState.type === 'enable' ? '已启用店铺' : '已停用店铺');
    }
    ensureCurrentPage();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

onMounted(loadStorePage);
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
  background: var(--td-bg-color-container);
  border-radius: 6px;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  border: 1px solid var(--td-component-border);
}

.table-card {
  margin-top: var(--td-comp-margin-l);
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
  justify-content: flex-start;
  align-items: center;
  margin-bottom: var(--td-comp-margin-l);
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
