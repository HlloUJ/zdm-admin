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
                <div class="filter-primary-row">
                  <t-form-item label="大板" class="slab-keyword-filter">
                    <t-input v-model="currentFilter.keyword" clearable placeholder="大板名称/ID/编码" />
                  </t-form-item>
                  <t-form-item label="品种">
                    <t-select v-model="currentFilter.variety" clearable filterable placeholder="请选择">
                      <t-option v-for="item in varietyOptions" :key="item" :label="item" :value="item" />
                    </t-select>
                  </t-form-item>
                  <t-form-item label="产地">
                    <t-select v-model="currentFilter.origin" clearable filterable placeholder="请选择">
                      <t-option v-for="item in originOptions" :key="item" :label="item" :value="item" />
                    </t-select>
                  </t-form-item>
                  <t-form-item label="纹理">
                    <t-select v-model="currentFilter.texture" clearable filterable placeholder="请选择">
                      <t-option v-for="item in textureFilterOptions" :key="item" :label="item" :value="item" />
                    </t-select>
                  </t-form-item>
                  <t-form-item label="色系">
                    <t-cascader
                      v-model="currentFilter.color"
                      :options="colorFilterCascaderOptions"
                      :show-all-levels="false"
                      :check-strictly="false"
                      clearable
                      filterable
                      placeholder="请选择"
                      trigger="hover"
                      value-mode="onlyLeaf"
                      value-type="single"
                    />
                  </t-form-item>
                  <t-form-item label="等级">
                    <t-select v-model="currentFilter.grade" clearable filterable placeholder="请选择">
                      <t-option
                        v-for="item in gradeFilterOptions"
                        :key="item.value"
                        :label="item.label"
                        :value="item.value"
                      />
                    </t-select>
                  </t-form-item>
                  <t-form-item label="租户" class="tenant-filter">
                    <t-select v-model="currentFilter.tenant" clearable filterable placeholder="请选择">
                      <t-option v-for="item in tenantOptions" :key="item" :label="item" :value="item" />
                    </t-select>
                  </t-form-item>
                </div>

                <div class="filter-secondary-row">
                  <t-form-item label="门店" class="store-filter">
                    <t-select v-model="currentFilter.store" clearable filterable placeholder="请选择">
                      <t-option v-for="item in storeOptions" :key="item" :label="item" :value="item" />
                    </t-select>
                  </t-form-item>
                  <div class="filter-actions">
                    <t-button theme="primary" @click="handleSearch">
                      <template #icon><t-icon name="search" /></template>
                      查询
                    </t-button>
                    <t-button class="reset-filter-button" theme="default" variant="base" @click="handleReset">
                      <template #icon><t-icon name="refresh" /></template>
                      重置
                    </t-button>
                  </div>
                </div>
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

          <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
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
            <label
              v-for="item in uploadItems"
              :key="item.key"
              class="upload-box"
              :class="{ 'is-disabled': productMode === 'view' }"
              :for="`slab-upload-${item.key}`"
            >
              <span v-if="item.required" class="required-star">*</span>
              <strong>{{ item.title }}</strong>
              <img
                v-if="uploadPreviews[item.key]?.url && item.accept.startsWith('image/')"
                class="upload-preview"
                :src="uploadPreviews[item.key]?.url"
                :alt="item.title"
                role="button"
                tabindex="0"
                @click.stop.prevent="openUploadPreview(item)"
                @keydown.enter.stop.prevent="openUploadPreview(item)"
              />
              <t-icon v-else name="add" />
              <span>{{ uploadPreviews[item.key]?.name || item.label }}</span>
              <input
                :id="`slab-upload-${item.key}`"
                class="direct-upload-input"
                type="file"
                :accept="item.accept"
                :disabled="productMode === 'view'"
                @change="(event) => handleDirectUpload(item, event)"
              />
            </label>
          </div>
        </t-tab-panel>
        <t-tab-panel value="base" label="基础信息">
          <t-form ref="productFormRef" :data="productForm" :rules="productRules" label-width="92px" colon>
            <div class="dialog-form-grid">
              <t-form-item label="品种" name="variety">
                <t-select
                  v-model="productForm.variety"
                  :disabled="productMode === 'view'"
                  filterable
                  placeholder="请选择"
                >
                  <t-option v-for="item in varietyOptions" :key="item" :label="item" :value="item" />
                </t-select>
              </t-form-item>
              <t-form-item label="产地" name="origin">
                <t-select
                  v-model="productForm.origin"
                  :disabled="productMode === 'view'"
                  filterable
                  placeholder="请选择"
                >
                  <t-option v-for="item in originOptions" :key="item" :label="item" :value="item" />
                </t-select>
              </t-form-item>
              <t-form-item label="纹理" name="textureId">
                <t-select
                  v-model="productForm.textureId"
                  :disabled="productMode === 'view'"
                  filterable
                  placeholder="请选择"
                >
                  <t-option
                    v-for="item in publishOptions.textures"
                    :key="item.id"
                    :label="item.label"
                    :value="item.id"
                    :disabled="item.status === 'disabled'"
                  />
                </t-select>
              </t-form-item>
              <t-form-item label="色系" name="colorId">
                <t-cascader
                  v-model="productForm.colorId"
                  :disabled="productMode === 'view'"
                  :options="colorCascaderOptions"
                  :show-all-levels="false"
                  :check-strictly="false"
                  filterable
                  placeholder="请选择"
                  trigger="hover"
                  value-mode="onlyLeaf"
                  value-type="single"
                />
              </t-form-item>
              <t-form-item label="等级" name="gradeId">
                <t-select
                  v-model="productForm.gradeId"
                  :disabled="productMode === 'view'"
                  filterable
                  placeholder="请选择"
                >
                  <t-option
                    v-for="item in publishOptions.grades"
                    :key="item.id"
                    :label="formatGradeOption(item)"
                    :value="item.id"
                    :disabled="item.status === 'disabled'"
                  />
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
                  <t-option v-for="item in tenantOptions" :key="item" :label="item" :value="item" />
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
      v-model:visible="uploadPreviewDialogVisible"
      :header="uploadPreviewTitle"
      width="760px"
      placement="center"
      :footer="false"
    >
      <img v-if="uploadPreviewUrl" class="upload-large-preview" :src="uploadPreviewUrl" :alt="uploadPreviewTitle" />
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
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminPagination } from '@/components/foundation';
import { listSlabOrigins, type SlabOriginRecord } from '@/services/slabOrigins';
import { listSlabVarieties, type SlabVarietyRecord } from '@/services/slabVarieties';
import {
  createSlab,
  deleteSlab,
  getSlabPublishOptions,
  listSlabs,
  updateSlab,
  type SlabPayload,
  type SlabPublishOptions,
  type SlabRecord,
  type SlabStatus,
} from '@/services/slabs';
import { listSuppliers, type SupplierRecord } from '@/services/suppliers';
import { computed, onMounted, reactive, ref } from 'vue';
type PublisherType = '租户发布' | '平台发布';
type ProductMode = 'create' | 'edit' | 'view';
type RowAction = 'shelf' | 'edit' | 'reject' | 'delete' | 'offShelf' | 'restore' | 'purge';
type BatchAction = 'publish' | 'batchShelf' | 'batchOffShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';
type ConfirmType =
  | 'shelf'
  | 'delete'
  | 'restore'
  | 'reject'
  | 'savePrice'
  | 'batchShelf'
  | 'batchRestore'
  | 'purge'
  | 'batchPurge'
  | 'clearRecycle';
type SalesPriceKey = 'guide' | 'level1' | 'level2' | 'level3';
type ProductPriceKey = `${SalesPriceKey}Price`;
type ProductRatioKey = `${SalesPriceKey}Ratio`;
type UploadItemKey = 'main' | 'scan' | 'design' | 'video';

interface FilterState {
  keyword: string;
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
  supplierId?: number;
  varietyId?: number;
  textureId?: number;
  colorId?: number;
  gradeId?: number;
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
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  areaSquareMeter?: number;
}

interface ProductForm {
  variety: string;
  origin: string;
  textureId?: number;
  colorId?: number;
  gradeId?: number;
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

const tabs: { value: SlabStatus; label: string }[] = [
  { value: 'warehouse', label: '仓库中' },
  { value: 'selling', label: '出售中' },
  { value: 'offShelf', label: '已下架' },
  { value: 'soldOut', label: '已售完' },
  { value: 'recycle', label: '回收站' },
];

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
  keyword: '',
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
  textureId: undefined,
  colorId: undefined,
  gradeId: undefined,
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
const loading = ref(false);
const saving = ref(false);
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
const uploadPreviews = reactive<Partial<Record<UploadItemKey, { name: string; url?: string }>>>({});
const uploadPreviewDialogVisible = ref(false);
const uploadPreviewTitle = ref('');
const uploadPreviewUrl = ref('');
const slabOrigins = ref<SlabOriginRecord[]>([]);
const slabVarieties = ref<SlabVarietyRecord[]>([]);
const slabSuppliers = ref<SupplierRecord[]>([]);
const publishOptions = reactive<SlabPublishOptions>({ textures: [], colorCategories: [], grades: [] });

const varietyOptions = computed(() => slabVarieties.value.map((item) => item.name));
const originOptions = computed(() => slabOrigins.value.map((item) => item.name));
const textureFilterOptions = computed(() => publishOptions.textures.map((item) => item.label));
const colorOptions = computed(() => publishOptions.colorCategories.flatMap((item) => item.children));
const formatGradeOption = (grade: SlabPublishOptions['grades'][number]) =>
  grade.description ? `${grade.label}（${grade.description}）` : grade.label;
const gradeFilterOptions = computed(() =>
  publishOptions.grades.map((item) => ({ value: formatGradeOption(item), label: formatGradeOption(item) })),
);
const colorCascaderOptions = computed(() =>
  publishOptions.colorCategories.map((category) => ({
    value: `category-${category.id}`,
    label: category.label,
    disabled: category.status === 'disabled',
    children: category.children.map((color) => ({
      value: color.id,
      label: color.label,
      disabled: color.status === 'disabled',
    })),
  })),
);
const colorFilterCascaderOptions = computed(() =>
  publishOptions.colorCategories.map((category) => ({
    value: `filter-category-${category.id}`,
    label: category.label,
    disabled: category.status === 'disabled',
    children: category.children.map((color) => ({
      value: color.label,
      label: color.label,
      disabled: color.status === 'disabled',
    })),
  })),
);
const tenantOptions = computed(() =>
  slabSuppliers.value.filter((item) => item.supplyTypes.some((type) => type.code === 'slab')).map((item) => item.name),
);
const storeOptions = computed(() => Array.from(new Set(tableData.value.map((item) => item.store).filter(Boolean))));

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

const tableData = ref<SlabItem[]>([]);

const normalizeStatus = (status?: string): SlabStatus => {
  if (status === 'selling' || status === 'offShelf' || status === 'soldOut' || status === 'recycle') return status;
  return 'warehouse';
};

const normalizePublisherType = (publisherType?: string): PublisherType =>
  publisherType === '租户发布' ? '租户发布' : '平台发布';

const originById = (id?: number) => slabOrigins.value.find((item) => item.id === id);
const varietyById = (id?: number) => slabVarieties.value.find((item) => item.id === id);
const supplierById = (id?: number) => slabSuppliers.value.find((item) => item.id === id);
const publishOptionLabel = (options: SlabPublishOptions[keyof SlabPublishOptions], id?: number) =>
  options.find((item) => item.id === id)?.label || '-';
const gradeLabelById = (id?: number) => {
  const grade = publishOptions.grades.find((item) => item.id === id);
  return grade ? formatGradeOption(grade) : '-';
};
const varietyIdByName = (name: string) => slabVarieties.value.find((item) => item.name === name)?.id;
const supplierIdByName = (name: string) => slabSuppliers.value.find((item) => item.name === name)?.id;

const formatSize = (record: SlabRecord) => {
  const dimensions = [record.lengthMm, record.widthMm, record.thicknessMm];
  return dimensions.some((item) => item == null) ? '-' : `${dimensions.join(' x ')}mm`;
};

const toSlabItem = (record: SlabRecord): SlabItem => {
  const variety = varietyById(record.varietyId);
  const supplier = supplierById(record.supplierId);
  return {
    id: record.id,
    supplierId: record.supplierId,
    varietyId: record.varietyId,
    textureId: record.textureId,
    colorId: record.colorId,
    gradeId: record.gradeId,
    code: record.serialNo,
    image: createStoneImage(record.id),
    name: record.name,
    size: formatSize(record),
    origin: originById(variety?.originId)?.name || '-',
    texture: publishOptionLabel(publishOptions.textures, record.textureId),
    color: publishOptionLabel(colorOptions.value, record.colorId),
    grade: gradeLabelById(record.gradeId),
    tenant: supplier?.name || (record.supplierId ? `供应商 #${record.supplierId}` : '平台自营'),
    store: record.warehouse || '-',
    publisherType: normalizePublisherType(record.publisherType),
    price: {
      cost: record.costPrice == null ? '' : String(record.costPrice),
      guide: record.guidePrice == null ? '' : String(record.guidePrice),
      level1: '',
      level2: '',
      level3: '',
    },
    status: normalizeStatus(record.status),
    variety: variety?.name || (record.varietyId ? `品种 #${record.varietyId}` : '-'),
    sku: record.serialNo,
    lengthMm: record.lengthMm,
    widthMm: record.widthMm,
    thicknessMm: record.thicknessMm,
    areaSquareMeter: record.areaSquareMeter,
  };
};

const toSlabPayload = (item: SlabItem, patch: Partial<SlabItem> = {}): SlabPayload => {
  const next = { ...item, ...patch };
  return {
    supplierId: next.supplierId,
    varietyId: next.varietyId,
    textureId: next.textureId,
    colorId: next.colorId,
    gradeId: next.gradeId,
    name: next.name,
    serialNo: next.code,
    warehouse: next.store === '-' ? undefined : next.store,
    publisherType: next.publisherType,
    lengthMm: next.lengthMm,
    widthMm: next.widthMm,
    thicknessMm: next.thicknessMm,
    areaSquareMeter: next.areaSquareMeter,
    costPrice: toNumber(next.price.cost),
    guidePrice: toNumber(next.price.guide),
    status: next.status,
  };
};

const upsertSlabItem = (record: SlabRecord) => {
  const nextItem = toSlabItem(record);
  const index = tableData.value.findIndex((item) => item.id === record.id);
  if (index >= 0) tableData.value[index] = nextItem;
  else tableData.value.unshift(nextItem);
  return nextItem;
};

const loadSlabs = async () => {
  loading.value = true;
  try {
    const [records, originsResult, varietiesResult, suppliersResult, publishOptionsResult] = await Promise.all([
      listSlabs(),
      listSlabOrigins().catch(() => []),
      listSlabVarieties().catch(() => []),
      listSuppliers().catch(() => []),
      getSlabPublishOptions(),
    ]);
    slabOrigins.value = originsResult;
    slabVarieties.value = varietiesResult;
    slabSuppliers.value = suppliersResult;
    Object.assign(publishOptions, publishOptionsResult);
    tableData.value = records.map(toSlabItem);
  } catch (error) {
    tableData.value = [];
    adminFeedback.error(error instanceof Error ? error.message : '大板数据加载失败');
  } finally {
    loading.value = false;
  }
};

onMounted(loadSlabs);

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
    reject: '驳回',
    savePrice: '保存价格',
    batchShelf: '批量上架',
    batchRestore: '批量恢复',
    purge: '彻底删除',
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

const uploadItems: { key: UploadItemKey; title: string; label: string; required: boolean; accept: string }[] = [
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
  textureId: [{ required: true, message: '请选择纹理', type: 'error' }],
  colorId: [{ required: true, message: '请选择色系', type: 'error' }],
  gradeId: [{ required: true, message: '请选择等级', type: 'error' }],
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
    { colKey: 'grade', title: '等级', width: 160, align: 'center' },
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
    const keyword = filter.keyword.trim().toLowerCase();
    const keywordMatched =
      !keyword ||
      String(item.id).includes(keyword) ||
      item.name.toLowerCase().includes(keyword) ||
      item.code.toLowerCase().includes(keyword);
    const varietyMatched = !filter.variety || item.variety === filter.variety;
    const originMatched = !filter.origin || item.origin === filter.origin;
    const textureMatched = !filter.texture || item.texture === filter.texture;
    const colorMatched = !filter.color || item.color === filter.color;
    const gradeMatched = !filter.grade || item.grade === filter.grade;
    const tenantMatched = !filter.tenant || item.tenant === filter.tenant;
    const storeMatched = !filter.store || item.store === filter.store;
    return (
      statusMatched &&
      keywordMatched &&
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

const tabLabel = (tab: { label: string; value: SlabStatus }) => {
  const count = tableData.value.filter((item) => item.status === tab.value).length;
  return count ? `${tab.label} ${count}` : tab.label;
};

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

const priceKey = (key: SalesPriceKey) => `${key}Price` as ProductPriceKey;
const ratioKey = (key: SalesPriceKey) => `${key}Ratio` as ProductRatioKey;

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
  Object.assign(productForm, {
    variety: row.variety,
    origin: row.origin,
    textureId: row.textureId,
    colorId: row.colorId,
    gradeId: row.gradeId,
    length: row.lengthMm == null ? '' : String(row.lengthMm),
    width: row.widthMm == null ? '' : String(row.widthMm),
    height: row.thicknessMm == null ? '' : String(row.thicknessMm),
    tolerance: '2mm',
    corner1Length: row.lengthMm == null ? '' : String(row.lengthMm),
    corner1Width: row.widthMm == null ? '' : String(row.widthMm),
    corner2Length: row.lengthMm == null ? '' : String(row.lengthMm),
    corner2Width: row.widthMm == null ? '' : String(row.widthMm),
    corner3Length: row.lengthMm == null ? '' : String(row.lengthMm),
    corner3Width: row.widthMm == null ? '' : String(row.widthMm),
    corner4Length: row.lengthMm == null ? '' : String(row.lengthMm),
    corner4Width: row.widthMm == null ? '' : String(row.widthMm),
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
  Object.keys(uploadPreviews).forEach((key) => delete uploadPreviews[key as UploadItemKey]);
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
  if (
    !productForm.variety ||
    !productForm.origin ||
    productForm.textureId == null ||
    productForm.colorId == null ||
    productForm.gradeId == null
  ) {
    productTab.value = 'base';
    adminFeedback.warning('请完善基础信息');
    return;
  }
  const targetName = `${productForm.variety}大板`;
  const editingItem =
    editingRowId.value == null ? undefined : tableData.value.find((item) => item.id === editingRowId.value);
  const lengthMm = toNumber(productForm.length);
  const widthMm = toNumber(productForm.width);
  const thicknessMm = toNumber(productForm.height);
  const payload: SlabPayload = {
    supplierId: supplierIdByName(productForm.supplier),
    varietyId: varietyIdByName(productForm.variety),
    textureId: productForm.textureId,
    colorId: productForm.colorId,
    gradeId: productForm.gradeId,
    name: targetName,
    serialNo: productForm.sku.trim() || editingItem?.code || `SLAB-${Date.now()}`,
    warehouse: editingItem?.store && editingItem.store !== '-' ? editingItem.store : '平台仓',
    publisherType: editingItem?.publisherType || '平台发布',
    lengthMm,
    widthMm,
    thicknessMm,
    areaSquareMeter: lengthMm && widthMm ? Number(((lengthMm * widthMm) / 1_000_000).toFixed(2)) : undefined,
    costPrice: toNumber(productForm.cost),
    guidePrice: toNumber(productForm.guidePrice),
    status: editingItem?.status || 'warehouse',
  };

  saving.value = true;
  try {
    if (productMode.value === 'edit' && editingItem) {
      upsertSlabItem(await updateSlab(editingItem.id, payload));
    } else {
      upsertSlabItem(await createSlab(payload));
      activeTab.value = 'warehouse';
      paginations.warehouse.current = 1;
    }
    closeProductDialog();
    if (productMode.value === 'create') adminFeedback.created(targetName);
    else adminFeedback.success('商品信息已提交');
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '商品提交失败');
  } finally {
    saving.value = false;
  }
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });

const handleDirectUpload = async (item: (typeof uploadItems)[number], event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    uploadPreviews[item.key] = {
      name: file.name,
      url: file.type.startsWith('image/') ? await readFileAsDataUrl(file) : undefined,
    };
    adminFeedback.success('上传成功');
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '上传失败');
  } finally {
    input.value = '';
  }
};

const openUploadPreview = (item: (typeof uploadItems)[number]) => {
  const previewUrl = uploadPreviews[item.key]?.url;
  if (!previewUrl) return;
  uploadPreviewTitle.value = item.title;
  uploadPreviewUrl.value = previewUrl;
  uploadPreviewDialogVisible.value = true;
};

const updateSlabStatus = async (id: number, status: SlabStatus) => {
  const item = tableData.value.find((candidate) => candidate.id === id);
  if (!item) return;
  upsertSlabItem(await updateSlab(id, toSlabPayload(item, { status })));
};

const handleBatchAction = async (action: BatchAction) => {
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
    saving.value = true;
    try {
      await Promise.all(selectedKeys.value.map((id) => updateSlabStatus(id, 'offShelf')));
      selectedKeys.value = [];
      adminFeedback.success('批量下架成功');
    } catch (error) {
      adminFeedback.error(error instanceof Error ? error.message : '批量下架失败');
    } finally {
      saving.value = false;
    }
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
    openConfirm('batchPurge', null, '彻底删除后无法恢复，是否批量彻底删除所选大板？');
    return;
  }
  openConfirm('clearRecycle', null, '清空后所有回收站大板将无法恢复，是否清空回收站？');
};

const handleRowAction = (action: RowAction, row: SlabItem) => {
  if (action === 'edit') openProductDialog('edit', row);
  if (action === 'shelf') openConfirm('shelf', row, `是否上架大板“${row.name}”？`);
  if (action === 'delete') openConfirm('delete', row, `是否删除大板“${row.name}”？`);
  if (action === 'restore') openConfirm('restore', row, `是否放回到仓库“${row.name}”？`);
  if (action === 'purge') openConfirm('purge', row, `彻底删除后无法恢复，是否彻底删除大板“${row.name}”？`);
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

const handleConfirmSubmit = async () => {
  const type = confirmState.type;
  const row = confirmState.row;
  const selectedCount = selectedKeys.value.length;
  const recycleIds = tableData.value.filter((item) => item.status === 'recycle').map((item) => item.id);
  saving.value = true;
  try {
    if (type === 'shelf' && row) await updateSlabStatus(row.id, 'selling');
    if (type === 'delete' && row) await updateSlabStatus(row.id, 'recycle');
    if (type === 'restore' && row) await updateSlabStatus(row.id, 'warehouse');
    if (type === 'reject' && row) await updateSlabStatus(row.id, 'recycle');
    if (type === 'savePrice' && row) {
      const nextPrice = {
        cost: batchPriceRows[0].price,
        guide: batchPriceRows[1].price,
        level1: batchPriceRows[2].price,
        level2: batchPriceRows[3].price,
        level3: batchPriceRows[4].price,
      };
      upsertSlabItem(await updateSlab(row.id, toSlabPayload(row, { price: nextPrice })));
      closePriceDrawer();
    }
    if (type === 'batchRestore') {
      await Promise.all(selectedKeys.value.map((id) => updateSlabStatus(id, 'warehouse')));
    }
    if (type === 'batchShelf') {
      await Promise.all(selectedKeys.value.map((id) => updateSlabStatus(id, 'selling')));
    }
    if (type === 'purge' && row) {
      await deleteSlab(row.id);
      tableData.value = tableData.value.filter((item) => item.id !== row.id);
    }
    if (type === 'batchPurge') {
      const selectedIds = [...selectedKeys.value];
      await Promise.all(selectedIds.map((id) => deleteSlab(id)));
      const deletedIds = new Set(selectedIds);
      tableData.value = tableData.value.filter((item) => !deletedIds.has(item.id));
    }
    if (type === 'clearRecycle') {
      await Promise.all(recycleIds.map((id) => deleteSlab(id)));
      tableData.value = tableData.value.filter((item) => item.status !== 'recycle');
    }
    if (type !== 'savePrice') {
      selectedKeys.value = [];
      ensureCurrentPage();
    }
    closeConfirmDialog();
    if ((type === 'delete' || type === 'purge') && row) adminFeedback.deleted(row.name);
    else if (type === 'batchPurge') adminFeedback.deleted(`${selectedCount} 个大板`);
    else if (type === 'clearRecycle') adminFeedback.deleted(`${recycleIds.length} 个回收站大板`);
    else adminFeedback.success('大板状态已更新');
  } catch (error) {
    if (type === 'batchPurge' || type === 'clearRecycle') await loadSlabs();
    adminFeedback.error(error instanceof Error ? error.message : '大板操作失败');
  } finally {
    saving.value = false;
  }
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

const handleReasonSubmit = async () => {
  if (!reasonForm.reason) {
    adminFeedback.warning('请选择原因');
    return;
  }
  if (reasonState.type === 'offShelf' && reasonState.row) {
    saving.value = true;
    try {
      await updateSlabStatus(reasonState.row.id, 'offShelf');
      ensureCurrentPage();
      closeReasonDialog();
      adminFeedback.success('大板下架原因已提交');
    } catch (error) {
      adminFeedback.error(error instanceof Error ? error.message : '大板下架失败');
    } finally {
      saving.value = false;
    }
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
  width: 100%;
}

.filter-fields {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-m);
}

.filter-primary-row,
.filter-secondary-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-comp-margin-m);
}

.filter-primary-row {
  justify-content: space-between;
}

.filter-secondary-row {
  width: 100%;
}

.filter-primary-row :deep(.t-form__item),
.filter-secondary-row :deep(.t-form__item) {
  width: 156px;
  margin-bottom: 0;
}

.filter-primary-row :deep(.t-form__item.slab-keyword-filter) {
  width: 234px;
}

.filter-secondary-row :deep(.t-form__item.store-filter) {
  width: 234px;
}

.filter-actions {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
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

.upload-box.is-disabled {
  cursor: default;
}

.upload-box:hover:not(.is-disabled) {
  color: var(--td-brand-color);
  border-color: var(--td-brand-color);
}

.direct-upload-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.upload-preview {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 4px;
  cursor: zoom-in;
}

.upload-large-preview {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: 0 auto;
  object-fit: contain;
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

  .filter-fields {
    width: 100%;
  }

  .filter-primary-row,
  .filter-secondary-row {
    gap: var(--td-comp-margin-s);
  }

  .filter-actions {
    margin-left: 0;
  }

  .filter-primary-row :deep(.t-form__item),
  .filter-secondary-row :deep(.t-form__item) {
    width: calc(50% - var(--td-comp-margin-s) / 2);
  }

  .filter-primary-row :deep(.t-form__item.slab-keyword-filter) {
    width: calc(50% - var(--td-comp-margin-s) / 2);
  }
}

@media (max-width: 640px) {
  .filter-primary-row :deep(.t-form__item),
  .filter-secondary-row :deep(.t-form__item) {
    width: 100%;
  }

  .filter-primary-row :deep(.t-form__item.slab-keyword-filter) {
    width: 100%;
  }
}
</style>
