<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>商品基础数据中心</t-breadcrumb-item>
              <t-breadcrumb-item>{{ menuTitle }}</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">{{ pageTitle }}</t-tag>
        </header>

        <t-alert theme="info" class="page-tip">
          模板先从“共享基础属性 + 当前业务专属属性”引用字段，再按当前类目配置属性角色、必填、SKU
          和可用值范围；销售属性使用标准选项时，发布前至少需关联 2 个可用选项；文本与数值类型作为 SKU
          销售属性时由商品端手工输入。
        </t-alert>

        <section v-if="!lockedDomain" class="domain-switch-card">
          <t-tabs v-model="templateDomain" :list="templateDomainTabs" @change="changeTemplateDomain" />
          <div class="source-caption">按业务域独立维护类目与模板；共享属性可在两套模板中复用。</div>
        </section>

        <section class="category-attribute-layout">
          <aside class="category-panel">
            <div class="panel-toolbar">
              <div>
                <h2>商品类目</h2>
                <p>类目树仅用于定位末级发布类目</p>
              </div>
            </div>

            <div class="category-search">
              <t-input v-model="globalKeyword" clearable placeholder="请输入" />
              <t-button theme="default" variant="base" @click="handleGlobalSearch">搜索</t-button>
            </div>

            <div class="category-tree">
              <div
                v-for="row in visibleCategoryRows"
                :key="row.node.id"
                class="category-node"
                :class="{ active: row.node.id === selectedCategoryId }"
                :style="{ paddingLeft: `${row.level * 20 + 12}px` }"
                @click="selectCategory(row.node.id)"
              >
                <t-button
                  v-if="row.node.children.length"
                  class="expand-button"
                  shape="square"
                  size="small"
                  variant="text"
                  @click.stop="toggleCategory(row.node)"
                >
                  <t-icon :name="row.node.expanded ? 'chevron-down' : 'chevron-right'" />
                </t-button>
                <span v-else class="expand-placeholder"></span>
                <span class="category-name">{{ row.node.name }}</span>
              </div>
            </div>
          </aside>

          <section class="attribute-panel">
            <div class="panel-toolbar">
              <div>
                <h2>{{ selectedCategoryName }}发布属性模板</h2>
                <p>配置商品发布字段、必填规则、SKU 规格构建与可用标准属性值</p>
              </div>
              <t-button theme="primary" @click="openAttributeTransferDialog">关联标准属性</t-button>
            </div>

            <div class="attribute-search">
              <t-form :data="filterForm" label-width="56px" colon>
                <div class="filter-row">
                  <t-form-item label="属性" name="attribute">
                    <t-input v-model="filterForm.attribute" clearable placeholder="请输入" />
                  </t-form-item>
                  <div class="filter-actions">
                    <t-button theme="primary" @click="handleQuery">查询</t-button>
                    <t-button theme="default" variant="base" @click="handleReset">重置</t-button>
                  </div>
                </div>
              </t-form>
            </div>

            <t-table row-key="id" :data="pageData" :columns="columns" hover table-layout="fixed">
              <template #index="{ rowIndex }">
                {{ (pagination.current - 1) * pagination.pageSize + rowIndex + 1 }}
              </template>
              <template #valueType="{ row }">
                {{ valueTypeLabel(row.valueType) }}
              </template>
              <template #attributeRole="{ row }">
                <t-select
                  v-model="row.role"
                  class="attribute-role-select"
                  size="small"
                  placeholder="请选择角色"
                  @change="changeAttributeRole(row, $event)"
                >
                  <t-option
                    v-for="item in attributeRoleOptions"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                  />
                </t-select>
              </template>
              <template #attributeSource="{ row }">
                <t-tag :theme="isSharedAttribute(row) ? 'primary' : 'warning'" variant="light">
                  {{ isSharedAttribute(row) ? '共享基础属性' : '当前业务专属' }}
                </t-tag>
              </template>
              <template #optionScope="{ row }">
                {{ row.valueType === 'select' ? `已限定 ${row.optionIds.length} 项` : '不适用' }}
              </template>
              <template #required="{ row }">
                <t-checkbox v-model="row.required" @change="markRequired(row)" />
              </template>
              <template #publishStatus="{ row }">
                <span class="status-tag" :class="row.publishStatus">
                  {{ row.publishStatus === 'published' ? '已发布' : '未发布' }}
                </span>
              </template>
              <template #operation="{ row }">
                <div class="table-actions">
                  <t-link
                    v-if="row.valueType === 'select'"
                    theme="primary"
                    hover="color"
                    @click="openOptionTransferDialog(row)"
                  >
                    关联选项
                  </t-link>
                  <t-link
                    v-if="row.publishStatus === 'unpublished'"
                    theme="primary"
                    hover="color"
                    @click="openPublishConfirm(row)"
                  >
                    发布
                  </t-link>
                  <t-link
                    v-if="row.valueType !== 'select' || row.publishStatus === 'published'"
                    theme="danger"
                    hover="color"
                    @click="openRemoveAttributeConfirm(row)"
                  >
                    移除
                  </t-link>
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
        </section>
      </main>
    </div>

    <t-dialog
      v-model:visible="categoryDialogVisible"
      :header="categoryDialogMode === 'create' ? '新建' : '编辑'"
      width="520px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleCategorySubmit"
      @cancel="closeCategoryDialog"
      @close="closeCategoryDialog"
    >
      <t-form ref="categoryFormRef" :data="categoryForm" :rules="categoryFormRules" label-width="96px" colon>
        <t-form-item label="类目名称" name="name" required-mark>
          <t-input v-model="categoryForm.name" clearable placeholder="请输入" />
        </t-form-item>
      </t-form>
    </t-dialog>

    <t-dialog
      v-model:visible="attributeTransferVisible"
      :header="`${selectedCategoryName} · 选择模板属性`"
      width="760px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="submitAttributeTransfer"
      @cancel="closeAttributeTransferDialog"
      @close="closeAttributeTransferDialog"
    >
      <t-tabs v-model="attributeSourceTab" :list="attributeSourceTabs" class="attribute-source-tabs" />
      <p class="attribute-source-help">
        左侧显示{{
          attributeSourceTab === 'shared'
            ? '共享基础属性，可被两个业务域的类目模板复用'
            : '当前类目所属业务域的专属属性'
        }}；右侧为该类目模板最终字段。
      </p>
      <div class="transfer-box">
        <div class="transfer-list">
          <t-input v-model="attributeTransferSearch.left" clearable placeholder="请输入关键词搜索" />
          <t-checkbox-group v-model="checkedAvailableAttributeIds" class="transfer-items">
            <t-checkbox v-for="item in availableAttributes" :key="item.id" :value="item.id">
              {{ item.name }}
            </t-checkbox>
          </t-checkbox-group>
        </div>
        <div class="transfer-actions">
          <t-button
            shape="square"
            theme="primary"
            :disabled="!checkedAvailableAttributeIds.length"
            @click="moveAttributesRight"
          >
            <t-icon name="chevron-right" />
          </t-button>
          <t-button
            shape="square"
            variant="outline"
            :disabled="!checkedBoundAttributeIds.length"
            @click="moveAttributesLeft"
          >
            <t-icon name="chevron-left" />
          </t-button>
        </div>
        <div class="transfer-list">
          <t-input v-model="attributeTransferSearch.right" clearable placeholder="请输入关键词搜索" />
          <t-checkbox-group v-model="checkedBoundAttributeIds" class="transfer-items">
            <t-checkbox v-for="item in boundAttributes" :key="item.id" :value="item.id">
              {{ item.name }}
            </t-checkbox>
          </t-checkbox-group>
        </div>
      </div>
    </t-dialog>

    <t-dialog
      v-model:visible="optionTransferVisible"
      :header="`${optionTransferTarget?.name ?? ''} · 可用标准选项范围`"
      width="760px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="submitOptionTransfer"
      @cancel="closeOptionTransferDialog"
      @close="closeOptionTransferDialog"
    >
      <div class="transfer-box">
        <div class="transfer-list">
          <t-input v-model="optionTransferSearch.left" clearable placeholder="请输入关键词搜索" />
          <t-checkbox-group v-model="checkedAvailableOptionIds" class="transfer-items">
            <t-checkbox v-for="item in availableOptions" :key="item.id" :value="item.id">
              {{ item.name }}
            </t-checkbox>
          </t-checkbox-group>
        </div>
        <div class="transfer-actions">
          <t-button
            shape="square"
            theme="primary"
            :disabled="!checkedAvailableOptionIds.length"
            @click="moveOptionsRight"
          >
            <t-icon name="chevron-right" />
          </t-button>
          <t-button shape="square" variant="outline" :disabled="!checkedBoundOptionIds.length" @click="moveOptionsLeft">
            <t-icon name="chevron-left" />
          </t-button>
        </div>
        <div class="transfer-list">
          <t-input v-model="optionTransferSearch.right" clearable placeholder="请输入关键词搜索" />
          <t-checkbox-group v-model="checkedBoundOptionIds" class="transfer-items">
            <t-checkbox v-for="item in boundOptions" :key="item.id" :value="item.id">
              {{ item.name }}
            </t-checkbox>
          </t-checkbox-group>
        </div>
      </div>
    </t-dialog>

    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="
        confirmState.type === 'delete-category' ? '删除' : confirmState.type === 'remove-attribute' ? '移除' : '发布'
      "
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
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminPagination } from '@/components/foundation';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
type ValueType = 'select' | 'number' | 'text';
type AttributeRole = '' | 'key' | 'basic' | 'sales';
type PublishStatus = 'published' | 'unpublished';
type ConfirmType = 'delete-category' | 'remove-attribute' | 'publish-attribute';

interface CategoryNode {
  id: string;
  name: string;
  expanded: boolean;
  children: CategoryNode[];
}

interface AttributeDefinition {
  id: number;
  name: string;
  valueType: ValueType;
  optionIds: number[];
}

interface AttributeItem extends AttributeDefinition {
  role: AttributeRole;
  required: boolean;
  publishStatus: PublishStatus;
}

interface OptionItem {
  id: number;
  name: string;
}

interface CategoryRow {
  node: CategoryNode;
  level: number;
}

const route = useRoute();

const globalKeyword = ref('');
const appliedGlobalKeyword = ref('');
const filterForm = reactive({
  attribute: '',
});
const appliedFilterForm = reactive({ ...filterForm });

const categoryTree = ref<CategoryNode[]>([
  {
    id: 'hardware-leg',
    name: '五金腿',
    expanded: true,
    children: [
      {
        id: 'dining-table',
        name: '餐桌',
        expanded: true,
        children: [
          { id: 'long-table-leg', name: '长桌五金腿', expanded: true, children: [] },
          { id: 'round-table-leg', name: '圆桌五金腿', expanded: true, children: [] },
        ],
      },
      {
        id: 'tea-table',
        name: '茶几',
        expanded: true,
        children: [
          { id: 'square-tea-table-leg', name: '方形茶几五金腿', expanded: true, children: [] },
          { id: 'round-tea-table-leg', name: '圆形茶几五金腿', expanded: true, children: [] },
        ],
      },
    ],
  },
]);

const accessoryCategoryTree = categoryTree.value;
const finishedCategoryTree: CategoryNode[] = [
  {
    id: 'finished-stock',
    name: '成品现货',
    expanded: true,
    children: [
      {
        id: 'dining-table-finished',
        name: '餐桌',
        expanded: true,
        children: [{ id: 'marble-dining-table', name: '石材餐桌', expanded: true, children: [] }],
      },
      {
        id: 'island-finished',
        name: '岛台',
        expanded: true,
        children: [{ id: 'stone-island', name: '石材岛台', expanded: true, children: [] }],
      },
      {
        id: 'washstand-finished',
        name: '洗手台',
        expanded: true,
        children: [{ id: 'stone-washstand', name: '石材洗手台', expanded: true, children: [] }],
      },
    ],
  },
];
const resolveTemplateDomain = (value: unknown): 'finished' | 'accessory' =>
  value === 'accessory' ? 'accessory' : 'finished';
const templateDomain = ref<'finished' | 'accessory'>(resolveTemplateDomain(route.query.scope));
const lockedDomain = computed(() => route.query.scope === 'finished' || route.query.scope === 'accessory');
const menuTitle = '类目属性模板';
const pageTitle = computed(() => (templateDomain.value === 'finished' ? '成品现货类目属性模板' : '配件类目属性模板'));
const templateDomainTabs = [
  { label: '成品现货类目模板', value: 'finished' },
  { label: '配件类目模板', value: 'accessory' },
];
if (templateDomain.value === 'finished') categoryTree.value = finishedCategoryTree;
const selectedCategoryId = ref(templateDomain.value === 'finished' ? 'marble-dining-table' : 'long-table-leg');

const attributeLibrary: AttributeDefinition[] = [
  { id: 1, name: '品牌', valueType: 'select', optionIds: [1, 2, 3] },
  { id: 2, name: '型号', valueType: 'text', optionIds: [] },
  { id: 3, name: '尺寸(mm)', valueType: 'number', optionIds: [] },
  { id: 4, name: '风格', valueType: 'select', optionIds: [11, 12] },
  { id: 5, name: '材质', valueType: 'select', optionIds: [21, 22] },
  { id: 6, name: '承重(kg)', valueType: 'number', optionIds: [] },
  { id: 7, name: '颜色', valueType: 'select', optionIds: [31, 32] },
];

const attributeRoleOptions = [
  { label: '关键属性', value: 'key' },
  { label: '普通属性', value: 'basic' },
  { label: '销售属性', value: 'sales' },
];

const optionLibraryMap: Record<number, OptionItem[]> = {
  1: [
    { id: 1, name: '装点猫' },
    { id: 2, name: '华中石业' },
    { id: 3, name: '国庆奢石家居' },
    { id: 4, name: '卓越五金' },
  ],
  4: [
    { id: 11, name: '现代' },
    { id: 12, name: '轻奢' },
    { id: 13, name: '极简' },
    { id: 14, name: '新中式' },
  ],
  5: [
    { id: 21, name: '不锈钢' },
    { id: 22, name: '铝合金' },
    { id: 23, name: '碳素钢' },
  ],
  7: [
    { id: 31, name: '哑光黑' },
    { id: 32, name: '钛金' },
    { id: 33, name: '拉丝银' },
  ],
};

const categoryAttributes = ref<Record<string, AttributeItem[]>>({
  'finished-stock': cloneAttributes([1, 4]),
  'dining-table-finished': cloneAttributes([1, 4, 5]),
  'marble-dining-table': cloneAttributes([1, 2, 3, 4, 5]),
  'island-finished': cloneAttributes([1, 4, 5]),
  'stone-island': cloneAttributes([1, 2, 3, 4, 5]),
  'washstand-finished': cloneAttributes([1, 4, 5]),
  'stone-washstand': cloneAttributes([1, 2, 3, 4, 5]),
  'hardware-leg': cloneAttributes([1, 2, 3, 4]),
  'dining-table': cloneAttributes([1, 2, 3, 5]),
  'tea-table': cloneAttributes([1, 3, 4, 7]),
  'long-table-leg': cloneAttributes([1, 2, 3]),
  'round-table-leg': cloneAttributes([1, 3, 4]),
  'square-tea-table-leg': cloneAttributes([1, 2, 5]),
  'round-tea-table-leg': cloneAttributes([1, 4, 7]),
});

function cloneAttributes(ids: number[]) {
  return ids.map((id) => ({
    ...attributeLibrary.find((item) => item.id === id)!,
    role: '' as AttributeRole,
    required: false,
    publishStatus: 'unpublished' as PublishStatus,
  }));
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 80, align: 'left' },
  { colKey: 'name', title: '属性', minWidth: 120, align: 'left' },
  { colKey: 'attributeSource', title: '数据来源', width: 128, align: 'left' },
  { colKey: 'attributeRole', title: '属性角色', width: 144, align: 'left' },
  { colKey: 'valueType', title: '值类型', width: 112, align: 'left' },
  { colKey: 'required', title: '必填', width: 80, align: 'left' },
  { colKey: 'optionScope', title: '可用选项', width: 128, align: 'left' },
  { colKey: 'publishStatus', title: '发布状态', width: 104, align: 'left' },
  { colKey: 'operation', title: '操作', width: 172, align: 'left', fixed: 'right' },
];

const pageSizeOptions = [10, 20, 50];
const pagination = reactive({
  current: 1,
  pageSize: 10,
});

const categoryFormRef = ref<FormInstanceFunctions>();
const categoryDialogVisible = ref(false);
const categoryDialogMode = ref<'create' | 'edit'>('create');
const editingCategoryId = ref('');
const parentCategoryId = ref('');
const categoryForm = reactive({
  name: '',
});
const categoryFormRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入类目名称', type: 'error' }],
};

const attributeTransferVisible = ref(false);
const attributeSourceTab = ref<'shared' | 'special'>('shared');
const attributeSourceTabs = [
  { label: '共享基础属性', value: 'shared' },
  { label: '当前业务专属属性', value: 'special' },
];
const tempAttributeIds = ref<number[]>([]);
const checkedAvailableAttributeIds = ref<number[]>([]);
const checkedBoundAttributeIds = ref<number[]>([]);
const attributeTransferSearch = reactive({
  left: '',
  right: '',
});

const optionTransferVisible = ref(false);
const optionTransferTarget = ref<AttributeItem | null>(null);
const tempOptionIds = ref<number[]>([]);
const checkedAvailableOptionIds = ref<number[]>([]);
const checkedBoundOptionIds = ref<number[]>([]);
const optionTransferSearch = reactive({
  left: '',
  right: '',
});

const confirmDialogVisible = ref(false);
const confirmState = reactive<{
  type: ConfirmType;
  content: string;
  category: CategoryNode | null;
  attribute: AttributeItem | null;
}>({
  type: 'delete-category',
  content: '',
  category: null,
  attribute: null,
});

const selectedAttributes = computed(() => categoryAttributes.value[selectedCategoryId.value] ?? []);
const selectedCategoryName = computed(() => findCategory(selectedCategoryId.value)?.name ?? '未选择类目');

const filteredAttributes = computed(() => {
  const keyword = appliedFilterForm.attribute.trim();
  if (!keyword) return selectedAttributes.value;
  return selectedAttributes.value.filter((item) => item.name.includes(keyword));
});

const paginationTotal = computed(() => filteredAttributes.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / pagination.pageSize), 1));
const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return filteredAttributes.value.slice(start, start + pagination.pageSize);
});

const visibleCategoryRows = computed(() => {
  const rows: CategoryRow[] = [];
  categoryTree.value.forEach((node) => collectVisibleRows(node, 0, rows));
  return rows;
});

const availableAttributes = computed(() => {
  const keyword = attributeTransferSearch.left.trim();
  return attributeLibrary.filter(
    (item) =>
      isSharedAttribute(item) === (attributeSourceTab.value === 'shared') &&
      !tempAttributeIds.value.includes(item.id) &&
      item.name.includes(keyword),
  );
});

const boundAttributes = computed(() => {
  const keyword = attributeTransferSearch.right.trim();
  return attributeLibrary.filter((item) => tempAttributeIds.value.includes(item.id) && item.name.includes(keyword));
});

const valueTypeLabel = (valueType: ValueType) =>
  ({ select: '标准选项', number: '数字 + 单位', text: '文本输入' })[valueType];

function isSharedAttribute(item: AttributeDefinition) {
  return item.id === 1 || item.id === 4;
}

const changeTemplateDomain = (value: string | number) => {
  const domain = value as 'finished' | 'accessory';
  categoryTree.value = domain === 'finished' ? finishedCategoryTree : accessoryCategoryTree;
  selectedCategoryId.value = domain === 'finished' ? 'marble-dining-table' : 'long-table-leg';
  attributeSourceTab.value = 'shared';
  pagination.current = 1;
};
watch(
  () => route.query.scope,
  (scope) => {
    const domain = resolveTemplateDomain(scope);
    if (domain !== templateDomain.value) {
      templateDomain.value = domain;
      changeTemplateDomain(domain);
    }
  },
  { immediate: true },
);

const currentOptionLibrary = computed(() =>
  optionTransferTarget.value ? (optionLibraryMap[optionTransferTarget.value.id] ?? []) : [],
);
const availableOptions = computed(() => {
  const keyword = optionTransferSearch.left.trim();
  return currentOptionLibrary.value.filter(
    (item) => !tempOptionIds.value.includes(item.id) && item.name.includes(keyword),
  );
});
const boundOptions = computed(() => {
  const keyword = optionTransferSearch.right.trim();
  return currentOptionLibrary.value.filter(
    (item) => tempOptionIds.value.includes(item.id) && item.name.includes(keyword),
  );
});

function collectVisibleRows(node: CategoryNode, level: number, rows: CategoryRow[]) {
  if (!matchesCategoryKeyword(node)) return;
  rows.push({ node, level });
  if (!node.expanded) return;
  node.children.forEach((child) => collectVisibleRows(child, level + 1, rows));
}

function matchesCategoryKeyword(node: CategoryNode): boolean {
  const keyword = appliedGlobalKeyword.value.trim();
  if (!keyword) return true;
  return node.name.includes(keyword) || node.children.some((child) => matchesCategoryKeyword(child));
}

function findCategory(id: string, nodes = categoryTree.value): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findCategory(id, node.children);
    if (child) return child;
  }
  return null;
}

function containsCategory(nodes: CategoryNode[], id: string): boolean {
  return nodes.some((node) => node.id === id || containsCategory(node.children, id));
}

function removeCategory(id: string, nodes = categoryTree.value): boolean {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    nodes.splice(index, 1);
    return true;
  }
  return nodes.some((node) => removeCategory(id, node.children));
}

function firstLeafCategory(nodes = categoryTree.value): CategoryNode | null {
  for (const node of nodes) {
    if (!node.children.length) return node;
    const child = firstLeafCategory(node.children);
    if (child) return child;
  }
  return null;
}

function createCategoryId(name: string) {
  return `${Date.now()}-${name.replace(/\s+/g, '-')}`;
}

const handleGlobalSearch = () => {
  appliedGlobalKeyword.value = globalKeyword.value;
};

const handleQuery = () => {
  Object.assign(appliedFilterForm, filterForm);
  pagination.current = 1;
};

const handleReset = () => {
  filterForm.attribute = '';
  pagination.pageSize = 10;
  handleQuery();
};

const selectCategory = (id: string) => {
  const node = findCategory(id);
  if (!node) return;
  if (node.children.length) {
    node.expanded = !node.expanded;
    adminFeedback.info('请选择末级类目查看属性');
    return;
  }
  selectedCategoryId.value = id;
  pagination.current = 1;
};

const toggleCategory = (node: CategoryNode) => {
  node.expanded = !node.expanded;
};

const closeCategoryDialog = () => {
  categoryDialogVisible.value = false;
  categoryFormRef.value?.clearValidate();
};

const handleCategorySubmit = async () => {
  const result = await categoryFormRef.value?.validate();
  if (result !== true) return;

  const name = categoryForm.name.trim();
  if (categoryDialogMode.value === 'create') {
    const newNode: CategoryNode = { id: createCategoryId(name), name, expanded: true, children: [] };
    const parent = parentCategoryId.value ? findCategory(parentCategoryId.value) : null;
    if (parent) {
      parent.expanded = true;
      parent.children.unshift(newNode);
    } else {
      categoryTree.value.unshift(newNode);
    }
    categoryAttributes.value[newNode.id] = [];
    selectedCategoryId.value = newNode.id;
  } else {
    const target = findCategory(editingCategoryId.value);
    if (target) target.name = name;
  }

  closeCategoryDialog();
  adminFeedback.success(categoryDialogMode.value === 'create' ? '已新增分类' : '已保存分类');
};

const openAttributeTransferDialog = () => {
  tempAttributeIds.value = selectedAttributes.value.map((item) => item.id);
  attributeSourceTab.value = 'shared';
  checkedAvailableAttributeIds.value = [];
  checkedBoundAttributeIds.value = [];
  attributeTransferSearch.left = '';
  attributeTransferSearch.right = '';
  attributeTransferVisible.value = true;
};

const closeAttributeTransferDialog = () => {
  attributeTransferVisible.value = false;
};

const moveAttributesRight = () => {
  tempAttributeIds.value = Array.from(new Set([...tempAttributeIds.value, ...checkedAvailableAttributeIds.value]));
  checkedAvailableAttributeIds.value = [];
};

const moveAttributesLeft = () => {
  tempAttributeIds.value = tempAttributeIds.value.filter((id) => !checkedBoundAttributeIds.value.includes(id));
  checkedBoundAttributeIds.value = [];
};

const submitAttributeTransfer = () => {
  const oldRows = selectedAttributes.value;
  const newIds = tempAttributeIds.value.filter((id) => !oldRows.some((item) => item.id === id));
  const keptIds = tempAttributeIds.value.filter((id) => oldRows.some((item) => item.id === id));
  const newlyBoundRows = newIds.map((id) => {
    const libraryRow = attributeLibrary.find((item) => item.id === id)!;
    return { ...libraryRow, role: '' as AttributeRole, required: false, publishStatus: 'unpublished' as PublishStatus };
  });
  const keptRows = keptIds.map((id) => ({ ...oldRows.find((item) => item.id === id)! }));
  categoryAttributes.value[selectedCategoryId.value] = [...newlyBoundRows, ...keptRows];
  pagination.current = 1;
  closeAttributeTransferDialog();
  adminFeedback.success('关联成功');
};

const openOptionTransferDialog = (row: AttributeItem) => {
  optionTransferTarget.value = row;
  tempOptionIds.value = [...row.optionIds];
  checkedAvailableOptionIds.value = [];
  checkedBoundOptionIds.value = [];
  optionTransferSearch.left = '';
  optionTransferSearch.right = '';
  optionTransferVisible.value = true;
};

const closeOptionTransferDialog = () => {
  optionTransferVisible.value = false;
  optionTransferTarget.value = null;
};

const moveOptionsRight = () => {
  tempOptionIds.value = Array.from(new Set([...tempOptionIds.value, ...checkedAvailableOptionIds.value]));
  checkedAvailableOptionIds.value = [];
};

const moveOptionsLeft = () => {
  tempOptionIds.value = tempOptionIds.value.filter((id) => !checkedBoundOptionIds.value.includes(id));
  checkedBoundOptionIds.value = [];
};

const submitOptionTransfer = () => {
  if (optionTransferTarget.value) {
    optionTransferTarget.value.optionIds = [...tempOptionIds.value];
  }
  closeOptionTransferDialog();
  adminFeedback.success('关联成功');
};

const markRequired = (row: AttributeItem) => {
  adminFeedback.success(row.required ? '已设为必填' : '已取消必填');
};

const changeAttributeRole = (row: AttributeItem, value: unknown) => {
  const nextRole = value as AttributeRole;
  row.role = nextRole;
  const roleLabel = attributeRoleOptions.find((item) => item.value === row.role)?.label;
  if (roleLabel) adminFeedback.success(`已将“${row.name}”设为${roleLabel}`);
};

const openRemoveAttributeConfirm = (row: AttributeItem) => {
  confirmState.type = 'remove-attribute';
  confirmState.category = null;
  confirmState.attribute = row;
  confirmState.content = `是否移除属性“${row.name}”？`;
  confirmDialogVisible.value = true;
};

const openPublishConfirm = (row: AttributeItem) => {
  if (!row.role) {
    adminFeedback.warning(`请先为属性“${row.name}”选择属性角色`);
    return;
  }
  if (row.role === 'sales' && row.valueType === 'select' && row.optionIds.length < 2) {
    adminFeedback.warning(`销售属性“${row.name}”至少需关联 2 个可用选项`);
    return;
  }
  confirmState.type = 'publish-attribute';
  confirmState.category = null;
  confirmState.attribute = row;
  confirmState.content = `是否发布属性“${row.name}”？`;
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.category = null;
  confirmState.attribute = null;
};

const ensureCurrentPage = () => {
  if (pagination.current > pageCount.value) {
    pagination.current = pageCount.value;
  }
};

const handleConfirm = () => {
  if (confirmState.type === 'delete-category' && confirmState.category) {
    const deletedId = confirmState.category.id;
    removeCategory(deletedId);
    delete categoryAttributes.value[deletedId];
    if (!containsCategory(categoryTree.value, selectedCategoryId.value)) {
      selectedCategoryId.value = firstLeafCategory()?.id ?? '';
    }
  }

  if (confirmState.type === 'remove-attribute' && confirmState.attribute) {
    categoryAttributes.value[selectedCategoryId.value] = selectedAttributes.value.filter(
      (item) => item.id !== confirmState.attribute?.id,
    );
    ensureCurrentPage();
  }

  if (confirmState.type === 'publish-attribute' && confirmState.attribute) {
    confirmState.attribute.publishStatus = 'published';
  }

  closeConfirmDialog();
  adminFeedback.success(
    confirmState.type === 'delete-category'
      ? '已删除分类'
      : confirmState.type === 'remove-attribute'
        ? '已移除分类属性'
        : '已发布分类属性',
  );
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
  background: var(--td-brand-color);
  color: #fff;
  font-weight: 700;
}

.brand-title {
  font-size: 16px;
  line-height: 24px;
  color: var(--td-text-color-primary);
  font-weight: 600;
}

.brand-subtitle {
  font-size: 12px;
  line-height: 20px;
  color: var(--td-text-color-secondary);
}

.top-actions {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--td-comp-margin-l);
}

.user-entry {
  display: inline-flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  color: var(--td-text-color-secondary);
  font-size: 14px;
}

.page {
  flex: 1;
  min-width: 0;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
}

.page-header {
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--td-comp-margin-l);
}

.page-tip,
.domain-switch-card {
  margin-bottom: var(--td-comp-margin-l);
}

.domain-switch-card {
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl) var(--td-comp-paddingTB-l);
  background: var(--td-bg-color-container);
  border-radius: 6px;
  box-shadow: var(--td-shadow-1);
}

.domain-switch-card :deep(.t-tabs) {
  min-width: 0;
}

.source-caption {
  margin-top: 12px;
  color: var(--td-text-color-secondary);
  font-size: 13px;
}

.category-panel,
.attribute-panel {
  background: var(--td-bg-color-container);
}

.category-search {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
  border-bottom: 1px solid var(--td-component-border);
}

.category-search :deep(.t-input) {
  flex: 1;
}

.filter-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}

.attribute-search {
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
  border-bottom: 1px solid var(--td-component-border);
}

.attribute-search :deep(.t-form__item) {
  margin-bottom: 0;
}

.attribute-search :deep(.t-input) {
  width: 220px;
}

.filter-actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.category-attribute-layout {
  display: grid;
  grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
  gap: var(--td-comp-margin-l);
}

.category-panel,
.attribute-panel {
  min-height: 600px;
  min-width: 0;
  overflow: hidden;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  box-shadow: var(--td-shadow-1);
}

.panel-toolbar {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-m);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
  border-bottom: 1px solid var(--td-component-border);
}

.panel-toolbar h2 {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.panel-toolbar p {
  margin: 2px 0 0;
  color: var(--td-text-color-secondary);
  font-size: 12px;
}

.category-tree {
  padding: var(--td-comp-paddingTB-s) 0;
}

.category-node {
  height: 40px;
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-xs);
  padding-right: var(--td-comp-paddingLR-s);
  cursor: pointer;
  color: var(--td-text-color-primary);
}

.category-node:hover,
.category-node.active {
  background: var(--td-brand-color-light);
  color: var(--td-brand-color);
}

.expand-button,
.expand-placeholder {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.category-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attribute-panel {
  padding-bottom: var(--td-comp-paddingTB-l);
}

.attribute-panel :deep(.t-table) {
  border-radius: 0;
}

.attribute-panel :deep(.t-table__content) {
  scrollbar-gutter: stable;
}

.attribute-panel :deep(.t-table th),
.attribute-panel :deep(.t-table td) {
  padding-right: var(--td-comp-paddingLR-l);
  padding-left: var(--td-comp-paddingLR-l);
  text-align: left;
  white-space: nowrap;
}

.attribute-panel :deep(.t-table__th-cell-inner) {
  justify-content: flex-start;
  white-space: nowrap;
}

.attribute-role-select {
  width: 112px;
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  gap: var(--td-comp-margin-m);
  white-space: nowrap;
}

.status-tag {
  min-width: 64px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--td-radius-small);
  color: #fff;
  font-size: 12px;
}

.status-tag.published {
  background: #63c782;
}

.status-tag.unpublished {
  background: #f27b7b;
}

.attribute-source-tabs {
  margin-bottom: var(--td-comp-margin-s);
}

.attribute-source-help {
  margin: 0 0 var(--td-comp-margin-l);
  color: var(--td-text-color-secondary);
  font-size: 13px;
}

.transfer-box {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 56px minmax(0, 1fr);
  gap: var(--td-comp-margin-l);
  min-height: 360px;
}

.transfer-list {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-m);
  min-width: 0;
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}

.transfer-items {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-s);
  height: 284px;
  overflow: auto;
}

.transfer-items :deep(.t-checkbox) {
  margin-left: 0;
}

.transfer-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--td-comp-margin-m);
}

@media (max-width: 1100px) {
  .category-attribute-layout {
    grid-template-columns: 280px minmax(0, 1fr);
  }

  .panel-toolbar,
  .category-search,
  .attribute-search {
    padding-right: var(--td-comp-paddingLR-l);
    padding-left: var(--td-comp-paddingLR-l);
  }
}
</style>
