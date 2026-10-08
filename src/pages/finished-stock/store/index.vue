<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <header class="page-header">
          <t-breadcrumb><t-breadcrumb-item>成品现货管理</t-breadcrumb-item></t-breadcrumb>
          <t-link v-if="canGlobal('operation-log.view')" theme="primary" @click="openLogs">操作日志</t-link>
        </header>
        <AdminListLayout v-if="tabs.length" class="finished-list-layout">
          <template #toolbar>
            <div class="list-controls">
              <t-tabs
                v-if="true"
                :value="activeTab"
                class="status-tabs"
                @change="
                  activeTab = String($event) as StoreFinishedStatus;
                  resetSelection();
                "
              >
                <t-tab-panel v-for="tab in tabs" :key="tab.value" :value="tab.value" :label="tab.label" />
              </t-tabs>
              <t-form class="zdm-admin-filter-form" label-width="auto" :data="filter" colon>
                <div class="filter-row">
                  <div class="filter-fields pool-filter-fields">
                    <t-form-item label="商品">
                      <t-input v-model="filter.keyword" clearable placeholder="商品名称 / ID" />
                    </t-form-item>
                    <t-form-item label="商品分类">
                      <t-select-input
                        :value="filter.category"
                        :value-display="listCategories.find((item) => item.id === filter.category)?.name"
                        :popup-visible="listCategoryVisible"
                        :popup-props="{
                          placement: 'bottom-left',
                          overlayInnerStyle: { width: 'auto' },
                          popperOptions: { modifiers: [{ name: 'flip', enabled: false }] },
                        }"
                        clearable
                        placeholder="请选择"
                        @popup-visible-change="listCategoryVisible = $event"
                        @clear="filter.category = undefined"
                      >
                        <template #suffixIcon
                          ><t-icon :name="listCategoryVisible ? 'chevron-up' : 'chevron-down'"
                        /></template>
                        <template #panel>
                          <t-cascader-panel
                            v-if="listCategoryVisible"
                            :value="''"
                            :options="listCategoryOptions"
                            :check-strictly="false"
                            trigger="hover"
                            @change="changeListCategory"
                          />
                        </template>
                      </t-select-input>
                    </t-form-item>
                  </div>
                  <div class="filter-actions">
                    <t-button theme="primary" @click="searchList">
                      <template #icon><t-icon name="search" /></template>查询
                    </t-button>
                    <t-button theme="default" variant="base" @click="resetFilter">
                      <template #icon><t-icon name="refresh" /></template>重置
                    </t-button>
                  </div>
                </div>
              </t-form>
              <div v-if="true" class="table-toolbar">
                <div class="toolbar-buttons">
                  <t-button
                    v-for="action in storeToolbarActions"
                    :key="action.id === 'batch' ? batchAction?.kind : action.id"
                    :theme="action.theme"
                    :variant="action.variant"
                    :class="action.className"
                    :disabled="action.disabled"
                    @click="handleStoreToolbarAction(action.id)"
                  >
                    <template v-if="action.icon" #icon><t-icon :name="action.icon" /></template>
                    {{ action.label }}
                  </t-button>
                </div>
                <div class="selection-info">已选 {{ selected.length }} 项</div>
              </div>
            </div>
          </template>
          <template #table
            ><SourceUnavailableOverlay :rows="pageRows.filter((item) => item.sourceUnavailable)">
              <FinishedRowWarnings :rows="pageRows" :errors="shelfErrors" @close="(id) => delete shelfErrors[id]">
                <t-table
                  :key="activeTab"
                  class="finished-stock-table"
                  row-key="id"
                  :data="pageRows"
                  :columns="columns"
                  :loading="loading"
                  :row-attributes="
                    ({ row }: { row: StoreFinishedProduct }) =>
                      row.sourceUnavailable
                        ? { 'data-source-id': row.id, inert: true }
                        : shelfErrors[row.id]
                          ? { 'data-shelf-error-id': row.id }
                          : {}
                  "
                  hover
                  table-layout="fixed"
                >
                  <template #selectTitle
                    ><t-checkbox :checked="pageAllSelected" :indeterminate="pagePartlySelected" @change="togglePage"
                  /></template>
                  <template #select="{ row }"
                    ><t-checkbox
                      :checked="selected.includes(row.id)"
                      :disabled="row.sourceUnavailable"
                      @change="(checked: boolean) => toggleRow(row.id, checked)"
                  /></template>
                  <template #product="{ row }"
                    ><div class="product-meta">
                      <div class="product-name">{{ row.name }}</div>
                      <div class="product-code">ID：{{ row.productId }}</div>
                    </div></template
                  >
                  <template #imageUrl="{ row }">
                    <button
                      class="product-image preview-trigger"
                      type="button"
                      title="点击查看大图"
                      @click="previewRowImage(row)"
                    >
                      <img v-if="row.imageUrl" :src="row.imageUrl" :alt="row.name" />
                      <t-icon v-else name="image-off" />
                    </button>
                  </template>
                  <template #totalStock="{ row }">{{ row.totalStock ?? 0 }}</template>
                  <template #createdByName="{ row }">{{ row.createdByName || '—' }}</template>
                  <template #createdAt="{ row }">{{ time(row.createdAt) }}</template>
                  <template #offShelfReason="{ row }">
                    <t-tooltip :content="row.offShelfDetail || '—'">{{ row.offShelfReason || '—' }}</t-tooltip>
                  </template>
                  <template #offShelfAt="{ row }">{{ time(row.offShelfAt) }}</template>
                  <template #operation="{ row }">
                    <div class="table-actions">
                      <t-link
                        v-for="action in storeRowButtons"
                        :key="action.id"
                        :theme="action.theme"
                        hover="color"
                        @click="handleStoreRowButton(action.id, row)"
                        >{{ action.label }}</t-link
                      >
                    </div>
                  </template>
                  <template #empty>暂无商品</template>
                </t-table>
              </FinishedRowWarnings>
              <template #overlay="{ row }">
                <t-space align="center"
                  ><t-icon name="info-circle" />{{ row.sourceMessage || '上游商品不可用' }}</t-space
                >
                <t-space size="small">
                  <t-button v-if="can(activeScope, 'view')" size="small" @click="openDetail(row)">详情</t-button>
                  <t-button
                    v-if="can(activeScope, 'view')"
                    size="small"
                    theme="danger"
                    @click="prepareAction('purge', row)"
                    >彻底删除</t-button
                  >
                </t-space>
              </template>
            </SourceUnavailableOverlay></template
          >
          <template #pagination>
            <AdminPagination
              :current="page"
              :page-size="pageSize"
              :total="filteredRows.length"
              :page-size-options="[10, 20, 50]"
              @update:current="page = $event"
              @update:page-size="pageSize = $event"
            />
          </template>
        </AdminListLayout>
        <t-empty v-else description="暂无成品现货管理权限" />
      </main>
    </div>

    <AdminDialog
      v-model:visible="poolVisible"
      header="商品中心"
      :footer="false"
      width="min(1200px, 94vw)"
      @close="poolVisible = false"
    >
      <t-space direction="vertical" style="width: 100%">
        <t-form
          class="zdm-admin-filter-form"
          label-width="auto"
          :data="{ keyword: poolKeyword, category: poolCategory }"
          colon
        >
          <div class="filter-row">
            <div class="filter-fields pool-filter-fields">
              <t-form-item label="商品名称/ID">
                <t-input v-model="poolKeyword" clearable placeholder="商品名称 / ID" />
              </t-form-item>
              <t-form-item label="商品分类">
                <t-select-input
                  :value="poolCategory"
                  :value-display="poolCategories.find((item) => item.id === poolCategory)?.name"
                  :popup-visible="poolCategoryVisible"
                  :popup-props="{
                    placement: 'bottom-left',
                    overlayInnerStyle: { width: 'auto' },
                    popperOptions: { modifiers: [{ name: 'flip', enabled: false }] },
                  }"
                  clearable
                  placeholder="请选择"
                  @popup-visible-change="poolCategoryVisible = $event"
                  @clear="poolCategory = undefined"
                >
                  <template #suffixIcon
                    ><t-icon :name="poolCategoryVisible ? 'chevron-up' : 'chevron-down'"
                  /></template>
                  <template #panel>
                    <t-cascader-panel
                      v-if="poolCategoryVisible"
                      :value="''"
                      :options="poolCategoryOptions"
                      :check-strictly="false"
                      trigger="hover"
                      @change="changePoolCategory"
                    />
                  </template>
                </t-select-input>
              </t-form-item>
            </div>
            <div class="filter-actions">
              <t-button theme="primary" @click="searchPool"
                ><template #icon><t-icon name="search" /></template>查询</t-button
              >
              <t-button theme="default" variant="base" @click="resetPoolFilter"
                ><template #icon><t-icon name="refresh" /></template>重置</t-button
              >
            </div>
          </div>
        </t-form>
        <div class="table-toolbar">
          <div class="toolbar-buttons">
            <t-button theme="primary" @click="selectPool">批量选择</t-button>
          </div>
        </div>
        <t-table row-key="id" :data="poolPageRows" :columns="poolColumns" hover>
          <template #poolSelectTitle>
            <t-checkbox
              :checked="poolPageAllSelected"
              :indeterminate="poolPagePartlySelected"
              :disabled="!poolPageRows.length"
              @change="togglePoolPage"
            />
          </template>
          <template #select="{ row }"
            ><t-checkbox
              :checked="poolSelected.includes(row.id)"
              @change="
                (checked: boolean) =>
                  (poolSelected = checked ? [...poolSelected, row.id] : poolSelected.filter((id) => id !== row.id))
              "
          /></template>
          <template #imageUrl="{ row }"
            ><t-image
              v-if="row.imageUrl"
              :src="row.imageUrl"
              fit="cover"
              :style="{ width: '48px', height: '48px' }"
              @click="imagePreview = row.imageUrl"
          /></template>
          <template #product="{ row }"
            >{{ row.name }}
            <div>ID：{{ row.id }}</div></template
          >
          <template #guidePrice="{ row }">{{ priceRange(row.guidePriceMin, row.guidePriceMax) }}</template>
          <template #partnerPrice="{ row }">{{ priceRange(row.partnerPriceMin, row.partnerPriceMax) }}</template>
          <template #operation="{ row }"><t-link theme="primary" @click="openPoolDetail(row)">详情</t-link></template>
          <template #empty>暂无可挑选的已上架商品</template>
        </t-table>
        <AdminPagination
          :current="poolPage"
          :page-size="poolPageSize"
          :total="filteredPool.length"
          :page-size-options="[10, 20, 50]"
          @update:current="poolPage = $event"
          @update:page-size="poolPageSize = $event"
        />
      </t-space>
    </AdminDialog>

    <t-drawer
      v-model:visible="poolDetailVisible"
      @close="poolVisible = true"
      header="商品详情"
      size="min(1200px, 100vw)"
      :footer="false"
      :close-btn="true"
    >
      <StorePoolProductDetail v-if="poolDetail" :product="poolDetail" />
    </t-drawer>

    <AdminDialog
      :visible="Boolean(logVideoPreview)"
      header="商品视频"
      width="min(960px, 94vw)"
      :cancel-btn="null"
      confirm-btn="关闭"
      @confirm="logVideoPreview = null"
      @close="logVideoPreview = null"
      @update:visible="!$event && (logVideoPreview = null)"
    >
      <video v-if="logVideoPreview" :src="logVideoPreview" controls autoplay playsinline class="log-video-preview" />
    </AdminDialog>
    <t-drawer v-model:visible="detailVisible" header="商品详情" size="min(1200px, 100vw)" :footer="false">
      <StoreProductDetail v-if="current" :product="current" />
    </t-drawer>

    <AdminDialog
      :visible="Boolean(imagePreview)"
      header="商品主图"
      width="min(960px, 94vw)"
      :footer="false"
      @close="imagePreview = null"
      @update:visible="!$event && (imagePreview = null)"
    >
      <img v-if="imagePreview" :src="imagePreview" alt="商品主图" style="max-width: 100%" />
    </AdminDialog>

    <t-drawer v-model:visible="priceVisible" header="商品价格" size="min(1050px, 100vw)" :footer="false">
      <t-space v-if="current" direction="vertical" size="large" style="width: 100%">
        <t-alert v-if="current.sourceUnavailable" theme="warning" :message="current.sourceMessage" />
        <t-alert
          theme="info"
          message="成本价为本店级别的合伙人价格，只能查看。角色最低可售价以成本价乘角色系数计算，可按 SKU 手工覆盖；允许低于成本价。"
        />
        <AdminSectionCard v-for="sku in current.skus" :key="sku.skuId">
          <h3>{{ sku.label }} · SKU ID {{ sku.skuId }}</h3>
          <t-descriptions bordered :column="3">
            <t-descriptions-item label="统一库存">{{ sku.stock }}</t-descriptions-item>
            <t-descriptions-item label="本店成本价">{{ money(sku.costPrice) }}</t-descriptions-item>
            <t-descriptions-item label="运营端指导价">{{ money(sku.guidePrice) }}</t-descriptions-item>
          </t-descriptions>
          <t-table row-key="roleId" :data="sku.rolePrices" :columns="roleColumns" style="margin-top: 16px">
            <template #price="{ row }"
              ><t-input-number
                v-model="roleDrafts[`${sku.skuId}:${row.roleId}`]"
                :min="0"
                :decimal-places="2"
                :disabled="!priceEditable || roleSources[`${sku.skuId}:${row.roleId}`] === 'auto'"
                theme="normal"
            /></template>
            <template #priceSource="{ row }"
              ><t-radio-group
                v-model="roleSources[`${sku.skuId}:${row.roleId}`]"
                :disabled="!priceEditable"
                @change="syncRoleDraft(sku.skuId, row)"
                ><t-radio value="auto">跟随配置</t-radio><t-radio value="manual">手工价格</t-radio></t-radio-group
              ></template
            >
            <template #operation="{ row }"
              ><t-button v-if="priceEditable" size="small" theme="primary" @click="saveRole(sku.skuId, row.roleId)"
                >保存</t-button
              ></template
            >
          </t-table>
        </AdminSectionCard>
      </t-space>
    </t-drawer>

    <AdminDialog
      v-model:visible="offShelfVisible"
      :header="pendingOffShelf?.batch ? '下架' : '下架商品'"
      :width="pendingOffShelf?.batch ? '520px' : '500px'"
      :confirm-btn="pendingOffShelf?.batch ? '提交' : undefined"
      @confirm="confirmOffShelf"
      @cancel="offShelfVisible = false"
      @close="offShelfVisible = false"
    >
      <t-form :data="offShelf" :label-width="pendingOffShelf?.batch ? '96px' : '92px'" colon>
        <t-form-item label="下架原因" :required-mark="Boolean(pendingOffShelf?.batch)"
          ><t-select v-model="offShelf.reason" placeholder="请选择"
            ><t-option value="商品暂停售卖" label="商品暂停售卖" /><t-option
              value="商品信息调整"
              label="商品信息调整" /><t-option value="其他" label="其他" /></t-select
        ></t-form-item>
        <t-form-item label="详细说明"
          ><t-textarea
            v-model="offShelf.detail"
            :maxlength="500"
            :placeholder="pendingOffShelf?.batch ? '请输入' : '选填'"
            :autosize="pendingOffShelf?.batch ? { minRows: 4, maxRows: 6 } : undefined"
        /></t-form-item>
      </t-form>
    </AdminDialog>
    <AdminConfirmDialog
      :visible="Boolean(confirm)"
      :action="confirm?.label || ''"
      object-type="商品"
      :description="confirm ? batchConfirmDescriptions[confirm.kind] : undefined"
      :object-name="confirm?.product?.name"
      @confirm="runConfirmed"
      @cancel="confirm = null"
      @close="confirm = null"
      @update:visible="!$event && (confirm = null)"
    />

    <ProductOperationLogTemplate
      v-model:visible="logsVisible"
      v-model:detail-visible="logDetailVisible"
      :records="logRows"
      :detail="logDetailRow"
      :total="logTotal"
      :loading="logLoading"
      :filter="logFilter"
      :pagination="logPagination"
      :type-options="logTypeOptions"
      operation-type-popup-min-width="240px"
      subject-label="商品"
      keyword-placeholder="商品名称/ID"
      :status-label="stateLabel"
      :format-time="time"
      :source-label="logSourceLabel"
      @filter-change="updateLogFilter"
      @search="searchLogs"
      @reset="resetLogFilter"
      @page-change="changeLogPage"
      @open-detail="openLogDetail"
    >
      <template #detail>
        <FinishedCreationSnapshot
          v-if="logDetailRow?.operationType === 'SELECT' && Object.keys(logChanges).length"
          :snapshot="logSnapshot"
          :media="logMedia"
          :rich-text="logAfterHtml"
          store-mode
          @preview="previewLogMedia"
        />
        <FinishedEditChanges
          v-else-if="Object.keys(logChanges).length"
          :changes="logChanges"
          :media="logMedia"
          before-html=""
          :after-html="logAfterHtml"
          store-mode
          @preview="previewLogMedia"
        />
      </template>
    </ProductOperationLogTemplate>
  </div>
</template>

<script setup lang="ts">
import FinishedCreationSnapshot from '../management/components/FinishedCreationSnapshot.vue';
import FinishedRowWarnings from '../management/components/FinishedRowWarnings.vue';
import type { FinishedStockToolbarAction, FinishedStockRowAction } from '../shared/finishedStockPageModel';
import { computed, onMounted, reactive, ref } from 'vue';
import { useStoreFinishedLogs } from './useStoreFinishedLogs';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { finishedStockActions } from '../shared/finishedStockActions';
import { storeOperationLogSourceLabel as logSourceLabel } from './storeOperationLog';
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminSectionCard,
  adminFeedback,
  getSafeErrorMessage,
} from '@/components/foundation';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import ProductOperationLogTemplate from '@/components/product-logs/ProductOperationLogTemplate.vue';
import {
  changeStoreFinishedStatus,
  changeStoreFinishedStatusBatch,
  clearStoreFinishedRecycle,
  getStoreFinishedProduct,
  getStoreFinishedPoolDetail,
  type StorePoolDetail,
  listStoreFinishedPool,
  listStoreFinishedPoolCategories,
  listStoreFinishedCategories,
  type StorePoolCategory,
  listStoreFinishedProducts,
  purgeStoreFinishedProduct,
  purgeStoreFinishedProducts,
  saveStoreFinishedRolePrice,
  selectStoreFinishedProducts,
  type StoreFinishedProduct,
  type StoreFinishedStatus,
  type StorePoolProduct,
  type StoreRolePrice,
} from '@/services/storeFinishedStock';
import SourceUnavailableOverlay from '../management/components/SourceUnavailableOverlay.vue';
import FinishedEditChanges from '../management/components/FinishedEditChanges.vue';
import StoreProductDetail from '../shared/StoreFinishedStockDetailAdapter.vue';
import StorePoolProductDetail from '../shared/StoreFinishedStockPoolDetailAdapter.vue';
import { AdminListLayout, AdminPagination } from '@/components/foundation';
const user = getLoginUser();
const prefix = 'store.finished-stock-management';
const can = (tab: string, action: string) => hasPermission(user, `${prefix}.${tab}.${action}`);
const canGlobal = (action: string) => hasPermission(user, `${prefix}.${action}`);
const statusLabels: Record<string, string> = {
  warehouse: '仓库中',
  selling: '出售中',
  offShelf: '已下架',
  soldOut: '已售完',
  recycle: '回收站',
  purged: '已彻底删除',
};
const tabOrder: StoreFinishedStatus[] = ['warehouse', 'selling', 'offShelf', 'soldOut', 'recycle'];
const tabs = computed(() =>
  tabOrder
    .filter((tab) => can(tab === 'offShelf' ? 'off-shelf' : tab === 'soldOut' ? 'sold-out' : tab, 'view'))
    .map((value) => ({
      value,
      label: `${statusLabels[value]}（${rows.value.filter((item) => item.effectiveStatus === value).length}）`,
    })),
);
const activeTab = ref<StoreFinishedStatus>('warehouse');
const activeScope = computed(() =>
  activeTab.value === 'offShelf' ? 'off-shelf' : activeTab.value === 'soldOut' ? 'sold-out' : activeTab.value,
);
const rows = ref<StoreFinishedProduct[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(10);
const filter = reactive<{ keyword: string; category?: number }>({ keyword: '' });
const appliedFilter = reactive<{ keyword: string; category?: number }>({ keyword: '' });
const listCategories = ref<StorePoolCategory[]>([]);
const listCategoryVisible = ref(false);
const listCategoryOptions = computed(() => {
  const build = (parentId?: number, visited = new Set<number>()): PoolCategoryOption[] =>
    listCategories.value
      .filter((item) => (item.parentId ?? undefined) === parentId && !visited.has(item.id))
      .map((item) => {
        const children = build(item.id, new Set([...visited, item.id]));
        return { value: item.id, label: item.name, ...(children.length ? { children } : {}) };
      });
  return build();
});
function changeListCategory(value: unknown) {
  if (typeof value !== 'number') return;
  filter.category = value;
  listCategoryVisible.value = false;
}
function searchList() {
  appliedFilter.keyword = filter.keyword.trim();
  appliedFilter.category = filter.category;
  page.value = 1;
  listCategoryVisible.value = false;
}
function matchesListCategory(categoryId?: number | null) {
  if (appliedFilter.category == null) return true;
  const visited = new Set<number>();
  let current = categoryId;
  while (current != null && !visited.has(current)) {
    if (current === appliedFilter.category) return true;
    visited.add(current);
    current = listCategories.value.find((item) => item.id === current)?.parentId;
  }
  return false;
}
const selected = ref<number[]>([]);
const shelfErrors = reactive<Record<number, string>>({});
const confirming = ref(false);
const batchConfirmDescriptions: Partial<Record<ActionKind, string>> = {
  'batch-shelf': '是否批量上架所选成品现货？',
  'batch-restore': '是否将所选成品现货放回仓库？',
  'batch-purge': '是否批量彻底删除所选成品现货？',
  clear: '是否清空回收站？',
};
const submittingOffShelf = ref(false);
const filteredRows = computed(() =>
  rows.value.filter(
    (row) =>
      row.effectiveStatus === activeTab.value &&
      (!appliedFilter.keyword || `${row.name} ${row.productId}`.includes(appliedFilter.keyword)) &&
      matchesListCategory(row.categoryId),
  ),
);
const pageRows = computed(() =>
  filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);
const selectablePageIds = computed(() => pageRows.value.filter((row) => !row.sourceUnavailable).map((row) => row.id));
const pageAllSelected = computed(
  () => selectablePageIds.value.length > 0 && selectablePageIds.value.every((id) => selected.value.includes(id)),
);
const pagePartlySelected = computed(
  () => !pageAllSelected.value && selectablePageIds.value.some((id) => selected.value.includes(id)),
);
const current = ref<StoreFinishedProduct | null>(null);
const detailVisible = ref(false);
const imagePreview = ref<string | null>(null);
const logVideoPreview = ref<string | null>(null);
function previewLogMedia(resource: { available: boolean; url?: string; mediaType: string }) {
  if (!resource.available || !resource.url) return;
  if (resource.mediaType === 'video') logVideoPreview.value = resource.url;
  else imagePreview.value = resource.url;
}
const priceVisible = ref(false);
const roleDrafts = reactive<Record<string, number | null>>({});
const roleSources = reactive<Record<string, 'auto' | 'manual'>>({});
const priceEditable = computed(() =>
  Boolean(
    current.value &&
    !current.value.sourceUnavailable &&
    ['warehouse', 'selling'].includes(current.value.effectiveStatus) &&
    can(activeScope.value, 'edit'),
  ),
);
const poolVisible = ref(false);
const poolDetailVisible = ref(false);
const poolDetail = ref<StorePoolDetail | null>(null);
const pool = ref<StorePoolProduct[]>([]);
const poolSelected = ref<number[]>([]);
const poolKeyword = ref('');
const poolPage = ref(1);
const poolPageSize = ref(10);
const poolCategory = ref<number>();
const poolCategoryVisible = ref(false);
const appliedPoolFilter = reactive<{ keyword: string; category?: number }>({ keyword: '' });
function changePoolCategory(value: unknown) {
  if (typeof value !== 'number') return;
  poolCategory.value = value;
  poolCategoryVisible.value = false;
}
function searchPool() {
  poolPage.value = 1;
  appliedPoolFilter.keyword = poolKeyword.value.trim();
  appliedPoolFilter.category = poolCategory.value;
  poolCategoryVisible.value = false;
}
function resetPoolFilter() {
  poolKeyword.value = '';
  poolCategory.value = undefined;
  searchPool();
}
const poolCategories = ref<StorePoolCategory[]>([]);
type PoolCategoryOption = { value: number; label: string; children?: PoolCategoryOption[] };
const poolCategoryOptions = computed(() => {
  const nodes = new Map<number, PoolCategoryOption>(
    poolCategories.value.map((item) => [item.id, { value: item.id, label: item.name }]),
  );
  const roots: PoolCategoryOption[] = [];
  for (const item of poolCategories.value) {
    const node = nodes.get(item.id)!;
    const parent = item.parentId ? nodes.get(item.parentId) : undefined;
    if (parent) (parent.children ??= []).push(node);
    else roots.push(node);
  }
  return roots;
});
function matchesPoolCategory(categoryId?: number) {
  if (appliedPoolFilter.category == null) return true;
  const visited = new Set<number>();
  let current = categoryId;
  while (current != null && !visited.has(current)) {
    if (current === appliedPoolFilter.category) return true;
    visited.add(current);
    current = poolCategories.value.find((item) => item.id === current)?.parentId ?? undefined;
  }
  return false;
}
const filteredPool = computed(() =>
  pool.value.filter(
    (item) => `${item.name} ${item.id}`.includes(appliedPoolFilter.keyword) && matchesPoolCategory(item.categoryId),
  ),
);
const poolPageRows = computed(() =>
  filteredPool.value.slice((poolPage.value - 1) * poolPageSize.value, poolPage.value * poolPageSize.value),
);
const poolPageAllSelected = computed(
  () => poolPageRows.value.length > 0 && poolPageRows.value.every((item) => poolSelected.value.includes(item.id)),
);
const poolPagePartlySelected = computed(
  () => !poolPageAllSelected.value && poolPageRows.value.some((item) => poolSelected.value.includes(item.id)),
);
function togglePoolPage(checked: boolean) {
  const ids = new Set(poolPageRows.value.map((item) => item.id));
  poolSelected.value = checked
    ? [...new Set([...poolSelected.value, ...ids])]
    : poolSelected.value.filter((id) => !ids.has(id));
}
const offShelfVisible = ref(false);
const offShelf = reactive({ reason: '', detail: '' });
const pendingOffShelf = ref<{ ids: number[]; batch: boolean } | null>(null);
type ActionKind = 'shelf' | 'delete' | 'restore' | 'purge' | 'batch-shelf' | 'batch-restore' | 'batch-purge' | 'clear';
const confirm = ref<{ kind: ActionKind; label: string; product?: StoreFinishedProduct; ids?: number[] } | null>(null);
const {
  logsVisible,
  logTotal,
  logLoading,
  logDetailVisible,
  logDetailRow,
  logChanges,
  logSnapshot,
  logMedia,
  logAfterHtml,
  logFilter,
  logPagination,
  logTypeOptions,
  logRows,
  openLogDetail,
  updateLogFilter,
  changeLogPage,
  openLogs,
  searchLogs,
  resetLogFilter,
} = useStoreFinishedLogs(stateLabel);
const batchActions: Record<string, { kind: ActionKind | 'off-shelf'; label: string; permission: string }> = {
  warehouse: { kind: 'batch-shelf', label: '批量上架', permission: 'batch-shelf' },
  selling: { kind: 'off-shelf', label: '批量下架', permission: 'batch-off-shelf' },
  offShelf: { kind: 'batch-restore', label: '批量放回到仓库', permission: 'batch-restore' },
  recycle: { kind: 'batch-restore', label: '批量放回到仓库', permission: 'batch-restore' },
};
const batchAction = computed(() => {
  const action = batchActions[activeTab.value];
  return action && can(activeScope.value, action.permission) ? action : null;
});
const storeToolbarActions = computed<FinishedStockToolbarAction[]>(() => [
  ...(activeTab.value === 'warehouse' && can('warehouse', 'select')
    ? [{ id: 'select', label: '商品中心', theme: 'primary' as const, icon: 'add' }]
    : []),
  ...(batchAction.value
    ? [
        {
          id: 'batch',
          label: batchAction.value.label,
          theme: batchAction.value.kind === 'off-shelf' ? ('default' as const) : ('primary' as const),
          icon:
            batchAction.value.kind === 'off-shelf'
              ? 'download'
              : batchAction.value.kind === 'batch-restore'
                ? 'rollback'
                : 'upload',
          className: batchAction.value.kind === 'off-shelf' ? 'brown-button' : undefined,
        },
      ]
    : []),
  ...(activeTab.value === 'recycle' && can('recycle', 'batch-purge')
    ? [
        {
          id: 'batch-purge',
          label: '批量彻底删除',
          theme: 'danger' as const,
          variant: 'base' as const,
          icon: 'delete',
          className: 'deep-danger-button',
        },
      ]
    : []),
  ...(activeTab.value === 'recycle' && can('recycle', 'clear')
    ? [{ id: 'clear', label: '清空回收站', theme: 'danger' as const, variant: 'base' as const, icon: 'clear' }]
    : []),
]);
const storeRowButtons = computed<FinishedStockRowAction[]>(() => [
  ...finishedStockActions[activeTab.value]
    .filter((action) => can(activeScope.value, action.permission))
    .map((action) => ({ id: action.id, label: action.label, theme: action.theme })),
]);
const handleStoreToolbarAction = (action: string) => {
  if (action === 'select') void openPool();
  else if (action === 'batch') prepareBatch();
  else if (action === 'batch-purge') {
    if (!selected.value.length) {
      adminFeedback.warning('请先选择商品');
      return;
    }
    confirm.value = { kind: 'batch-purge', label: '批量彻底删除', ids: [...selected.value] };
  } else if (action === 'clear') confirm.value = { kind: 'clear', label: '清空回收站' };
};
const handleStoreRowButton = async (action: string, row: StoreFinishedProduct) => {
  if (!['detail', 'purge'].includes(action) && !(await refreshAvailability([row.id]))) return;
  if (action === 'detail') void openDetail(row);
  else if (action === 'edit') void openPrice(row);
  else prepareAction(action === 'offShelf' ? 'off-shelf' : (action as ActionKind), row);
};
const baseColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'select', title: 'selectTitle', width: 52, align: 'center' },
  { colKey: 'imageUrl', title: '商品主图', width: 96 },
  { colKey: 'product', title: '商品名称/ID', minWidth: 220 },
];
const operationWidths: Record<StoreFinishedStatus, number> = {
  warehouse: 190,
  selling: 152,
  offShelf: 180,
  soldOut: 104,
  recycle: 208,
};
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...baseColumns,
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  ...(activeTab.value === 'offShelf'
    ? [
        { colKey: 'offShelfReason', title: '下架原因', minWidth: 140 },
        { colKey: 'offShelfAt', title: '下架时间', width: 180 },
      ]
    : []),
  { colKey: 'operation', title: '操作', width: operationWidths[activeTab.value], align: 'left', fixed: 'right' },
]);
const poolColumns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  { colKey: 'select', title: 'poolSelectTitle', width: 48 },
  { colKey: 'imageUrl', title: '商品主图', width: 96 },
  { colKey: 'product', title: '商品名称/ID', minWidth: 320 },
  { colKey: 'guidePrice', title: '指导价', width: 180 },
  {
    colKey: 'partnerPrice',
    title: pool.value[0]?.storeLevelName ? `${pool.value[0].storeLevelName}价` : '—',
    width: 180,
  },
  { colKey: 'operation', title: '操作', width: 80 },
]);
const roleColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'roleName', title: '角色', minWidth: 140 },
  { colKey: 'coefficient', title: '系数', width: 90 },
  { colKey: 'price', title: '最低可售价', minWidth: 150 },
  { colKey: 'priceSource', title: '价格来源', minWidth: 230 },
  { colKey: 'operation', title: '操作', width: 90 },
];
function time(value?: string) {
  return value ? value.replace('T', ' ').slice(0, 16).replaceAll('-', '/') : '—';
}
function money(value: number | null | undefined) {
  return value == null ? '—' : Number(value).toFixed(2);
}
function stateLabel(value?: string | null) {
  return value ? statusLabels[value] || value : '—';
}
async function load() {
  loading.value = true;
  try {
    const [products, categories] = await Promise.all([listStoreFinishedProducts(), listStoreFinishedCategories()]);
    rows.value = products;
    listCategories.value = categories;
    if (!tabs.value.some((tab) => tab.value === activeTab.value)) activeTab.value = tabs.value[0]?.value ?? 'warehouse';
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '商品加载失败'));
  } finally {
    loading.value = false;
  }
}
function resetSelection() {
  selected.value = [];
  page.value = 1;
}
function resetFilter() {
  filter.keyword = '';
  filter.category = undefined;
  searchList();
}
async function refreshAvailability(ids: number[], allowBlocked = false) {
  try {
    const latest = await listStoreFinishedProducts();
    rows.value = latest;
    selected.value = selected.value.filter((id) => latest.some((item) => item.id === id && !item.sourceUnavailable));
    const missing = ids.some((id) => !latest.some((item) => item.id === id));
    if (missing) adminFeedback.warning('商品不存在或不可访问');
    const blocked = ids.some((id) => latest.some((item) => item.id === id && item.sourceUnavailable));
    if (blocked && current.value && ids.includes(current.value.id)) priceVisible.value = false;
    return !missing && (!blocked || allowBlocked);
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '商品状态核验失败，请重试'));
    return false;
  }
}
async function previewRowImage(row: StoreFinishedProduct) {
  if (!(await refreshAvailability([row.id]))) return;
  const latest = rows.value.find((item) => item.id === row.id);
  if (latest?.imageUrl) imagePreview.value = latest.imageUrl;
}
async function toggleRow(id: number, checked: boolean) {
  if (!(await refreshAvailability([id]))) return;
  selected.value = checked ? [...new Set([...selected.value, id])] : selected.value.filter((item) => item !== id);
}
async function togglePage(checked: boolean) {
  const ids = pageRows.value.map((item) => item.id);
  if (!(await refreshAvailability(ids, true))) return;
  if (checked) {
    const available = ids.filter((id) => rows.value.some((item) => item.id === id && !item.sourceUnavailable));
    selected.value = [...new Set([...selected.value, ...available])];
  } else selected.value = selected.value.filter((id) => !ids.includes(id));
}
function priceRange(min?: number | null, max?: number | null) {
  if (min == null || max == null) return '—';
  return Number(min) === Number(max) ? money(min) : `${money(min)} ~ ${money(max)}`;
}
async function openPoolDetail(row: StorePoolProduct) {
  poolDetail.value = null;
  try {
    poolDetail.value = await getStoreFinishedPoolDetail(row.id);
    poolVisible.value = false;
    poolDetailVisible.value = true;
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '商品详情加载失败'));
  }
}
async function openPool() {
  try {
    const [products, categories] = await Promise.all([listStoreFinishedPool(), listStoreFinishedPoolCategories()]);
    pool.value = products;
    poolCategories.value = categories;
    poolCategory.value = undefined;
    poolSelected.value = [];
    poolPageSize.value = 10;
    resetPoolFilter();
    poolVisible.value = true;
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '商品池加载失败'));
  }
}
async function selectPool() {
  if (!poolSelected.value.length) {
    adminFeedback.warning('请先选择商品');
    return;
  }
  try {
    await selectStoreFinishedProducts(poolSelected.value);
    poolVisible.value = false;
    adminFeedback.success('商品已进入本店仓库');
    await load();
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '挑选商品失败'));
  }
}
async function loadCurrent(row: StoreFinishedProduct) {
  try {
    current.value = await getStoreFinishedProduct(row.id);
    const latest = current.value;
    rows.value = rows.value.map((item) => (item.id === latest.id ? latest : item));
    if (latest.sourceUnavailable) selected.value = selected.value.filter((id) => id !== latest.id);
    return true;
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '商品详情加载失败'));
    return false;
  }
}
async function openDetail(row: StoreFinishedProduct) {
  if (await loadCurrent(row)) detailVisible.value = true;
}
function fillPriceDrafts(product: StoreFinishedProduct) {
  for (const sku of product.skus) {
    for (const role of sku.rolePrices) {
      const key = `${sku.skuId}:${role.roleId}`;
      roleDrafts[key] = role.price;
      roleSources[key] = role.priceSource;
    }
  }
}
async function openPrice(row: StoreFinishedProduct) {
  if ((await loadCurrent(row)) && current.value) {
    if (current.value.sourceUnavailable) {
      await refreshAvailability([row.id]);
      return;
    }
    fillPriceDrafts(current.value);
    priceVisible.value = true;
  }
}
function syncRoleDraft(skuId: number, role: StoreRolePrice) {
  if (roleSources[`${skuId}:${role.roleId}`] === 'auto') roleDrafts[`${skuId}:${role.roleId}`] = role.price;
}
async function saveRole(skuId: number, roleId: number) {
  if (!current.value || !(await refreshAvailability([current.value.id]))) return;
  const key = `${skuId}:${roleId}`;
  const follow = roleSources[key] === 'auto';
  const price = roleDrafts[key];
  if (!follow && (price == null || price < 0)) {
    adminFeedback.warning('请输入角色最低可售价');
    return;
  }
  try {
    current.value = await saveStoreFinishedRolePrice(current.value.id, skuId, roleId, price, follow);
    fillPriceDrafts(current.value);
    adminFeedback.success('角色最低可售价已保存');
    await load();
  } catch (error) {
    if (current.value && (await refreshAvailability([current.value.id])))
      adminFeedback.error(getSafeErrorMessage(error, '保存价格失败'));
  }
}
function prepareAction(kind: ActionKind | 'off-shelf', product: StoreFinishedProduct) {
  if (kind === 'off-shelf') {
    pendingOffShelf.value = { ids: [product.id], batch: false };
    offShelf.reason = '';
    offShelf.detail = '';
    offShelfVisible.value = true;
    return;
  }
  const labels: Record<ActionKind, string> = {
    shelf: '上架',
    delete: '删除至回收站',
    restore: '放回仓库',
    purge: '彻底删除',
    'batch-shelf': '批量上架',
    'batch-restore': '批量放回仓库',
    'batch-purge': '批量彻底删除',
    clear: '清空回收站',
  };
  confirm.value = { kind, label: labels[kind], product };
}
async function prepareBatch() {
  const action = batchAction.value;
  if (!action) return;
  if (!selected.value.length) {
    adminFeedback.warning('请先选择商品');
    return;
  }
  if (!(await refreshAvailability([...selected.value]))) return;
  if (action.kind === 'off-shelf') {
    pendingOffShelf.value = { ids: [...selected.value], batch: true };
    offShelf.reason = '';
    offShelf.detail = '';
    offShelfVisible.value = true;
    return;
  }
  confirm.value = { kind: action.kind, label: action.label, ids: [...selected.value] };
}
async function confirmOffShelf() {
  if (submittingOffShelf.value) return;
  const ids = pendingOffShelf.value?.ids;
  if (!ids) return;
  if (!(await refreshAvailability(ids))) {
    offShelfVisible.value = false;
    return;
  }
  if (!offShelf.reason) {
    adminFeedback.warning(pendingOffShelf.value?.batch ? '请选择原因' : '请选择下架原因');
    return;
  }
  const pending = pendingOffShelf.value;
  if (!pending) return;
  submittingOffShelf.value = true;
  if (pending.batch) offShelfVisible.value = false;
  try {
    if (pending.batch)
      await Promise.all(
        pending.ids.map(async (id) => {
          const changed = await changeStoreFinishedStatusBatch(
            [id],
            'offShelf',
            offShelf.reason,
            offShelf.detail.trim(),
          );
          for (const item of changed) rows.value = rows.value.map((row) => (row.id === item.id ? item : row));
        }),
      );
    else await changeStoreFinishedStatus(pending.ids[0], 'offShelf', offShelf.reason, offShelf.detail);
    offShelfVisible.value = false;
    selected.value = [];
    adminFeedback.success(pending.batch ? '已批量下架' : '商品已下架');
    await load();
  } catch (error) {
    if (await refreshAvailability(pending.ids))
      adminFeedback.error(getSafeErrorMessage(error, pending.batch ? '操作失败' : '下架失败'));
    else offShelfVisible.value = false;
  } finally {
    submittingOffShelf.value = false;
  }
}
async function runConfirmed() {
  const action = confirm.value;
  if (!action || confirming.value) return;
  confirming.value = true;
  const ids = action.ids ?? (action.product ? [action.product.id] : []);
  try {
    if (!['purge', 'batch-purge', 'clear'].includes(action.kind) && !(await refreshAvailability(ids))) {
      confirm.value = null;
      return;
    }
    if (action.kind === 'batch-shelf' && action.ids) {
      const failed = new Map<number, string>();
      let succeeded = 0;
      for (const id of action.ids) {
        delete shelfErrors[id];
        try {
          await changeStoreFinishedStatusBatch([id], 'selling');
          succeeded++;
        } catch (error) {
          failed.set(id, getSafeErrorMessage(error, '上架失败，请重试'));
        }
      }
      await load();
      for (const [id, message] of failed) {
        const latest = rows.value.find((item) => item.id === id);
        if (latest?.status === 'selling') {
          succeeded++;
          failed.delete(id);
        } else if (latest && !latest.sourceUnavailable) shelfErrors[id] = message;
      }
      selected.value = action.ids.filter(
        (id) =>
          failed.has(id) &&
          rows.value.some((item) => item.id === id && !item.sourceUnavailable && item.status === 'warehouse'),
      );
      page.value = Math.min(page.value, Math.max(1, Math.ceil(filteredRows.value.length / pageSize.value)));
      confirm.value = null;
      const message = `已上架 ${succeeded} 个商品，未上架 ${failed.size} 个商品`;
      if (failed.size) adminFeedback.warning(message);
      else adminFeedback.success(message);
      return;
    }
    const selectedCount = action.ids?.length ?? 0;
    const recycleCount = rows.value.filter((item) => item.status === 'recycle').length;
    if (action.kind === 'clear') await clearStoreFinishedRecycle();
    else if (action.kind === 'purge' && action.product) await purgeStoreFinishedProduct(action.product.id);
    else if (action.kind === 'batch-purge' && action.ids)
      await Promise.all(
        action.ids.map(async (id) => {
          await purgeStoreFinishedProducts([id]);
          rows.value = rows.value.filter((item) => item.id !== id);
        }),
      );
    else {
      const target =
        action.kind === 'shelf' || action.kind === 'batch-shelf'
          ? 'selling'
          : action.kind === 'delete'
            ? 'recycle'
            : 'warehouse';
      if (action.ids)
        await Promise.all(
          action.ids.map(async (id) => {
            const changed = await changeStoreFinishedStatusBatch([id], target);
            for (const item of changed) rows.value = rows.value.map((row) => (row.id === item.id ? item : row));
          }),
        );
      else if (action.product) await changeStoreFinishedStatus(action.product.id, target);
    }
    confirm.value = null;
    selected.value = [];
    if (action.kind === 'batch-purge') adminFeedback.deleted(`${selectedCount} 个商品`);
    else if (action.kind === 'clear') adminFeedback.deleted(`${recycleCount} 个回收站商品`);
    else adminFeedback.success(action.kind === 'batch-restore' ? '操作已完成' : '操作成功');
    await load();
  } catch (error) {
    if (['purge', 'batch-purge', 'clear'].includes(action.kind) || (await refreshAvailability(ids)))
      adminFeedback.error(getSafeErrorMessage(error, '操作失败'));
    else confirm.value = null;
  } finally {
    confirming.value = false;
  }
}
onMounted(load);
</script>
<style scoped src="./index.css"></style>
