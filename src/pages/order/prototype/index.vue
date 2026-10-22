<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page" :class="{ 'sales-order-page': page === 'sales' && !selected }">
        <div>
          <template v-if="selected">
            <AdminDetailPage :title="selected.id" :items="detailItems">
              <t-space break-line
                ><t-button :theme="buttonTheme('back')" variant="outline" @click="selectedId = ''">返回列表</t-button
                ><t-button
                  v-for="a in detailActions"
                  :key="a.id"
                  :theme="buttonTheme(buttonFunctionFor('order-detail', a.id))"
                  @click="openAction(a.id, selected!)"
                  >{{ a.label }}</t-button
                ></t-space
              >
              <t-space v-if="warnings(selected).length" break-line
                ><t-tag v-for="w in warnings(selected)" :key="w" theme="warning" variant="light">{{
                  w
                }}</t-tag></t-space
              >
              <h3 class="form-section-title">商品与金额</h3>
              <AdminListPage
                :table-props="{
                  rowKey: 'sku',
                  data: selected.lines,
                  columns: lineColumns,
                  pagination: undefined,
                  bordered: true,
                }"
              >
                <template #price="{ row }">{{ money(row.price) }}</template
                ><template #pending="{ row }">{{ remaining(row) }}</template>
              </AdminListPage>
              <AdminDetailPage embedded title="金额计算过程" :items="priceItems" />
              <h3 class="form-section-title">供货与发货安排</h3>
              <AdminListPage
                :table-props="{
                  rowKey: 'id',
                  data: selected.plans,
                  columns: planColumns,
                  pagination: undefined,
                  bordered: true,
                }"
              >
                <template #source="{ row }">{{ row.source === 'local' ? '本店实物' : '供应链供货' }}</template
                ><template #route="{ row }">{{ row.route === 'store' ? '先发到门店' : '直接交付客户' }}</template
                ><template #status="{ row }">{{
                  row.voided
                    ? '已撤销'
                    : row.shipped === row.quantity
                      ? '已执行'
                      : row.received > 0
                        ? '已部分/全部到店'
                        : row.source === 'supply'
                          ? '待供应链反馈（模拟）'
                          : '待执行'
                }}</template>
                <template #operation="{ row }"
                  ><t-link
                    v-if="!row.voided && row.shipped < row.quantity && can('revoke-plan', selected!)"
                    hover="color"
                    :theme="buttonTheme('archive')"
                    @click="openAction('revoke-plan', selected!, row.id)"
                    >撤销未发安排</t-link
                  ></template
                >
              </AdminListPage>
              <h3 class="form-section-title">客户实际发货记录</h3>
              <AdminListPage
                :table-props="{
                  rowKey: 'id',
                  data: selected.shipments,
                  columns: shipmentColumns,
                  pagination: undefined,
                  bordered: true,
                }"
              >
                <template #at="{ row }">{{ time(row.at) }}</template
                ><template #voided="{ row }">{{ row.voided ? '已作废' : '有效' }}</template
                ><template #operation="{ row }"
                  ><t-link
                    v-if="!row.voided && can('correct-shipment', selected!)"
                    hover="color"
                    :theme="buttonTheme('edit')"
                    @click="openAction('correct-shipment', selected!, row.id)"
                    >更正／作废</t-link
                  ></template
                >
              </AdminListPage>
              <h3 class="form-section-title">收款与退款记录</h3>
              <AdminListPage
                :table-props="{
                  rowKey: 'id',
                  data: selected.payments,
                  columns: paymentColumns,
                  pagination: undefined,
                  bordered: true,
                }"
              >
                <template #kind="{ row }">{{ row.kind === 'receipt' ? '收款' : '退款' }}</template
                ><template #amount="{ row }">{{ money(row.amount) }}</template
                ><template #at="{ row }">{{ time(row.at) }}</template
                ><template #voided="{ row }">{{ row.voided ? '已作废' : '有效' }}</template>
                <template #proof="{ row }"
                  ><t-link v-if="row.proof" :theme="buttonTheme('view')" hover="color" @click="proofUrl = row.proof.url"
                    >查看凭证</t-link
                  ><span v-else>—</span></template
                >
                <template #operation="{ row }"
                  ><t-space v-if="!row.voided" size="small"
                    ><t-link
                      v-if="can('correct-payment', selected!)"
                      :theme="buttonTheme('view')"
                      hover="color"
                      @click="openAction('correct-payment', selected!, row.id)"
                      >更正</t-link
                    ><t-link
                      v-if="can('void-payment', selected!)"
                      hover="color"
                      :theme="buttonTheme('archive')"
                      @click="openAction('void-payment', selected!, row.id)"
                      >作废</t-link
                    ></t-space
                  ></template
                >
              </AdminListPage>
              <h3 class="form-section-title">操作记录</h3>
              <AdminListPage
                :table-props="{
                  rowKey: 'id',
                  data: selected.logs,
                  columns: logColumns,
                  pagination: { ...detailPagination, total: selected.logs.length },
                }"
                @page-change="updateListPagination(detailPagination, $event)"
              >
                <template #at="{ row }">{{ time(row.at) }}</template
                ><template #change="{ row }"
                  ><t-link :theme="buttonTheme('view')" hover="color" @click="logDetail = row"
                    >查看前后数据</t-link
                  ></template
                >
              </AdminListPage>
            </AdminDetailPage>
          </template>
          <SalesOrderList
            v-else-if="page === 'sales'"
            v-model:filter-values="filterDraft"
            :tabs="tabs"
            :active-tab="status"
            :filters="filters"
            :actions="toolbarActions"
            :rows="rows"
            :can="can"
            :expanded-order-ids="expandedOrderIds"
            :pagination="{
              current: pageNumber,
              pageSize,
              total: filtered.length,
              showJumper: true,
              showPageSize: true,
            }"
            @expand-change="updateOrderExpansion"
            @tab-change="switchTab"
            @search="search"
            @reset="reset"
            @action="openAction"
            @page-change="changePage"
          />
          <AdminListPage
            v-else-if="page === 'fulfillment'"
            :table-props="{
              rowKey: 'id',
              data: tasks,
              columns: taskColumns,
              pagination: { ...fulfillmentPagination, total: tasks.length },
            }"
            @page-change="updateListPagination(fulfillmentPagination, $event)"
          >
            <template #orderId="{ row }"
              ><span>{{ row.orderId }}</span>
            </template>
            <template #operation="{ row }"
              ><t-space size="small"
                ><t-link
                  v-if="
                    row.source === 'supply' &&
                    row.route === 'store' &&
                    row.received < row.quantity &&
                    canTask('receive')
                  "
                  :theme="buttonTheme('view')"
                  hover="color"
                  @click="openAction('receive', findOrder(row.orderId), row.id)"
                  >登记收货</t-link
                ><t-link
                  v-if="canTask('ship') && (row.source === 'local' || row.received > row.shipped)"
                  :theme="buttonTheme('view')"
                  hover="color"
                  @click="openAction('ship', findOrder(row.orderId), row.id)"
                  >登记客户发货</t-link
                ></t-space
              ></template
            >
          </AdminListPage>
          <AdminListPage
            v-else
            v-model:filter-values="settingsFilters"
            :tabs="configTabs"
            :active-tab="settingGroup"
            :actions="configActions"
            :table-props="{
              rowKey: 'id',
              data: settingsRows,
              columns: settingColumns,
              pagination: { ...settingsPagination, total: settingsRows.length },
            }"
            @page-change="updateListPagination(settingsPagination, $event)"
            @action="openSetting()"
          >
            <template #createdByName="{ row }">{{
              row.createdBy === context.accountId ? context.name : row.createdByName || '—'
            }}</template>
            <template #createdAt="{ row }">{{ time(row.createdAt) }}</template>
            <template #enabled="{ row }"
              ><t-tag :theme="row.enabled ? 'success' : 'default'" variant="light">{{
                row.enabled ? '启用' : '停用'
              }}</t-tag></template
            ><template #operation="{ row }"
              ><t-space>
                <t-link v-if="canSetting('edit')" hover="color" :theme="buttonTheme('edit')" @click="openSetting(row)"
                  >编辑</t-link
                >
                <t-link
                  v-if="canSetting('toggle-status')"
                  hover="color"
                  :theme="buttonTheme(row.enabled ? 'disable' : 'enable')"
                  @click="openToggleSetting(row)"
                  >{{ row.enabled ? '停用' : '启用' }}</t-link
                >
                <t-link
                  v-if="canSetting('delete')"
                  hover="color"
                  :theme="buttonTheme('delete')"
                  @click="
                    deletingSetting = row;
                    deleteSettingVisible = true;
                  "
                  >删除</t-link
                >
              </t-space></template
            >
          </AdminListPage>
        </div>
      </main>
    </div>
    <OrderEditor
      v-model:visible="editorVisible"
      :order="editingOrder"
      :state="state"
      :editing="editing"
      @save="saveEditor"
    />
    <OrderActionDialog
      v-if="actionOrder"
      v-model:visible="actionVisible"
      :action="action"
      :label="actionLabel"
      :order="actionOrder"
      :state="state"
      :record-id="recordId"
      :execute="execute"
    />
    <AdminFormDialog
      ref="settingDialog"
      v-model:visible="settingVisible"
      :header="`${editingSettingId ? '编辑' : '新增'}款项名称`"
      :data="{ name: settingName }"
      :confirm-function="editingSettingId ? 'edit' : 'create'"
      :confirmation="formConfirmation(editingSettingId ? 'edit' : 'create')"
      @confirm="addSetting"
      ><t-form-item label="名称" required v-bind="settingFeedback.field('name', settingName)"
        ><t-input v-model="settingName" placeholder="请输入名称" /></t-form-item
    ></AdminFormDialog>
    <AdminConfirmDialog
      v-model:visible="toggleSettingVisible"
      :function="pendingToggleSetting?.enabled ? 'disable' : 'enable'"
      :action="pendingToggleSetting?.enabled ? '停用' : '启用'"
      object-type="款项名称"
      :object-name="pendingToggleSetting?.name"
      @confirm="confirmToggleSetting"
    />
    <AdminConfirmDialog
      v-model:visible="deleteSettingVisible"
      function="delete"
      action="删除"
      object-type="款项名称"
      :object-name="deletingSetting?.name"
      @confirm="deleteSetting"
    />
    <AdminDialog
      :visible="Boolean(proofUrl)"
      header="收退款凭证"
      width="min(960px, 94vw)"
      confirm-function="close"
      :confirmation="{ kind: 'none' }"
      :cancel-btn="null"
      :close-on-overlay-click="true"
      @update:visible="!$event && (proofUrl = '')"
      ><img :src="proofUrl" alt="收退款凭证" width="100%"
    /></AdminDialog>
    <AdminDialog
      :visible="Boolean(logDetail)"
      header="操作前后数据"
      width="min(960px, 94vw)"
      confirm-function="close"
      :confirmation="{ kind: 'close', text: '关闭' }"
      :cancel-btn="null"
      @confirm="logDetail = null"
      @update:visible="!$event && (logDetail = null)"
      ><t-descriptions v-if="logDetail" :column="1" bordered
        ><t-descriptions-item label="操作">{{ logDetail.action }}</t-descriptions-item
        ><t-descriptions-item label="操作前">
          <pre>{{ pretty(logDetail.before) }}</pre></t-descriptions-item
        ><t-descriptions-item label="操作后">
          <pre>{{ pretty(logDetail.after) }}</pre>
        </t-descriptions-item></t-descriptions
      ></AdminDialog
    >
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { PageInfo } from 'tdesign-vue-next';
import AdminTopNav from '@/components/AdminTopNav.vue';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import {
  AdminListPage,
  AdminDetailPage,
  AdminFormDialog,
  AdminConfirmDialog,
  AdminDialog,
  adminFeedback,
  type ListAction,
  type ListFilter,
  type FilterValues,
} from '@/components/foundation';
import { buttonTheme, buttonFunctionFor } from '@/components/foundation/actions/buttonFunctions';
import { formConfirmation } from '@/components/foundation/actions/confirmation';
import { getLoginUser } from '@/services/auth';
import { hasPermission } from '@/services/adminPermissions';
import { getUserFunctionAudience } from '@/services/functionAudience';
import { useFormFeedback } from '@/utils/formValidation';
import { rejectFormSubmission } from '@/utils/submitValidation';
import OrderEditor from './OrderEditor.vue';
import SalesOrderList from './SalesOrderList.vue';
import OrderActionDialog, { type ActionForm } from './OrderActionDialog.vue';
import { generateOrderNumber } from './orderNumber';
import { prefix, salesActions, taskActions, settingTabs, type SalesAction } from './resources';
import {
  statuses,
  clone,
  uid,
  now,
  money,
  pricing,
  remaining,
  shipmentProgress,
  warnings,
  scopeKey,
  createState,
  removeDefaultSettings,
  blankOrder,
  saveDraft,
  copyOrder,
  confirmOrder,
  recordPayment,
  voidPayment,
  planShipment,
  receivePlan,
  shipPlan,
  correctShipment,
  cancelLines,
  updateTerms,
  audit,
  demand,
  type Context,
  type State,
  type Order,
  type Log,
  type Setting,
  type Status,
} from './model';
const route = useRoute(),
  user = computed(() => getLoginUser());
const context = computed<Context>(() => ({
  tenantId: user.value.tenantId ?? 0,
  storeId: user.value.storeId ?? 0,
  identityId: user.value.identityId ?? user.value.id,
  accountId: user.value.id,
  name: user.value.name,
}));
const key = computed(() => scopeKey(context.value));
const state = ref<State>(createState(context.value));
const storageWarning = ref(false);
watch(
  key,
  () => {
    selectedId.value = '';
    editorVisible.value = false;
    actionVisible.value = false;
    try {
      const raw = localStorage.getItem(key.value);
      const saved = raw ? (JSON.parse(raw) as State) : null;
      state.value =
        saved?.version === 1 && scopeKey(saved.context) === key.value
          ? removeDefaultSettings(saved)
          : createState(context.value);
    } catch {
      state.value = createState(context.value);
    }
  },
  { flush: 'sync' },
);
try {
  const raw = localStorage.getItem(key.value);
  if (raw) {
    const saved = JSON.parse(raw) as State;
    if (saved.version === 1 && scopeKey(saved.context) === key.value) state.value = removeDefaultSettings(saved);
  }
} catch {
  /* Invalid prototype storage is replaced by isolated fixtures. */
}
watch(
  state,
  () => {
    try {
      localStorage.setItem(key.value, JSON.stringify(state.value));
    } catch {
      if (!storageWarning.value) {
        storageWarning.value = true;
        adminFeedback.warning('本地存储空间不足，本次原型操作只保留到页面刷新前');
      }
    }
  },
  { deep: true, immediate: true },
);
const page = computed(() =>
  route.path.endsWith('/fulfillment') ? 'fulfillment' : route.path.endsWith('/settings') ? 'settings' : 'sales',
);
watch(page, () => {
  selectedId.value = '';
});
const scopedOrders = computed(() =>
  state.value.orders.filter(
    (o) =>
      o.tenantId === context.value.tenantId &&
      o.storeId === context.value.storeId &&
      (user.value.dataPermission === 'all' ||
        user.value.permissions.includes('all') ||
        user.value.roles.includes('SUPER_ADMIN') ||
        (user.value.dataPermission === 'self' && o.ownerId === user.value.id)),
  ),
);
const expandedOrderIds = ref<Array<string | number>>([]);
function updateOrderExpansion(keys: Array<string | number>) {
  expandedOrderIds.value = keys;
}
const status = ref<Status>('pending'),
  selectedId = ref('');
const selected = computed(() => scopedOrders.value.find((o) => o.id === selectedId.value));
const can = (a: string, o?: Order) => hasPermission(user.value, `${prefix}.sales.${o?.status ?? status.value}.${a}`);
const canTask = (a: string) => hasPermission(user.value, `${prefix}.fulfillment.${a}`);
const settingGroup = ref('nature');
const canSetting = (a: string) => hasPermission(user.value, `${prefix}.settings.${settingGroup.value}.${a}`);
const tabs = computed(() =>
  statuses
    .filter((s) => hasPermission(user.value, `${prefix}.sales.${s.value}.view`))
    .map((s) => ({
      ...s,
      label: `${s.label}（${scopedOrders.value.filter((order) => order.status === s.value).length}）`,
    })),
);
const configTabs = computed(() =>
  settingTabs.filter((s) => hasPermission(user.value, `${prefix}.settings.${s.value}.view`)),
);
watch(
  tabs,
  (list) => {
    if (list.length && !list.some((s) => s.value === status.value)) status.value = list[0]!.value;
  },
  { immediate: true },
);
watch(
  configTabs,
  (list) => {
    if (list.length && !list.some((s) => s.value === settingGroup.value)) settingGroup.value = list[0]!.value;
  },
  { immediate: true },
);
const filterDraft = ref<FilterValues>({}),
  applied = ref<FilterValues>({}),
  pageNumber = ref(1),
  pageSize = ref(10);
const detailPagination = ref({ current: 1, pageSize: 5 });
const fulfillmentPagination = ref({ current: 1, pageSize: 10 });
const settingsPagination = ref({ current: 1, pageSize: 10 });
function updateListPagination(pagination: { current: number; pageSize: number }, info: PageInfo) {
  pagination.current = info.current;
  pagination.pageSize = info.pageSize;
}
function clampListPage(pagination: { current: number; pageSize: number }, total: number) {
  pagination.current = Math.min(pagination.current, Math.max(1, Math.ceil(total / pagination.pageSize)));
}
watch(selectedId, () => {
  detailPagination.value.current = 1;
});
watch(settingGroup, () => {
  settingsPagination.value.current = 1;
});
watch(
  () => selected.value?.logs.length ?? 0,
  (total) => clampListPage(detailPagination.value, total),
);
const filters = computed<ListFilter[]>(() => [
  { key: 'keyword', label: '订单', searchScope: '订单号/客户姓名/联系电话' },
  {
    key: 'owner',
    label: '负责人',
    kind: 'select',
    options: Array.from(
      new Map(scopedOrders.value.map((o) => [o.ownerId, { label: o.ownerName, value: o.ownerId }])).values(),
    ),
  },
  {
    key: 'payment',
    label: '收款状态',
    kind: 'select',
    options: ['未收款', '部分收款', '已收齐'].map((x) => ({ label: x, value: x })),
  },
  ...(status.value === 'shipped'
    ? [
        {
          key: 'shipment',
          label: '发货进度',
          kind: 'select' as const,
          options: ['部分发货', '全部发货'].map((x) => ({ label: x, value: x })),
        },
      ]
    : []),
  {
    key: 'warning',
    label: '异常',
    kind: 'select',
    options: ['缺货待补', '延期', '待退款', '发货异常', '收款异常'].map((x) => ({ label: x, value: x })),
  },
  { key: 'start', label: '创建开始日期' },
  { key: 'end', label: '创建结束日期' },
]);
const paymentStatus = (o: Order) =>
  pricing(o).outstanding === 0 ? '已收齐' : pricing(o).net > 0 ? '部分收款' : '未收款';
const dateOnly = (value: string) =>
  value ? new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) : '';
const filtered = computed(() =>
  scopedOrders.value
    .filter((o) => o.status === status.value)
    .filter((o) => {
      const f = applied.value;
      const text = String(f.keyword ?? '').trim();
      return (
        (!text || `${o.id} ${o.customerName} ${o.phone}`.includes(text)) &&
        (!f.owner || o.ownerId === Number(f.owner)) &&
        (!f.payment || paymentStatus(o) === f.payment) &&
        (!f.shipment || shipmentProgress(o).label === f.shipment) &&
        (!f.warning || warnings(o).includes(String(f.warning))) &&
        (!f.start || (Boolean(o.createdAt) && dateOnly(o.createdAt) >= String(f.start))) &&
        (!f.end || (Boolean(o.createdAt) && dateOnly(o.createdAt) <= String(f.end)))
      );
    })
    .sort((a, b) => b.statusAt.localeCompare(a.statusAt)),
);
const rows = computed(() =>
  filtered.value.slice((pageNumber.value - 1) * pageSize.value, pageNumber.value * pageSize.value),
);
function search() {
  expandedOrderIds.value = [];
  applied.value = { ...filterDraft.value };
  pageNumber.value = 1;
}
function reset() {
  filterDraft.value = {};
  search();
}
function switchTab(v: string | number) {
  status.value = String(v) as Status;
  reset();
}
function changePage(info: PageInfo) {
  if (info.current === pageNumber.value && info.pageSize === pageSize.value) return;
  expandedOrderIds.value = [];
  pageNumber.value = info.current;
  pageSize.value = info.pageSize;
}
const toolbarActions = computed<ListAction[]>(() =>
  can('create') ? [{ id: 'create', label: '新增订单', function: 'create', icon: 'add' }] : [],
);
const editingOrder = ref(blankOrder(context.value, state.value.orders)),
  editing = ref(false),
  editorVisible = ref(false);
const actionVisible = ref(false),
  action = ref(''),
  recordId = ref(''),
  actionOrderId = ref('');
const actionOrder = computed(() => scopedOrders.value.find((o) => o.id === actionOrderId.value));
const actionLabel = computed(
  () => [...salesActions, ...taskActions].find(([id]) => id === action.value)?.[1] ?? '确认订单',
);
const detailActions = computed<ListAction[]>(() => {
  const o = selected.value;
  if (!o) return [];
  const actions: { id: SalesAction; function: ListAction['function'] }[] = [{ id: 'copy', function: 'create' }];
  if (o.status === 'pending') actions.push({ id: 'edit', function: 'edit' }, { id: 'confirm', function: 'submit' });
  if (o.status !== 'cancelled') actions.push({ id: 'receipt', function: 'create' });
  actions.push({ id: 'refund', function: 'create' });
  if (['confirmed', 'shipped'].includes(o.status) && shipmentProgress(o).pending > 0)
    actions.push({ id: 'plan', function: 'submit' }, { id: 'supply', function: 'submit' });
  if (!['completed', 'cancelled'].includes(o.status)) {
    actions.push({ id: 'cancel', function: 'archive' }, { id: 'terms', function: 'edit' });
  }
  return actions
    .filter((a) => can(a.id, o))
    .map((a) => ({ ...a, label: salesActions.find(([id]) => id === a.id)![1] }));
});
function findOrder(id: string) {
  const o = scopedOrders.value.find((o) => o.id === id);
  demand(o, '订单不在当前数据范围内');
  return o;
}
function openAction(id: string, o?: Order, rid = '') {
  try {
    demand(getUserFunctionAudience(user.value) === 'store', '仅门店端可访问订单原型');
    if (id === 'ship' || id === 'receive') demand(canTask(id), '没有操作权限');
    else demand(can(id, o), '没有操作权限');
    if (id === 'detail' && o) {
      selectedId.value = o.id;
      return;
    }
    if (['create', 'copy', 'edit'].includes(id)) {
      editing.value = id === 'edit';
      editingOrder.value =
        id === 'create'
          ? blankOrder(context.value, state.value.orders)
          : id === 'copy'
            ? copyOrder(state.value, o!, context.value)
            : clone(o!);
      if (id === 'copy' && o) {
        const skipped = o.lines.filter((l) => !state.value.products.some((p) => p.sku === l.sku && p.available));
        if (skipped.length) adminFeedback.warning(`以下已下架商品未复制：${skipped.map((l) => l.name).join('、')}`);
      }
      editorVisible.value = true;
      return;
    }
    demand(o, '请选择订单');
    action.value = id;
    recordId.value = rid;
    actionOrderId.value = o.id;
    actionVisible.value = true;
  } catch (e) {
    adminFeedback.error(e instanceof Error ? e.message : '操作失败');
  }
}
function saveEditor(o: Order, reason: string) {
  try {
    demand(can(editing.value ? 'edit' : 'create', o), '没有保存权限');
    if (!editing.value && state.value.orders.some((existing) => existing.id === o.id))
      o.id = generateOrderNumber(state.value.orders.map((existing) => existing.id));
    saveDraft(state.value, o, context.value, reason);
    editorVisible.value = false;
    selectedId.value = o.id;
    adminFeedback.success('模拟订单已保存，尚未确认');
  } catch (e) {
    adminFeedback.error(e instanceof Error ? e.message : '保存失败');
  }
}
function execute(f: ActionForm) {
  const o = findOrder(actionOrderId.value),
    c = context.value;
  demand(
    action.value === 'ship' || action.value === 'receive' ? canTask(action.value) : can(action.value, o),
    '没有操作权限',
  );
  if (action.value === 'confirm') confirmOrder(state.value, o, c);
  else if (['receipt', 'refund', 'correct-payment'].includes(action.value)) {
    const existing = o.payments.find((p) => p.id === recordId.value),
      kind = action.value === 'correct-payment' ? existing!.kind : action.value === 'receipt' ? 'receipt' : 'refund';
    recordPayment(
      o,
      {
        id: existing?.id ?? uid(),
        kind,
        amount: f.amount,
        nature: f.nature,
        method: f.method,
        at: f.at,
        reason: f.reason,
        remark: f.remark,
        proof: f.proof?.url ? { name: f.proof.name, url: f.proof.url } : undefined,
        voided: false,
      },
      c,
      action.value === 'correct-payment' ? recordId.value : undefined,
    );
  } else if (action.value === 'void-payment') voidPayment(o, recordId.value, c, f.reason);
  else if (action.value === 'plan' || action.value === 'supply') {
    const product = state.value.products.find((p) => p.sku === f.sku);
    demand(action.value !== 'plan' || product?.local, '本店没有该实物，请向供应链下单');
    planShipment(
      o,
      {
        id: uid(),
        sku: f.sku,
        quantity: f.quantity,
        shipped: 0,
        received: 0,
        source: action.value === 'supply' ? 'supply' : 'local',
        route: action.value === 'supply' ? f.route : 'customer',
        mode: f.mode,
        recipient: f.recipient,
        phone: f.phone,
        address: f.address,
        at: now(),
        voided: false,
      },
      c,
    );
  } else if (action.value === 'ship')
    shipPlan(
      state.value,
      o,
      o.plans.find((p) => p.id === recordId.value)!,
      f.quantity,
      f.at,
      c,
    );
  else if (action.value === 'receive')
    receivePlan(
      state.value,
      o,
      o.plans.find((p) => p.id === recordId.value)!,
      f.quantity,
      c,
    );
  else if (action.value === 'correct-shipment')
    correctShipment(state.value, o, recordId.value, f.quantity, c, f.reason);
  else if (action.value === 'cancel')
    cancelLines(state.value, o, f.cancelQuantities, f.billings, f.discount, f.reduction, f.rounding, f.reason, c, {
      mode: f.discountMode,
      discounts: f.lineDiscounts,
    });
  else if (action.value === 'terms')
    updateTerms(o, c, f.freight, f.due, f.ownerId, f.ownerId === c.accountId ? c.name : '示例导购', f.reason);
  else if (action.value === 'revoke-plan') {
    demand(f.reason.trim(), '请输入撤销原因');
    const p = o.plans.find((p) => p.id === recordId.value)!;
    demand(!p.voided && p.shipped < p.quantity, '无可撤销数量');
    const before = clone(p);
    p.quantity = p.shipped;
    p.voided = p.shipped === 0;
    audit(o, c, '撤销未发安排', before, { plan: p, reason: f.reason, notice: '已通知执行方，保留订单统一库存占用' });
  }
  adminFeedback.success('模拟记录已更新');
}
const tasks = computed(() =>
  scopedOrders.value.flatMap((o) =>
    o.plans
      .filter((p) => !p.voided && p.shipped < p.quantity && (p.source === 'local' || p.route === 'store'))
      .map((p) => ({ ...p, orderId: o.id, name: o.lines.find((l) => l.sku === p.sku)?.name })),
  ),
);
const settingsFilters = ref<FilterValues>({});
const settingsRows = computed(() =>
  state.value.settings
    .filter((s) => s.group === settingGroup.value)
    .sort((a, b) => (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0)),
);
watch(
  () => tasks.value.length,
  (total) => clampListPage(fulfillmentPagination.value, total),
);
watch(
  () => settingsRows.value.length,
  (total) => clampListPage(settingsPagination.value, total),
);
const configActions = computed<ListAction[]>(() =>
  canSetting('create') ? [{ id: 'create', label: '新增', function: 'create' }] : [],
);
const settingVisible = ref(false),
  settingName = ref(''),
  editingSettingId = ref('');
const deletingSetting = ref<Setting | null>(null),
  deleteSettingVisible = ref(false);
const pendingToggleSetting = ref<Setting | null>(null),
  toggleSettingVisible = ref(false);
const settingDialog = ref<InstanceType<typeof AdminFormDialog>>();
const settingFeedback = useFormFeedback(settingVisible);
function openSetting(row?: Setting) {
  if (!canSetting(row ? 'edit' : 'create')) return;
  editingSettingId.value = row?.id ?? '';
  settingName.value = row?.name ?? '';
  settingVisible.value = true;
}
async function addSetting() {
  if (!canSetting(editingSettingId.value ? 'edit' : 'create')) return;
  const name = settingName.value.trim();
  if (
    !name ||
    state.value.settings.some(
      (s) => s.group === settingGroup.value && s.name === name && s.id !== editingSettingId.value,
    )
  ) {
    settingFeedback.reject('name', settingName.value, !name ? '请输入名称' : '该名称已存在');
    await rejectFormSubmission(settingDialog.value);
    return;
  }
  if (editingSettingId.value) {
    const row = state.value.settings.find((s) => s.id === editingSettingId.value && s.group === settingGroup.value);
    if (!row) return;
    row.name = name;
  } else {
    state.value.settings.push({
      id: uid(),
      group: settingGroup.value as 'nature' | 'method',
      name,
      enabled: true,
      createdBy: context.value.accountId,
      createdByName: context.value.name,
      createdAt: now(),
    });
  }
  settingVisible.value = false;
  adminFeedback.actionSuccess({ action: editingSettingId.value ? '修改' : '新增', target: name });
}
function openToggleSetting(s: Setting) {
  if (!canSetting('toggle-status')) return;
  pendingToggleSetting.value = s;
  toggleSettingVisible.value = true;
}
function confirmToggleSetting() {
  const s = pendingToggleSetting.value;
  if (!s || !canSetting('toggle-status')) return;
  s.enabled = !s.enabled;
  toggleSettingVisible.value = false;
  pendingToggleSetting.value = null;
  adminFeedback.actionSuccess({ action: s.enabled ? '启用' : '停用', target: s.name });
}
function deleteSetting() {
  const row = deletingSetting.value;
  if (!row || !canSetting('delete')) return;
  state.value.settings = state.value.settings.filter((s) => s.id !== row.id);
  deleteSettingVisible.value = false;
  deletingSetting.value = null;
  adminFeedback.deleted(row.name);
}
const proofUrl = ref(''),
  logDetail = ref<Log | null>(null);
const pretty = (v: string) => {
  try {
    return JSON.stringify(JSON.parse(v), null, 2);
  } catch {
    return v;
  }
};
const time = (value: string) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '—';
const detailItems = computed(() => {
  const o = selected.value;
  if (!o) return [];
  return [
    { label: '订单状态', value: statuses.find((s) => s.value === o.status)!.label },
    { label: '客户', value: o.customerName },
    { label: '联系电话', value: o.phone },
    { label: '负责人', value: o.ownerName },
    { label: '开单人', value: o.creator },
    { label: '创建时间', value: time(o.createdAt) },
    { label: '成交时间', value: time(o.confirmedAt) },
    { label: '预计全部发完日期', value: o.due || '暂未约定' },
    { label: '发货进度', value: shipmentProgress(o).label },
    { label: '收款状态', value: paymentStatus(o) },
    { label: '未收金额', value: money(pricing(o).outstanding) },
    { label: '待退款', value: money(pricing(o).refund) },
  ];
});
const priceItems = computed(() => {
  const o = selected.value;
  if (!o) return [];
  const p = pricing(o);
  return [
    { label: '商品原金额', value: money(p.goods) },
    { label: '运费', value: money(o.freight) },
    { label: '折扣优惠', value: money(p.discount) },
    { label: '减免金额', value: money(o.reduction) },
    { label: '抹零金额', value: money(o.rounding) },
    { label: '当前成交金额', value: money(p.total) },
    { label: '原确认金额', value: o.originalAmount === null ? '尚未确认' : money(o.originalAmount) },
    { label: '当前应收', value: money(p.due) },
    { label: '有效净收款', value: money(p.net) },
  ];
});
const lineColumns = [
  { colKey: 'sku', title: 'SKU' },
  { colKey: 'name', title: '商品' },
  { colKey: 'specification', title: '规格' },
  { colKey: 'material', title: '材料' },
  { colKey: 'quantity', title: '原购买件数' },
  { colKey: 'cancelled', title: '已取消' },
  { colKey: 'shipped', title: '已发' },
  { colKey: 'pending', title: '待发' },
  { colKey: 'billingQuantity', title: '当前计价数量' },
  { colKey: 'price', title: '单价' },
  { colKey: 'discount', title: '商品折扣（%）' },
];
const planColumns = [
  { colKey: 'sku', title: 'SKU' },
  { colKey: 'source', title: '来源' },
  { colKey: 'route', title: '交付路径' },
  { colKey: 'quantity', title: '安排件数' },
  { colKey: 'received', title: '到店件数' },
  { colKey: 'shipped', title: '客户已发' },
  { colKey: 'address', title: '收货地址' },
  { colKey: 'status', title: '执行情况' },
  { colKey: 'operation', title: '操作' },
];
const shipmentColumns = [
  { colKey: 'sku', title: 'SKU' },
  { colKey: 'quantity', title: '客户已发件数' },
  { colKey: 'at', title: '实际发货时间' },
  { colKey: 'recipient', title: '收货人' },
  { colKey: 'phone', title: '电话' },
  { colKey: 'address', title: '地址' },
  { colKey: 'voided', title: '记录状态' },
  { colKey: 'operation', title: '操作' },
];
const paymentColumns = [
  { colKey: 'kind', title: '类型' },
  { colKey: 'amount', title: '金额' },
  { colKey: 'nature', title: '款项名称' },
  { colKey: 'method', title: '收退款渠道' },
  { colKey: 'at', title: '实际时间' },
  { colKey: 'reason', title: '原因' },
  { colKey: 'remark', title: '备注' },
  { colKey: 'proof', title: '凭证' },
  { colKey: 'voided', title: '状态' },
  { colKey: 'operation', title: '操作' },
];
const logColumns = [
  { colKey: 'at', title: '操作时间', width: 180 },
  { colKey: 'actor', title: '操作人', width: 100 },
  { colKey: 'action', title: '操作内容' },
  { colKey: 'change', title: '前后数据', width: 150 },
];
const taskColumns = [
  { colKey: 'orderId', title: '销售订单' },
  { colKey: 'name', title: '商品' },
  { colKey: 'source', title: '执行来源' },
  { colKey: 'quantity', title: '安排件数' },
  { colKey: 'received', title: '已到店' },
  { colKey: 'remaining', title: '客户待发件数' },
  { colKey: 'recipient', title: '收货人' },
  { colKey: 'address', title: '收货地址' },
  { colKey: 'operation', title: '操作' },
];
const settingColumns = [
  { colKey: 'name', title: '名称' },
  { colKey: 'enabled', title: '状态' },
  { colKey: 'createdByName', title: '创建人' },
  { colKey: 'createdAt', title: '创建时间' },
  { colKey: 'operation', title: '操作' },
];
</script>
