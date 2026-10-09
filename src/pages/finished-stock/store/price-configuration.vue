<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <AdminPageHeader :breadcrumbs="['价格配置']" />
        <div class="price-workspace">
          <t-menu
            width="180px"
            class="price-menu"
            :value="activeKey"
            :expanded="['price', 'discount']"
            @change="selectMenu"
          >
            <t-submenu v-for="group in menuGroups" :key="group.kind" :value="group.kind" :title="group.label">
              <t-menu-item v-for="entry in group.entries" :key="entry.key" :value="entry.key" :disabled="saving">
                {{ entry.label }}
              </t-menu-item>
            </t-submenu>
          </t-menu>
          <AdminListLayout class="price-content">
            <template #toolbar>
              <t-space direction="vertical" size="medium" class="price-toolbar">
                <t-space align="center">
                  <span>{{ scopeLabel }} · {{ kindLabel }}</span>
                  <t-popup trigger="click" placement="bottom-left">
                    <t-link theme="primary"><t-icon name="help-circle" />说明</t-link>
                    <template #content>
                      <div class="price-help">
                        <p>各分类独立设置价格系数；未设置时需手工填写商品价格。</p>
                        <p>未配置角色折扣时按正常售价计算，不比较角色之间的折扣高低。</p>
                        <p>配置仅用于自动计算，商品手工修改后以商品价格为准。新配置将在商品模块接入后生效。</p>
                      </div>
                    </template>
                  </t-popup>
                </t-space>
                <span>{{
                  activeKind === 'price'
                    ? '正常售价 = 本店成本价 × 价格系数'
                    : '角色最低可售价 = 商品正常售价 × 折扣系数'
                }}</span>
                <div class="price-actions">
                  <t-input v-model="keyword" clearable :placeholder="activeKind === 'price' ? '搜索分类' : '搜索角色'">
                    <template #prefix-icon><t-icon name="search" /></template>
                  </t-input>
                  <t-button
                    v-if="can('batch-set')"
                    theme="primary"
                    :disabled="selectedIds.length === 0 || saving"
                    @click="openBatch"
                    >批量设置</t-button
                  >
                </div>
              </t-space>
            </template>
            <template #table>
              <t-table
                row-key="id"
                :data="displayRows"
                :columns="columns"
                :loading="loading"
                hover
                :selected-row-keys="selectedIds"
                @select-change="selectRows"
              >
                <template #name="{ row }">
                  <t-space size="small">
                    <span
                      v-if="activeKind === 'price'"
                      class="category-indent"
                      :style="{ width: `${row.depth * 24}px` }"
                    />
                    <t-link v-if="activeKind === 'price' && row.hasChildren" @click="toggleExpanded(row.id)">
                      <t-icon :name="collapsedIds.includes(row.id) ? 'chevron-right' : 'chevron-down'" />
                    </t-link>
                    <t-icon v-else-if="activeKind === 'price'" name="minus" />
                    <span>{{ row.name }}</span>
                  </t-space>
                </template>
                <template #coefficient="{ row }">{{
                  row.rule ? Number(row.rule.coefficient).toFixed(2) : '—'
                }}</template>
                <template #discount="{ row }">{{
                  row.rule ? `${Number((Number(row.rule.coefficient) * 10).toFixed(2))}折` : '按正常售价'
                }}</template>
                <template #empty>{{ activeKind === 'price' ? '暂无门店分类' : '暂无门店角色' }}</template>
              </t-table>
              <p>
                {{
                  activeKind === 'price'
                    ? '未设置价格系数的分类，上架商品需手工填写价格。'
                    : '配置用于自动计算，商品手工修改后以商品价格为准。'
                }}
              </p>
            </template>
          </AdminListLayout>
        </div>
      </main>
    </div>
    <AdminDialog
      v-model:visible="formVisible"
      :header="`批量设置${kindLabel}`"
      :confirm-btn="{ content: '提交', loading: saving }"
      @confirm="save"
      @cancel="formVisible = false"
      @close="formVisible = false"
    >
      <t-form label-align="top" :data="form" colon>
        <t-form-item :label="activeKind === 'price' ? '已选分类' : '已选角色'">
          已选择 {{ selectedIds.length }} 个{{ activeKind === 'price' ? '分类' : '角色' }}
        </t-form-item>
        <t-form-item :label="kindLabel"
          ><t-input-number v-model="form.coefficient" :decimal-places="2" :min="0.01" :max="999" theme="normal"
        /></t-form-item>
      </t-form>
    </AdminDialog>
  </div>
</template>
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import {
  AdminDialog,
  AdminListLayout,
  AdminPageHeader,
  adminFeedback,
  getSafeErrorMessage,
} from '@/components/foundation';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  listStorePriceRules,
  listStorePriceCategories,
  listStoreDiscountRoles,
  saveStorePriceBatch,
  type StorePriceRuleKind,
  type StorePriceScope,
  type StorePriceRule,
  type StorePriceCategory,
  type StorePriceRole,
} from '@/services/storePriceRules';
interface DisplayRow extends TableRowData {
  id: number;
  name: string;
  status: string;
  depth: number;
  hasChildren: boolean;
  rule?: StorePriceRule;
}
const user = computed(getLoginUser);
const entries = (['price', 'discount'] as const).flatMap((kind) =>
  (['finished', 'accessory'] as const).map((scope) => ({
    kind,
    scope,
    key: `${kind}.${scope}`,
    label: scope === 'finished' ? '成品现货' : '配件',
  })),
);
const availableEntries = computed(() =>
  entries.filter((entry) => hasPermission(user.value, `store.price-configuration.${entry.key}.view`)),
);
const menuGroups = computed(() =>
  (['price', 'discount'] as const)
    .map((kind) => ({
      kind,
      label: kind === 'price' ? '价格系数' : '折扣系数',
      entries: availableEntries.value.filter((entry) => entry.kind === kind),
    }))
    .filter((group) => group.entries.length),
);
const activeKey = ref('price.finished');
const activeKind = computed(() => activeKey.value.split('.')[0] as StorePriceRuleKind);
const activeScope = computed(() => activeKey.value.split('.')[1] as StorePriceScope);
const kindLabel = computed(() => (activeKind.value === 'price' ? '价格系数' : '折扣系数'));
const scopeLabel = computed(() => (activeScope.value === 'finished' ? '成品现货' : '配件'));
const can = (action: string) => hasPermission(user.value, `store.price-configuration.${activeKey.value}.${action}`);
const rules = ref<StorePriceRule[]>([]);
const categories = ref<StorePriceCategory[]>([]);
const roles = ref<StorePriceRole[]>([]);
const keyword = ref('');
const selectedIds = ref<number[]>([]);
const collapsedIds = ref<number[]>([]);
const loading = ref(false);
const saving = ref(false);
const formVisible = ref(false);
const form = reactive<{ coefficient: number | null }>({ coefficient: null });
const ruleFor = (id: number) =>
  rules.value.find((rule) => (activeKind.value === 'price' ? rule.categoryId : rule.roleId) === id);
const displayRows = computed<DisplayRow[]>(() => {
  if (activeKind.value === 'discount')
    return roles.value
      .filter((role) => role.name.includes(keyword.value.trim()))
      .map((role) => ({ ...role, depth: 0, hasChildren: false, rule: ruleFor(role.id) }));
  const result: DisplayRow[] = [];
  const query = keyword.value.trim();
  const matches = (node: StorePriceCategory, depth = 0): boolean =>
    node.name.includes(query) ||
    (depth < 3 && categories.value.some((child) => child.parentId === node.id && matches(child, depth + 1)));
  const visit = (parentId: number | null, depth: number) => {
    if (depth >= 3) return;
    categories.value
      .filter((node) => node.parentId === parentId)
      .forEach((node) => {
        if (query && !matches(node)) return;
        result.push({
          ...node,
          depth,
          hasChildren: categories.value.some((child) => child.parentId === node.id),
          rule: ruleFor(node.id),
        });
        if (query || !collapsedIds.value.includes(node.id)) visit(node.id, depth + 1);
      });
  };
  visit(null, 0);
  return result;
});
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(can('batch-set')
    ? [
        {
          colKey: 'row-select',
          type: 'multiple' as const,
          width: 48,
          checkProps: ({ row }: { row: TableRowData }) => ({
            disabled: row.status !== 'enabled',
          }),
        },
      ]
    : []),
  { colKey: 'name', title: activeKind.value === 'price' ? '分类名称' : '角色', minWidth: 180 },
  { colKey: 'coefficient', title: activeKind.value === 'price' ? '本分类系数' : '折扣系数', width: 120 },
  ...(activeKind.value === 'discount' ? [{ colKey: 'discount', title: '折扣说明', width: 120 }] : []),
]);
function selectRows(keys: (string | number)[]) {
  selectedIds.value = keys.map(Number);
}
function toggleExpanded(id: number) {
  collapsedIds.value = collapsedIds.value.includes(id)
    ? collapsedIds.value.filter((item) => item !== id)
    : [...collapsedIds.value, id];
}
function selectMenu(value: string | number) {
  if (!saving.value) activeKey.value = String(value);
}
let revision = 0;
async function load() {
  const current = ++revision;
  const key = activeKey.value;
  if (!availableEntries.value.some((entry) => entry.key === key)) return;
  loading.value = true;
  try {
    const [data, targets] = await Promise.all([
      listStorePriceRules(activeKind.value, activeScope.value),
      activeKind.value === 'price'
        ? listStorePriceCategories(activeScope.value)
        : listStoreDiscountRoles(activeScope.value),
    ]);
    if (current !== revision || key !== activeKey.value) return;
    rules.value = data;
    if (activeKind.value === 'price') categories.value = targets as StorePriceCategory[];
    else roles.value = targets as StorePriceRole[];
  } catch (error) {
    if (current === revision) adminFeedback.error(getSafeErrorMessage(error, '价格配置加载失败'));
  } finally {
    if (current === revision) loading.value = false;
  }
}
function openBatch() {
  form.coefficient = null;
  formVisible.value = true;
}
async function save() {
  if (saving.value) return;
  if (form.coefficient == null || form.coefficient <= 0 || form.coefficient > 999) {
    adminFeedback.warning('请填写正确的系数');
    return;
  }
  const key = activeKey.value;
  saving.value = true;
  try {
    await saveStorePriceBatch(activeKind.value, activeScope.value, selectedIds.value, form.coefficient);
    if (key === activeKey.value) {
      formVisible.value = false;
      selectedIds.value = [];
      adminFeedback.success('价格配置已保存');
      await load();
    }
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '保存失败'));
  } finally {
    saving.value = false;
  }
}
watch(
  availableEntries,
  () => {
    if (!availableEntries.value.some((entry) => entry.key === activeKey.value))
      activeKey.value = availableEntries.value[0]?.key ?? '';
  },
  { immediate: true },
);
watch(
  [activeKey, user],
  () => {
    keyword.value = '';
    selectedIds.value = [];
    collapsedIds.value = [];
    rules.value = [];
    categories.value = [];
    roles.value = [];
    loading.value = false;
    formVisible.value = false;
    void load();
  },
  { immediate: true },
);
</script>
<style scoped>
.price-workspace {
  display: flex;
  align-items: stretch;
}
.price-menu {
  flex-shrink: 0;
}
.price-content {
  flex: 1;
  min-width: 0;
}
.price-toolbar {
  width: 100%;
}
.price-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}
.price-actions .t-input {
  max-width: 320px;
}
.price-help {
  max-width: 360px;
}
.category-indent {
  display: inline-block;
  flex-shrink: 0;
}
</style>
