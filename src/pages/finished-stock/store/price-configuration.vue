<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <AdminPageHeader :breadcrumbs="['价格配置']" />
        <div class="price-workspace">
          <t-card size="small" class="price-navigation">
            <t-menu width="160px" class="price-menu" :value="activeKey" @change="selectMenu">
              <t-menu-group v-for="group in menuGroups" :key="group.kind" :title="group.label">
                <t-menu-item v-for="entry in group.entries" :key="entry.key" :value="entry.key" :disabled="saving">
                  {{ entry.label }}
                </t-menu-item>
              </t-menu-group>
            </t-menu>
          </t-card>
          <AdminListLayout class="price-content">
            <template #toolbar>
              <div class="list-controls">
                <t-form
                  class="zdm-admin-filter-form"
                  label-width="auto"
                  :data="searchForm"
                  colon
                  @submit="queryCategories"
                >
                  <div class="filter-row">
                    <div class="filter-fields">
                      <t-form-item :label="activeKind === 'price' ? '分类名称' : '角色'" name="keyword">
                        <t-input
                          v-model="searchForm.keyword"
                          clearable
                          :placeholder="activeKind === 'price' ? '请输入分类名称' : '请输入角色'"
                          @enter="queryCategories"
                        />
                      </t-form-item>
                      <t-form-item v-if="activeKind === 'price'" name="onlyUnconfigured">
                        <t-checkbox v-model="searchForm.onlyUnconfigured">仅看未配置分类</t-checkbox>
                      </t-form-item>
                    </div>
                    <t-space size="small">
                      <t-button theme="primary" @click="queryCategories"
                        ><template #icon><t-icon name="search" /></template>查询</t-button
                      >
                      <t-button theme="default" @click="resetCategories"
                        ><template #icon><t-icon name="refresh" /></template>重置</t-button
                      >
                    </t-space>
                  </div>
                </t-form>
                <t-space v-if="activeKind === 'discount' && can('create')" size="small">
                  <t-button
                    v-if="can('create')"
                    theme="primary"
                    :disabled="loading || saving"
                    @click="openCreateDiscount"
                  >
                    <template #icon><t-icon name="add" /></template>新增
                  </t-button>
                </t-space>
                <div v-if="activeKind === 'price' && can('batch-set')" class="price-actions">
                  <t-button theme="primary" variant="outline" :disabled="saving || loading" @click="openBatch"
                    >批量设置</t-button
                  >
                  <t-button
                    v-if="activeKind === 'price'"
                    theme="primary"
                    :loading="saving"
                    :disabled="loading"
                    @click="savePrices"
                    ><template #icon><t-icon name="save" /></template>保存</t-button
                  >
                </div>
              </div>
            </template>
            <template #table>
              <t-table
                row-key="id"
                :data="displayRows"
                :columns="columns"
                :loading="loading"
                hover
                :selected-row-keys="selectedIds"
              >
                <template #categorySelectTitle>
                  <t-checkbox
                    :checked="categorySelection().checked"
                    :indeterminate="categorySelection().indeterminate"
                    :disabled="loading || saving"
                    aria-label="全选所有分类"
                    @change="(checked: boolean) => selectCategory(checked)"
                  />
                </template>
                <template #categorySelect="{ row }">
                  <t-checkbox
                    :checked="categorySelection(row.id).checked"
                    :indeterminate="categorySelection(row.id).indeterminate"
                    :disabled="loading || saving"
                    :aria-label="`选择${row.name}`"
                    @change="(checked: boolean) => selectCategory(checked, row.id)"
                  />
                </template>
                <template #name="{ row }">
                  <div v-if="activeKind === 'price'" :class="['category-name-cell', `level-${row.depth + 1}`]">
                    <t-button
                      v-if="row.hasChildren"
                      class="tree-toggle"
                      variant="text"
                      shape="square"
                      size="small"
                      :aria-label="isExpanded(row.id) ? '收起下级分类' : '展开下级分类'"
                      @click.stop="toggleExpanded(row.id)"
                    >
                      <template #icon
                        ><t-icon :name="isExpanded(row.id) ? 'chevron-down' : 'chevron-right'"
                      /></template>
                    </t-button>
                    <span v-else class="tree-toggle-placeholder"><t-icon name="minus" /></span>
                    <span>{{ row.name }}</span>
                  </div>
                  <span v-else>{{ row.name }}</span>
                </template>
                <template #coefficient="{ row }">
                  <t-input-number
                    v-if="activeKind === 'price' && !row.hasChildren"
                    class="price-coefficient-input"
                    :value="coefficientDrafts[row.id]"
                    large-number
                    :decimal-places="2"
                    theme="normal"
                    placeholder="请输入"
                    :aria-label="`${row.name}分类系数`"
                    :disabled="!can('batch-set') || row.status !== 'enabled' || saving"
                    :status="coefficientErrors[row.id] ? 'error' : undefined"
                    :tips="coefficientErrors[row.id]"
                    @change="
                      (value: string | number | undefined, context: { type?: string }) =>
                        changeCoefficient(row.id, value, context)
                    "
                    @keydown="handleCoefficientKeydown"
                    @blur="validateCoefficient(row.id)"
                  />
                  <template v-else-if="activeKind === 'discount'">{{
                    row.rule ? Number(row.rule.coefficient).toFixed(2) : '—'
                  }}</template>
                </template>
                <template #createdByName="{ row }">{{ row.rule?.createdByName || '-' }}</template>
                <template #createdAt="{ row }">{{ formatStoreRuleDateTime(row.rule?.createdAt) }}</template>
                <template #operation="{ row }">
                  <t-space size="small">
                    <t-link v-if="can('edit')" theme="primary" @click="editDiscount(row.rule)">编辑</t-link>
                    <t-link
                      v-if="can('toggle-status')"
                      :theme="row.rule.status === 'disabled' ? 'primary' : 'warning'"
                      @click="confirmDiscountAction(row.rule, 'status')"
                      >{{ row.rule.status === 'disabled' ? '启用' : '停用' }}</t-link
                    >
                    <t-link v-if="can('delete')" theme="danger" @click="confirmDiscountAction(row.rule, 'delete')"
                      >删除</t-link
                    >
                  </t-space>
                </template>
                <template #empty>{{ activeKind === 'price' ? '暂无门店分类' : '暂无折扣配置' }}</template>
              </t-table>
            </template>
          </AdminListLayout>
        </div>
      </main>
    </div>
    <AdminDialog
      v-model:visible="createVisible"
      :header="editingDiscountId == null ? '新增' : '编辑'"
      dialog-class-name="discount-config-dialog"
      width="360px"
      :confirm-btn="{ content: '保存', loading: saving }"
      @confirm="saveDiscount"
      @cancel="createVisible = false"
      @close="createVisible = false"
    >
      <t-form
        ref="createFormRef"
        class="discount-config-form"
        :data="createForm"
        :rules="createRules"
        :label-width="96"
        label-align="right"
        :style="{ width: '272px', maxWidth: '100%', minHeight: '88px', margin: '0 auto' }"
        colon
      >
        <t-form-item label="角色" name="roleId">
          <t-select
            v-model="createForm.roleId"
            :style="{ width: '100%' }"
            :options="availableRoleOptions"
            placeholder="请选择角色"
            clearable
            filterable
          />
        </t-form-item>
        <t-form-item label="折扣系数" name="coefficient">
          <t-input-number
            v-model="createForm.coefficient"
            :style="{ width: '100%' }"
            theme="normal"
            :decimal-places="2"
            :min="0.01"
            :max="1"
            allow-input-over-limit
            placeholder="请输入0.01～1之间的值"
            @keydown="handleCoefficientKeydown"
          />
        </t-form-item>
      </t-form>
    </AdminDialog>
    <AdminConfirmDialog
      v-model:visible="discountConfirmVisible"
      :action="discountActionLabel"
      object-type="折扣配置"
      :object-name="discountActionTarget?.targetName"
      @confirm="applyDiscountAction"
      @cancel="discountConfirmVisible = false"
      @close="discountConfirmVisible = false"
    >
      {{ discountActionLabel }}后{{
        discountAction === 'delete'
          ? '将移除此折扣配置，该角色的商品折扣不再受此配置限制'
          : discountActionLabel === '停用'
            ? '该角色的商品折扣不再受此配置限制'
            : '该角色的商品折扣将按此系数限制，低于折扣底线需店长审批'
      }}。已有成交订单不受影响。是否继续？
    </AdminConfirmDialog>
    <AdminDialog
      v-model:visible="formVisible"
      width="320px"
      header="批量设置"
      :confirm-btn="{ content: '完成', loading: saving }"
      @confirm="save"
      @cancel="formVisible = false"
      @close="formVisible = false"
    >
      <t-form label-align="right" label-width="auto" :data="form" colon>
        <t-form-item :label="kindLabel" required
          ><t-input-number
            v-model="form.coefficient"
            :decimal-places="2"
            :min="0.01"
            :max="999"
            theme="normal"
            :status="batchError ? 'error' : undefined"
            :tips="batchError || undefined"
            @change="batchError = ''"
        /></t-form-item>
      </t-form>
    </AdminDialog>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import {
  AdminConfirmDialog,
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
  createStoreDiscount,
  updateStoreDiscount,
  setStoreDiscountStatus,
  deleteStoreDiscount,
  listStoreDiscountRoles,
  saveStoreCategoryPrices,
  type StorePriceRuleKind,
  type StorePriceScope,
  type StorePriceRule,
  type StorePriceCategory,
  type StorePriceRole,
} from '@/services/storePriceRules';
import { formatStoreRuleDateTime } from '@/utils/formatStoreRuleDateTime';
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
const can = (action: string) => hasPermission(user.value, `store.price-configuration.${activeKey.value}.${action}`);
const rules = ref<StorePriceRule[]>([]);
const categories = ref<StorePriceCategory[]>([]);
const roles = ref<StorePriceRole[]>([]);
const keyword = ref('');
const searchForm = reactive({ keyword: '', onlyUnconfigured: false });
const onlyUnconfigured = ref(false);
const draftCache = new Map<string, Record<number, string | number | undefined>>();
function queryCategories() {
  keyword.value = searchForm.keyword;
  onlyUnconfigured.value = activeKind.value === 'price' && searchForm.onlyUnconfigured;
  filterExpandedIds.value = onlyUnconfigured.value
    ? categories.value
        .filter((node) => categories.value.some((child) => child.parentId === node.id))
        .map((node) => node.id)
    : [];
}
function resetCategories() {
  searchForm.keyword = '';
  searchForm.onlyUnconfigured = false;
  onlyUnconfigured.value = false;
  keyword.value = '';
}
const selectedIds = ref<number[]>([]);
const expandedIds = ref<number[]>([]);
const filterExpandedIds = ref<number[]>([]);
const coefficientDrafts = ref<Record<number, string | number | undefined>>({});
const coefficientErrors = ref<Record<number, string>>({});
const loading = ref(false);
const saving = ref(false);
const formVisible = ref(false);
const batchError = ref('');
const form = reactive<{ coefficient: number | null }>({ coefficient: null });
const ruleFor = (id: number) =>
  rules.value.find((rule) => (activeKind.value === 'price' ? rule.categoryId : rule.roleId) === id);
const displayRows = computed<DisplayRow[]>(() => {
  if (activeKind.value === 'discount')
    return rules.value
      .filter((rule) => rule.roleId != null && (rule.targetName ?? '').includes(keyword.value.trim()))
      .map((rule) => ({
        id: rule.roleId!,
        name: rule.targetName ?? '—',
        status: roles.value.find((role) => role.id === rule.roleId)?.status ?? 'disabled',
        depth: 0,
        hasChildren: false,
        rule,
      }));
  const result: DisplayRow[] = [];
  const query = keyword.value.trim();
  const matches = (node: StorePriceCategory, depth = 0): boolean =>
    (node.name.includes(query) &&
      (!onlyUnconfigured.value ||
        (!categories.value.some((child) => child.parentId === node.id) && !ruleFor(node.id)))) ||
    (depth < 3 && categories.value.some((child) => child.parentId === node.id && matches(child, depth + 1)));
  const visit = (parentId: number | null, depth: number) => {
    if (depth >= 3) return;
    categories.value
      .filter((node) => node.parentId === parentId)
      .forEach((node) => {
        if ((query || onlyUnconfigured.value) && !matches(node)) return;
        result.push({
          ...node,
          depth,
          hasChildren: categories.value.some((child) => child.parentId === node.id),
          rule: ruleFor(node.id),
        });
        if (query || isExpanded(node.id)) visit(node.id, depth + 1);
      });
  };
  visit(null, 0);
  return result;
});
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(activeKind.value === 'price' && can('batch-set')
    ? [
        {
          colKey: 'categorySelect',
          title: 'categorySelectTitle',
          width: 48,
        },
      ]
    : []),
  { colKey: 'name', title: activeKind.value === 'price' ? '分类名称' : '角色', minWidth: 180 },
  {
    colKey: 'coefficient',
    title: activeKind.value === 'price' ? '价格系数' : '折扣系数',
    width: activeKind.value === 'price' ? 200 : 120,
  },
  ...(activeKind.value === 'discount'
    ? [
        { colKey: 'createdByName', title: '创建人', width: 120 },
        { colKey: 'createdAt', title: '创建时间', width: 180 },
        ...(can('edit') || can('toggle-status') || can('delete')
          ? [{ colKey: 'operation', title: '操作', width: 180 }]
          : []),
      ]
    : []),
]);
function isLeafCategory(id: number) {
  return !categories.value.some((category) => category.parentId === id);
}
function categoryLeafIds(id?: number): number[] {
  if (id == null)
    return categories.value.filter((category) => isLeafCategory(category.id)).map((category) => category.id);
  const children = categories.value.filter((category) => category.parentId === id);
  return children.length ? children.flatMap((child) => categoryLeafIds(child.id)) : [id];
}
function categorySelection(id?: number) {
  const ids = categoryLeafIds(id);
  const count = ids.filter((key) => selectedIds.value.includes(key)).length;
  return { checked: ids.length > 0 && count === ids.length, indeterminate: count > 0 && count < ids.length };
}
function selectCategory(checked: boolean, id?: number) {
  const ids = categoryLeafIds(id);
  selectedIds.value = checked
    ? [...new Set([...selectedIds.value, ...ids])]
    : selectedIds.value.filter((key) => !ids.includes(key));
}
const selectedEditableLeafIds = computed(() =>
  selectedIds.value.filter(
    (id) =>
      categories.value.some((category) => category.id === id && category.status === 'enabled') && isLeafCategory(id),
  ),
);
function isExpanded(id: number) {
  return (onlyUnconfigured.value ? filterExpandedIds.value : expandedIds.value).includes(id);
}
function toggleExpanded(id: number) {
  const ids = onlyUnconfigured.value ? filterExpandedIds : expandedIds;
  ids.value = ids.value.includes(id) ? ids.value.filter((item) => item !== id) : [...ids.value, id];
}
function selectMenu(value: string | number) {
  if (saving.value || loading.value) return;
  if (activeKind.value === 'price') {
    const changed = Object.fromEntries(
      Object.entries(coefficientDrafts.value).filter(([id, value]) => {
        const numeric = value == null || String(value).trim() === '' ? null : Number(value);
        const rule = ruleFor(Number(id));
        return numeric !== (rule ? Number(rule.coefficient) : null);
      }),
    );
    draftCache.set(activeKey.value, changed);
  }
  activeKey.value = String(value);
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
    if (activeKind.value === 'price') {
      categories.value = targets as StorePriceCategory[];
      const firstRoot = categories.value.find((category) => category.parentId == null);
      const expandBranch = (id: number): number[] => {
        const children = categories.value.filter((category) => category.parentId === id);
        return children.length ? [id, ...children.flatMap((child) => expandBranch(child.id))] : [];
      };
      expandedIds.value = firstRoot ? expandBranch(firstRoot.id) : [];
      coefficientDrafts.value = Object.fromEntries(
        categories.value.map((category) => {
          const rule = ruleFor(category.id);
          const cached = draftCache.get(key);
          return [
            category.id,
            cached && Object.hasOwn(cached, category.id)
              ? cached[category.id]
              : rule
                ? Number(rule.coefficient).toFixed(2)
                : undefined,
          ];
        }),
      );
      coefficientErrors.value = {};
    } else roles.value = targets as StorePriceRole[];
  } catch (error) {
    if (current === revision) adminFeedback.error(getSafeErrorMessage(error, '价格配置加载失败'));
  } finally {
    if (current === revision) loading.value = false;
  }
}
function handleCoefficientKeydown(_value: unknown, context?: { e?: KeyboardEvent }) {
  const event = context?.e;
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return;
  const allowedKeys = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (/^\d$/.test(event.key) || allowedKeys.includes(event.key)) return;
  if (event.key === '.') {
    const input = event.target as HTMLInputElement | null;
    const selectedText = input?.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0) ?? '';
    if (!input?.value.includes('.') || selectedText.includes('.')) return;
  }
  event.preventDefault();
}
function changeCoefficient(id: number, value: string | number | undefined, context?: { type?: string }) {
  if (context?.type === 'props') return;
  coefficientDrafts.value[id] = value;
  delete coefficientErrors.value[id];
}
function validateCoefficient(id: number) {
  const value = String(coefficientDrafts.value[id] ?? '').trim();
  const coefficient = Number(value);
  if (value && (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) || coefficient < 0.01 || coefficient > 999)) {
    coefficientErrors.value[id] = '请输入0.01至999之间的系数，最多两位小数';
    return false;
  }
  delete coefficientErrors.value[id];
  coefficientDrafts.value[id] = value ? coefficient.toFixed(2) : '';
  return true;
}
async function savePrices() {
  if (saving.value || loading.value || !can('batch-set')) return;
  const editable = categories.value.filter((category) => category.status === 'enabled' && isLeafCategory(category.id));
  const valid = editable.map((category) => validateCoefficient(category.id)).every(Boolean);
  if (!valid) {
    adminFeedback.warning('请填写正确的价格系数');
    return;
  }
  const changes = editable
    .map((category) => {
      const value = String(coefficientDrafts.value[category.id] ?? '').trim();
      return { categoryId: category.id, coefficient: value ? Number(value) : null };
    })
    .filter(
      (change) =>
        change.coefficient !== (ruleFor(change.categoryId) ? Number(ruleFor(change.categoryId)!.coefficient) : null),
    );
  if (!changes.length) {
    adminFeedback.info('没有需要保存的修改');
    return;
  }
  saving.value = true;
  try {
    rules.value = await saveStoreCategoryPrices(activeScope.value, changes);
    selectedIds.value = [];
    draftCache.delete(activeKey.value);
    adminFeedback.success('价格配置已保存');
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '保存失败，请稍后重试'));
  } finally {
    saving.value = false;
  }
}
const createVisible = ref(false);
const editingDiscountId = ref<number | null>(null);
const createFormRef = ref<FormInstanceFunctions>();
const createRules: Record<string, FormRule[]> = {
  roleId: [{ required: true, message: '请选择角色', type: 'error' }],
  coefficient: [
    { required: true, message: '请输入折扣系数', type: 'error' },
    {
      validator: (value) => {
        const text = String(value ?? '').trim();
        return !text || (/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text) && Number(text) >= 0.01 && Number(text) <= 1);
      },
      message: '请输入0.01至1.00之间的折扣系数，最多两位小数',
      type: 'error',
    },
  ],
};
const createForm = reactive<{ roleId: number | undefined; coefficient: number | null }>({
  roleId: undefined,
  coefficient: null,
});
const availableRoleOptions = computed(() =>
  roles.value
    .filter(
      (role) =>
        role.status === 'enabled' &&
        !rules.value.some((rule) => rule.roleId === role.id && rule.id !== editingDiscountId.value),
    )
    .map((role) => ({ label: role.name, value: role.id })),
);
function openCreateDiscount() {
  editingDiscountId.value = null;
  createForm.roleId = undefined;
  createForm.coefficient = null;
  createVisible.value = true;
  nextTick(() => createFormRef.value?.clearValidate());
}
async function saveDiscount() {
  if (saving.value || !can(editingDiscountId.value == null ? 'create' : 'edit')) return;
  if ((await createFormRef.value?.validate()) !== true || createForm.roleId == null) return;
  saving.value = true;
  try {
    rules.value =
      editingDiscountId.value == null
        ? await createStoreDiscount(activeScope.value, createForm.roleId, Number(createForm.coefficient))
        : await updateStoreDiscount(
            activeScope.value,
            editingDiscountId.value,
            createForm.roleId,
            Number(createForm.coefficient),
          );
    createVisible.value = false;
    adminFeedback.actionSuccess({ action: editingDiscountId.value == null ? '新增' : '保存', target: '折扣配置' });
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '新增失败，请稍后重试'));
  } finally {
    saving.value = false;
  }
}
function editDiscount(rule: StorePriceRule) {
  editingDiscountId.value = rule.id;
  createForm.roleId = rule.roleId ?? undefined;
  createForm.coefficient = Number(rule.coefficient);
  createVisible.value = true;
  nextTick(() => createFormRef.value?.clearValidate());
}
const discountConfirmVisible = ref(false);
const discountAction = ref<'status' | 'delete'>('status');
const discountActionTarget = ref<StorePriceRule>();
const discountActionLabel = computed(() =>
  discountAction.value === 'delete' ? '删除' : discountActionTarget.value?.status === 'disabled' ? '启用' : '停用',
);
function confirmDiscountAction(rule: StorePriceRule, action: 'status' | 'delete') {
  discountActionTarget.value = rule;
  discountAction.value = action;
  discountConfirmVisible.value = true;
}
async function applyDiscountAction() {
  const target = discountActionTarget.value;
  if (!target || saving.value) return;
  saving.value = true;
  try {
    rules.value =
      discountAction.value === 'delete'
        ? await deleteStoreDiscount(activeScope.value, target.id)
        : await setStoreDiscountStatus(
            activeScope.value,
            target.id,
            target.status === 'disabled' ? 'enabled' : 'disabled',
          );
    selectedIds.value = [];
    discountConfirmVisible.value = false;
    adminFeedback.actionSuccess({ action: discountActionLabel.value, target: '折扣配置' });
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '操作失败，请稍后重试'));
  } finally {
    saving.value = false;
  }
}
function openBatch() {
  if (activeKind.value !== 'price' || !can('batch-set')) return;
  if (!selectedIds.value.length) {
    adminFeedback.warning('请先选择分类');
    return;
  }
  if (!selectedEditableLeafIds.value.length) {
    adminFeedback.warning('请选择可设置价格系数的末级分类');
    return;
  }
  form.coefficient = null;
  batchError.value = '';
  formVisible.value = true;
}
function save() {
  if (saving.value || activeKind.value !== 'price' || !can('batch-set')) return;
  if (form.coefficient == null || String(form.coefficient).trim() === '') {
    batchError.value = '请输入价格系数';
    adminFeedback.warning(batchError.value);
    return;
  }
  if (form.coefficient <= 0 || form.coefficient > 999) {
    batchError.value = '请填写正确的系数';
    adminFeedback.warning(batchError.value);
    return;
  }
  for (const id of selectedEditableLeafIds.value) {
    coefficientDrafts.value[id] = Number(form.coefficient).toFixed(2);
    delete coefficientErrors.value[id];
  }
  formVisible.value = false;
}

watch(
  availableEntries,
  () => {
    if (!availableEntries.value.some((entry) => entry.key === activeKey.value))
      activeKey.value = availableEntries.value[0]?.key ?? '';
  },
  { immediate: true },
);
watch(user, () => draftCache.clear());
watch(
  [activeKey, user],
  () => {
    createVisible.value = false;
    searchForm.keyword = '';
    searchForm.onlyUnconfigured = false;
    onlyUnconfigured.value = false;
    keyword.value = '';
    selectedIds.value = [];
    expandedIds.value = [];
    coefficientDrafts.value = {};
    coefficientErrors.value = {};
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
  align-items: flex-start;
  gap: var(--zdm-admin-section-gap);
}
.price-navigation {
  flex-shrink: 0;
}
.price-content {
  flex: 1;
  min-width: 0;
}
.price-coefficient-input {
  width: 72px;
}
.filter-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}
.list-controls {
  display: grid;
  width: 100%;
  gap: var(--td-comp-margin-l);
}
.filter-fields {
  display: flex;
  align-items: flex-start;
}
.filter-fields :deep(.t-form__item) {
  width: 260px;
  margin-bottom: 0;
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
.category-name-cell {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}
.category-name-cell.level-1 {
  font-weight: 600;
}
.category-name-cell.level-2 {
  padding-left: 28px;
  color: var(--td-text-color-secondary);
}
.category-name-cell.level-3 {
  padding-left: 56px;
  color: var(--td-text-color-placeholder);
}
.tree-toggle,
.tree-toggle-placeholder {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
}
.tree-toggle {
  color: var(--td-text-color-secondary);
}
.tree-toggle-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--td-text-color-placeholder);
}
.discount-config-form :deep(.t-form-item__coefficient .t-input__extra) {
  position: static;
  width: 100%;
  max-width: 100%;
  margin-bottom: calc(0px - var(--td-line-height-body-small));
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
}
:global(.discount-config-dialog .t-dialog__body) {
  overflow: visible;
}
</style>
