<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>大板管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">全平台共用大板库</t-tag>
        </header>

        <section class="filter-card">
          <t-tabs v-model="activeTab" class="status-tabs" @change="handleTabChange">
            <t-tab-panel v-for="tab in tabs" :key="tab.value" :value="tab.value" :label="tabLabel(tab)" />
          </t-tabs>

          <t-form :data="currentFilter" label-width="44px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="ID">
                  <t-input v-model="currentFilter.id" clearable placeholder="请输入" />
                </t-form-item>
                <t-form-item label="品种">
                  <t-select v-model="currentFilter.variety" clearable placeholder="请选择">
                    <t-option v-for="item in varietyOptions" :key="item" :label="item" :value="item" />
                  </t-select>
                </t-form-item>
                <t-form-item label="产地">
                  <t-select v-model="currentFilter.origin" clearable placeholder="请选择">
                    <t-option v-for="item in originOptions" :key="item" :label="item" :value="item" />
                  </t-select>
                </t-form-item>
                <t-form-item label="纹理">
                  <t-select v-model="currentFilter.texture" clearable placeholder="请选择">
                    <t-option v-for="item in textureOptions" :key="item" :label="item" :value="item" />
                  </t-select>
                </t-form-item>
                <t-form-item label="色系">
                  <t-select v-model="currentFilter.color" clearable placeholder="请选择">
                    <t-option v-for="item in colorOptions" :key="item" :label="item" :value="item" />
                  </t-select>
                </t-form-item>
                <t-form-item label="等级">
                  <t-select v-model="currentFilter.grade" clearable placeholder="请选择">
                    <t-option v-for="item in gradeOptions" :key="item" :label="item" :value="item" />
                  </t-select>
                </t-form-item>
                <t-form-item label="租户">
                  <t-select v-model="currentFilter.tenant" clearable placeholder="请选择">
                    <t-option v-for="item in tenantOptions" :key="item" :label="item" :value="item" />
                  </t-select>
                </t-form-item>
                <t-form-item label="门店">
                  <t-select v-model="currentFilter.store" clearable placeholder="请选择">
                    <t-option v-for="item in storeOptions" :key="item" :label="item" :value="item" />
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
            <div class="toolbar-buttons">
              <t-button
                v-for="button in batchButtons"
                :key="button.action"
                :theme="button.theme"
                :class="button.className"
                @click="handleBatchAction(button.action)"
              >
                <template #icon>
                  <t-icon :name="button.icon" />
                </template>
                {{ button.label }}
              </t-button>
            </div>
            <div class="selection-info">已选 {{ selectedKeys.length }} 项</div>
          </div>

          <t-table row-key="id" :data="pageData" :columns="columns" hover table-layout="fixed">
            <template #selectTitle>
              <t-checkbox
                :checked="pageAllSelected"
                :indeterminate="pagePartiallySelected"
                @change="toggleCurrentPage"
              />
            </template>
            <template #select="{ row }">
              <t-checkbox
                :checked="selectedKeySet.has(row.id)"
                @change="(checked: boolean) => toggleRow(row.id, checked)"
              />
            </template>
            <template #image="{ row }">
              <div class="slab-image">
                <img :src="row.image" :alt="row.name" />
              </div>
            </template>
            <template #slab="{ row }">
              <div class="slab-meta">
                <div class="slab-name">{{ row.name }}</div>
                <div class="slab-code">ID：{{ row.id }}</div>
                <div class="slab-code">编码：{{ row.code }}</div>
              </div>
            </template>
            <template #tenant="{ row }">
              <div class="tenant-cell">
                <span>{{ row.tenant }}</span>
                <span class="store-text">{{ row.store }}</span>
                <div class="tenant-tags">
                  <t-tag
                    v-for="tag in publisherTags(row)"
                    :key="tag.label"
                    :theme="tag.theme"
                    variant="light"
                    class="tenant-tag"
                  >
                    {{ tag.label }}
                  </t-tag>
                </div>
              </div>
            </template>
            <template #price="{ row }">
              <t-link theme="primary" hover="color" @click="openPriceDrawer(row)">查看</t-link>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link
                  v-for="action in rowActions(row)"
                  :key="action.action"
                  :theme="action.theme"
                  hover="color"
                  @click="handleRowAction(action.action, row)"
                >
                  {{ action.label }}
                </t-link>
              </div>
            </template>
          </t-table>

          <AdminPagination
            v-model:current="currentPagination.current"
            v-model:page-size="currentPagination.pageSize"
            :total="paginationTotal"
            :page-size-options="pageSizeOptions"
          />
        </section>
      </main>
    </div>

    <t-dialog
      v-model:visible="productDialogVisible"
      :header="productDialogTitle"
      width="940px"
      placement="center"
      :confirm-btn="productMode === 'view' ? null : '提交商品信息'"
      cancel-btn="取消"
      @confirm="handleProductSubmit"
      @cancel="closeProductDialog"
      @close="closeProductDialog"
    >
      <t-tabs v-model="productTab" class="product-tabs">
        <t-tab-panel value="images" label="图片">
          <div class="upload-grid">
            <button
              v-for="item in uploadItems"
              :key="item.key"
              class="upload-box"
              type="button"
              :disabled="productMode === 'view'"
              @click="handleUploadClick(item)"
            >
              <span v-if="item.required" class="required-star">*</span>
              <strong>{{ item.title }}</strong>
              <t-icon name="add" />
              <span>{{ item.label }}</span>
            </button>
          </div>
        </t-tab-panel>
        <t-tab-panel value="base" label="基础信息">
          <t-form ref="productFormRef" :data="productForm" :rules="productRules" label-width="92px" colon>
            <div class="dialog-form-grid">
              <t-form-item label="品种" name="variety">
                <t-select v-model="productForm.variety" :disabled="productMode === 'view'" placeholder="请选择">
                  <t-option v-for="item in varietyOptions" :key="item" :label="item" :value="item" />
                </t-select>
              </t-form-item>
              <t-form-item label="产地" name="origin">
                <t-select v-model="productForm.origin" :disabled="productMode === 'view'" placeholder="请选择">
                  <t-option v-for="item in originOptions" :key="item" :label="item" :value="item" />
                </t-select>
              </t-form-item>
              <t-form-item label="纹理" name="texture">
                <t-select v-model="productForm.texture" :disabled="productMode === 'view'" placeholder="请选择">
                  <t-option v-for="item in textureOptions" :key="item" :label="item" :value="item" />
                </t-select>
              </t-form-item>
              <t-form-item label="色系" name="color">
                <t-select v-model="productForm.color" :disabled="productMode === 'view'" placeholder="请选择">
                  <t-option v-for="item in colorOptions" :key="item" :label="item" :value="item" />
                </t-select>
              </t-form-item>
              <t-form-item label="等级" name="grade">
                <t-select v-model="productForm.grade" :disabled="productMode === 'view'" placeholder="请选择">
                  <t-option v-for="item in gradeOptions" :key="item" :label="item" :value="item" />
                </t-select>
              </t-form-item>
            </div>
            <div class="section-title">尺寸</div>
            <div class="dimension-grid">
              <t-form-item label="长" name="length">
                <t-input v-model="productForm.length" :disabled="productMode === 'view'" placeholder="请输入" />
              </t-form-item>
              <t-form-item label="宽" name="width">
                <t-input v-model="productForm.width" :disabled="productMode === 'view'" placeholder="请输入" />
              </t-form-item>
              <t-form-item label="高" name="height">
                <t-input v-model="productForm.height" :disabled="productMode === 'view'" placeholder="请输入" />
              </t-form-item>
              <t-form-item label="土误差">
                <t-input v-model="productForm.tolerance" :disabled="productMode === 'view'" placeholder="请输入" />
              </t-form-item>
            </div>
            <div class="section-title">扣角（mm）</div>
            <div class="corner-grid">
              <t-form-item v-for="item in cornerFields" :key="item.key" :label="item.label">
                <t-input v-model="productForm[item.key]" :disabled="productMode === 'view'" placeholder="请输入" />
              </t-form-item>
            </div>
          </t-form>
        </t-tab-panel>
        <t-tab-panel value="sales" label="销售信息">
          <t-form :data="productForm" label-width="96px" colon>
            <div class="dialog-form-grid">
              <t-form-item label="供应商" name="supplier">
                <t-select v-model="productForm.supplier" :disabled="productMode === 'view'" placeholder="请选择">
                  <t-option label="云石供应链" value="云石供应链" />
                  <t-option label="星河矿业" value="星河矿业" />
                  <t-option label="平台自营" value="平台自营" />
                </t-select>
              </t-form-item>
              <t-form-item label="成本价">
                <t-input
                  v-model="productForm.cost"
                  :disabled="productMode === 'view'"
                  placeholder="请输入"
                  @change="recalculateProductPrices"
                />
              </t-form-item>
              <t-form-item label="库存">
                <t-input v-model="productForm.stock" :disabled="productMode === 'view'" placeholder="请输入" />
              </t-form-item>
              <t-form-item label="SKU">
                <t-input v-model="productForm.sku" :disabled="productMode === 'view'" placeholder="请输入" />
              </t-form-item>
            </div>
            <div class="price-editor">
              <div class="price-editor__head">
                <span>阶梯价格</span>
                <span>系数</span>
                <span>价格</span>
              </div>
              <div v-for="item in salesPriceRows" :key="item.key" class="price-editor__row">
                <span>{{ item.label }}</span>
                <t-input
                  v-model="productForm[`${item.key}Ratio`]"
                  :disabled="productMode === 'view'"
                  @change="calculateProductPrice(item.key)"
                />
                <t-input
                  v-model="productForm[`${item.key}Price`]"
                  :disabled="productMode === 'view'"
                  @change="calculateProductRatio(item.key)"
                />
              </div>
            </div>
          </t-form>
        </t-tab-panel>
      </t-tabs>
    </t-dialog>

    <t-drawer
      v-model:visible="priceDrawerVisible"
      header="价格编辑器"
      placement="right"
      size="440px"
      :footer="false"
      @close="closePriceDrawer"
    >
      <div class="drawer-actions">
        <t-button v-if="!priceDrawerReadonly" theme="primary" block @click="saveBatchPrice">
          <template #icon><t-icon name="save" /></template>
          保存
        </t-button>
      </div>
      <div class="price-table">
        <div class="price-table__head">
          <span>价格项</span>
          <span>系数</span>
          <span>价格</span>
        </div>
        <div v-for="row in batchPriceRows" :key="row.label" class="price-table__row">
          <span>{{ row.label }}</span>
          <t-input
            v-model="row.ratio"
            :disabled="priceDrawerReadonly || row.label === '成本价'"
            @change="calculateBatchPrice(row)"
          />
          <t-input
            v-model="row.price"
            :disabled="priceDrawerReadonly || row.label === '成本价'"
            @change="calculateBatchRatio(row)"
          />
        </div>
      </div>
    </t-drawer>

    <t-dialog
      v-model:visible="uploadDialogVisible"
      :header="uploadDialogTitle"
      width="520px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="submitUpload"
      @cancel="closeUploadDialog"
      @close="closeUploadDialog"
    >
      <t-upload
        v-model="uploadFiles"
        :accept="uploadAccept"
        :auto-upload="false"
        :multiple="false"
        :max="1"
        theme="file"
        draggable
      />
    </t-dialog>

    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="confirmAction"
      object-type="大板"
      :object-name="confirmState.row?.name"
      @confirm="handleConfirmSubmit"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
    >
      {{ confirmState.content }}
    </AdminConfirmDialog>

    <t-dialog
      v-model:visible="reasonDialogVisible"
      :header="reasonState.type === 'reject' ? '驳回' : '下架'"
      width="520px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleReasonSubmit"
      @cancel="closeReasonDialog"
      @close="closeReasonDialog"
    >
      <t-form :data="reasonForm" label-width="96px" colon>
        <t-form-item :label="reasonState.type === 'reject' ? '驳回原因' : '下架原因'" required-mark>
          <t-select v-model="reasonForm.reason" placeholder="请选择">
            <t-option
              v-for="item in reasonState.type === 'reject' ? rejectReasons : offShelfReasons"
              :key="item"
              :label="item"
              :value="item"
            />
          </t-select>
        </t-form-item>
        <t-form-item label="详细说明">
          <t-textarea v-model="reasonForm.detail" placeholder="请输入" :autosize="{ minRows: 4, maxRows: 6 }" />
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData, UploadFile } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminPagination } from '@/components/foundation';
import { computed, reactive, ref } from 'vue';
type SlabStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';
type PublisherType = '租户发布' | '平台发布';
type ProductMode = 'create' | 'edit' | 'view';
type RowAction = 'shelf' | 'edit' | 'reject' | 'delete' | 'offShelf' | 'restore' | 'purge';
type BatchAction = 'publish' | 'batchShelf' | 'batchOffShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';
type ConfirmType =
  | 'shelf'
  | 'delete'
  | 'restore'
  | 'purge'
  | 'reject'
  | 'savePrice'
  | 'batchShelf'
  | 'batchRestore'
  | 'batchPurge'
  | 'clearRecycle';
type SalesPriceKey = 'guide' | 'level1' | 'level2' | 'level3';

interface FilterState {
  id: string;
  variety: string;
  origin: string;
  texture: string;
  color: string;
  grade: string;
  tenant: string;
  store: string;
}

interface PriceGroup {
  cost: string;
  guide: string;
  level1: string;
  level2: string;
  level3: string;
}

interface SlabItem {
  id: number;
  code: string;
  image: string;
  name: string;
  size: string;
  origin: string;
  texture: string;
  color: string;
  grade: string;
  tenant: string;
  store: string;
  publisherType: PublisherType;
  price: PriceGroup;
  status: SlabStatus;
  variety: string;
  sku: string;
}

interface ProductForm {
  variety: string;
  origin: string;
  texture: string;
  color: string;
  grade: string;
  length: string;
  width: string;
  height: string;
  tolerance: string;
  corner1Length: string;
  corner1Width: string;
  corner2Length: string;
  corner2Width: string;
  corner3Length: string;
  corner3Width: string;
  corner4Length: string;
  corner4Width: string;
  supplier: string;
  cost: string;
  stock: string;
  sku: string;
  guideRatio: string;
  guidePrice: string;
  level1Ratio: string;
  level1Price: string;
  level2Ratio: string;
  level2Price: string;
  level3Ratio: string;
  level3Price: string;
}

const tabs: { value: SlabStatus; label: string; count?: number }[] = [
  { value: 'warehouse', label: '仓库中', count: 153 },
  { value: 'selling', label: '出售中', count: 10589 },
  { value: 'offShelf', label: '已下架', count: 856 },
  { value: 'soldOut', label: '已售完' },
  { value: 'recycle', label: '回收站' },
];

const varietyOptions = ['雪花白', '鱼肚白', '云朵拉灰', '黑金沙', '雅士白'];
const originOptions = ['意大利', '希腊', '土耳其', '广东云浮', '福建水头'];
const textureOptions = ['细纹', '直纹', '乱纹', '山水纹', '晶体纹'];
const colorOptions = ['白色系', '灰色系', '黑色系', '棕色系', '绿色系'];
const gradeOptions = ['A+', 'A', 'B', 'C'];
const tenantOptions = ['云石供应链', '平台自营', '星河矿业', '南山石材'];
const storeOptions = ['杭州旗舰店', '深圳设计中心', '云浮仓', '平台仓'];
const pageSizeOptions = [10, 20, 50];
const rejectReasons = ['图片不清晰', '资料不完整', '规格填写异常', '价格信息缺失'];
const offShelfReasons = ['库存异常', '价格调整', '图片更新', '供应商申请'];

const createStoneImage = (seed: number) => {
  const palettes = [
    ['#f8fafc', '#c9d4df', '#52677f'],
    ['#fff7ed', '#d6a06f', '#56606d'],
    ['#ecfeff', '#9eb7b8', '#1f2937'],
    ['#f5f3ff', '#c4b5fd', '#57534e'],
  ];
  const [start, middle, end] = palettes[seed % palettes.length];
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${start}"/>
          <stop offset="0.52" stop-color="${middle}"/>
          <stop offset="1" stop-color="${end}"/>
        </linearGradient>
      </defs>
      <rect width="180" height="180" rx="12" fill="url(#bg)"/>
      <path d="M-8 42 C34 18 58 62 96 40 C132 20 146 36 188 12" fill="none" stroke="#fff" stroke-opacity=".46" stroke-width="8"/>
      <path d="M-12 126 C28 94 72 144 112 108 C142 82 164 102 192 76" fill="none" stroke="#fff" stroke-opacity=".34" stroke-width="7"/>
      <path d="M18 184 C54 126 86 164 112 126 C134 94 158 112 176 86" fill="none" stroke="#172033" stroke-opacity=".16" stroke-width="5"/>
    </svg>
  `)}`;
};

const makeFilterState = (): FilterState => ({
  id: '',
  variety: '',
  origin: '',
  texture: '',
  color: '',
  grade: '',
  tenant: '',
  store: '',
});

const makeProductForm = (): ProductForm => ({
  variety: '',
  origin: '',
  texture: '',
  color: '',
  grade: '',
  length: '',
  width: '',
  height: '',
  tolerance: '',
  corner1Length: '',
  corner1Width: '',
  corner2Length: '',
  corner2Width: '',
  corner3Length: '',
  corner3Width: '',
  corner4Length: '',
  corner4Width: '',
  supplier: '',
  cost: '',
  stock: '',
  sku: '',
  guideRatio: '1.60',
  guidePrice: '',
  level1Ratio: '1.45',
  level1Price: '',
  level2Ratio: '1.30',
  level2Price: '',
  level3Ratio: '1.18',
  level3Price: '',
});

const activeTab = ref<SlabStatus>('warehouse');
const selectedKeys = ref<number[]>([]);
const productDialogVisible = ref(false);
const productMode = ref<ProductMode>('create');
const productTab = ref('images');
const editingRowId = ref<number | null>(null);
const productFormRef = ref<FormInstanceFunctions>();
const productForm = reactive<ProductForm>(makeProductForm());
const priceDrawerVisible = ref(false);
const priceDrawerRowId = ref<number | null>(null);
const confirmDialogVisible = ref(false);
const reasonDialogVisible = ref(false);
const uploadDialogVisible = ref(false);
const uploadDialogTitle = ref('');
const uploadAccept = ref('image/*');
const uploadFiles = ref<UploadFile[]>([]);

const filters = reactive<Record<SlabStatus, FilterState>>({
  warehouse: makeFilterState(),
  selling: makeFilterState(),
  offShelf: makeFilterState(),
  soldOut: makeFilterState(),
  recycle: makeFilterState(),
});
const appliedFilters = reactive<Record<SlabStatus, FilterState>>({
  warehouse: makeFilterState(),
  selling: makeFilterState(),
  offShelf: makeFilterState(),
  soldOut: makeFilterState(),
  recycle: makeFilterState(),
});

const paginations = reactive<Record<SlabStatus, { current: number; pageSize: number }>>({
  warehouse: { current: 1, pageSize: 10 },
  selling: { current: 1, pageSize: 10 },
  offShelf: { current: 1, pageSize: 10 },
  soldOut: { current: 1, pageSize: 10 },
  recycle: { current: 1, pageSize: 10 },
});

const tableData = ref<SlabItem[]>(
  Array.from({ length: 30 }, (_, index) => {
    const statuses: SlabStatus[] = ['warehouse', 'selling', 'offShelf', 'soldOut', 'recycle'];
    const status = statuses[index % statuses.length];
    const publisherTypes: PublisherType[] = ['租户发布', '平台发布'];
    const variety = varietyOptions[index % varietyOptions.length];
    return {
      id: 860100 + index,
      code: `DB-${202607}${String(index + 1).padStart(3, '0')}`,
      image: createStoneImage(index),
      name: `${variety}大板 ${String(index + 1).padStart(2, '0')}`,
      size: `${2600 + index * 20} x ${1600 + index * 10} x 18mm`,
      origin: originOptions[index % originOptions.length],
      texture: textureOptions[index % textureOptions.length],
      color: colorOptions[index % colorOptions.length],
      grade: gradeOptions[index % gradeOptions.length],
      tenant: tenantOptions[index % tenantOptions.length],
      store: storeOptions[index % storeOptions.length],
      publisherType: publisherTypes[index % publisherTypes.length],
      price: {
        cost: String(820 + index * 12),
        guide: String(1280 + index * 18),
        level1: String(1180 + index * 16),
        level2: String(1080 + index * 14),
        level3: String(980 + index * 12),
      },
      status,
      variety,
      sku: `SKU-SLAB-${index + 1}`,
    };
  }),
);

const confirmState = reactive<{
  type: ConfirmType;
  row: SlabItem | null;
  content: string;
}>({
  type: 'shelf',
  row: null,
  content: '',
});
const confirmAction = computed(() => {
  const actionMap: Record<ConfirmType, string> = {
    shelf: '上架',
    delete: '删除',
    restore: '恢复',
    purge: '彻底删除',
    reject: '驳回',
    savePrice: '保存价格',
    batchShelf: '批量上架',
    batchRestore: '批量恢复',
    batchPurge: '批量彻底删除',
    clearRecycle: '清空回收站',
  };
  return actionMap[confirmState.type];
});

const reasonState = reactive<{
  type: 'reject' | 'offShelf';
  row: SlabItem | null;
}>({
  type: 'reject',
  row: null,
});

const reasonForm = reactive({
  reason: '',
  detail: '',
});

const batchPriceRows = reactive([
  { label: '成本价', ratio: '1.00', price: '820' },
  { label: '指导价', ratio: '1.60', price: '1280' },
  { label: '1级合伙人', ratio: '1.45', price: '1180' },
  { label: '2级合伙人', ratio: '1.30', price: '1080' },
  { label: '3级合伙人', ratio: '1.18', price: '980' },
]);

const uploadItems = [
  { key: 'main', title: '1:1主图', label: '点击上传图片', required: true, accept: 'image/*' },
  { key: 'scan', title: '扫描图', label: '点击上传图片', required: true, accept: 'image/*' },
  { key: 'design', title: '设计图', label: '点击上传图片', required: true, accept: 'image/*' },
  { key: 'video', title: '商品视频', label: '点击上传视频', required: false, accept: 'video/*' },
];

const cornerFields: { key: keyof ProductForm; label: string }[] = [
  { key: 'corner1Length', label: '扣角1长' },
  { key: 'corner1Width', label: '扣角1宽' },
  { key: 'corner2Length', label: '扣角2长' },
  { key: 'corner2Width', label: '扣角2宽' },
  { key: 'corner3Length', label: '扣角3长' },
  { key: 'corner3Width', label: '扣角3宽' },
  { key: 'corner4Length', label: '扣角4长' },
  { key: 'corner4Width', label: '扣角4宽' },
];

const salesPriceRows: { key: SalesPriceKey; label: string }[] = [
  { key: 'guide', label: '指导价' },
  { key: 'level1', label: '1级合伙人' },
  { key: 'level2', label: '2级合伙人' },
  { key: 'level3', label: '3级合伙人' },
];

const productRules: Record<string, FormRule[]> = {
  variety: [{ required: true, message: '请选择品种', type: 'error' }],
  origin: [{ required: true, message: '请选择产地', type: 'error' }],
  texture: [{ required: true, message: '请选择纹理', type: 'error' }],
  color: [{ required: true, message: '请选择色系', type: 'error' }],
  grade: [{ required: true, message: '请选择等级', type: 'error' }],
  length: [{ required: true, message: '请输入长度', type: 'error' }],
  width: [{ required: true, message: '请输入宽度', type: 'error' }],
  height: [{ required: true, message: '请输入高度', type: 'error' }],
};

const columns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  const baseColumns: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'select', title: 'selectTitle', width: 48, align: 'center' },
    { colKey: 'image', title: '商品主图', width: 96, align: 'center' },
    { colKey: 'slab', title: '大板名称/ID/编码', minWidth: 220 },
    { colKey: 'size', title: '尺寸', width: 170 },
    { colKey: 'origin', title: '产地', width: 110 },
    { colKey: 'texture', title: '纹理', width: 110 },
    { colKey: 'color', title: '色系', width: 110 },
    { colKey: 'grade', title: '等级', width: 88, align: 'center' },
    { colKey: 'tenant', title: '租户/门店', width: 180 },
    { colKey: 'price', title: '价格', width: 150 },
  ];

  if (activeTab.value !== 'soldOut') {
    baseColumns.push({ colKey: 'operation', title: '操作', width: 230, align: 'left', fixed: 'right' });
  }

  return baseColumns;
});

const currentFilter = computed(() => filters[activeTab.value]);
const currentAppliedFilter = computed(() => appliedFilters[activeTab.value]);
const currentPagination = computed(() => paginations[activeTab.value]);
const selectedKeySet = computed(() => new Set(selectedKeys.value));
const currentPageIds = computed(() => pageData.value.map((item) => item.id));
const pageAllSelected = computed(
  () => currentPageIds.value.length > 0 && currentPageIds.value.every((id) => selectedKeySet.value.has(id)),
);
const pagePartiallySelected = computed(
  () => currentPageIds.value.some((id) => selectedKeySet.value.has(id)) && !pageAllSelected.value,
);
const priceDrawerReadonly = computed(() => activeTab.value === 'soldOut');
const productDialogTitle = computed(() => {
  if (productMode.value === 'create') return '发布商品';
  if (productMode.value === 'edit') return '编辑商品';
  return '查看商品';
});

const filteredData = computed(() => {
  const filter = currentAppliedFilter.value;
  return tableData.value.filter((item) => {
    const statusMatched = item.status === activeTab.value;
    const idMatched = !filter.id || String(item.id).includes(filter.id.trim());
    const varietyMatched = !filter.variety || item.variety === filter.variety;
    const originMatched = !filter.origin || item.origin === filter.origin;
    const textureMatched = !filter.texture || item.texture === filter.texture;
    const colorMatched = !filter.color || item.color === filter.color;
    const gradeMatched = !filter.grade || item.grade === filter.grade;
    const tenantMatched = !filter.tenant || item.tenant === filter.tenant;
    const storeMatched = !filter.store || item.store === filter.store;
    return (
      statusMatched &&
      idMatched &&
      varietyMatched &&
      originMatched &&
      textureMatched &&
      colorMatched &&
      gradeMatched &&
      tenantMatched &&
      storeMatched
    );
  });
});

const pageData = computed(() => {
  const start = (currentPagination.value.current - 1) * currentPagination.value.pageSize;
  return filteredData.value.slice(start, start + currentPagination.value.pageSize);
});

const paginationTotal = computed(() => filteredData.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / currentPagination.value.pageSize), 1));
const batchButtons = computed(() => {
  const map: Record<
    SlabStatus,
    { label: string; action: BatchAction; theme: 'primary' | 'danger' | 'default'; icon: string; className?: string }[]
  > = {
    warehouse: [
      { label: '发布商品', action: 'publish', theme: 'primary', icon: 'add' },
      { label: '批量上架', action: 'batchShelf', theme: 'primary', icon: 'upload' },
    ],
    selling: [
      { label: '发布商品', action: 'publish', theme: 'primary', icon: 'add' },
      { label: '批量下架', action: 'batchOffShelf', theme: 'default', icon: 'download', className: 'brown-button' },
    ],
    offShelf: [{ label: '批量放回到仓库', action: 'batchRestore', theme: 'primary', icon: 'rollback' }],
    soldOut: [],
    recycle: [
      { label: '批量放回到仓库', action: 'batchRestore', theme: 'primary', icon: 'rollback' },
      { label: '批量彻底删除', action: 'batchPurge', theme: 'danger', icon: 'delete', className: 'dark-red-button' },
      { label: '清空回收站', action: 'clearRecycle', theme: 'danger', icon: 'clear' },
    ],
  };
  return map[activeTab.value];
});

const tabLabel = (tab: { label: string; count?: number }) => (tab.count ? `${tab.label} ${tab.count}` : tab.label);

const publisherTags = (row: SlabItem): { label: string; theme: 'primary' | 'success' | 'warning' }[] => {
  if (activeTab.value === 'offShelf' || activeTab.value === 'recycle') {
    return [
      { label: '平台发布', theme: 'success' },
      { label: '外部供应商', theme: 'warning' },
    ];
  }
  if (row.publisherType === '租户发布') {
    return [{ label: '租户发布', theme: 'primary' }];
  }
  return [
    { label: '平台发布', theme: 'success' },
    { label: '外部供应商', theme: 'warning' },
  ];
};

const rowActions = (
  row: SlabItem,
): { label: string; action: RowAction; theme: 'primary' | 'warning' | 'danger' | 'default' }[] => {
  if (activeTab.value === 'warehouse') {
    if (row.publisherType === '租户发布') {
      return [
        { label: '上架', action: 'shelf', theme: 'primary' },
        { label: '编辑', action: 'edit', theme: 'primary' },
        { label: '驳回', action: 'reject', theme: 'warning' },
      ];
    }
    return [
      { label: '上架', action: 'shelf', theme: 'primary' },
      { label: '编辑', action: 'edit', theme: 'primary' },
      { label: '删除', action: 'delete', theme: 'danger' },
    ];
  }
  if (activeTab.value === 'selling') {
    const actions: { label: string; action: RowAction; theme: 'primary' | 'warning' | 'danger' | 'default' }[] =
      row.publisherType === '租户发布'
        ? [
            { label: '编辑', action: 'edit', theme: 'primary' },
            { label: '驳回', action: 'reject', theme: 'warning' },
          ]
        : [{ label: '下架', action: 'offShelf', theme: 'warning' }];
    if (row.publisherType === '平台发布') {
      actions.push(
        { label: '编辑', action: 'edit', theme: 'primary' },
        { label: '删除', action: 'delete', theme: 'danger' },
      );
    }
    return actions;
  }
  if (activeTab.value === 'offShelf') {
    return [
      { label: '放回到仓库', action: 'restore', theme: 'primary' },
      { label: '编辑', action: 'edit', theme: 'primary' },
      { label: '删除', action: 'delete', theme: 'danger' },
    ];
  }
  if (activeTab.value === 'soldOut') {
    return [];
  }
  return [
    { label: '放回到仓库', action: 'restore', theme: 'primary' },
    { label: '彻底删除', action: 'purge', theme: 'danger' },
  ];
};

const handleTabChange = () => {
  selectedKeys.value = [];
  ensureCurrentPage();
};

const handleSearch = () => {
  Object.assign(currentAppliedFilter.value, currentFilter.value);
  currentPagination.value.current = 1;
};

const handleReset = () => {
  Object.assign(currentFilter.value, makeFilterState());
  handleSearch();
};

const ensureCurrentPage = () => {
  if (currentPagination.value.current > pageCount.value) {
    currentPagination.value.current = pageCount.value;
  }
};

const toggleRow = (id: number, checked: boolean) => {
  if (checked) {
    selectedKeys.value = Array.from(new Set([...selectedKeys.value, id]));
  } else {
    selectedKeys.value = selectedKeys.value.filter((item) => item !== id);
  }
};

const toggleCurrentPage = (checked: boolean) => {
  if (checked) {
    selectedKeys.value = Array.from(new Set([...selectedKeys.value, ...currentPageIds.value]));
    return;
  }
  selectedKeys.value = selectedKeys.value.filter((id) => !currentPageIds.value.includes(id));
};

const toNumber = (value: string) => {
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatPrice = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const normalizeDecimal = (value: string) => {
  const match = String(value)
    .replace(/[^\d.]/g, '')
    .match(/^(\d*)(?:\.(\d{0,2})?)?/);
  if (!match) return '';
  const integer = match[1] || '0';
  const decimal = match[2];
  return decimal === undefined ? integer : `${integer}.${decimal}`;
};

const priceKey = (key: SalesPriceKey) => `${key}Price` as keyof ProductForm;
const ratioKey = (key: SalesPriceKey) => `${key}Ratio` as keyof ProductForm;

const calculateProductPrice = (key: SalesPriceKey) => {
  const cost = toNumber(productForm.cost);
  const ratio = toNumber(productForm[ratioKey(key)]);
  if (!cost || !ratio) return;
  productForm[priceKey(key)] = formatPrice(cost * ratio);
};

const calculateProductRatio = (key: SalesPriceKey) => {
  const cost = toNumber(productForm.cost);
  const price = toNumber(productForm[priceKey(key)]);
  if (!cost || !price) return;
  productForm[ratioKey(key)] = (price / cost).toFixed(2);
};

const recalculateProductPrices = () => {
  salesPriceRows.forEach((item) => calculateProductPrice(item.key));
};

const calculateBatchPrice = (row: { label: string; ratio: string; price: string }) => {
  if (row.label === '成本价') {
    row.ratio = '1.00';
    batchPriceRows.slice(1).forEach((item) => calculateBatchPrice(item));
    return;
  }
  row.ratio = normalizeDecimal(row.ratio);
  const cost = toNumber(batchPriceRows[0].price);
  const ratio = toNumber(row.ratio);
  if (!cost || !ratio) return;
  row.price = formatPrice(cost * ratio);
};

const calculateBatchRatio = (row: { label: string; ratio: string; price: string }) => {
  if (row.label === '成本价') {
    row.ratio = '1.00';
    batchPriceRows.slice(1).forEach((item) => calculateBatchPrice(item));
    return;
  }
  row.price = normalizeDecimal(row.price);
  const cost = toNumber(batchPriceRows[0].price);
  const price = toNumber(row.price);
  if (!cost || !price) return;
  row.ratio = (price / cost).toFixed(2);
};

const fillPriceRows = (row: SlabItem) => {
  batchPriceRows[0].price = row.price.cost;
  batchPriceRows[0].ratio = '1.00';
  batchPriceRows[1].price = row.price.guide;
  batchPriceRows[2].price = row.price.level1;
  batchPriceRows[3].price = row.price.level2;
  batchPriceRows[4].price = row.price.level3;
  batchPriceRows.slice(1).forEach((item) => calculateBatchRatio(item));
};

const openPriceDrawer = (row: SlabItem) => {
  priceDrawerRowId.value = row.id;
  fillPriceRows(row);
  priceDrawerVisible.value = true;
};

const resetProductForm = () => {
  Object.assign(productForm, makeProductForm());
};

const fillProductForm = (row: SlabItem) => {
  const [length = '', width = '', height = ''] = row.size.replace('mm', '').split(' x ');
  Object.assign(productForm, {
    variety: row.variety,
    origin: row.origin,
    texture: row.texture,
    color: row.color,
    grade: row.grade,
    length,
    width,
    height,
    tolerance: '2mm',
    corner1Length: length,
    corner1Width: width,
    corner2Length: length,
    corner2Width: width,
    corner3Length: length,
    corner3Width: width,
    corner4Length: length,
    corner4Width: width,
    supplier: row.tenant,
    cost: row.price.cost,
    stock: row.status === 'soldOut' ? '0' : '1',
    sku: row.sku,
    guideRatio: '1.60',
    guidePrice: row.price.guide,
    level1Ratio: '1.45',
    level1Price: row.price.level1,
    level2Ratio: '1.30',
    level2Price: row.price.level2,
    level3Ratio: '1.18',
    level3Price: row.price.level3,
  });
  salesPriceRows.forEach((item) => calculateProductRatio(item.key));
};

const openProductDialog = (mode: ProductMode, row?: SlabItem) => {
  productMode.value = mode;
  productTab.value = mode === 'view' ? 'sales' : 'images';
  editingRowId.value = row?.id ?? null;
  resetProductForm();
  if (row) fillProductForm(row);
  productDialogVisible.value = true;
};

const closeProductDialog = () => {
  productDialogVisible.value = false;
  productFormRef.value?.clearValidate();
};

const handleProductSubmit = async () => {
  if (productMode.value === 'view') {
    closeProductDialog();
    return;
  }
  if (!productForm.variety || !productForm.origin || !productForm.texture || !productForm.color || !productForm.grade) {
    productTab.value = 'base';
    adminFeedback.warning('请完善基础信息');
    return;
  }
  if (productMode.value === 'create') {
    const nextId = Math.max(...tableData.value.map((item) => item.id), 860100) + 1;
    tableData.value.unshift({
      id: nextId,
      code: `DB-${nextId}`,
      image: createStoneImage(nextId),
      name: `${productForm.variety}大板`,
      size: `${productForm.length} x ${productForm.width} x ${productForm.height}mm`,
      origin: productForm.origin,
      texture: productForm.texture,
      color: productForm.color,
      grade: productForm.grade,
      tenant: productForm.supplier || '平台自营',
      store: '平台仓',
      publisherType: '平台发布',
      price: {
        cost: productForm.cost || '0',
        guide: productForm.guidePrice || '0',
        level1: productForm.level1Price || '0',
        level2: productForm.level2Price || '0',
        level3: productForm.level3Price || '0',
      },
      status: 'warehouse',
      variety: productForm.variety,
      sku: productForm.sku || `SKU-SLAB-${nextId}`,
    });
    activeTab.value = 'warehouse';
    paginations.warehouse.current = 1;
  } else if (editingRowId.value) {
    const target = tableData.value.find((item) => item.id === editingRowId.value);
    if (target) {
      target.name = `${productForm.variety}大板`;
      target.size = `${productForm.length} x ${productForm.width} x ${productForm.height}mm`;
      target.origin = productForm.origin;
      target.texture = productForm.texture;
      target.color = productForm.color;
      target.grade = productForm.grade;
      target.tenant = productForm.supplier || target.tenant;
      target.variety = productForm.variety;
      target.sku = productForm.sku;
      target.price = {
        cost: productForm.cost,
        guide: productForm.guidePrice,
        level1: productForm.level1Price,
        level2: productForm.level2Price,
        level3: productForm.level3Price,
      };
    }
  }
  closeProductDialog();
  adminFeedback.success('商品信息已提交');
};

const handleUploadClick = (item: (typeof uploadItems)[number]) => {
  if (productMode.value === 'view') return;
  uploadDialogTitle.value = item.title;
  uploadAccept.value = item.accept;
  uploadFiles.value = [];
  uploadDialogVisible.value = true;
};

const closeUploadDialog = () => {
  uploadDialogVisible.value = false;
};

const submitUpload = () => {
  closeUploadDialog();
  adminFeedback.success('上传素材已选择');
};

const handleBatchAction = (action: BatchAction) => {
  if (action === 'publish') {
    openProductDialog('create');
    return;
  }
  if (action === 'batchShelf') {
    if (!selectedKeys.value.length) {
      adminFeedback.warning('请先选择大板');
      return;
    }
    openConfirm('batchShelf', null, '是否批量上架所选大板？');
    return;
  }
  if (action === 'batchOffShelf') {
    if (!selectedKeys.value.length) {
      adminFeedback.warning('请先选择大板');
      return;
    }
    selectedKeys.value.forEach((id) => {
      const row = tableData.value.find((item) => item.id === id);
      if (row) row.status = 'offShelf';
    });
    selectedKeys.value = [];
    adminFeedback.success('批量下架成功');
    return;
  }
  if (action === 'batchRestore') {
    if (!selectedKeys.value.length) {
      adminFeedback.warning('请先选择大板');
      return;
    }
    openConfirm('batchRestore', null, '是否批量放回到仓库？');
    return;
  }
  if (action === 'batchPurge') {
    if (!selectedKeys.value.length) {
      adminFeedback.warning('请先选择大板');
      return;
    }
    openConfirm('batchPurge', null, '是否批量彻底删除所选大板？');
    return;
  }
  openConfirm('clearRecycle', null, '是否清空回收站？');
};

const handleRowAction = (action: RowAction, row: SlabItem) => {
  if (action === 'edit') openProductDialog('edit', row);
  if (action === 'shelf') openConfirm('shelf', row, `是否上架大板“${row.name}”？`);
  if (action === 'delete') openConfirm('delete', row, `是否删除大板“${row.name}”？`);
  if (action === 'restore') openConfirm('restore', row, `是否放回到仓库“${row.name}”？`);
  if (action === 'purge') openConfirm('purge', row, `是否彻底删除大板“${row.name}”？`);
  if (action === 'reject') openReasonDialog('reject', row);
  if (action === 'offShelf') openReasonDialog('offShelf', row);
};

const openConfirm = (type: ConfirmType, row: SlabItem | null, content: string) => {
  confirmState.type = type;
  confirmState.row = row;
  confirmState.content = content;
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};

const handleConfirmSubmit = () => {
  const row = confirmState.row;
  if (confirmState.type === 'shelf' && row) row.status = 'selling';
  if (confirmState.type === 'delete' && row) row.status = 'recycle';
  if (confirmState.type === 'restore' && row) row.status = 'warehouse';
  if (confirmState.type === 'reject' && row) row.status = 'recycle';
  if (confirmState.type === 'savePrice' && row) {
    row.price = {
      cost: batchPriceRows[0].price,
      guide: batchPriceRows[1].price,
      level1: batchPriceRows[2].price,
      level2: batchPriceRows[3].price,
      level3: batchPriceRows[4].price,
    };
    closePriceDrawer();
  }
  if (confirmState.type === 'purge' && row) {
    tableData.value = tableData.value.filter((item) => item.id !== row.id);
  }
  if (confirmState.type === 'batchRestore') {
    tableData.value.forEach((item) => {
      if (selectedKeys.value.includes(item.id)) item.status = 'warehouse';
    });
  }
  if (confirmState.type === 'batchShelf') {
    tableData.value.forEach((item) => {
      if (selectedKeys.value.includes(item.id)) item.status = 'selling';
    });
  }
  if (confirmState.type === 'batchPurge') {
    tableData.value = tableData.value.filter((item) => !selectedKeys.value.includes(item.id));
  }
  if (confirmState.type === 'clearRecycle') {
    tableData.value = tableData.value.filter((item) => item.status !== 'recycle');
  }
  if (confirmState.type !== 'savePrice') {
    selectedKeys.value = [];
    ensureCurrentPage();
  }
  closeConfirmDialog();
  adminFeedback.success('大板状态已更新');
};

const openReasonDialog = (type: 'reject' | 'offShelf', row: SlabItem) => {
  reasonState.type = type;
  reasonState.row = row;
  reasonForm.reason = '';
  reasonForm.detail = '';
  reasonDialogVisible.value = true;
};

const closeReasonDialog = () => {
  reasonDialogVisible.value = false;
  reasonState.row = null;
};

const handleReasonSubmit = () => {
  if (!reasonForm.reason) {
    adminFeedback.warning('请选择原因');
    return;
  }
  if (reasonState.type === 'offShelf' && reasonState.row) {
    reasonState.row.status = 'offShelf';
    ensureCurrentPage();
    closeReasonDialog();
    adminFeedback.success('大板下架原因已提交');
    return;
  }
  if (reasonState.type === 'reject' && reasonState.row) {
    const row = reasonState.row;
    closeReasonDialog();
    openConfirm('reject', row, `是否驳回大板“${row.name}”？`);
    return;
  }
};

const closePriceDrawer = () => {
  priceDrawerVisible.value = false;
  priceDrawerRowId.value = null;
};

const saveBatchPrice = () => {
  const target = tableData.value.find((item) => item.id === priceDrawerRowId.value);
  if (target) {
    openConfirm('savePrice', target, `是否保存大板“${target.name}”的价格？`);
  }
};
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
  background: var(--td-bg-color-page);
}

.side-nav {
  width: 248px;
  flex-shrink: 0;
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-s) 0;
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-component-border);
}

.brand {
  width: 224px;
  height: 100%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.brand-logo {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: #fff;
  background: var(--td-brand-color);
  font: var(--td-font-title-small);
}

.brand-title {
  color: var(--td-text-color-primary);
  font: var(--td-font-title-medium);
}

.brand-subtitle {
  margin-top: 2px;
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
}

.top-actions {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.user-entry {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  padding: 0 var(--td-comp-paddingLR-s);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}

.page {
  min-width: 0;
  flex: 1;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xxl);
}

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

.status-tabs {
  margin-bottom: var(--td-comp-margin-l);
}

.filter-row {
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  gap: var(--td-comp-margin-l);
}

.filter-fields {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--td-comp-margin-m);
}

.filter-fields :deep(.t-form__item) {
  width: 156px;
  margin-bottom: 0;
}

.filter-actions {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
}

.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.toolbar-buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-comp-margin-s);
  min-height: 32px;
}

.selection-info {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}

.brown-button {
  color: #fff;
  background: #8b5e34;
  border-color: #8b5e34;
}

.dark-red-button {
  color: #fff;
  background: #8f1d2c;
  border-color: #8f1d2c;
}

.slab-image {
  width: 64px;
  height: 64px;
  display: inline-flex;
  overflow: hidden;
  border-radius: 6px;
  border: 1px solid var(--td-component-border);
  background: var(--td-bg-color-secondarycontainer);
}

.slab-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.slab-meta {
  min-width: 0;
}

.slab-name {
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
}

.slab-code,
.store-text,
.price-cell span {
  display: block;
  margin-top: 4px;
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
}

.tenant-cell {
  display: grid;
  gap: 4px;
}

.tenant-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.tenant-tag {
  width: fit-content;
  max-width: 100%;
}

.price-cell {
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-s);
}

.product-tabs {
  min-height: 460px;
}

.upload-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--td-comp-margin-l);
  padding-top: var(--td-comp-paddingTB-l);
}

.upload-box {
  height: 168px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--td-comp-margin-s);
  color: var(--td-text-color-secondary);
  cursor: pointer;
  border-radius: 6px;
  border: 1px dashed var(--td-component-border);
  background: var(--td-bg-color-secondarycontainer);
}

.upload-box:disabled {
  cursor: default;
}

.upload-box:hover:not(:disabled) {
  color: var(--td-brand-color);
  border-color: var(--td-brand-color);
}

.required-star {
  position: absolute;
  top: 12px;
  left: 12px;
  color: var(--td-error-color);
}

.dialog-form-grid,
.dimension-grid,
.corner-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--td-comp-margin-m) var(--td-comp-margin-l);
  padding-top: var(--td-comp-paddingTB-l);
}

.dimension-grid,
.corner-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding-top: 0;
}

.section-title {
  margin: var(--td-comp-margin-l) 0 var(--td-comp-margin-s);
  color: var(--td-text-color-primary);
  font: var(--td-font-title-small);
}

.price-editor,
.price-table {
  margin-top: var(--td-comp-margin-l);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
  overflow: hidden;
}

.price-editor__head,
.price-editor__row,
.price-table__head,
.price-table__row {
  display: grid;
  grid-template-columns: 1fr 120px 140px;
  align-items: center;
  gap: var(--td-comp-margin-m);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  border-bottom: 1px solid var(--td-component-border);
}

.price-editor__head,
.price-table__head {
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-secondarycontainer);
  font: var(--td-font-body-medium);
}

.price-editor__row:last-child,
.price-table__row:last-child {
  border-bottom: 0;
}

.drawer-actions {
  margin-bottom: var(--td-comp-margin-l);
}

@media (max-width: 1100px) {
  .upload-grid,
  .dimension-grid,
  .corner-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .top-nav {
    height: auto;
    align-items: stretch;
    flex-direction: column;
    padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-l);
    gap: var(--td-comp-margin-s);
  }

  .brand {
    width: 100%;
    height: 40px;
  }

  .top-actions {
    width: 100%;
    justify-content: space-between;
  }

  .admin-shell {
    display: block;
    min-height: auto;
  }

  .side-nav {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid var(--td-component-border);
  }

  .page {
    padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  }

  .page-header,
  .filter-row,
  .table-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .filter-fields,
  .filter-actions {
    width: 100%;
  }

  .filter-fields {
    gap: var(--td-comp-margin-s);
  }

  .filter-fields :deep(.t-form__item) {
    width: calc(50% - var(--td-comp-margin-s) / 2);
  }

  .filter-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 640px) {
  .filter-fields :deep(.t-form__item) {
    width: 100%;
  }
}
</style>
