<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>基础信息管理</t-breadcrumb-item>
              <t-breadcrumb-item>成品现货分类管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">类目属性模板</t-tag>
        </header>

        <section class="category-attribute-layout">
          <aside class="category-panel">
            <div class="panel-toolbar">
              <h2>类目树</h2>
              <t-button theme="primary" @click="openCreateDialog()">新建</t-button>
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
                <span class="category-actions">
                  <t-button
                    v-if="row.level < maxCategoryLevel - 1"
                    shape="square"
                    size="small"
                    variant="text"
                    title="新增"
                    @click.stop="openCreateDialog(row.node)"
                  >
                    <t-icon name="add" />
                  </t-button>
                  <t-button
                    shape="square"
                    size="small"
                    variant="text"
                    title="编辑"
                    @click.stop="openEditDialog(row.node)"
                  >
                    <t-icon name="edit-1" />
                  </t-button>
                  <t-button
                    shape="square"
                    size="small"
                    variant="text"
                    title="删除"
                    @click.stop="openDeleteCategoryConfirm(row.node)"
                  >
                    <t-icon name="delete" />
                  </t-button>
                </span>
              </div>
            </div>
          </aside>

          <section class="attribute-panel">
            <div class="panel-toolbar">
              <div>
                <h2>{{ selectedCategoryName }}属性</h2>
                <p>仅叶子类目可配置发布模板；属性来自全局属性库</p>
              </div>
              <t-button theme="primary" @click="openAttributeTransferDialog">{{ relationButtonText }}</t-button>
            </div>

            <t-tabs v-model="activeTab" class="attribute-tabs" :list="tabList" @change="handleTabChange" />

            <t-alert theme="info" class="template-tip">
              商品属性用于商品识别与搜索；销售属性勾选“规格构建”后才参与 SKU 组合。下拉属性仅可限定使用全局标准选项。
            </t-alert>

            <div class="attribute-search">
              <t-form :data="currentState.filterForm" label-width="56px" colon>
                <div class="filter-row">
                  <t-form-item label="属性" name="attribute">
                    <t-input v-model="currentState.filterForm.attribute" clearable placeholder="请输入" />
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
                {{ (currentState.pagination.current - 1) * currentState.pagination.pageSize + rowIndex + 1 }}
              </template>
              <template #controlType="{ row }">
                {{ row.controlType === 'select' ? '下拉列表' : '文本框' }}
              </template>
              <template #attributeRole="{ row }">
                <t-tag :theme="attributeRoleTheme(row)" variant="light">{{ attributeRoleLabel(row) }}</t-tag>
              </template>
              <template #optionScope="{ row }">
                {{ row.controlType === 'select' ? `已限定 ${row.optionIds.length} 项` : '不适用' }}
              </template>
              <template #required="{ row }">
                <t-checkbox v-model="row.required" @change="markRequired(row, $event)" />
              </template>
              <template #specBuild="{ row }">
                <t-checkbox v-model="row.specBuild" @change="markSpecBuild(row, $event)" />
              </template>
              <template #publishStatus="{ row }">
                <span class="status-tag" :class="row.publishStatus">
                  {{ row.publishStatus === 'published' ? '已发布' : '未发布' }}
                </span>
              </template>
              <template #operation="{ row }">
                <div class="table-actions">
                  <t-link
                    v-if="row.controlType === 'select'"
                    theme="primary"
                    hover="color"
                    @click="openOptionTransferDialog(row)"
                  >
                    关联选项
                  </t-link>
                  <t-link
                    v-if="row.controlType === 'select' && row.publishStatus === 'unpublished'"
                    theme="primary"
                    hover="color"
                    @click="openPublishConfirm(row)"
                  >
                    发布
                  </t-link>
                  <t-link
                    v-if="row.controlType === 'input' || row.publishStatus === 'published'"
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
              v-model:current="currentState.pagination.current"
              v-model:page-size="currentState.pagination.pageSize"
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
      :header="`${relationButtonText}（引用全局属性库）`"
      width="760px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="submitAttributeTransfer"
      @cancel="closeAttributeTransferDialog"
      @close="closeAttributeTransferDialog"
    >
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

    <t-dialog
      v-model:visible="confirmDialogVisible"
      header="系统提示"
      width="420px"
      placement="center"
      confirm-btn="确认"
      cancel-btn="取消"
      @confirm="handleConfirm"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
    >
      {{ confirmState.content }}
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { AdminPagination } from '@/components/foundation';
import { computed, reactive, ref } from 'vue';
type TabKey = 'goods' | 'sales';
type ControlType = 'input' | 'select';
type PublishStatus = 'published' | 'unpublished';
type ConfirmType = 'delete-category' | 'remove-attribute' | 'publish-attribute';

interface CategoryNode {
  id: string;
  name: string;
  expanded: boolean;
  children: CategoryNode[];
}

interface AttributeItem {
  id: number;
  name: string;
  controlType: ControlType;
  required: boolean;
  specBuild: boolean;
  publishStatus: PublishStatus;
  optionIds: number[];
}

interface OptionItem {
  id: number;
  name: string;
}

interface CategoryRow {
  node: CategoryNode;
  level: number;
}

interface TabState {
  filterForm: {
    attribute: string;
  };
  pagination: {
    current: number;
    pageSize: number;
  };
  categoryAttributes: Record<string, AttributeItem[]>;
}

const maxCategoryLevel = 4;

const globalKeyword = ref('');
const appliedGlobalKeyword = ref('');
const activeTab = ref<TabKey>('goods');

const tabList = [
  { label: '商品属性', value: 'goods' },
  { label: '销售属性', value: 'sales' },
];

const categoryTree = ref<CategoryNode[]>([
  {
    id: 'residential-furniture',
    name: '住宅家具',
    expanded: true,
    children: [
      {
        id: 'dining-room-set',
        name: '餐厅成套家具',
        expanded: true,
        children: [
          { id: 'table-chair', name: '餐桌+餐椅', expanded: true, children: [] },
          { id: 'table-chair-sideboard', name: '餐桌椅+餐边柜', expanded: true, children: [] },
        ],
      },
      {
        id: 'tables',
        name: '桌类',
        expanded: true,
        children: [
          { id: 'marble-dining-table', name: '大理石餐桌', expanded: true, children: [] },
          { id: 'luxury-stone-dining-table', name: '奢石餐桌', expanded: true, children: [] },
        ],
      },
    ],
  },
]);

const selectedCategoryId = ref('table-chair');

const attributeLibraries: Record<TabKey, AttributeItem[]> = {
  goods: [
    {
      id: 1,
      name: '品牌',
      controlType: 'select',
      required: false,
      specBuild: false,
      publishStatus: 'published',
      optionIds: [1, 2, 3],
    },
    {
      id: 2,
      name: '型号',
      controlType: 'input',
      required: false,
      specBuild: false,
      publishStatus: 'published',
      optionIds: [],
    },
    {
      id: 3,
      name: '尺寸(mm)',
      controlType: 'input',
      required: false,
      specBuild: false,
      publishStatus: 'published',
      optionIds: [],
    },
    {
      id: 4,
      name: '风格',
      controlType: 'select',
      required: false,
      specBuild: false,
      publishStatus: 'unpublished',
      optionIds: [11, 12],
    },
    {
      id: 5,
      name: '材质',
      controlType: 'select',
      required: false,
      specBuild: false,
      publishStatus: 'published',
      optionIds: [21, 22],
    },
    {
      id: 6,
      name: '产地',
      controlType: 'input',
      required: false,
      specBuild: false,
      publishStatus: 'unpublished',
      optionIds: [],
    },
    {
      id: 7,
      name: '台面厚度(mm)',
      controlType: 'input',
      required: false,
      specBuild: false,
      publishStatus: 'published',
      optionIds: [],
    },
  ],
  sales: [
    {
      id: 101,
      name: '价格',
      controlType: 'select',
      required: false,
      specBuild: false,
      publishStatus: 'published',
      optionIds: [101, 102],
    },
    {
      id: 102,
      name: '数量',
      controlType: 'input',
      required: false,
      specBuild: false,
      publishStatus: 'published',
      optionIds: [],
    },
    {
      id: 103,
      name: '桌子形状',
      controlType: 'input',
      required: false,
      specBuild: false,
      publishStatus: 'published',
      optionIds: [],
    },
    {
      id: 104,
      name: '颜色分类',
      controlType: 'select',
      required: false,
      specBuild: false,
      publishStatus: 'unpublished',
      optionIds: [121, 122],
    },
    {
      id: 105,
      name: '尺寸规格',
      controlType: 'select',
      required: false,
      specBuild: false,
      publishStatus: 'published',
      optionIds: [131, 132],
    },
    {
      id: 106,
      name: '套餐组合',
      controlType: 'select',
      required: false,
      specBuild: false,
      publishStatus: 'unpublished',
      optionIds: [141, 142],
    },
  ],
};

const optionLibraryMap: Record<number, OptionItem[]> = {
  1: [
    { id: 1, name: '装点猫' },
    { id: 2, name: '华中石业' },
    { id: 3, name: '国庆奢石家居' },
    { id: 4, name: '中磐石材' },
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
  101: [
    { id: 101, name: '平台标准价' },
    { id: 102, name: '门店采购价' },
    { id: 103, name: '活动价' },
  ],
  104: [
    { id: 121, name: '爵士白' },
    { id: 122, name: '鱼肚白' },
    { id: 123, name: '劳伦黑金' },
    { id: 124, name: '雅士灰' },
  ],
  105: [
    { id: 131, name: '1200*700' },
    { id: 132, name: '1400*800' },
    { id: 133, name: '1600*900' },
  ],
  106: [
    { id: 141, name: '一桌四椅' },
    { id: 142, name: '一桌六椅' },
    { id: 143, name: '餐桌椅+餐边柜' },
  ],
};

const tabsState = reactive<Record<TabKey, TabState>>({
  goods: {
    filterForm: {
      attribute: '',
    },
    pagination: {
      current: 1,
      pageSize: 10,
    },
    categoryAttributes: {
      'residential-furniture': cloneAttributes('goods', [1, 2, 3, 4]),
      'dining-room-set': cloneAttributes('goods', [1, 2, 3, 4]),
      tables: cloneAttributes('goods', [1, 2, 3, 5]),
      'table-chair': cloneAttributes('goods', [1, 2, 3, 4]),
      'table-chair-sideboard': cloneAttributes('goods', [1, 3, 4, 5]),
      'marble-dining-table': cloneAttributes('goods', [1, 2, 3, 5]),
      'luxury-stone-dining-table': cloneAttributes('goods', [1, 2, 3, 4, 7]),
    },
  },
  sales: {
    filterForm: {
      attribute: '',
    },
    pagination: {
      current: 1,
      pageSize: 10,
    },
    categoryAttributes: {
      'residential-furniture': cloneAttributes('sales', [101, 102, 103, 104]),
      'dining-room-set': cloneAttributes('sales', [101, 102, 103, 104]),
      tables: cloneAttributes('sales', [101, 102, 103, 105]),
      'table-chair': cloneAttributes('sales', [101, 102, 103, 104]),
      'table-chair-sideboard': cloneAttributes('sales', [101, 102, 104, 106]),
      'marble-dining-table': cloneAttributes('sales', [101, 102, 103, 105]),
      'luxury-stone-dining-table': cloneAttributes('sales', [101, 102, 104, 105]),
    },
  },
});
const appliedFilterForms = reactive<Record<TabKey, TabState['filterForm']>>({
  goods: { ...tabsState.goods.filterForm },
  sales: { ...tabsState.sales.filterForm },
});

function cloneAttributes(tab: TabKey, ids: number[]) {
  return ids.map((id) => ({ ...attributeLibraries[tab].find((item) => item.id === id)! }));
}

const pageSizeOptions = [10, 20, 50];

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

const currentState = computed(() => tabsState[activeTab.value]);
const currentLibrary = computed(() => attributeLibraries[activeTab.value]);
const selectedCategoryName = computed(() => findCategory(selectedCategoryId.value)?.name ?? '未选择类目');
const selectedAttributes = computed(() => currentState.value.categoryAttributes[selectedCategoryId.value] ?? []);
const relationButtonText = computed(() => (activeTab.value === 'goods' ? '关联商品属性' : '关联销售属性'));

const columns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  const baseColumns: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'index', title: '序号', width: 80, align: 'left' },
    { colKey: 'name', title: '属性', minWidth: 140, align: 'left' },
    { colKey: 'attributeRole', title: '属性角色', width: 110, align: 'center' },
    { colKey: 'controlType', title: '控件类型', width: 140, align: 'center' },
    { colKey: 'required', title: '必填', width: 96, align: 'center' },
  ];

  if (activeTab.value === 'sales') {
    baseColumns.push({ colKey: 'specBuild', title: '规格构建', width: 112, align: 'center' });
  }

  return [
    ...baseColumns,
    { colKey: 'optionScope', title: '可用选项', width: 120, align: 'center' },
    { colKey: 'publishStatus', title: '发布状态', width: 120, align: 'center' },
    { colKey: 'operation', title: '操作', width: 220, align: 'left', fixed: 'right' },
  ];
});

const filteredAttributes = computed(() => {
  const keyword = appliedFilterForms[activeTab.value].attribute.trim();
  if (!keyword) return selectedAttributes.value;
  return selectedAttributes.value.filter((item) => item.name.includes(keyword));
});

const paginationTotal = computed(() => filteredAttributes.value.length);
const pageCount = computed(() =>
  Math.max(Math.ceil(paginationTotal.value / currentState.value.pagination.pageSize), 1),
);
const pageData = computed(() => {
  const start = (currentState.value.pagination.current - 1) * currentState.value.pagination.pageSize;
  return filteredAttributes.value.slice(start, start + currentState.value.pagination.pageSize);
});

const visibleCategoryRows = computed(() => {
  const rows: CategoryRow[] = [];
  categoryTree.value.forEach((node) => collectVisibleRows(node, 0, rows));
  return rows;
});

const availableAttributes = computed(() => {
  const keyword = attributeTransferSearch.left.trim();
  return currentLibrary.value.filter(
    (item) => !tempAttributeIds.value.includes(item.id) && item.name.includes(keyword),
  );
});

const boundAttributes = computed(() => {
  const keyword = attributeTransferSearch.right.trim();
  return currentLibrary.value.filter((item) => tempAttributeIds.value.includes(item.id) && item.name.includes(keyword));
});

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

function getCategoryLevel(id: string, nodes = categoryTree.value, level = 0): number {
  for (const node of nodes) {
    if (node.id === id) return level;
    const childLevel = getCategoryLevel(id, node.children, level + 1);
    if (childLevel >= 0) return childLevel;
  }
  return -1;
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
  Object.assign(appliedFilterForms[activeTab.value], currentState.value.filterForm);
  currentState.value.pagination.current = 1;
};

const handleReset = () => {
  currentState.value.filterForm.attribute = '';
  currentState.value.pagination.pageSize = 10;
  handleQuery();
};

const attributeRoleLabel = (row: AttributeItem) => {
  if (activeTab.value === 'sales') return '销售属性';
  return row.name === '品牌' || row.name === '型号' ? '关键属性' : '普通属性';
};

const attributeRoleTheme = (row: AttributeItem) => {
  const role = attributeRoleLabel(row);
  return role === '销售属性' ? 'warning' : role === '关键属性' ? 'primary' : 'default';
};

const handleTabChange = () => {
  ensureCurrentPage();
};

const selectCategory = (id: string) => {
  const node = findCategory(id);
  if (!node) return;
  if (node.children.length) {
    node.expanded = !node.expanded;
    MessagePlugin.info('请选择末级类目查看属性');
    return;
  }
  selectedCategoryId.value = id;
  currentState.value.pagination.current = 1;
};

const toggleCategory = (node: CategoryNode) => {
  node.expanded = !node.expanded;
};

const openCreateDialog = (parent?: CategoryNode) => {
  if (parent && getCategoryLevel(parent.id) >= maxCategoryLevel - 1) {
    MessagePlugin.warning('类目最多支持创建4级');
    return;
  }

  categoryDialogMode.value = 'create';
  editingCategoryId.value = '';
  parentCategoryId.value = parent?.id ?? '';
  categoryForm.name = '';
  categoryDialogVisible.value = true;
};

const openEditDialog = (node: CategoryNode) => {
  categoryDialogMode.value = 'edit';
  editingCategoryId.value = node.id;
  parentCategoryId.value = '';
  categoryForm.name = node.name;
  categoryDialogVisible.value = true;
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
    tabsState.goods.categoryAttributes[newNode.id] = [];
    tabsState.sales.categoryAttributes[newNode.id] = [];
    selectedCategoryId.value = newNode.id;
  } else {
    const target = findCategory(editingCategoryId.value);
    if (target) target.name = name;
  }

  closeCategoryDialog();
  MessagePlugin.success('操作成功');
};

const openDeleteCategoryConfirm = (node: CategoryNode) => {
  confirmState.type = 'delete-category';
  confirmState.category = node;
  confirmState.attribute = null;
  confirmState.content = `是否删除类目【${node.name}】？`;
  confirmDialogVisible.value = true;
};

const openAttributeTransferDialog = () => {
  tempAttributeIds.value = selectedAttributes.value.map((item) => item.id);
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
    const libraryRow = currentLibrary.value.find((item) => item.id === id)!;
    return { ...libraryRow, required: false, specBuild: false, publishStatus: 'unpublished' as PublishStatus };
  });
  const keptRows = keptIds.map((id) => ({ ...oldRows.find((item) => item.id === id)! }));
  currentState.value.categoryAttributes[selectedCategoryId.value] = [...newlyBoundRows, ...keptRows];
  currentState.value.pagination.current = 1;
  closeAttributeTransferDialog();
  MessagePlugin.success('关联成功');
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
  MessagePlugin.success('关联成功');
};

const markRequired = (row: AttributeItem, checked: unknown) => {
  row.required = Boolean(checked);
  MessagePlugin.success(row.required ? '已设为必填' : '已取消必填');
};

const markSpecBuild = (row: AttributeItem, checked: unknown) => {
  row.specBuild = Boolean(checked);
  MessagePlugin.success(row.specBuild ? '已参与规格构建' : '已取消规格构建');
};

const openRemoveAttributeConfirm = (row: AttributeItem) => {
  confirmState.type = 'remove-attribute';
  confirmState.category = null;
  confirmState.attribute = row;
  confirmState.content = `是否移除属性【${row.name}】？`;
  confirmDialogVisible.value = true;
};

const openPublishConfirm = (row: AttributeItem) => {
  confirmState.type = 'publish-attribute';
  confirmState.category = null;
  confirmState.attribute = row;
  confirmState.content = `是否发布属性【${row.name}】？`;
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.category = null;
  confirmState.attribute = null;
};

const ensureCurrentPage = () => {
  if (currentState.value.pagination.current > pageCount.value) {
    currentState.value.pagination.current = pageCount.value;
  }
};

const handleConfirm = () => {
  if (confirmState.type === 'delete-category' && confirmState.category) {
    const deletedId = confirmState.category.id;
    removeCategory(deletedId);
    delete tabsState.goods.categoryAttributes[deletedId];
    delete tabsState.sales.categoryAttributes[deletedId];
    if (!containsCategory(categoryTree.value, selectedCategoryId.value)) {
      selectedCategoryId.value = firstLeafCategory()?.id ?? '';
    }
  }

  if (confirmState.type === 'remove-attribute' && confirmState.attribute) {
    currentState.value.categoryAttributes[selectedCategoryId.value] = selectedAttributes.value.filter(
      (item) => item.id !== confirmState.attribute?.id,
    );
    ensureCurrentPage();
  }

  if (confirmState.type === 'publish-attribute' && confirmState.attribute) {
    confirmState.attribute.publishStatus = 'published';
  }

  closeConfirmDialog();
  MessagePlugin.success('操作成功');
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

.category-panel,
.attribute-panel {
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
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
  grid-template-columns: 320px minmax(0, 1fr);
  gap: var(--td-comp-margin-l);
}

.category-panel,
.attribute-panel {
  min-height: 600px;
  overflow: hidden;
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

.category-actions {
  display: inline-flex;
  align-items: center;
  opacity: 0;
}

.category-node:hover .category-actions,
.category-node.active .category-actions {
  opacity: 1;
}

.attribute-panel {
  padding-bottom: var(--td-comp-paddingTB-l);
}

.attribute-tabs {
  padding: 0 var(--td-comp-paddingLR-xl);
  border-bottom: 1px solid var(--td-component-border);
}

.attribute-panel :deep(.t-table) {
  border-radius: 0;
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  gap: var(--td-comp-margin-m);
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
</style>
