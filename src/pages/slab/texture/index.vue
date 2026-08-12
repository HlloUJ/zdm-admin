<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page">
        <header class="page-header">
          <t-breadcrumb>
            <t-breadcrumb-item>商品基础数据中心</t-breadcrumb-item>
            <t-breadcrumb-item>大板基础数据管理</t-breadcrumb-item>
            <t-breadcrumb-item>纹理管理</t-breadcrumb-item>
          </t-breadcrumb>
          <t-tag theme="primary" variant="light">全平台唯一数据源</t-tag>
        </header>

        <section class="filter-card">
          <t-form :data="searchForm" label-width="56px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <t-form-item label="纹理" name="name">
                  <t-input v-model="searchForm.name" clearable placeholder="请输入" />
                </t-form-item>
                <t-form-item label="别名" name="alias">
                  <t-input v-model="searchForm.alias" clearable placeholder="请输入" />
                </t-form-item>
                <t-form-item label="状态" name="status">
                  <t-select v-model="searchForm.status" clearable placeholder="请选择">
                    <t-option label="启用" value="normal" />
                    <t-option label="停用" value="disabled" />
                  </t-select>
                </t-form-item>
              </div>
              <div class="filter-actions">
                <t-button theme="primary" @click="handleSearch"
                  ><template #icon><t-icon name="search" /></template>查询</t-button
                >
                <t-button theme="default" variant="base" @click="handleReset"
                  ><template #icon><t-icon name="refresh" /></template>重置</t-button
                >
              </div>
            </div>
          </t-form>
        </section>

        <section class="table-card">
          <div class="table-toolbar">
            <t-button v-if="canCreate" theme="primary" @click="openCreate"
              ><template #icon><t-icon name="add" /></template>新增</t-button
            >
          </div>
          <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
            <template #index="{ rowIndex }">{{
              (pagination.current - 1) * pagination.pageSize + rowIndex + 1
            }}</template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'normal' ? 'success' : 'danger'" variant="light">{{
                row.status === 'normal' ? '启用' : '停用'
              }}</t-tag>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link v-if="canManageAliases" theme="primary" hover="color" @click="openAliases(row)">别名</t-link>
                <t-link v-if="canEdit" theme="primary" hover="color" @click="openEdit(row)">编辑</t-link>
                <t-link
                  v-if="canToggle"
                  :theme="row.status === 'normal' ? 'warning' : 'success'"
                  hover="color"
                  @click="openConfirm(row, row.status === 'normal' ? 'disable' : 'enable')"
                  >{{ row.status === 'normal' ? '停用' : '启用' }}</t-link
                >
                <t-link v-if="canDelete" theme="danger" hover="color" @click="openConfirm(row, 'delete')">删除</t-link>
              </div>
            </template>
          </t-table>
          <AdminPagination
            v-model:current="pagination.current"
            v-model:page-size="pagination.pageSize"
            :total="filteredData.length"
            :page-size-options="[10, 20, 50]"
          />
        </section>
      </main>
    </div>

    <AdminDialog
      v-model:visible="formVisible"
      :header="editingId ? '编辑纹理' : '新增纹理'"
      @confirm="submitTexture"
      @cancel="formVisible = false"
      @close="formVisible = false"
    >
      <t-form ref="formRef" :data="formData" :rules="formRules" label-width="72px" colon>
        <t-form-item label="标准纹理" name="name"
          ><t-input v-model="formData.name" clearable placeholder="请输入标准纹理"
        /></t-form-item>
        <t-form-item label="备注" name="remark"
          ><t-textarea
            v-model="formData.remark"
            placeholder="请输入备注"
            :maxlength="100"
            :autosize="{ minRows: 4, maxRows: 6 }"
        /></t-form-item>
      </t-form>
    </AdminDialog>

    <AdminDialog
      v-model:visible="aliasesVisible"
      :header="`别名管理 - ${activeTexture?.name ?? ''}`"
      width="680px"
      confirm-btn="关闭"
      :cancel-btn="null"
      @confirm="aliasesVisible = false"
      @close="aliasesVisible = false"
    >
      <div class="table-toolbar">
        <t-button theme="primary" @click="openAliasForm()"
          ><template #icon><t-icon name="add" /></template>新增别名</t-button
        >
      </div>
      <t-table row-key="id" :data="aliases" :columns="aliasColumns" table-layout="fixed">
        <template #operation="{ row }">
          <div class="table-actions">
            <t-link theme="primary" hover="color" @click="openAliasForm(row)">编辑</t-link>
            <t-link theme="danger" hover="color" @click="removeAlias(row)">删除</t-link>
          </div>
        </template>
      </t-table>
    </AdminDialog>

    <AdminDialog
      v-model:visible="aliasFormVisible"
      :header="editingAliasId ? '编辑别名' : '新增别名'"
      @confirm="submitAlias"
      @cancel="aliasFormVisible = false"
      @close="aliasFormVisible = false"
    >
      <t-form ref="aliasFormRef" :data="aliasForm" :rules="aliasRules" label-width="72px" colon>
        <t-form-item label="别名" name="name"
          ><t-input v-model="aliasForm.name" clearable placeholder="请输入纹理别名"
        /></t-form-item>
      </t-form>
    </AdminDialog>

    <AdminConfirmDialog
      v-model:visible="confirmVisible"
      :action="confirmType === 'delete' ? '删除' : confirmType === 'disable' ? '停用' : '启用'"
      object-type="纹理"
      :object-name="confirmRow?.name"
      @confirm="submitConfirm"
      @cancel="confirmVisible = false"
      @close="confirmVisible = false"
    >
      {{ confirmType === 'delete' ? '删除标准纹理后，其全部别名也会被删除。' : '' }}
    </AdminConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminDialog, AdminPagination } from '@/components/foundation';
import { getLoginUser } from '@/services/auth';
import { hasPermission } from '@/services/adminPermissions';
import { sortByCreatedAtDesc } from '@/services/recordSorting';
import {
  createSlabTexture,
  createSlabTextureAlias,
  deleteSlabTexture,
  deleteSlabTextureAlias,
  listSlabTextureAliases,
  listSlabTextures,
  updateSlabTexture,
  updateSlabTextureAlias,
  updateSlabTextureStatus,
  type SlabTextureAliasRecord,
  type SlabTextureRecord,
} from '@/services/slabTextures';

type TextureItem = Omit<SlabTextureRecord, 'status'> & { status: 'normal' | 'disabled'; aliasCount: number };
type ConfirmType = 'enable' | 'disable' | 'delete';
const prefix = 'admin.product-data-center.slab-texture';
const user = computed(() => getLoginUser());
const canCreate = computed(() => hasPermission(user.value, `${prefix}.create`));
const canEdit = computed(() => hasPermission(user.value, `${prefix}.edit`));
const canToggle = computed(() => hasPermission(user.value, `${prefix}.toggle-status`));
const canDelete = computed(() => hasPermission(user.value, `${prefix}.delete`));
const canManageAliases = computed(() => hasPermission(user.value, `${prefix}.manage-aliases`));
const loading = ref(false);
const tableData = ref<TextureItem[]>([]);
const aliasesByTexture = reactive<Record<number, SlabTextureAliasRecord[]>>({});
const searchForm = reactive({ name: '', alias: '', status: '' });
const applied = reactive({ ...searchForm });
const pagination = reactive({ current: 1, pageSize: 10 });
const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'index', title: '序号', width: 88, align: 'left' },
  { colKey: 'name', title: '标准纹理', minWidth: 200, align: 'left' },
  { colKey: 'aliasCount', title: '别名数量', width: 120, align: 'center' },
  { colKey: 'status', title: '状态', width: 120, align: 'center' },
  { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
  { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  { colKey: 'operation', title: '操作', width: 220, align: 'left', fixed: 'right' },
];
const aliasColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', title: '别名', minWidth: 260, align: 'left' },
  { colKey: 'operation', title: '操作', width: 140, align: 'left' },
];
const filteredData = computed(() =>
  tableData.value.filter(
    (item) =>
      (!applied.name.trim() || item.name.includes(applied.name.trim())) &&
      (!applied.alias.trim() ||
        aliasesByTexture[item.id]?.some((alias) => alias.name.includes(applied.alias.trim()))) &&
      (!applied.status || item.status === applied.status),
  ),
);
const pageData = computed(() =>
  filteredData.value.slice((pagination.current - 1) * pagination.pageSize, pagination.current * pagination.pageSize),
);
const formatDate = (value?: string) => (value ? value.replace(/-/g, '/').replace('T', ' ').slice(0, 16) : '-');
const loadData = async () => {
  loading.value = true;
  try {
    const records = sortByCreatedAtDesc(await listSlabTextures());
    const aliasLists = await Promise.all(records.map((item) => listSlabTextureAliases(item.id)));
    records.forEach((item, index) => {
      aliasesByTexture[item.id] = aliasLists[index];
    });
    tableData.value = records.map((item) => ({
      ...item,
      status: item.status === 'disabled' ? 'disabled' : 'normal',
      createdByName: item.createdByName ?? '-',
      createdAt: formatDate(item.createdAt),
      aliasCount: aliasesByTexture[item.id].length,
    }));
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '纹理列表加载失败');
  } finally {
    loading.value = false;
  }
};
const handleSearch = () => {
  Object.assign(applied, searchForm);
  pagination.current = 1;
};
const handleReset = () => {
  Object.assign(searchForm, { name: '', alias: '', status: '' });
  pagination.pageSize = 10;
  handleSearch();
};

const formRef = ref<FormInstanceFunctions>();
const formVisible = ref(false);
const editingId = ref<number | null>(null);
const formData = reactive({ name: '', remark: '' });
const formRules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入标准纹理', type: 'error' }],
  remark: [{ max: 100, message: '备注最多输入100个汉字', type: 'error' }],
};
const openCreate = () => {
  editingId.value = null;
  Object.assign(formData, { name: '', remark: '' });
  formVisible.value = true;
};
const openEdit = (row: TextureItem) => {
  editingId.value = row.id;
  Object.assign(formData, { name: row.name, remark: row.remark ?? '' });
  formVisible.value = true;
};
const submitTexture = async () => {
  if ((await formRef.value?.validate()) !== true) return;
  try {
    const payload = { name: formData.name.trim(), remark: formData.remark.trim(), status: 'enabled' as const };
    if (editingId.value) {
      await updateSlabTexture(editingId.value, payload);
      adminFeedback.actionSuccess({ action: '保存', target: payload.name });
    } else {
      await createSlabTexture(payload);
      adminFeedback.created(payload.name);
    }
    formVisible.value = false;
    await loadData();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '提交失败');
  }
};

const aliasesVisible = ref(false);
const activeTexture = ref<TextureItem | null>(null);
const aliases = ref<SlabTextureAliasRecord[]>([]);
const openAliases = async (row: TextureItem) => {
  activeTexture.value = row;
  aliases.value = await listSlabTextureAliases(row.id);
  aliasesVisible.value = true;
};
const aliasFormRef = ref<FormInstanceFunctions>();
const aliasFormVisible = ref(false);
const editingAliasId = ref<number | null>(null);
const aliasForm = reactive({ name: '' });
const aliasRules: Record<string, FormRule[]> = { name: [{ required: true, message: '请输入纹理别名', type: 'error' }] };
const openAliasForm = (row?: SlabTextureAliasRecord) => {
  editingAliasId.value = row?.id ?? null;
  aliasForm.name = row?.name ?? '';
  aliasFormVisible.value = true;
};
const submitAlias = async () => {
  if ((await aliasFormRef.value?.validate()) !== true || !activeTexture.value) return;
  const name = aliasForm.name.trim();
  try {
    if (editingAliasId.value) {
      await updateSlabTextureAlias(activeTexture.value.id, editingAliasId.value, name);
      adminFeedback.actionSuccess({ action: '保存', target: name });
    } else {
      await createSlabTextureAlias(activeTexture.value.id, name);
      adminFeedback.created(name);
    }
    aliasFormVisible.value = false;
    aliases.value = await listSlabTextureAliases(activeTexture.value.id);
    await loadData();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '别名提交失败');
  }
};
const removeAlias = async (row: SlabTextureAliasRecord) => {
  if (!activeTexture.value) return;
  try {
    await deleteSlabTextureAlias(activeTexture.value.id, row.id);
    adminFeedback.deleted(row.name);
    aliases.value = await listSlabTextureAliases(activeTexture.value.id);
    await loadData();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '删除失败');
  }
};

const confirmVisible = ref(false);
const confirmRow = ref<TextureItem | null>(null);
const confirmType = ref<ConfirmType>('disable');
const openConfirm = (row: TextureItem, type: ConfirmType) => {
  confirmRow.value = row;
  confirmType.value = type;
  confirmVisible.value = true;
};
const submitConfirm = async () => {
  if (!confirmRow.value) return;
  try {
    if (confirmType.value === 'delete') {
      await deleteSlabTexture(confirmRow.value.id);
      adminFeedback.deleted(confirmRow.value.name);
    } else {
      const next = confirmType.value === 'disable' ? 'disabled' : 'enabled';
      await updateSlabTextureStatus(confirmRow.value.id, next);
      adminFeedback.actionSuccess({ action: next === 'enabled' ? '启用' : '停用', target: confirmRow.value.name });
    }
    confirmVisible.value = false;
    await loadData();
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  }
};

onMounted(loadData);
</script>

<style scoped>
.admin-layout {
  min-height: 100vh;
  background: var(--td-bg-color-page);
}
.admin-shell {
  min-height: calc(100vh - 64px);
  display: flex;
  background: var(--td-bg-color-page);
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
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
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
  width: 240px;
  margin-bottom: 0;
}
.filter-actions,
.table-actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
}
.filter-actions {
  justify-content: flex-end;
}
.table-toolbar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  margin-bottom: var(--td-comp-margin-l);
}
.table-actions {
  justify-content: flex-start;
  gap: var(--td-comp-margin-m);
}
.zdm-admin-pagination {
  margin-top: var(--td-comp-margin-l);
}
@media (max-width: 960px) {
  .page {
    padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  }
  .page-header,
  .filter-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .filter-fields,
  .filter-actions {
    width: 100%;
  }
  .filter-actions {
    justify-content: flex-start;
  }
}
@media (max-width: 640px) {
  .filter-fields :deep(.t-form__item) {
    width: 100%;
  }
}
</style>
