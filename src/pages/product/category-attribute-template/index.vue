<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <AdminPageHeader :breadcrumbs="['商品管理', '商品公共基础数据', '分类属性模板']" />
        <AdminListLayout class="template-workbench">
          <template #toolbar>
            <div class="list-controls">
              <div class="scope-controls">
                <t-tabs
                  v-if="scopeTabs.length > 1"
                  :value="scope"
                  :list="scopeTabs"
                  class="scope-tabs"
                  @change="switchScope"
                />
              </div>
            </div>
          </template>
          <template #table>
            <t-alert v-if="!scopeTabs.length" theme="warning" message="暂无分类属性模板权限" />
            <div
              v-else
              ref="versionLayout"
              class="version-layout"
              :style="{ '--category-viewport-height': categoryViewportHeight }"
            >
              <t-card class="category-panel" :shadow="false">
                <t-space direction="vertical" class="category-content">
                  <t-input v-model="keyword" clearable placeholder="请输入分类名称">
                    <template #prefix-icon><t-icon name="search" /></template>
                  </t-input>
                  <t-tree
                    v-model:expanded="expandedCategories"
                    :data="categoryTree"
                    :keys="{ value: 'id', label: 'name' }"
                    :actived="categoryId ? [categoryId] : []"
                    activable
                    :filter="keyword ? filterCategory : undefined"
                    @active="selectCategory"
                  />
                </t-space>
              </t-card>
              <t-card class="version-panel" :shadow="false">
                <t-space direction="vertical" size="medium" class="version-content">
                  <div v-if="isDraft" class="template-tab-bar">
                    <t-link
                      class="exit-edit"
                      theme="default"
                      hover="color"
                      :underline="false"
                      :disabled="busy"
                      @click="exitEdit"
                      ><template #prefix-icon><t-icon name="arrow-left" /></template>草稿箱</t-link
                    >
                  </div>
                  <t-loading :loading="loading">
                    <t-space direction="vertical" size="large" class="version-content">
                      <t-alert
                        v-if="!isDraft"
                        :message="
                          selected
                            ? '已发布版本仅可调整属性展示顺序，其他配置不可修改，如需调整配置，需创建新版本草稿，并发布新版本。'
                            : '当前暂无已发布属性模板，请创建新版本草稿，并发布新版本。'
                        "
                      />
                      <t-alert v-if="selected && isDraft" message="修改自动保存到草稿，发布后生成新版本。" />
                      <div v-if="isDraft" class="draft-footer">
                        <t-space class="draft-status" break-line>
                          <t-tag theme="warning" variant="light">草稿</t-tag>
                          <span class="draft-version-info"
                            >待发布版本 <span class="metadata-value">V{{ nextAttributeVersion }}</span></span
                          >
                        </t-space>
                        <t-button
                          v-if="can('create')"
                          class="publish-draft"
                          :disabled="busy || (dirty && !can('create'))"
                          @click="preparePublish"
                          >发布新版本</t-button
                        >
                        <t-button
                          v-if="editable"
                          class="add-attribute"
                          theme="default"
                          variant="outline"
                          @click="openAdd"
                          ><template #icon><t-icon name="add" /></template>添加属性</t-button
                        >
                      </div>
                      <div v-if="!isDraft" class="version-toolbar">
                        <t-space class="version-actions">
                          <t-button
                            v-if="!draft && can('create')"
                            :disabled="!categoryId || busy"
                            @click="createDraft()"
                            >创建新版本草稿</t-button
                          >
                          <t-button
                            v-if="draft && selectedId !== draft.id && can('create')"
                            theme="default"
                            @click="navigate(() => choose(draft!))"
                            >继续编辑草稿</t-button
                          >
                        </t-space>
                        <t-button
                          v-if="can('history')"
                          class="version-history"
                          theme="default"
                          variant="outline"
                          :disabled="!versions.length"
                          @click="historyVisible = true"
                        >
                          <template #icon><t-icon name="time" /></template>版本记录
                        </t-button>
                      </div>
                      <template v-if="selected">
                        <t-space direction="vertical" size="medium" class="version-content">
                          <div v-if="!isDraft" class="attribute-summary">
                            <div class="template-metadata">
                              <t-tag :theme="isCurrentDisplayedVersion ? 'primary' : 'default'" variant="light">
                                {{ isCurrentDisplayedVersion ? '当前版本' : '历史版本' }}
                                {{ versionLabel(displayedVersion) }}
                              </t-tag>
                              <span v-if="displayedVersion?.publishedByName"
                                >创建人 <span class="metadata-value">{{ displayedVersion.publishedByName }}</span></span
                              >
                              <span v-if="displayedVersion?.publishedAt"
                                >创建时间
                                <span class="metadata-value">{{
                                  formatDateTime(displayedVersion.publishedAt)
                                }}</span></span
                              >
                            </div>
                          </div>
                          <div>
                            <t-table
                              hover
                              class="attribute-table"
                              table-layout="fixed"
                              row-key="attributeId"
                              :data="attributePageRows"
                              :columns="attributeColumns"
                              :drag-sort="canSortAttributes ? 'row-handler' : undefined"
                              @drag-sort="sortAttributes"
                            >
                              <template #serialNumber="{ rowIndex }">{{
                                (attributePage - 1) * attributePageSize + rowIndex + 1
                              }}</template>
                              <template #drag><t-icon name="move" /></template>
                              <template #scope="{ row }">{{ row.scope === 'shared' ? '共享' : '专属' }}</template>
                              <template #valueType="{ row }">{{ typeLabel(row.valueType) }}</template>
                              <template #attributeRole="{ row }">
                                <t-select
                                  v-if="editable"
                                  v-model="row.attributeRole"
                                  placeholder="请选择"
                                  :status="
                                    validatedAttributeIds.includes(row.attributeId) && !row.attributeRole
                                      ? 'error'
                                      : undefined
                                  "
                                  :options="[
                                    { label: '商品属性', value: 'product' },
                                    { label: '销售属性', value: 'sales' },
                                  ]"
                                  @change="changeAttributeRole(row)"
                                />
                                <span v-else>{{
                                  row.attributeRole === 'sales'
                                    ? '销售属性'
                                    : row.attributeRole === 'product'
                                      ? '商品属性'
                                      : '未配置'
                                }}</span>
                              </template>
                              <template #skuFlag="{ row }">
                                <span v-if="row.attributeRole !== 'sales'">-</span>
                                <span
                                  v-else-if="editable"
                                  class="specification-control"
                                  @click.capture="notifySpecificationLimit(row)"
                                >
                                  <t-switch
                                    :value="row.skuFlag"
                                    :disabled="!row.skuFlag && specificationCount >= 4"
                                    role="switch"
                                    :aria-label="`${row.name}构建规格`"
                                    :aria-checked="!!row.skuFlag"
                                    tabindex="0"
                                    @change="toggleSpecification(row, Boolean($event))"
                                    @keydown.enter.prevent="toggleSpecification(row, !row.skuFlag)"
                                    @keydown.space.prevent="toggleSpecification(row, !row.skuFlag)"
                                  />
                                </span>
                                <span v-else>{{ row.skuFlag ? '是' : '否' }}</span>
                              </template>
                              <template #requiredFlag="{ row }"
                                ><t-switch v-if="editable" v-model="row.requiredFlag" class="required-switch" /><span
                                  v-else
                                  >{{ row.requiredFlag ? '是' : '否' }}</span
                                ></template
                              >
                              <template #options="{ row }"
                                ><t-link
                                  v-if="row.valueType === 'select'"
                                  :theme="
                                    validatedAttributeIds.includes(row.attributeId) && !row.options.length
                                      ? 'danger'
                                      : 'primary'
                                  "
                                  @click="openValues(row)"
                                  >{{ row.options.length }}</t-link
                                ><span v-else>—</span></template
                              >
                              <template #operation="{ row }"
                                ><t-link theme="danger" @click="removeTarget = row">移除</t-link></template
                              >
                            </t-table>
                            <AdminPagination
                              :current="attributePage"
                              :page-size="attributePageSize"
                              :total="rows.length"
                              @change="changeAttributePage"
                            />
                          </div>
                        </t-space>
                        <t-typography-paragraph v-if="!editable && selected.changeNote"
                          >变更说明：{{ selected.changeNote }}</t-typography-paragraph
                        >
                      </template>
                      <t-empty v-if="!selected" description="当前分类暂无版本，请创建草稿" />
                    </t-space>
                  </t-loading>
                </t-space>
              </t-card>
            </div>
          </template>
        </AdminListLayout>
      </main>
    </div>
    <AdminDialog v-model:visible="addVisible" header="添加属性" width="720px" @confirm="addAttributes">
      <t-input v-model="attributeKeyword" placeholder="搜索属性名称" clearable />
      <t-table
        hover
        table-layout="fixed"
        row-key="id"
        select-on-row-click
        :data="addPageRows"
        :columns="addColumns"
        :selected-row-keys="addIds"
        @select-change="selectAddAttributes"
      >
        <template #valueType="{ row }">{{ typeLabel(row.valueType) }}</template>
      </t-table>
      <AdminPagination
        :current="addPage"
        :page-size="addPageSize"
        :total="filteredAddAttributes.length"
        @change="changeAddPage"
      />
    </AdminDialog>
    <AdminDialog
      v-model:visible="valuesVisible"
      :header="`${editable ? '编辑' : '查看'}选项值 · ${valueTarget?.name || ''}`"
      width="720px"
      :footer="editable ? undefined : false"
      @confirm="applyValues"
    >
      <t-input v-if="editable" v-model="valueKeyword" placeholder="搜索选项值" clearable />
      <t-table
        hover
        table-layout="fixed"
        row-key="id"
        :data="editable ? valuePageRows : valueTarget?.options || []"
        :columns="valueColumns"
        :select-on-row-click="editable"
        :selected-row-keys="valueIds"
        @select-change="selectValues"
      />
      <AdminPagination
        v-if="editable"
        :current="valuePage"
        :page-size="valuePageSize"
        :total="filteredValues.length"
        @change="changeValuePage"
      />
    </AdminDialog>
    <AdminConfirmDialog
      :visible="!!removeTarget"
      action="移除"
      object-type="属性"
      :object-name="removeTarget?.name"
      @confirm="removeAttribute"
      @close="removeTarget = undefined"
      @cancel="removeTarget = undefined"
    />
    <AdminDialog
      v-model:visible="publishVisible"
      header="发布新版本"
      width="max-content"
      :confirm-btn="{ content: '确认发布', loading: busy }"
      @confirm="publish"
    >
      <div class="publish-confirm-content">
        版本发布后，不能修改。<br />
        本次版本发布不影响现存商品，后续新建商品使用最新版本属性模板。
      </div>
    </AdminDialog>
    <AdminDialog
      :visible="!!copyTarget"
      header="复制版本"
      :confirm-btn="{ content: '确认复制', loading: busy }"
      @confirm="copyVersion(copyTarget!)"
      @close="copyTarget = undefined"
      @cancel="copyTarget = undefined"
      >当前分类已有草稿，复制后将覆盖草稿中的全部配置，是否继续？</AdminDialog
    >
    <t-drawer v-model:visible="historyVisible" header="版本记录" size="760px" :footer="false">
      <t-table row-key="id" :data="versions.filter((v) => v.state === 'published')" :columns="historyColumns">
        <template #versionNo="{ row }">
          <t-space size="small" align="center">
            <span>{{ versionLabel(row) }}</span>
            <t-tag
              v-if="row.id === versions.find((version) => version.state === 'published')?.id"
              theme="primary"
              variant="light"
              >当前版本</t-tag
            >
          </t-space>
        </template>
        <template #publishedAt="{ row }">{{ formatDateTime(row.publishedAt) }}</template>
        <template #operation="{ row }">
          <t-space>
            <t-link theme="primary" @click="viewHistoryVersion(row)">查看</t-link>
            <t-link v-if="can('create')" theme="primary" :disabled="busy" @click="prepareCopy(row)">复制</t-link>
          </t-space>
        </template>
      </t-table>
    </t-drawer>
  </div>
</template>

<script setup lang="ts">
import { toRaw, computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import {
  adminFeedback,
  AdminConfirmDialog,
  AdminDialog,
  AdminListLayout,
  AdminPageHeader,
  AdminPagination,
} from '@/components/foundation';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import { sortByCreatedAtDesc } from '@/services/recordSorting';
import type { ProductAttributeRecord } from '@/services/productAttributes';
import type { ProductAttributeValueRecord } from '@/services/productAttributeValues';
import type { ProductCategoryRecord } from '@/services/productCategories';
import {
  listTemplateCategories,
  listTemplateAttributes,
  listTemplateValues,
  listTemplateVersions,
  createTemplateDraft,
  copyTemplateDraft,
  saveTemplateDraft,
  saveTemplateDisplayOrder,
  publishTemplateDraft,
  versionLabel,
  type TemplateScope,
  type TemplateVersion,
  type TemplateAttribute,
} from '@/services/templateVersions';
const prefix = 'admin.product-data-center.category-attribute-template';
const scope = ref<TemplateScope>('finished');
const allowed = (s: string, action: string) => hasPermission(getLoginUser(), `${prefix}.${s}.attributes.${action}`);
const scopeTabs = computed(() =>
  [
    { label: '成品现货模板', value: 'finished' },
    { label: '配件模板', value: 'accessory' },
  ].filter((t) => allowed(t.value, 'view')),
);
const can = (action: string) => allowed(scope.value, action);
const categories = ref<ProductCategoryRecord[]>([]);
const expandedCategories = ref<Array<string | number>>([]);
const versionLayout = ref<HTMLElement>();
const categoryViewportHeight = ref('100dvh');
const updateCategoryHeight = () => {
  if (!versionLayout.value) return;
  const layoutTop = versionLayout.value.getBoundingClientRect().top + window.scrollY;
  categoryViewportHeight.value = `${Math.max(0, window.innerHeight - layoutTop - 24)}px`;
};
const categoryLayoutObserver = new ResizeObserver(updateCategoryHeight);
watch(versionLayout, (element, previous) => {
  if (previous) categoryLayoutObserver.unobserve(previous);
  if (element) categoryLayoutObserver.observe(element);
});
const categoryId = ref<number>();
const keyword = ref('');
const versions = ref<TemplateVersion[]>([]);
const selectedId = ref<number>();
const rows = ref<TemplateAttribute[]>([]);
const attributePage = ref(1);
const attributePageSize = ref(10);
const attributePageRows = computed(() => {
  const start = (attributePage.value - 1) * attributePageSize.value;
  return rows.value.slice(start, start + attributePageSize.value);
});
function changeAttributePage(pageInfo: PageInfo) {
  attributePage.value = pageInfo.pageSize === attributePageSize.value ? pageInfo.current : 1;
  attributePageSize.value = pageInfo.pageSize;
}
watch(
  () => rows.value.length,
  (total) => {
    attributePage.value = Math.min(attributePage.value, Math.max(1, Math.ceil(total / attributePageSize.value)));
  },
);
const note = ref('');
const saved = ref('');
const loading = ref(false);
const busy = ref(false);
let savePromise: Promise<boolean> | undefined;
const validatedAttributeIds = ref<number[]>([]);
let loadSequence = 0;
const selected = computed(() => versions.value.find((v) => v.id === selectedId.value));
const draft = computed(() => versions.value.find((v) => v.state === 'draft'));
const isDraft = computed(() => selected.value?.state === 'draft');
const editable = computed(() => isDraft.value && can('create') && !busy.value);
const canSortAttributes = computed(() => !!selected.value && can('create') && !busy.value && !loading.value);
const specificationCount = computed(
  () => rows.value.filter((row) => row.attributeRole === 'sales' && row.skuFlag).length,
);
function changeAttributeRole(row: TemplateAttribute) {
  if (row.attributeRole !== 'sales') row.skuFlag = false;
}
function notifySpecificationLimit(row: TemplateAttribute) {
  if (!row.skuFlag && specificationCount.value >= 4) {
    adminFeedback.warning('最多选择4个属性构建规格');
  }
}
function toggleSpecification(row: TemplateAttribute, value: boolean) {
  if (!editable.value || row.attributeRole !== 'sales') return;
  if (value && !row.skuFlag && specificationCount.value >= 4) {
    notifySpecificationLimit(row);
    return;
  }
  row.skuFlag = value;
}
const content = () => rows.value;
const dirty = computed(() => isDraft.value && saved.value !== JSON.stringify([content(), note.value]));
const nextAttributeVersion = computed(
  () =>
    Math.max(
      0,
      ...versions.value.filter((version) => version.state === 'published').map((version) => version.versionNo || 0),
    ) + 1,
);
const displayedVersion = computed(() =>
  selected.value?.state === 'published'
    ? selected.value
    : versions.value.find((version) => version.state === 'published'),
);
const isCurrentDisplayedVersion = computed(
  () => displayedVersion.value?.id === versions.value.find((version) => version.state === 'published')?.id,
);
interface CategoryNode extends ProductCategoryRecord {
  children: CategoryNode[];
  disabled: boolean;
}
const categoryTree = computed(() => {
  const build = (parentId?: number): CategoryNode[] =>
    categories.value
      .filter((c) => (c.parentId || undefined) === parentId)
      .map((c) => {
        const children = build(c.id);
        return { ...c, children, disabled: false };
      });
  return build();
});
const filterCategory = (node: { data: { name?: string } }) =>
  !keyword.value || !!node.data.name?.includes(keyword.value);
const typeLabel = (type: string) => ({ select: '下拉选择', number: '数字输入', text: '文本输入' })[type] || type;
const attributeColumns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(canSortAttributes.value ? [{ colKey: 'drag', title: '', width: 24, className: 'attribute-drag-cell' }] : []),
  { colKey: 'serialNumber', title: '序号', width: 80 },
  { colKey: 'name', title: '属性名称' },
  { colKey: 'valueType', title: '输入类型', width: 100 },
  {
    colKey: 'attributeRole',
    title: () =>
      isDraft.value
        ? h('span', ['属性角色', h('span', { style: { color: 'var(--td-error-color)' } }, ' *')])
        : '属性角色',
    width: 150,
  },
  { colKey: 'skuFlag', title: '构建规格', width: 100 },
  { colKey: 'requiredFlag', title: '必填', width: 70 },
  {
    colKey: 'options',
    title: () =>
      isDraft.value ? h('span', ['选项值', h('span', { style: { color: 'var(--td-error-color)' } }, ' *')]) : '选项值',
    width: 110,
  },
  ...(editable.value ? [{ colKey: 'operation', title: '操作', width: 80, fixed: 'right' as const }] : []),
]);
const addColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'row-select', type: 'multiple' },
  { colKey: 'name', title: '属性名称' },
  { colKey: 'valueType', title: '输入类型' },
];
const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}+08:00`);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
};
const historyColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'versionNo', title: '版本', width: 160 },
  { colKey: 'publishedByName', title: '创建人' },
  { colKey: 'publishedAt', title: '创建时间' },
  { colKey: 'operation', title: '操作', width: 190 },
];
const pendingEdits = new Map<
  number,
  {
    revision: number;
    rows: TemplateAttribute[];
    note: string;
    saved: string;
    validatedAttributeIds: number[];
    page: number;
  }
>();
const viewSelections = new Map<string, number | undefined>();
const viewKey = () => `${scope.value}:${categoryId.value}`;
const scopeSelections = new Map<TemplateScope, { categoryId?: number }>();
function rememberEdits() {
  viewSelections.set(viewKey(), selectedId.value);
  scopeSelections.set(scope.value, { categoryId: categoryId.value });
  if (!selected.value || !isDraft.value) return;
  pendingEdits.set(selected.value.id, {
    revision: selected.value.revision,
    rows: JSON.parse(JSON.stringify(rows.value)),
    note: note.value,
    saved: saved.value,
    validatedAttributeIds: [...validatedAttributeIds.value],
    page: attributePage.value,
  });
}
function choose(v?: TemplateVersion) {
  attributePage.value = 1;
  selectedId.value = v?.id;
  rows.value = v
    ? JSON.parse(JSON.stringify(v.content)).map((row: TemplateAttribute) => ({
        ...row,
        skuFlag: row.attributeRole === 'sales' && !!row.skuFlag,
      }))
    : [];
  note.value = v?.changeNote || '';
  saved.value = JSON.stringify([content(), note.value]);
  validatedAttributeIds.value = [];
  const pending = v?.state === 'draft' ? pendingEdits.get(v.id) : undefined;
  if (pending && pending.revision === v?.revision) {
    rows.value = JSON.parse(JSON.stringify(pending.rows));
    note.value = pending.note;
    saved.value = pending.saved;
    validatedAttributeIds.value = [...pending.validatedAttributeIds];
    attributePage.value = pending.page;
  } else if (v) pendingEdits.delete(v.id);
}
function upsert(v: TemplateVersion) {
  pendingEdits.delete(v.id);
  versions.value = [v, ...versions.value.filter((x) => x.id !== v.id)];
  choose(v);
}
const error = (e: unknown, action = '操作', target?: string) => adminFeedback.actionError({ action, target, error: e });
async function loadVersions() {
  const sequence = ++loadSequence;
  loading.value = true;
  versions.value = [];
  choose();
  try {
    if (!categoryId.value || !can('view')) return;
    const list = await listTemplateVersions(categoryId.value);
    if (sequence !== loadSequence) return;
    versions.value = list;
    if (viewSelections.has(viewKey())) {
      const previousId = viewSelections.get(viewKey());
      choose(
        list.find((version) => version.id === previousId) || list.find((version) => version.state === 'published'),
      );
    } else choose(list.find((version) => version.state === 'published'));
  } catch (e) {
    if (sequence === loadSequence) error(e);
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}
async function loadScope() {
  ++loadSequence;
  categoryId.value = undefined;
  versions.value = [];
  choose();
  loading.value = true;
  try {
    categories.value = sortByCreatedAtDesc(await listTemplateCategories(scope.value));
    expandedCategories.value = categories.value.map((category) => category.id);
    const previousCategoryId = scopeSelections.get(scope.value)?.categoryId;
    categoryId.value = categories.value.some((c) => c.id === previousCategoryId)
      ? previousCategoryId
      : categories.value.find(
          (c) => c.status === 'enabled' && !categories.value.some((child) => child.parentId === c.id),
        )?.id;
    await loadVersions();
  } catch (e) {
    error(e);
    loading.value = false;
  }
}
let navigationSequence = 0;
async function navigate(action: () => void) {
  if (busy.value || loading.value) return;
  const sequence = ++navigationSequence;
  if (isDraft.value && (dirty.value || savePromise) && !(await save())) return;
  if (sequence !== navigationSequence) return;
  rememberEdits();
  action();
}
function exitEdit() {
  navigate(() => choose(versions.value.find((version) => version.state === 'published')));
}
function switchScope(value: unknown) {
  navigate(() => {
    scope.value = value as TemplateScope;
    void loadScope();
  });
}
function selectCategory(ids: (string | number)[]) {
  const id = Number(ids[0]);
  if (!id || categories.value.some((c) => c.parentId === id)) return;
  navigate(() => {
    categoryId.value = id;
    void loadVersions();
  });
}
const copyTarget = ref<TemplateVersion>();
let copyDraftSnapshot: { draftId: number; revision: number } | undefined;
function prepareCopy(version: TemplateVersion) {
  copyDraftSnapshot = draft.value ? { draftId: draft.value.id, revision: draft.value.revision } : undefined;
  if (draft.value) copyTarget.value = version;
  else void copyVersion(version);
}
async function copyVersion(version: TemplateVersion) {
  if (busy.value) return;
  busy.value = true;
  try {
    const copied = await copyTemplateDraft(version.id, copyDraftSnapshot);
    pendingEdits.delete(copied.id);
    upsert(copied);
    copyTarget.value = undefined;
    historyVisible.value = false;
    adminFeedback.actionSuccess({ action: '复制', target: versionLabel(version) });
  } catch (e) {
    error(e, '复制', versionLabel(version));
  } finally {
    busy.value = false;
  }
}
async function createDraft() {
  if (!categoryId.value) return;
  busy.value = true;
  try {
    upsert(
      await createTemplateDraft({
        categoryId: categoryId.value,
      }),
    );
    historyVisible.value = false;
  } catch (e) {
    error(e);
  } finally {
    busy.value = false;
  }
}
function save(): Promise<boolean> {
  if (savePromise) return savePromise;
  if (!selected.value || !isDraft.value || !can('create')) return Promise.resolve(!dirty.value);
  if (!dirty.value) return Promise.resolve(true);
  const draftId = selected.value.id;
  savePromise = (async () => {
    try {
      // Serialize saves so rapid edits always use the latest server revision.
      while (selected.value?.id === draftId && isDraft.value && dirty.value) {
        const snapshot = JSON.stringify([content(), note.value]);
        const [draftContent, draftNote] = JSON.parse(snapshot) as [TemplateVersion['content'], string];
        const updated = await saveTemplateDraft(draftId, selected.value.revision, draftContent, draftNote);
        versions.value = versions.value.map((version) => (version.id === draftId ? updated : version));
        saved.value = snapshot;
        pendingEdits.delete(draftId);
      }
      adminFeedback.actionSuccess({ action: '保存', target: '草稿' });
      return true;
    } catch (e) {
      error(e, '保存', '草稿');
      return false;
    } finally {
      savePromise = undefined;
    }
  })();
  return savePromise;
}
watch(
  () => JSON.stringify([selectedId.value, content(), note.value]),
  () => {
    if (isDraft.value && can('create') && !loading.value && dirty.value) void save();
  },
  { flush: 'post' },
);
const publishVisible = ref(false);
async function preparePublish() {
  if (!(await save())) return;
  validatedAttributeIds.value = rows.value.map((row) => row.attributeId);
  if (
    !rows.value.length ||
    rows.value.some((r) => !r.attributeRole || (r.valueType === 'select' && !r.options.length))
  ) {
    const invalidIndex = rows.value.findIndex(
      (row) => !row.attributeRole || (row.valueType === 'select' && !row.options.length),
    );
    if (invalidIndex >= 0) attributePage.value = Math.floor(invalidIndex / attributePageSize.value) + 1;
    adminFeedback.warning('请完善属性角色和选项值后发布');
    return;
  }
  publishVisible.value = true;
}
async function publish() {
  if (!(await save())) return;
  if (!selected.value) return;
  busy.value = true;
  try {
    upsert(await publishTemplateDraft(selected.value.id, selected.value.revision));
    publishVisible.value = false;
    adminFeedback.actionSuccess({ action: '发布', target: '新版本' });
  } catch (e) {
    error(e, '发布', '新版本');
  } finally {
    busy.value = false;
  }
}
const addVisible = ref(false),
  attributeKeyword = ref(''),
  addIds = ref<number[]>([]),
  availableAttributes = ref<ProductAttributeRecord[]>([]);
const addPage = ref(1);
const addPageSize = ref(10);
const filteredAddAttributes = computed(() =>
  availableAttributes.value.filter((attribute) => attribute.name.includes(attributeKeyword.value)),
);
const addPageRows = computed(() =>
  filteredAddAttributes.value.slice((addPage.value - 1) * addPageSize.value, addPage.value * addPageSize.value),
);
watch(attributeKeyword, () => {
  addPage.value = 1;
});
function changeAddPage(page: PageInfo) {
  addPage.value = page.pageSize === addPageSize.value ? page.current : 1;
  addPageSize.value = page.pageSize;
}
function selectAddAttributes(keys: Array<string | number>) {
  const pageIds = new Set(addPageRows.value.map((attribute) => attribute.id));
  addIds.value = [...new Set([...addIds.value.filter((id) => !pageIds.has(id)), ...keys.map(Number)])];
}
async function openAdd() {
  if (!categoryId.value) return;
  try {
    availableAttributes.value = (await listTemplateAttributes(categoryId.value)).filter(
      (a) => !rows.value.some((r) => r.attributeId === a.id),
    );
    addIds.value = [];
    addPage.value = 1;
    attributeKeyword.value = '';
    addVisible.value = true;
  } catch (e) {
    error(e);
  }
}
function addAttributes() {
  for (const attribute of availableAttributes.value.filter((a) => addIds.value.includes(a.id)))
    rows.value.push({
      attributeId: attribute.id,
      name: attribute.name,
      scope: attribute.scope,
      valueType: attribute.valueType,
      attributeRole: '',
      requiredFlag: false,
      skuFlag: false,
      sortOrder: rows.value.length + 1,
      options: [],
    });
  addVisible.value = false;
}
const valueTarget = ref<TemplateAttribute>(),
  valuesVisible = ref(false),
  valueKeyword = ref(''),
  valueIds = ref<number[]>([]),
  valueOptions = ref<ProductAttributeValueRecord[]>([]);
const valuePage = ref(1);
const valuePageSize = ref(10);
const filteredValues = computed(() =>
  (editable.value ? valueOptions.value : valueTarget.value?.options || []).filter((option) =>
    option.value.includes(valueKeyword.value),
  ),
);
const valuePageRows = computed(() =>
  filteredValues.value.slice((valuePage.value - 1) * valuePageSize.value, valuePage.value * valuePageSize.value),
);
const valueColumns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(editable.value ? [{ colKey: 'row-select', type: 'multiple' as const }] : []),
  { colKey: 'value', title: '选项值' },
]);
watch(valueKeyword, () => {
  valuePage.value = 1;
});
function changeValuePage(page: PageInfo) {
  valuePage.value = page.pageSize === valuePageSize.value ? page.current : 1;
  valuePageSize.value = page.pageSize;
}
function selectValues(keys: Array<string | number>) {
  if (!editable.value) return;
  const pageIds = new Set(valuePageRows.value.map((option) => option.id));
  valueIds.value = [...new Set([...valueIds.value.filter((id) => !pageIds.has(id)), ...keys.map(Number)])];
}
async function openValues(row: TemplateAttribute) {
  valueTarget.value = row;
  valueKeyword.value = '';
  valuePage.value = 1;
  valueIds.value = row.options.map((v) => v.id);
  try {
    valueOptions.value =
      editable.value && categoryId.value ? await listTemplateValues(categoryId.value, row.attributeId) : [];
    valuesVisible.value = true;
  } catch (e) {
    error(e);
  }
}
function applyValues() {
  if (editable.value && valueTarget.value)
    valueTarget.value.options = valueOptions.value
      .filter((v) => valueIds.value.includes(v.id))
      .map((v) => ({ id: v.id, value: v.value, code: v.code }));
  valuesVisible.value = false;
}
const removeTarget = ref<TemplateAttribute>();
function removeAttribute() {
  validatedAttributeIds.value = validatedAttributeIds.value.filter((id) => id !== removeTarget.value?.attributeId);
  rows.value = rows.value.filter((r) => r.attributeId !== removeTarget.value?.attributeId);
  rows.value.forEach((r, i) => (r.sortOrder = i + 1));
  removeTarget.value = undefined;
}
async function sortAttributes(context: { currentIndex: number; targetIndex: number }) {
  if (!canSortAttributes.value || context.currentIndex === context.targetIndex) return;
  const version = selected.value!;
  const previousRows = structuredClone(toRaw(rows.value));
  const offset = (attributePage.value - 1) * attributePageSize.value;
  const [row] = rows.value.splice(offset + context.currentIndex, 1);
  if (row) rows.value.splice(offset + context.targetIndex, 0, row);
  rows.value.forEach((r, i) => (r.sortOrder = i + 1));
  if (isDraft.value) return;
  busy.value = true;
  try {
    const updated = await saveTemplateDisplayOrder(
      version.id,
      version.revision,
      rows.value.map((r) => r.attributeId),
    );
    versions.value = versions.value.map((v) => (v.id === updated.id ? updated : v));
    rows.value = structuredClone(updated.content as TemplateAttribute[]);
    adminFeedback.actionSuccess({ action: '调整', target: '字段显示顺序' });
  } catch (e) {
    rows.value = previousRows;
    error(e, '调整', '字段显示顺序');
  } finally {
    busy.value = false;
  }
}
const historyVisible = ref(false);
function viewHistoryVersion(version: TemplateVersion) {
  void navigate(() => {
    choose(version);
    historyVisible.value = false;
  });
}
onMounted(() => {
  window.addEventListener('resize', updateCategoryHeight);
  if (scopeTabs.value.length) {
    scope.value = scopeTabs.value[0]!.value as TemplateScope;
    void loadScope();
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateCategoryHeight);
  categoryLayoutObserver.disconnect();
});
</script>
<style scoped>
.publish-confirm-content {
  color: var(--td-text-color-primary);
  font-size: 14px;
  line-height: 22px;
  overflow-wrap: anywhere;
}
.list-controls {
  display: grid;
  width: 100%;
  gap: var(--td-comp-margin-l);
}
.scope-controls {
  min-width: 0;
}
:deep(.zdm-admin-list-layout__toolbar) {
  display: block;
  min-height: 0;
}
:deep(.zdm-admin-list-layout__content) {
  overflow-anchor: none;
}
.version-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  align-items: stretch;
  gap: var(--td-comp-margin-l);
}
.category-panel {
  min-height: var(--category-viewport-height);
  contain: size;
  overflow-y: auto;
}
.category-panel,
.version-panel {
  min-width: 0;
}
.category-content,
.version-content {
  width: 100%;
}
.category-content :deep(.t-space-item) {
  width: 100%;
}
.category-content :deep(.t-tree__item.t-is-active) {
  background-color: var(--td-brand-color-light);
  border-radius: var(--td-radius-default);
}
.attribute-table :deep(.attribute-drag-cell:first-child) {
  padding-left: 0;
  padding-right: 0;
}
.attribute-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-l);
}
.metadata-value {
  color: var(--td-text-color-primary);
}
.draft-version-info {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
}
.template-metadata {
  margin-left: auto;
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-comp-margin-l);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
}
.version-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}
.version-history {
  margin-left: auto;
}
.draft-footer {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-l);
}
.draft-status {
  margin-right: auto;
}
.add-attribute {
  order: 1;
}
.template-tab-bar {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-l);
}
.exit-edit {
  flex-shrink: 0;
}
.publish-draft {
  order: 2;
}
@media (max-width: 1180px) {
  .version-layout {
    grid-template-columns: 200px minmax(0, 1fr);
  }
}
</style>
