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
        <AdminListLayout v-if="tabs.length">
          <template #toolbar>
            <div class="list-controls">
              <t-tabs v-model="activeTab" :list="tabs" @change="resetSelection" />
              <t-form class="zdm-admin-filter-form" label-width="auto" :data="filter" colon>
                <div class="filter-row">
                  <div class="filter-fields">
                    <t-form-item label="商品"
                      ><t-input v-model="filter.keyword" clearable placeholder="商品名称 / ID" @enter="page = 1"
                    /></t-form-item>
                    <t-form-item label="商品分类">
                      <t-select v-model="filter.category" clearable placeholder="请选择">
                        <t-option v-for="item in categoryOptions" :key="item" :value="item" :label="item" />
                      </t-select>
                    </t-form-item>
                    <t-form-item label="供应商">
                      <t-select v-model="filter.supplier" clearable placeholder="请选择">
                        <t-option v-for="item in supplierOptions" :key="item" :value="item" :label="item" />
                      </t-select>
                    </t-form-item>
                  </div>
                  <div class="filter-actions">
                    <t-button theme="primary" @click="page = 1"
                      ><template #icon><t-icon name="search" /></template>查询</t-button
                    >
                    <t-button variant="base" @click="resetFilter"
                      ><template #icon><t-icon name="refresh" /></template>重置</t-button
                    >
                  </div>
                </div>
              </t-form>
              <div class="table-toolbar">
                <t-space>
                  <t-button
                    v-if="activeTab === 'warehouse' && can('warehouse', 'select')"
                    theme="primary"
                    @click="openPool"
                    ><template #icon><t-icon name="add" /></template>挑选商品</t-button
                  >
                  <t-button v-if="batchAction" theme="default" :disabled="!selected.length" @click="prepareBatch">{{
                    batchAction.label
                  }}</t-button>
                  <t-button
                    v-if="activeTab === 'recycle' && can('recycle', 'batch-purge')"
                    theme="danger"
                    variant="base"
                    :disabled="!selected.length"
                    @click="confirm = { kind: 'batch-purge', label: '批量彻底删除', ids: [...selected] }"
                    >批量彻底删除</t-button
                  >
                  <t-button
                    v-if="activeTab === 'recycle' && can('recycle', 'clear')"
                    theme="danger"
                    variant="base"
                    @click="confirm = { kind: 'clear', label: '清空回收站' }"
                    >清空回收站</t-button
                  >
                </t-space>
                <span>已选 {{ selected.length }} 项</span>
              </div>
            </div>
          </template>
          <template #table>
            <SourceUnavailableOverlay :rows="pageRows.filter((item) => item.sourceUnavailable)">
              <t-table
                :key="activeTab"
                row-key="id"
                :data="pageRows"
                :columns="columns"
                :loading="loading"
                :row-attributes="
                  ({ row }: { row: StoreFinishedProduct }) =>
                    row.sourceUnavailable ? { 'data-source-id': row.id, inert: true } : {}
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
                  ><div>{{ row.name }}</div>
                  <div>ID：{{ row.productId }}</div></template
                >
                <template #imageUrl="{ row }"
                  ><t-image
                    v-if="row.imageUrl"
                    :src="row.imageUrl"
                    fit="cover"
                    :style="{ width: '48px', height: '48px' }"
                    @click="imagePreview = row.imageUrl"
                /></template>
                <template #totalStock="{ row }">{{ row.totalStock ?? 0 }}</template>
                <template #createdAt="{ row }">{{ time(row.createdAt) }}</template>
                <template #offShelfReason="{ row }">
                  <t-tooltip :content="row.offShelfDetail || '—'">{{ row.offShelfReason || '—' }}</t-tooltip>
                </template>
                <template #offShelfAt="{ row }">{{ time(row.offShelfAt) }}</template>
                <template #operation="{ row }">
                  <t-space size="small">
                    <t-link v-if="can(activeScope, 'detail')" theme="primary" @click="openDetail(row)">详情</t-link>
                    <t-link v-if="can(activeScope, 'price')" theme="primary" @click="openPrice(row)">价格</t-link>
                    <t-link
                      v-if="rowAction && can(activeScope, rowAction.permission)"
                      :theme="rowAction.theme"
                      @click="prepareAction(rowAction.kind, row)"
                      >{{ rowAction.label }}</t-link
                    >
                    <t-link
                      v-if="secondRowAction && can(activeScope, secondRowAction.permission)"
                      :theme="secondRowAction.theme"
                      @click="prepareAction(secondRowAction.kind, row)"
                      >{{ secondRowAction.label }}</t-link
                    >
                  </t-space>
                </template>
                <template #empty>暂无商品</template>
              </t-table>
              <template #overlay="{ row }">
                <t-space align="center"
                  ><t-icon name="info-circle" />{{ row.sourceMessage || '上游商品不可用' }}</t-space
                >
                <t-space size="small">
                  <t-button
                    v-if="
                      can(
                        row.effectiveStatus === 'offShelf'
                          ? 'off-shelf'
                          : row.effectiveStatus === 'soldOut'
                            ? 'sold-out'
                            : row.effectiveStatus,
                        'detail',
                      )
                    "
                    size="small"
                    @click="openDetail(row)"
                    >详情</t-button
                  >
                  <t-button
                    v-if="canGlobal('unavailable.purge')"
                    size="small"
                    theme="danger"
                    @click="prepareAction('purge', row)"
                    >彻底删除</t-button
                  >
                </t-space>
              </template>
            </SourceUnavailableOverlay>
          </template>
          <template #pagination
            ><AdminPagination v-model:current="page" v-model:page-size="pageSize" :total="filteredRows.length"
          /></template>
        </AdminListLayout>
        <t-empty v-else description="暂无成品现货管理权限" />
      </main>
    </div>

    <AdminDialog
      v-model:visible="poolVisible"
      header="从运营端已上架商品中挑选"
      width="min(1000px, 94vw)"
      @confirm="selectPool"
      @cancel="poolVisible = false"
      @close="poolVisible = false"
    >
      <t-space direction="vertical" style="width: 100%">
        <t-input v-model="poolKeyword" clearable placeholder="搜索商品名称 / ID" />
        <t-table row-key="id" :data="filteredPool" :columns="poolColumns" hover>
          <template #select="{ row }"
            ><t-checkbox
              :checked="poolSelected.includes(row.id)"
              @change="
                (checked: boolean) =>
                  (poolSelected = checked ? [...poolSelected, row.id] : poolSelected.filter((id) => id !== row.id))
              "
          /></template>
          <template #product="{ row }"
            >{{ row.name }}
            <div>ID：{{ row.id }}</div></template
          >
          <template #empty>暂无可挑选的已上架商品</template>
        </t-table>
      </t-space>
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
            <t-descriptions-item label="指导价来源">{{
              sku.guideSource === 'manual' ? '本店手工价格' : '运营端指导价'
            }}</t-descriptions-item>
          </t-descriptions>
          <t-space align="center" style="margin-top: 16px">
            <span>本店指导价</span>
            <t-input-number
              v-model="guideDrafts[sku.skuId]"
              :min="0"
              :decimal-places="2"
              :disabled="!priceEditable"
              theme="normal"
            />
            <t-button v-if="priceEditable" theme="primary" @click="saveGuide(sku.skuId)">保存指导价</t-button>
          </t-space>
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
      header="下架商品"
      width="500px"
      @confirm="confirmOffShelf"
      @cancel="offShelfVisible = false"
      @close="offShelfVisible = false"
    >
      <t-form :data="offShelf" label-width="92px" colon>
        <t-form-item label="下架原因"
          ><t-select v-model="offShelf.reason" placeholder="请选择"
            ><t-option value="商品暂停售卖" label="商品暂停售卖" /><t-option
              value="商品信息调整"
              label="商品信息调整" /><t-option value="其他" label="其他" /></t-select
        ></t-form-item>
        <t-form-item label="详细说明"
          ><t-textarea v-model="offShelf.detail" :maxlength="500" placeholder="选填"
        /></t-form-item>
      </t-form>
    </AdminDialog>
    <AdminConfirmDialog
      :visible="Boolean(confirm)"
      :action="confirm?.label || ''"
      object-type="商品"
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
        <FinishedEditChanges
          v-if="Object.keys(logChanges).length"
          :changes="logChanges"
          :media="[]"
          before-html=""
          after-html=""
        />
      </template>
    </ProductOperationLogTemplate>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminListLayout,
  AdminPagination,
  AdminSectionCard,
  adminFeedback,
  getSafeErrorMessage,
} from '@/components/foundation';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import ProductOperationLogTemplate from '@/components/product-logs/ProductOperationLogTemplate.vue';
import { productOperationTypeOptions, type ProductOperationLogRow } from '@/services/productOperationLog';
import {
  changeStoreFinishedStatus,
  changeStoreFinishedStatusBatch,
  clearStoreFinishedRecycle,
  getStoreFinishedProduct,
  getStoreFinishedLog,
  listStoreFinishedLogs,
  listStoreFinishedPool,
  listStoreFinishedProducts,
  purgeStoreFinishedProduct,
  purgeStoreFinishedProducts,
  saveStoreFinishedGuide,
  saveStoreFinishedRolePrice,
  selectStoreFinishedProducts,
  type StoreFinishedLog,
  type StoreFinishedProduct,
  type StoreFinishedStatus,
  type StorePoolProduct,
  type StoreRolePrice,
} from '@/services/storeFinishedStock';
import SourceUnavailableOverlay from '../management/components/SourceUnavailableOverlay.vue';
import FinishedEditChanges from '../management/components/FinishedEditChanges.vue';
import StoreProductDetail from './product-detail.vue';

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
const filter = reactive({ keyword: '', category: '', supplier: '' });
const categoryOptions = computed(() =>
  [...new Set(rows.value.map((row) => row.categoryName).filter((value): value is string => Boolean(value)))].sort(),
);
const supplierOptions = computed(() =>
  [...new Set(rows.value.map((row) => row.supplierName).filter((value): value is string => Boolean(value)))].sort(),
);
const selected = ref<number[]>([]);
const filteredRows = computed(() =>
  rows.value.filter(
    (row) =>
      row.effectiveStatus === activeTab.value &&
      (!filter.keyword.trim() || `${row.name} ${row.productId}`.includes(filter.keyword.trim())) &&
      (!filter.category || row.categoryName === filter.category) &&
      (!filter.supplier || row.supplierName === filter.supplier),
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
const priceVisible = ref(false);
const guideDrafts = reactive<Record<number, number | null>>({});
const roleDrafts = reactive<Record<string, number | null>>({});
const roleSources = reactive<Record<string, 'auto' | 'manual'>>({});
const priceEditable = computed(() =>
  Boolean(
    current.value &&
    !current.value.sourceUnavailable &&
    ['warehouse', 'selling'].includes(current.value.effectiveStatus) &&
    can(activeScope.value, 'price'),
  ),
);
const poolVisible = ref(false);
const pool = ref<StorePoolProduct[]>([]);
const poolSelected = ref<number[]>([]);
const poolKeyword = ref('');
const filteredPool = computed(() =>
  pool.value.filter((item) => `${item.name} ${item.id}`.includes(poolKeyword.value.trim())),
);
const offShelfVisible = ref(false);
const offShelf = reactive({ reason: '', detail: '' });
const pendingOffShelf = ref<{ ids: number[]; batch: boolean } | null>(null);
type ActionKind = 'shelf' | 'delete' | 'restore' | 'purge' | 'batch-shelf' | 'batch-restore' | 'batch-purge' | 'clear';
const confirm = ref<{ kind: ActionKind; label: string; product?: StoreFinishedProduct; ids?: number[] } | null>(null);
const logsVisible = ref(false);
const logs = ref<StoreFinishedLog[]>([]);
const logTotal = ref(0);
const logLoading = ref(false);
const logDetail = ref<StoreFinishedLog | null>(null);
const logDetailVisible = ref(false);
const toLogRow = (row: StoreFinishedLog): ProductOperationLogRow => ({
  id: row.id,
  subjectName: row.productName,
  subjectId: row.productId,
  operationType: row.operationType,
  operationSummary: row.operationSummary,
  operatorName: row.operatorName,
  operatedAt: row.operatedAt,
  beforeStatus:
    row.operationType.startsWith('SOURCE_') || row.operationType.startsWith('OPERATIONS_') ? null : row.beforeStatus,
  afterStatus:
    row.operationType.startsWith('SOURCE_') || row.operationType.startsWith('OPERATIONS_') ? null : row.afterStatus,
});
const logDetailRow = computed(() => logDetail.value && toLogRow(logDetail.value));
const logSourceLabel = (row: ProductOperationLogRow) =>
  row.operationType.startsWith('SOURCE_')
    ? '供应链协同系统'
    : row.operationType.startsWith('OPERATIONS_')
      ? '运营管理平台'
      : '合伙人门店';
async function openLogDetail(id: number) {
  try {
    logDetail.value = await getStoreFinishedLog(id);
    logDetailVisible.value = true;
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '操作详情加载失败'));
  }
}
const logChanges = computed<Record<string, { before: unknown; after: unknown }>>(() => {
  if (!logDetail.value?.changeDetails) return {};
  try {
    const details = JSON.parse(logDetail.value.changeDetails) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(details).map(([field, value]) => {
        const label = field === '指导价' ? '本店指导价' : field;
        const change =
          value && typeof value === 'object' && 'before' in value && 'after' in value
            ? (value as { before: unknown; after: unknown })
            : { before: null, after: value };
        return [
          label,
          ['状态', '来源状态', '运营状态'].includes(field)
            ? { before: stateLabel(change.before as string), after: stateLabel(change.after as string) }
            : change,
        ];
      }),
    );
  } catch {
    return {};
  }
});
const logFilter = reactive({ keyword: '', operationType: '', operatorName: '', dateRange: [] as string[] });
const appliedLogFilter = reactive({ keyword: '', operationType: '', operatorName: '', dateRange: [] as string[] });
const logPagination = reactive({ current: 1, pageSize: 10 });
const updateLogFilter = (field: string, value: string | string[]) => Object.assign(logFilter, { [field]: value });
function changeLogPage(page: { current: number; pageSize: number }) {
  Object.assign(logPagination, page);
  void loadLogs();
}
const logTypeOptions = productOperationTypeOptions([
  'SELECT',
  'SHELF',
  'OFF_SHELF',
  'RESTORE',
  'DELETE_TO_RECYCLE',
  'PURGE',
  'PRICE_UPDATE',
  'SOURCE_SHELF',
  'SOURCE_OFF_SHELF',
  'SOURCE_DELETE',
  'OPERATIONS_SHELF',
  'OPERATIONS_OFF_SHELF',
  'OPERATIONS_DELETE_TO_RECYCLE',
  'OPERATIONS_PURGE',
]);
const logRows = computed(() => logs.value.map(toLogRow));
const rowActions: Record<
  string,
  { kind: ActionKind | 'off-shelf'; label: string; permission: string; theme: 'primary' | 'danger' | 'warning' }[]
> = {
  warehouse: [
    { kind: 'shelf', label: '上架', permission: 'shelf', theme: 'primary' },
    { kind: 'delete', label: '删除', permission: 'delete', theme: 'danger' },
  ],
  selling: [{ kind: 'off-shelf', label: '下架', permission: 'off-shelf', theme: 'warning' }],
  offShelf: [
    { kind: 'restore', label: '放回仓库', permission: 'restore', theme: 'primary' },
    { kind: 'delete', label: '删除', permission: 'delete', theme: 'danger' },
  ],
  soldOut: [],
  recycle: [
    { kind: 'restore', label: '放回仓库', permission: 'restore', theme: 'primary' },
    { kind: 'purge', label: '彻底删除', permission: 'purge', theme: 'danger' },
  ],
};
const rowAction = computed(() => rowActions[activeTab.value]?.[0]);
const secondRowAction = computed(() => rowActions[activeTab.value]?.[1]);
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
const baseColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'select', title: '全选', width: 70 },
  { colKey: 'imageUrl', title: '主图', width: 84 },
  { colKey: 'product', title: '商品名称/ID', minWidth: 220 },
  { colKey: 'supplierName', title: '供应商', minWidth: 140 },
  { colKey: 'totalStock', title: '统一库存', width: 100 },
];
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...baseColumns,
  ...(activeTab.value === 'offShelf'
    ? [
        { colKey: 'offShelfReason', title: '下架原因', minWidth: 140 },
        { colKey: 'offShelfAt', title: '下架时间', width: 180 },
      ]
    : [{ colKey: 'createdAt', title: '挑选时间', width: 180 }]),
  { colKey: 'operation', title: '操作', minWidth: 280, fixed: 'right' },
]);
const poolColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'select', title: '选择', width: 70 },
  { colKey: 'product', title: '商品名称/ID', minWidth: 220 },
  { colKey: 'supplierName', title: '供应商', minWidth: 140 },
  { colKey: 'totalStock', title: '统一库存', width: 100 },
];
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
    rows.value = await listStoreFinishedProducts();
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
  filter.category = '';
  filter.supplier = '';
  page.value = 1;
}
function toggleRow(id: number, checked: boolean) {
  selected.value = checked ? [...selected.value, id] : selected.value.filter((item) => item !== id);
}
function togglePage(checked: boolean) {
  selected.value = checked
    ? [...new Set([...selected.value, ...selectablePageIds.value])]
    : selected.value.filter((id) => !selectablePageIds.value.includes(id));
}
async function openPool() {
  try {
    pool.value = await listStoreFinishedPool();
    poolSelected.value = [];
    poolKeyword.value = '';
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
    guideDrafts[sku.skuId] = sku.guidePrice;
    for (const role of sku.rolePrices) {
      const key = `${sku.skuId}:${role.roleId}`;
      roleDrafts[key] = role.price;
      roleSources[key] = role.priceSource;
    }
  }
}
async function openPrice(row: StoreFinishedProduct) {
  if ((await loadCurrent(row)) && current.value) {
    fillPriceDrafts(current.value);
    priceVisible.value = true;
  }
}
function syncRoleDraft(skuId: number, role: StoreRolePrice) {
  if (roleSources[`${skuId}:${role.roleId}`] === 'auto') roleDrafts[`${skuId}:${role.roleId}`] = role.price;
}
async function saveGuide(skuId: number) {
  const price = guideDrafts[skuId];
  if (!current.value || price == null || price < 0) {
    adminFeedback.warning('请输入指导价');
    return;
  }
  try {
    current.value = await saveStoreFinishedGuide(current.value.id, skuId, price);
    fillPriceDrafts(current.value);
    adminFeedback.success('指导价已保存');
    await load();
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '保存指导价失败'));
  }
}
async function saveRole(skuId: number, roleId: number) {
  if (!current.value) return;
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
function prepareBatch() {
  const action = batchAction.value;
  if (!action || !selected.value.length) return;
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
  if (!offShelf.reason) {
    adminFeedback.warning('请选择下架原因');
    return;
  }
  const pending = pendingOffShelf.value;
  if (!pending) return;
  try {
    if (pending.batch) await changeStoreFinishedStatusBatch(pending.ids, 'offShelf', offShelf.reason, offShelf.detail);
    else await changeStoreFinishedStatus(pending.ids[0], 'offShelf', offShelf.reason, offShelf.detail);
    offShelfVisible.value = false;
    selected.value = [];
    adminFeedback.success('商品已下架');
    await load();
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '下架失败'));
  }
}
async function runConfirmed() {
  const action = confirm.value;
  if (!action) return;
  try {
    if (action.kind === 'clear') await clearStoreFinishedRecycle();
    else if (action.kind === 'purge' && action.product) await purgeStoreFinishedProduct(action.product.id);
    else if (action.kind === 'batch-purge' && action.ids) await purgeStoreFinishedProducts(action.ids);
    else {
      const target =
        action.kind === 'shelf' || action.kind === 'batch-shelf'
          ? 'selling'
          : action.kind === 'delete'
            ? 'recycle'
            : 'warehouse';
      if (action.ids) await changeStoreFinishedStatusBatch(action.ids, target);
      else if (action.product) await changeStoreFinishedStatus(action.product.id, target);
    }
    confirm.value = null;
    selected.value = [];
    adminFeedback.success('操作成功');
    await load();
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '操作失败'));
  }
}
async function openLogs() {
  Object.assign(logFilter, { keyword: '', operationType: '', operatorName: '', dateRange: [] });
  Object.assign(appliedLogFilter, logFilter);
  logPagination.current = 1;
  logsVisible.value = true;
  await loadLogs();
}
async function loadLogs() {
  logLoading.value = true;
  try {
    const result = await listStoreFinishedLogs({
      keyword: appliedLogFilter.keyword,
      operationType: appliedLogFilter.operationType,
      operatorName: appliedLogFilter.operatorName,
      startDate: appliedLogFilter.dateRange[0] || '',
      endDate: appliedLogFilter.dateRange[1] || '',
      page: logPagination.current,
      pageSize: logPagination.pageSize,
    });
    logs.value = result.records;
    logTotal.value = result.total;
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '操作日志加载失败'));
  } finally {
    logLoading.value = false;
  }
}
function searchLogs() {
  Object.assign(appliedLogFilter, logFilter, { dateRange: [...logFilter.dateRange] });
  logPagination.current = 1;
  void loadLogs();
}
function resetLogFilter() {
  Object.assign(logFilter, { keyword: '', operationType: '', operatorName: '', dateRange: [] });
  searchLogs();
}
onMounted(load);
</script>
