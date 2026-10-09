<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <header class="page-header">
          <t-breadcrumb><t-breadcrumb-item>价格配置</t-breadcrumb-item></t-breadcrumb>
        </header>
        <AdminListLayout>
          <template #toolbar>
            <div class="list-controls">
              <t-tabs v-if="showTabRail" v-model="activeKind" :list="visibleTabs" :disabled="saving" />
              <t-alert theme="info">
                <template #message>
                  <template v-if="activeKind === 'price'"
                    >正常售价 = 本店成本价 ×
                    价格系数；优先本分类，其次最近上级分类。未配置时商品价格需手工填写。</template
                  >
                  <template v-else>角色最低可售价 = 商品正常售价 × 折扣系数；未配置角色默认按正常售价计算。</template>
                  <br />配置仅用于自动计算，商品手工修改后以商品价格为准。旧成本倍数未转换为折扣系数，新配置将在商品模块接入后生效。
                </template>
              </t-alert>
              <t-form class="zdm-admin-filter-form" label-width="auto" :data="filter" colon>
                <div class="filter-row">
                  <div class="filter-fields">
                    <t-form-item :label="activeKind === 'price' ? '分类' : '角色'"
                      ><t-input
                        v-model="filter.keyword"
                        clearable
                        :placeholder="activeKind === 'price' ? '请输入分类名称' : '请输入角色名称'"
                    /></t-form-item>
                  </div>
                  <div class="filter-actions">
                    <t-button theme="primary" @click="page = 1"
                      ><template #icon><t-icon name="search" /></template>查询</t-button
                    >
                    <t-button theme="default" variant="base" @click="reset"
                      ><template #icon><t-icon name="refresh" /></template>重置</t-button
                    >
                  </div>
                </div>
              </t-form>
              <div class="table-toolbar">
                <t-button v-if="can('create')" theme="primary" @click="openCreate"
                  ><template #icon><t-icon name="add" /></template>新增</t-button
                >
              </div>
            </div>
          </template>
          <template #table>
            <t-table row-key="id" :data="visibleRows" :columns="columns" :loading="loading" hover table-layout="fixed">
              <template #index="{ rowIndex }">{{ (page - 1) * pageSize + rowIndex + 1 }}</template>
              <template #targetName="{ row }">{{ targetName(row) }}</template>
              <template #coefficient="{ row }">{{ Number(row.coefficient).toFixed(2) }}</template>
              <template #status="{ row }"
                ><t-tag :theme="row.status === 'enabled' ? 'success' : 'danger'" variant="light">{{
                  row.status === 'enabled' ? '已启用' : '已停用'
                }}</t-tag></template
              >
              <template #createdAt="{ row }">{{
                row.createdAt ? row.createdAt.replace(/-/g, '/').replace('T', ' ').slice(0, 16) : '—'
              }}</template>
              <template #operation="{ row }">
                <t-space size="small">
                  <t-link v-if="can('edit')" theme="primary" @click="openEdit(row)">编辑</t-link>
                  <t-link
                    v-if="can('toggle-status')"
                    :theme="row.status === 'enabled' ? 'warning' : 'success'"
                    @click="confirmAction = { kind: 'status', row }"
                    >{{ row.status === 'enabled' ? '停用' : '启用' }}</t-link
                  >
                  <t-link v-if="can('delete')" theme="danger" @click="confirmAction = { kind: 'delete', row }"
                    >删除</t-link
                  >
                </t-space>
              </template>
              <template #empty>暂无价格配置</template>
            </t-table>
          </template>
          <template #pagination
            ><AdminPagination v-model:current="page" v-model:page-size="pageSize" :total="filteredRows.length"
          /></template>
        </AdminListLayout>
        <t-collapse
          v-if="activeKind === 'price' && visibleTabs.some((tab) => tab.value === 'price')"
          class="effective-rules"
        >
          <t-collapse-panel value="categories" header="分类生效系数">
            <t-table row-key="id" :data="categories" :columns="effectiveColumns" :loading="loading" hover>
              <template #name="{ row }">{{ categoryName(row.id) }}</template>
              <template #effectiveCoefficient="{ row }">{{
                row.effectiveCoefficient == null ? '未配置' : Number(row.effectiveCoefficient).toFixed(2)
              }}</template>
              <template #empty>暂无门店分类</template>
            </t-table>
          </t-collapse-panel>
        </t-collapse>
      </main>
    </div>
    <AdminDialog
      v-model:visible="formVisible"
      :header="editing ? '编辑' : '新增'"
      width="440px"
      :confirm-btn="{ content: '提交', loading: saving }"
      @confirm="save"
      @cancel="formVisible = false"
      @close="formVisible = false"
    >
      <t-form class="price-configuration-form" label-align="top" :data="form" colon>
        <t-form-item :label="activeKind === 'price' ? '分类' : '角色'" name="target">
          <t-select
            v-model="form.target"
            :disabled="Boolean(editing)"
            :placeholder="activeKind === 'price' ? '请选择分类' : '请选择角色'"
            clearable
          >
            <t-option
              v-for="option in enabledOptions"
              :key="option.id"
              :value="option.id"
              :label="option.name"
              :disabled="
                rows.some(
                  (item) =>
                    (activeKind === 'price' ? item.categoryId : item.roleId) === option.id && item.id !== editing?.id,
                )
              "
            />
          </t-select>
        </t-form-item>
        <t-form-item :label="activeKind === 'price' ? '价格系数' : '折扣系数'" name="coefficient"
          ><t-input-number
            v-model="form.coefficient"
            class="price-coefficient-input"
            :decimal-places="2"
            :min="0.01"
            :max="999"
            theme="normal"
        /></t-form-item>
        <t-alert class="price-configuration-tip" theme="info">
          <template #message>
            <div>
              {{
                activeKind === 'price'
                  ? '正常售价 = 本店成本价 × 价格系数；'
                  : '角色最低可售价 = 商品正常售价 × 折扣系数；例如0.80表示八折。'
              }}<br />商品手工修改后以商品价格为准。
            </div>
          </template>
        </t-alert>
      </t-form>
    </AdminDialog>
    <AdminConfirmDialog
      :visible="Boolean(confirmAction)"
      :action="confirmAction?.kind === 'delete' ? '删除' : confirmAction?.row.status === 'enabled' ? '停用' : '启用'"
      object-type="价格配置"
      :object-name="confirmAction ? targetName(confirmAction.row) : undefined"
      @confirm="runConfirmed"
      @cancel="confirmAction = null"
      @close="confirmAction = null"
      @update:visible="!$event && (confirmAction = null)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import {
  AdminConfirmDialog,
  AdminDialog,
  AdminListLayout,
  AdminPagination,
  adminFeedback,
  getSafeErrorMessage,
} from '@/components/foundation';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import {
  listStorePriceRules,
  listStorePriceCategories,
  listStoreDiscountRoles,
  saveStorePriceRule,
  statusStorePriceRule,
  deleteStorePriceRule,
  type StorePriceRuleKind,
  type StorePriceRule,
  type StorePriceCategory,
  type StorePriceRole,
} from '@/services/storePriceRules';

const user = computed(getLoginUser);
const activeKind = ref<StorePriceRuleKind>('price');
const { visibleTabs, showTabRail } = usePermissionTabs({
  tabs: [
    { label: '价格系数', value: 'price' as const },
    { label: '折扣系数', value: 'discount' as const },
  ],
  activeTab: activeKind,
  canAccess: (tab) => hasPermission(user.value, `store.price-configuration.${tab.value}.view`),
});
const can = (action: string) => hasPermission(user.value, `store.price-configuration.${activeKind.value}.${action}`);
const rows = ref<StorePriceRule[]>([]);
const roles = ref<StorePriceRole[]>([]);
const categories = ref<StorePriceCategory[]>([]);
const loading = ref(false);
const saving = ref(false);
const page = ref(1);
const pageSize = ref(10);
const filter = reactive({ keyword: '' });
const editing = ref<StorePriceRule | null>(null);
const formVisible = ref(false);
const form = reactive<{ target: number | null; coefficient: number | null }>({
  target: null,
  coefficient: null,
});
const confirmAction = ref<{ kind: 'status' | 'delete'; row: StorePriceRule } | null>(null);
function categoryName(id: number) {
  const names: string[] = [];
  let item = categories.value.find((category) => category.id === id);
  const scope = item?.scope;
  for (let level = 0; item && level < 3; level++) {
    names.unshift(item.name);
    const parentId = item.parentId;
    item = categories.value.find((category) => category.id === parentId);
  }
  return `${scope === 'accessory' ? '配件' : '成品现货'} / ${names.join(' / ')}`;
}
const targetName = (row: StorePriceRule) =>
  activeKind.value === 'price' && row.categoryId != null ? categoryName(row.categoryId) : row.targetName;
const enabledOptions = computed(() =>
  activeKind.value === 'price'
    ? categories.value
        .filter((item) => item.status === 'enabled')
        .map((item) => ({ id: item.id, name: categoryName(item.id) }))
    : roles.value.filter((item) => item.status === 'enabled'),
);
const filteredRows = computed(() => rows.value.filter((row) => targetName(row).includes(filter.keyword.trim())));
const visibleRows = computed(() =>
  filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  { colKey: 'index', title: '序号', width: 75 },
  { colKey: 'targetName', title: activeKind.value === 'price' ? '分类' : '角色', minWidth: 200 },
  { colKey: 'coefficient', title: activeKind.value === 'price' ? '价格系数' : '折扣系数', width: 120 },
  { colKey: 'status', title: '状态', width: 100 },
  { colKey: 'createdByName', title: '创建人', width: 120 },
  { colKey: 'createdAt', title: '创建时间', width: 180 },
  { colKey: 'operation', title: '操作', width: 190, fixed: 'right' },
]);
const effectiveColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '门店分类' },
  { colKey: 'effectiveCoefficient', title: '生效系数', width: 120 },
  { colKey: 'sourceName', title: '配置来源', width: 180 },
];
let loadRevision = 0;
async function load() {
  const revision = ++loadRevision;
  const kind = activeKind.value;
  if (!visibleTabs.value.some((tab) => tab.value === kind)) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const [rules, options] = await Promise.all([
      listStorePriceRules(kind),
      kind === 'price' ? listStorePriceCategories() : listStoreDiscountRoles(),
    ]);
    if (revision !== loadRevision || kind !== activeKind.value) return;
    rows.value = rules;
    if (kind === 'price') categories.value = options as StorePriceCategory[];
    else roles.value = options as StorePriceRole[];
  } catch (error) {
    if (revision === loadRevision) adminFeedback.error(getSafeErrorMessage(error, '价格配置加载失败'));
  } finally {
    if (revision === loadRevision) loading.value = false;
  }
}
function reset() {
  filter.keyword = '';
  page.value = 1;
}
function openCreate() {
  editing.value = null;
  form.target = null;
  form.coefficient = null;
  formVisible.value = true;
}
function openEdit(row: StorePriceRule) {
  editing.value = row;
  form.target = activeKind.value === 'price' ? row.categoryId : row.roleId;
  form.coefficient = Number(row.coefficient);
  formVisible.value = true;
}
async function save() {
  if (saving.value) return;
  if (form.target == null || form.coefficient == null || form.coefficient <= 0 || form.coefficient > 999) {
    adminFeedback.warning('请选择配置对象并填写正确的系数');
    return;
  }
  const kind = activeKind.value;
  saving.value = true;
  try {
    await saveStorePriceRule(
      kind,
      {
        categoryId: activeKind.value === 'price' ? form.target : null,
        roleId: activeKind.value === 'discount' ? form.target : null,
        coefficient: form.coefficient,
      },
      editing.value?.id,
    );
    if (kind === activeKind.value) {
      formVisible.value = false;
      adminFeedback.success('价格配置已保存');
      await load();
    }
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '保存失败'));
  } finally {
    saving.value = false;
  }
}
async function runConfirmed() {
  const action = confirmAction.value;
  if (!action) return;
  const kind = activeKind.value;
  try {
    if (action.kind === 'delete') await deleteStorePriceRule(kind, action.row.id);
    else await statusStorePriceRule(kind, action.row.id, action.row.status === 'enabled' ? 'disabled' : 'enabled');
    if (kind === activeKind.value) {
      confirmAction.value = null;
      adminFeedback.success('操作成功');
      await load();
    }
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '操作失败'));
  }
}
watch(
  [activeKind, visibleTabs, user],
  () => {
    reset();
    rows.value = [];
    roles.value = [];
    categories.value = [];
    formVisible.value = false;
    confirmAction.value = null;
    editing.value = null;
    void load();
  },
  { immediate: true },
);
</script>

<style scoped>
.list-controls {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: var(--td-comp-margin-l);
}
.effective-rules {
  margin-top: var(--td-comp-margin-l);
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-m);
}
.filter-fields {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-wrap: wrap;
}
.filter-fields :deep(.t-form__item) {
  width: 260px;
  margin-bottom: 0;
}
.filter-actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--td-comp-margin-s);
}
.price-configuration-form {
  display: grid;
  gap: var(--td-comp-margin-l);
}
.price-configuration-form :deep(.t-form__item) {
  margin-bottom: 0;
}
.price-configuration-form :deep(.t-form__label--top) {
  min-height: 0;
  line-height: var(--td-line-height-body-medium);
  margin-bottom: var(--td-comp-margin-s);
}
.price-configuration-tip {
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-s);
}
.price-configuration-tip :deep(.t-alert__content) {
  font: var(--td-font-body-small);
}
.price-coefficient-input {
  width: 100%;
}
</style>
