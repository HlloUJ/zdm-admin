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
              <t-breadcrumb-item>成品现货工艺管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">全平台唯一数据源</t-tag>
        </header>

        <section class="filter-card">
          <t-form :data="searchForm" label-width="72px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="工艺名称">
                  <t-input v-model="searchForm.name" clearable placeholder="请输入" />
                </t-form-item>
                <t-form-item label="工艺类型">
                  <t-select v-model="searchForm.type" clearable placeholder="请选择">
                    <t-option
                      v-for="item in craftTypeOptions"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </t-select>
                </t-form-item>
                <t-form-item label="工艺宽度">
                  <div class="width-range">
                    <t-input
                      :model-value="searchForm.widthStart"
                      clearable
                      inputmode="numeric"
                      placeholder="长"
                      @update:model-value="handleWidthSearchInput('widthStart', $event)"
                    />
                    <span>-</span>
                    <t-input
                      :model-value="searchForm.widthEnd"
                      clearable
                      inputmode="numeric"
                      placeholder="宽"
                      @update:model-value="handleWidthSearchInput('widthEnd', $event)"
                    />
                  </div>
                </t-form-item>
                <t-form-item label="状态">
                  <t-select v-model="searchForm.status" clearable placeholder="请选择">
                    <t-option label="正常" value="normal" />
                    <t-option label="停用" value="disabled" />
                  </t-select>
                </t-form-item>
              </div>

              <div class="filter-actions">
                <t-button theme="primary" @click="handleSearch">
                  <template #icon><t-icon name="search" /></template>
                  查询
                </t-button>
                <t-button theme="default" variant="base" @click="handleReset">
                  <template #icon><t-icon name="refresh" /></template>
                  重置
                </t-button>
              </div>
            </div>
          </t-form>
        </section>

        <section class="table-card">
          <div class="table-toolbar">
            <t-button v-if="canCreateCraft" theme="primary" @click="openCreateDialog">
              <template #icon><t-icon name="add" /></template>
              新增
            </t-button>
          </div>

          <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
            <template #index="{ rowIndex }">
              {{ (pagination.current - 1) * pagination.pageSize + rowIndex + 1 }}
            </template>
            <template #image="{ row }">
              <button class="craft-image" type="button" aria-label="预览工艺图片" @click="openImagePreview(row)">
                <img v-if="row.image?.[0]?.url" class="craft-image__thumb" :src="row.image[0].url" alt="工艺图片" />
                <span v-else class="craft-image__empty">暂无图片</span>
              </button>
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'normal' ? 'success' : 'danger'" variant="light">
                {{ row.status === 'normal' ? '正常' : '停用' }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link v-if="canEditCraft" theme="primary" hover="color" @click="openEditDialog(row)">编辑</t-link>
                <t-link
                  v-if="canToggleCraftStatus"
                  :theme="row.status === 'normal' ? 'warning' : 'success'"
                  hover="color"
                  @click="openStatusConfirm(row)"
                >
                  {{ row.status === 'normal' ? '停用' : '启用' }}
                </t-link>
                <t-link v-if="canDeleteCraft" theme="danger" hover="color" @click="openDeleteConfirm(row)">删除</t-link>
                <span v-if="!canEditCraft && !canToggleCraftStatus && !canDeleteCraft">-</span>
              </div>
            </template>
          </t-table>

          <div class="custom-pagination">
            <div class="pagination-total">共 {{ paginationTotal }} 条数据</div>
            <div class="pagination-controls">
              <t-select
                :model-value="pagination.pageSize"
                class="page-size-select"
                size="small"
                @change="handlePageSizeChange"
              >
                <t-option v-for="item in pageSizeOptions" :key="item" :label="`${item}条/页`" :value="item" />
              </t-select>
              <t-button size="small" variant="outline" :disabled="pagination.current === 1" @click="goPrevPage">
                上一页
              </t-button>
              <t-button
                v-for="page in pageNumbers"
                :key="page"
                size="small"
                :theme="page === pagination.current ? 'primary' : 'default'"
                :variant="page === pagination.current ? 'base' : 'outline'"
                class="page-number"
                @click="goPage(page)"
              >
                {{ page }}
              </t-button>
              <t-button size="small" variant="outline" :disabled="pagination.current === pageCount" @click="goNextPage">
                下一页
              </t-button>
            </div>
          </div>
        </section>
      </main>
    </div>

    <t-dialog
      v-model:visible="formDialogVisible"
      :header="dialogMode === 'create' ? '新增' : '编辑'"
      width="640px"
      placement="center"
      :close-on-overlay-click="true"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleSubmit"
      @cancel="closeFormDialog"
      @close="closeFormDialog"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="96px" colon>
        <t-form-item label="工艺图片" name="image">
          <t-upload
            v-model="formData.image"
            theme="image"
            accept="image/*"
            :auto-upload="false"
            :multiple="false"
            :max="1"
            :size-limit="{ size: 5, unit: 'MB' }"
            tips="点击上传图片"
          />
        </t-form-item>
        <t-form-item label="工艺名称" name="name">
          <t-input v-model="formData.name" clearable placeholder="请输入" />
        </t-form-item>
        <t-form-item label="工艺类型" name="type">
          <t-select v-model="formData.type" placeholder="请选择">
            <t-option v-for="item in craftTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </t-select>
        </t-form-item>
        <t-form-item label="工艺宽度" name="width">
          <t-input
            :model-value="formData.width"
            clearable
            inputmode="numeric"
            placeholder="请输入"
            suffix="mm"
            @update:model-value="handleFormWidthInput"
          />
        </t-form-item>
        <t-form-item label="备注" name="remark">
          <t-textarea
            v-model="formData.remark"
            placeholder="请输入"
            :maxlength="100"
            :autosize="{ minRows: 4, maxRows: 6 }"
          />
        </t-form-item>
      </t-form>
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

    <t-dialog
      v-model:visible="imagePreviewVisible"
      :header="previewCraftName"
      width="560px"
      placement="center"
      :footer="false"
    >
      <div class="image-preview">
        <img v-if="previewImageUrl" class="image-preview__img" :src="previewImageUrl" alt="工艺大图" />
        <div v-else class="image-preview__empty">暂无图片</div>
        <span>统一3D工艺图</span>
      </div>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData, UploadFile } from 'tdesign-vue-next';
import { MessagePlugin } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  createCraft,
  deleteCraft,
  listCrafts,
  updateCraft,
  updateCraftStatus,
  uploadCraftImage,
  type CraftPayload,
  type CraftRecord,
} from '@/services/crafts';
import { computed, onMounted, reactive, ref } from 'vue';
type CraftStatus = 'normal' | 'disabled';
type ConfirmType = 'enable' | 'disable' | 'delete';

interface CraftItem {
  id: number;
  image: UploadFile[];
  name: string;
  type: string;
  width: string;
  status: CraftStatus;
  createdByName: string;
  createdAt: string;
  remark?: string;
}

interface CraftForm {
  image: UploadFile[];
  name: string;
  type: string;
  width: string;
  remark: string;
}

const craftTypeOptions = [
  { label: '边工艺', value: '边工艺' },
  { label: '面工艺', value: '面工艺' },
  { label: '拼接工艺', value: '拼接工艺' },
];
const pageSizeOptions = [10, 20, 50];
const craftPermissionPrefix = 'admin.product-data-center.finished-stock-craft';

const tableData = ref<CraftItem[]>([]);
const loading = ref(false);
const loginUser = computed(() => getLoginUser());
const canCreateCraft = computed(() => hasPermission(loginUser.value, `${craftPermissionPrefix}.create`));
const canEditCraft = computed(() => hasPermission(loginUser.value, `${craftPermissionPrefix}.edit`));
const canToggleCraftStatus = computed(() => hasPermission(loginUser.value, `${craftPermissionPrefix}.toggle-status`));
const canDeleteCraft = computed(() => hasPermission(loginUser.value, `${craftPermissionPrefix}.delete`));

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 72, align: 'left' },
  { colKey: 'image', title: '工艺图片', width: 112, align: 'center' },
  { colKey: 'name', title: '工艺名称', minWidth: 160 },
  { colKey: 'type', title: '工艺类型', width: 120 },
  { colKey: 'width', title: '工艺宽度（mm）', width: 150, ellipsisTitle: true },
  { colKey: 'status', title: '状态', width: 100, align: 'center' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 180, align: 'left', fixed: 'right' },
];

const searchForm = reactive({
  name: '',
  type: '',
  widthStart: '',
  widthEnd: '',
  status: '',
});
const appliedSearchForm = reactive({ ...searchForm });

const pagination = reactive({
  current: 1,
  pageSize: 10,
});

const formRef = ref<FormInstanceFunctions>();
const formDialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const formData = reactive<CraftForm>({
  image: [],
  name: '',
  type: '',
  width: '',
  remark: '',
});

const formRules: Record<string, FormRule[]> = {
  image: [{ required: true, message: '请上传工艺图片', type: 'error' }],
  name: [{ required: true, message: '请输入工艺名称', type: 'error' }],
  type: [{ required: true, message: '请选择工艺类型', type: 'error' }],
};

const confirmDialogVisible = ref(false);
const imagePreviewVisible = ref(false);
const previewCraftName = ref('工艺图片');
const previewImageUrl = ref('');
const confirmState = reactive<{
  content: string;
  type: ConfirmType;
  row: CraftItem | null;
}>({
  content: '',
  type: 'disable',
  row: null,
});

const filteredData = computed(() => {
  const name = appliedSearchForm.name.trim();
  const widthStart = Number(appliedSearchForm.widthStart);
  const widthEnd = Number(appliedSearchForm.widthEnd);
  const hasWidthStart = appliedSearchForm.widthStart.trim() !== '' && !Number.isNaN(widthStart);
  const hasWidthEnd = appliedSearchForm.widthEnd.trim() !== '' && !Number.isNaN(widthEnd);

  return tableData.value.filter((item) => {
    const itemWidth = Number(item.width);
    const nameMatched = !name || item.name.includes(name);
    const typeMatched = !appliedSearchForm.type || item.type === appliedSearchForm.type;
    const widthStartMatched = !hasWidthStart || itemWidth >= widthStart;
    const widthEndMatched = !hasWidthEnd || itemWidth <= widthEnd;
    const statusMatched = !appliedSearchForm.status || item.status === appliedSearchForm.status;
    return nameMatched && typeMatched && widthStartMatched && widthEndMatched && statusMatched;
  });
});

const pageData = computed(() => {
  const start = (pagination.current - 1) * pagination.pageSize;
  return filteredData.value.slice(start, start + pagination.pageSize);
});

const paginationTotal = computed(() => filteredData.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / pagination.pageSize), 1));
const pageNumbers = computed(() => Array.from({ length: pageCount.value }, (_, index) => index + 1));

const normalizeStatus = (status?: CraftRecord['status']): CraftStatus =>
  status === 'disabled' ? 'disabled' : 'normal';

const toBackendStatus = (status: CraftStatus): CraftPayload['status'] =>
  status === 'disabled' ? 'disabled' : 'enabled';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/-/g, '/').replace('T', ' ').slice(0, 16);

  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toUploadFiles = (record: CraftRecord): UploadFile[] => {
  return record.imageUrl ? [{ name: `${record.name || 'craft'}.png`, status: 'success', url: record.imageUrl }] : [];
};

const toCraftItem = (record: CraftRecord): CraftItem => ({
  id: record.id,
  image: toUploadFiles(record),
  name: record.name,
  type: record.type,
  width: record.width ?? '',
  status: normalizeStatus(record.status),
  createdByName: record.createdByName || '-',
  createdAt: formatDateTime(record.createdAt),
  remark: record.remark ?? '',
});

const toCraftPayload = (status: CraftStatus, imageUrl?: string): CraftPayload => ({
  name: formData.name.trim(),
  type: formData.type,
  width: formData.width,
  imageUrl,
  description: formData.remark.trim(),
  pricingMethod: formData.width ? 'width' : undefined,
  remark: formData.remark.trim(),
  status: toBackendStatus(status),
});

const loadCrafts = async () => {
  loading.value = true;
  try {
    const records = await listCrafts();
    tableData.value = records.map(toCraftItem);
    ensureCurrentPage();
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '工艺列表加载失败');
  } finally {
    loading.value = false;
  }
};

const resetFormData = () => {
  formData.image = [];
  formData.name = '';
  formData.type = '';
  formData.width = '';
  formData.remark = '';
};

const fillFormData = (row: CraftItem) => {
  formData.image = [...row.image];
  formData.name = row.name;
  formData.type = row.type;
  formData.width = row.width.replace(/\D/g, '');
  formData.remark = row.remark ?? '';
};

const handleSearch = () => {
  Object.assign(appliedSearchForm, searchForm);
  pagination.current = 1;
};

const handleWidthSearchInput = (field: 'widthStart' | 'widthEnd', value: string) => {
  searchForm[field] = value.replace(/\D/g, '');
};

const handleFormWidthInput = (value: string) => {
  formData.width = value.replace(/\D/g, '');
};

const handleReset = () => {
  searchForm.name = '';
  searchForm.type = '';
  searchForm.widthStart = '';
  searchForm.widthEnd = '';
  searchForm.status = '';
  handleSearch();
};

const handlePageSizeChange = (value: unknown) => {
  pagination.pageSize = Number(value);
  pagination.current = 1;
};

const goPage = (page: number) => {
  pagination.current = page;
};

const goPrevPage = () => {
  if (pagination.current > 1) {
    pagination.current -= 1;
  }
};

const goNextPage = () => {
  if (pagination.current < pageCount.value) {
    pagination.current += 1;
  }
};

const openCreateDialog = () => {
  dialogMode.value = 'create';
  editingId.value = null;
  resetFormData();
  formDialogVisible.value = true;
};

const openEditDialog = (row: CraftItem) => {
  dialogMode.value = 'edit';
  editingId.value = row.id;
  fillFormData(row);
  formDialogVisible.value = true;
};

const closeFormDialog = () => {
  formDialogVisible.value = false;
  formRef.value?.clearValidate();
};

const resolveFormImageUrl = async () => {
  const image = formData.image[0];
  if (!image) return undefined;
  if (!image.raw) return image.url;

  const uploaded = await uploadCraftImage(image.raw);
  image.url = uploaded.url;
  image.status = 'success';
  return uploaded.url;
};

const handleSubmit = async () => {
  const result = await formRef.value?.validate();
  if (result !== true) return;

  const normalizedName = formData.name.trim();
  const duplicateName = tableData.value.some(
    (item) => item.id !== editingId.value && item.name.trim() === normalizedName,
  );
  if (duplicateName) {
    MessagePlugin.warning('工艺名称已存在');
    return;
  }

  try {
    const imageUrl = await resolveFormImageUrl();
    if (dialogMode.value === 'create') {
      await createCraft(toCraftPayload('normal', imageUrl));
      await loadCrafts();
      pagination.current = 1;
    } else if (editingId.value) {
      const current = tableData.value.find((item) => item.id === editingId.value);
      await updateCraft(editingId.value, toCraftPayload(current?.status ?? 'normal', imageUrl));
      await loadCrafts();
    }

    closeFormDialog();
    MessagePlugin.success('操作成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
  }
};

const openStatusConfirm = (row: CraftItem) => {
  const isNormal = row.status === 'normal';
  confirmState.type = isNormal ? 'disable' : 'enable';
  confirmState.row = row;
  confirmState.content = isNormal ? `是否停用工艺【${row.name}】？` : `是否启用工艺【${row.name}】？`;
  confirmDialogVisible.value = true;
};

const openDeleteConfirm = (row: CraftItem) => {
  confirmState.type = 'delete';
  confirmState.row = row;
  confirmState.content = `是否删除工艺【${row.name}】？`;
  confirmDialogVisible.value = true;
};

const openImagePreview = (row: CraftItem) => {
  previewCraftName.value = row.name;
  previewImageUrl.value = row.image[0]?.url ?? '';
  imagePreviewVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};

const ensureCurrentPage = () => {
  const maxPage = Math.max(Math.ceil(filteredData.value.length / pagination.pageSize), 1);
  if (pagination.current > maxPage) {
    pagination.current = maxPage;
  }
};

const handleConfirm = async () => {
  if (!confirmState.row) return;

  try {
    if (confirmState.type === 'delete') {
      await deleteCraft(confirmState.row.id);
      tableData.value = tableData.value.filter((item) => item.id !== confirmState.row?.id);
      ensureCurrentPage();
    } else {
      const updated = await updateCraftStatus(
        confirmState.row.id,
        toBackendStatus(confirmState.type === 'enable' ? 'normal' : 'disabled'),
      );
      const targetIndex = tableData.value.findIndex((item) => item.id === confirmState.row?.id);
      if (targetIndex !== -1) {
        tableData.value.splice(targetIndex, 1, toCraftItem(updated));
      }
    }

    closeConfirmDialog();
    MessagePlugin.success('操作成功');
  } catch (error) {
    MessagePlugin.error(error instanceof Error ? error.message : '操作失败');
  }
};

onMounted(loadCrafts);
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

.filter-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
}

.filter-fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--td-comp-margin-l);
}

.filter-fields :deep(.t-form__item) {
  width: 220px;
  margin-bottom: 0;
}

.width-range {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--td-comp-margin-xs);
}

.width-range span {
  color: var(--td-text-color-placeholder);
}

.filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
}

.table-toolbar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.table-toolbar h2 {
  margin: 0;
  color: var(--td-text-color-primary);
  font: var(--td-font-title-medium);
  letter-spacing: 0;
}

.table-toolbar p {
  margin: var(--td-comp-margin-xxs) 0 0;
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}

.custom-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-l);
  margin-top: var(--td-comp-margin-l);
}

.pagination-total {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-xs);
}

.page-size-select {
  width: 108px;
  margin-right: var(--td-comp-margin-xs);
}

.page-number {
  min-width: 32px;
}

.craft-image {
  width: 56px;
  height: 56px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  cursor: pointer;
  border-radius: 6px;
  color: var(--td-text-color-placeholder);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid #c7d1df;
}

.craft-image:hover {
  border-color: var(--td-brand-color);
}

.craft-image__thumb {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.craft-image__empty {
  font-size: 12px;
}

.image-preview {
  height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--td-comp-margin-s);
  border-radius: 6px;
  color: var(--td-text-color-placeholder);
  background: var(--td-bg-color-secondarycontainer);
  border: 1px dashed var(--td-component-border);
}

.image-preview__img {
  max-width: 100%;
  max-height: 300px;
  display: block;
  border-radius: 8px;
  object-fit: contain;
  border: 1px solid #c7d1df;
}

.image-preview__empty {
  color: var(--td-text-color-placeholder);
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: var(--td-comp-margin-m);
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

  .filter-fields,
  .filter-fields :deep(.t-form__item),
  .filter-actions {
    width: 100%;
  }

  .custom-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .pagination-controls {
    flex-wrap: wrap;
  }

  .filter-actions {
    justify-content: flex-start;
  }
}
</style>
