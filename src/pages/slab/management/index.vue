<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>大板管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">全平台共用大板库</t-tag>
        </header>

        <section class="filter-card">
          <t-tabs v-model="activeTab" class="status-tabs" @change="handleTabChange">
            <t-tab-panel v-for="tab in tabs" :key="tab.value" :value="tab.value" :label="tabLabel(tab)" />
          </t-tabs>

          <t-form :data="currentFilter" label-width="44px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <div class="filter-primary-row">
                  <t-form-item label="大板" class="slab-keyword-filter">
                    <t-input v-model="currentFilter.keyword" clearable placeholder="大板名称/ID/编码" />
                  </t-form-item>
                  <t-form-item label="品种">
                    <t-select v-model="currentFilter.variety" clearable filterable placeholder="请选择">
                      <t-option v-for="item in varietyOptions" :key="item" :label="item" :value="item" />
                    </t-select>
                  </t-form-item>
                  <t-form-item label="产地">
                    <t-select v-model="currentFilter.origin" clearable filterable placeholder="请选择">
                      <t-option v-for="item in originOptions" :key="item" :label="item" :value="item" />
                    </t-select>
                  </t-form-item>
                  <t-form-item label="纹理">
                    <t-select v-model="currentFilter.texture" clearable filterable placeholder="请选择">
                      <t-option v-for="item in textureFilterOptions" :key="item" :label="item" :value="item" />
                    </t-select>
                  </t-form-item>
                  <t-form-item label="色系">
                    <t-cascader
                      v-model="currentFilter.color"
                      :options="colorFilterCascaderOptions"
                      :show-all-levels="false"
                      :check-strictly="false"
                      clearable
                      filterable
                      placeholder="请选择"
                      trigger="hover"
                      value-mode="onlyLeaf"
                      value-type="single"
                    />
                  </t-form-item>
                  <t-form-item label="等级">
                    <t-select v-model="currentFilter.grade" clearable filterable placeholder="请选择">
                      <t-option
                        v-for="item in gradeFilterOptions"
                        :key="item.value"
                        :label="item.label"
                        :value="item.value"
                      />
                    </t-select>
                  </t-form-item>
                </div>
                <div class="filter-secondary-row">
                  <t-form-item label="供应商" label-width="60px" class="supplier-filter">
                    <t-select v-model="currentFilter.supplier" clearable filterable placeholder="请选择供应商">
                      <t-option
                        v-for="item in supplierFilterOptions"
                        :key="item.id"
                        :label="item.name"
                        :value="item.name"
                      />
                    </t-select>
                  </t-form-item>
                  <div class="filter-actions">
                    <t-button theme="primary" @click="handleSearch">
                      <template #icon><t-icon name="search" /></template>
                      查询
                    </t-button>
                    <t-button class="reset-filter-button" theme="default" variant="base" @click="handleReset">
                      <template #icon><t-icon name="refresh" /></template>
                      重置
                    </t-button>
                  </div>
                </div>
              </div>
            </div>
          </t-form>
        </section>

        <section class="table-card">
          <div class="table-toolbar">
            <div class="toolbar-buttons">
              <t-button
                v-for="button in batchButtons"
                :key="button.action"
                :theme="button.theme"
                :class="button.className"
                @click="handleBatchAction(button.action)"
              >
                <template #icon>
                  <t-icon :name="button.icon" />
                </template>
                {{ button.label }}
              </t-button>
            </div>
            <div class="selection-info">已选 {{ selectedKeys.length }} 项</div>
          </div>

          <t-table row-key="id" :data="pageData" :columns="columns" :loading="loading" hover table-layout="fixed">
            <template #selectTitle>
              <t-checkbox
                :checked="pageAllSelected"
                :indeterminate="pagePartiallySelected"
                @change="toggleCurrentPage"
              />
            </template>
            <template #select="{ row }">
              <t-checkbox
                :checked="selectedKeySet.has(row.id)"
                @change="(checked: boolean) => toggleRow(row.id, checked)"
              />
            </template>
            <template #image="{ row }">
              <div class="slab-image">
                <img
                  v-if="row.image"
                  :src="row.image"
                  :alt="row.name"
                  role="button"
                  tabindex="0"
                  @click="openTableImage(row)"
                  @keydown.enter="openTableImage(row)"
                />
                <span v-else class="slab-image-placeholder">暂无主图</span>
              </div>
            </template>
            <template #slab="{ row }">
              <div class="slab-meta">
                <div class="slab-name">{{ row.name }}</div>
                <div class="slab-code">ID：{{ row.id }}</div>
                <div class="slab-code">编码：{{ row.code }}</div>
              </div>
            </template>
            <template #tenant="{ row }">
              <div class="tenant-cell">
                <span>{{ row.tenant }}</span>
                <span class="store-text">{{ row.store }}</span>
              </div>
            </template>
            <template #operation="{ row }">
              <div class="table-actions">
                <t-link
                  v-for="action in rowActions(row)"
                  :key="action.action"
                  :theme="action.theme"
                  hover="color"
                  @click="handleRowAction(action.action, row)"
                >
                  {{ action.label }}
                </t-link>
              </div>
            </template>
          </t-table>

          <AdminPagination
            v-model:current="currentPagination.current"
            v-model:page-size="currentPagination.pageSize"
            :total="paginationTotal"
            :page-size-options="pageSizeOptions"
          />
        </section>
      </main>
    </div>

    <t-dialog
      v-model:visible="productDialogVisible"
      :header="productDialogTitle"
      width="940px"
      placement="center"
      :confirm-btn="productMode === 'view' ? null : '提交商品信息'"
      cancel-btn="取消"
      @confirm="handleProductSubmit"
      @cancel="closeProductDialog"
      @close="closeProductDialog"
    >
      <t-tabs v-model="productTab" class="product-tabs">
        <t-tab-panel value="images" label="图片">
          <div class="upload-grid">
            <label
              v-for="item in uploadItems"
              :key="item.key"
              class="upload-box"
              :class="{ 'is-disabled': productMode === 'view', 'is-error': uploadErrors[item.key] }"
              :for="`slab-upload-${item.key}`"
            >
              <span v-if="item.required" class="required-star">*</span>
              <t-button
                v-if="uploadPreviews[item.key] && productMode !== 'view'"
                class="upload-delete-button"
                theme="danger"
                variant="text"
                size="small"
                @click.stop.prevent="removeUpload(item.key)"
              >
                删除
              </t-button>
              <strong>{{ item.title }}</strong>
              <img
                v-if="uploadPreviews[item.key]?.url && item.accept.startsWith('image/')"
                class="upload-preview"
                :src="uploadPreviews[item.key]?.url"
                :alt="item.title"
                role="button"
                tabindex="0"
                @click.stop.prevent="openUploadPreview(item)"
                @keydown.enter.stop.prevent="openUploadPreview(item)"
              />
              <img
                v-else-if="uploadPreviews[item.key]?.coverUrl && item.accept.startsWith('video/')"
                class="upload-preview"
                :src="uploadPreviews[item.key]?.coverUrl"
                :alt="`${item.title}封面`"
                role="button"
                tabindex="0"
                @click.stop.prevent="openUploadPreview(item)"
                @keydown.enter.stop.prevent="openUploadPreview(item)"
              />
              <t-icon v-else name="add" />
              <span>{{ uploadPreviews[item.key]?.name || item.label }}</span>
              <span v-if="uploadErrors[item.key]" class="upload-error">请上传{{ item.title }}</span>
              <input
                :id="`slab-upload-${item.key}`"
                class="direct-upload-input"
                type="file"
                :accept="item.accept"
                :disabled="productMode === 'view'"
                @change="(event) => handleDirectUpload(item, event)"
              />
            </label>
          </div>
        </t-tab-panel>
        <t-tab-panel value="base" label="基础信息">
          <t-form ref="productFormRef" :data="productForm" :rules="productRules" label-width="92px" colon>
            <div class="dialog-form-grid">
              <t-form-item label="品种" name="variety">
                <t-select
                  v-model="productForm.variety"
                  :disabled="productMode === 'view'"
                  filterable
                  placeholder="请选择"
                  @change="clearProductFieldError('variety')"
                >
                  <t-option v-for="item in varietyOptions" :key="item" :label="item" :value="item" />
                </t-select>
              </t-form-item>
              <t-form-item label="产地" name="origin">
                <t-select
                  v-model="productForm.origin"
                  :disabled="productMode === 'view'"
                  filterable
                  placeholder="请选择"
                  @change="clearProductFieldError('origin')"
                >
                  <t-option v-for="item in originOptions" :key="item" :label="item" :value="item" />
                </t-select>
              </t-form-item>
              <t-form-item label="纹理" name="textureId">
                <t-select
                  v-model="productForm.textureId"
                  :disabled="productMode === 'view'"
                  filterable
                  placeholder="请选择"
                  @change="clearProductFieldError('textureId')"
                >
                  <t-option
                    v-for="item in publishOptions.textures"
                    :key="item.id"
                    :label="item.label"
                    :value="item.id"
                    :disabled="item.status === 'disabled'"
                  />
                </t-select>
              </t-form-item>
              <t-form-item label="色系" name="colorId">
                <t-cascader
                  v-model="productForm.colorId"
                  :disabled="productMode === 'view'"
                  :options="colorCascaderOptions"
                  :show-all-levels="false"
                  :check-strictly="false"
                  filterable
                  placeholder="请选择"
                  trigger="hover"
                  value-mode="onlyLeaf"
                  value-type="single"
                  @change="clearProductFieldError('colorId')"
                />
              </t-form-item>
              <t-form-item label="等级" name="gradeId">
                <t-select
                  v-model="productForm.gradeId"
                  :disabled="productMode === 'view'"
                  filterable
                  placeholder="请选择"
                  @change="clearProductFieldError('gradeId')"
                >
                  <t-option
                    v-for="item in publishOptions.grades"
                    :key="item.id"
                    :label="formatGradeOption(item)"
                    :value="item.id"
                    :disabled="item.status === 'disabled'"
                  />
                </t-select>
              </t-form-item>
            </div>
            <div class="section-title">尺寸</div>
            <div class="dimension-grid">
              <t-form-item label="长" name="length" required-mark>
                <t-input-number
v-model="productForm.length"
                  class="measurement-input"
                  large-number
                  :disabled="productMode === 'view'"
                  :decimal-places="2"
                  theme="normal"
                  placeholder="请输入"
                  @blur="handleMeasurementBlur('length')"
                  @change="handleMeasurementChange('length')"
                />
              </t-form-item>
              <t-form-item label="宽" name="width" required-mark>
                <t-input-number
v-model="productForm.width"
                  class="measurement-input"
                  large-number
                  :disabled="productMode === 'view'"
                  :decimal-places="2"
                  theme="normal"
                  placeholder="请输入"
                  @blur="handleMeasurementBlur('width')"
                  @change="handleMeasurementChange('width')"
                />
              </t-form-item>
              <t-form-item label="高" name="height" required-mark>
                <t-input-number
v-model="productForm.height"
                  class="measurement-input"
                  large-number
                  :disabled="productMode === 'view'"
                  :decimal-places="2"
                  theme="normal"
                  placeholder="请输入"
                  @blur="handleMeasurementBlur('height')"
                  @change="handleMeasurementChange('height')"
                />
              </t-form-item>
              <t-form-item label="土误差" name="tolerance">
                <t-input-number
v-model="productForm.tolerance"
                  class="measurement-input"
                  large-number
                  :disabled="productMode === 'view'"
                  :decimal-places="2"
                  theme="normal"
                  placeholder="请输入"
                  @blur="handleMeasurementBlur('tolerance')"
                  @change="handleMeasurementChange('tolerance')"
                />
              </t-form-item>
            </div>
            <div class="section-title">扣角（mm）</div>
            <div class="corner-grid">
              <t-form-item v-for="item in cornerFields" :key="item.key" :label="item.label" :name="item.key">
                <t-input-number
v-model="productForm[item.key]"
                  class="measurement-input"
                  large-number
                  :disabled="productMode === 'view'"
                  :decimal-places="2"
                  theme="normal"
                  placeholder="请输入"
                  @blur="handleMeasurementBlur(item.key)"
                  @change="handleMeasurementChange(item.key)"
                />
              </t-form-item>
            </div>
          </t-form>
        </t-tab-panel>
        <t-tab-panel value="sales" label="销售信息">
          <t-form ref="salesFormRef" :data="productForm" :rules="salesRules" label-width="96px" colon>
            <div class="dialog-form-grid">
              <t-form-item label="供应商" name="supplier" required-mark>
                <t-select
                  v-model="productForm.supplier"
                  :disabled="productMode === 'view'"
                  filterable
                  placeholder="请选择"
                  @change="clearSalesFieldError('supplier')"
                >
                  <t-option
                    v-for="item in publishSupplierOptions"
                    :key="item.id"
                    :label="item.name"
                    :value="item.name"
                  />
                </t-select>
              </t-form-item>
              <t-form-item label="库存" name="stock" required-mark>
                <t-input-number
v-model="productForm.stock"
                  large-number
                  :disabled="productMode === 'view'"
                  :decimal-places="0"
                  :input-props="stockInputProps"
                  theme="normal"
                  placeholder="请输入"
                  @change="handleStockChange"
                  @keydown="handleStockKeydown"
                />
              </t-form-item>
              <t-form-item label="SKU" name="sku" required-mark>
                <t-input
                  v-model="productForm.sku"
                  :disabled="productMode === 'view'"
                  placeholder="请输入"
                  @change="clearSalesFieldError('sku')"
                />
              </t-form-item>
            </div>
            <div class="section-title">价格设置</div>
            <div class="price-editor">
              <div class="price-editor__head">
                <span>价格层级</span>
                <span><span class="price-required-star">*</span>系数</span>
                <span><span class="price-required-star">*</span>价格</span>
              </div>
              <div class="price-editor__row">
                <span>成本价（基准）</span>
                <t-input class="price-input" model-value="1.00" disabled />
                <t-form-item class="price-form-item" name="cost" label-width="0" :required-mark="false">
                  <t-input-number
v-model="productForm.cost"
                    class="price-input"
                    large-number
                    :disabled="productMode === 'view'"
                    :decimal-places="2"
                    theme="normal"
                    placeholder="请输入"
                    @change="handleCostChange"
                  />
                </t-form-item>
              </div>
              <div class="price-editor__row">
                <span>指导价</span>
                <t-form-item
                  class="price-form-item"
                  :name="guideRatioFieldName"
                  :rules="salesNumberFieldRules('指导价系数', 0)"
                  label-width="0"
                  :required-mark="false"
                >
                  <t-input-number
v-if="guidePriceRow"
                    v-model="productForm.markupPrices[guidePriceRow.id].ratio"
                    class="price-input"
                    large-number
                    :disabled="productMode === 'view'"
                    :decimal-places="2"
                    theme="normal"
                    @change="handleGuideRatioChange"
                  />
                  <t-input-number
v-else
                    v-model="productForm.guideRatio"
                    class="price-input"
                    large-number
                    :disabled="productMode === 'view'"
                    :decimal-places="2"
                    theme="normal"
                    @change="handleGuideRatioChange"
                  />
                </t-form-item>
                <t-form-item
                  class="price-form-item"
                  :name="guidePriceFieldName"
                  :rules="salesNumberFieldRules('指导价', 0)"
                  label-width="0"
                  :required-mark="false"
                >
                  <t-input-number
v-if="guidePriceRow"
                    v-model="productForm.markupPrices[guidePriceRow.id].price"
                    class="price-input"
                    large-number
                    :disabled="productMode === 'view'"
                    :decimal-places="2"
                    theme="normal"
                    @change="handleGuidePriceChange"
                  />
                  <t-input-number
v-else
                    v-model="productForm.guidePrice"
                    class="price-input"
                    large-number
                    :disabled="productMode === 'view'"
                    :decimal-places="2"
                    theme="normal"
                    @change="handleGuidePriceChange"
                  />
                </t-form-item>
              </div>
              <div v-for="item in partnerPriceRows" :key="item.id" class="price-editor__row">
                <span>{{ item.label }}</span>
                <t-form-item
                  class="price-form-item"
                  :name="`markupPrices.${item.id}.ratio`"
                  :rules="salesNumberFieldRules(`${item.label}系数`, 0)"
                  label-width="0"
                  :required-mark="false"
                >
                  <t-input-number
v-model="productForm.markupPrices[item.id].ratio"
                    class="price-input"
                    large-number
                    :disabled="productMode === 'view'"
                    :decimal-places="2"
                    theme="normal"
                    @change="(value: unknown, context: SalesNumberChangeContext) => handlePartnerRatioChange(item.id, value, context)"
                  />
                </t-form-item>
                <t-form-item
                  class="price-form-item"
                  :name="`markupPrices.${item.id}.price`"
                  :rules="salesNumberFieldRules(`${item.label}价格`, 0)"
                  label-width="0"
                  :required-mark="false"
                >
                  <t-input-number
v-model="productForm.markupPrices[item.id].price"
                    class="price-input"
                    large-number
                    :disabled="productMode === 'view'"
                    :decimal-places="2"
                    theme="normal"
                    @change="(value: unknown, context: SalesNumberChangeContext) => handlePartnerPriceChange(item.id, value, context)"
                  />
                </t-form-item>
              </div>
            </div>
          </t-form>
        </t-tab-panel>
      </t-tabs>
    </t-dialog>

    <t-drawer
      v-model:visible="priceDrawerVisible"
      header="价格编辑器"
      placement="right"
      :size="priceDrawerSize"
      :footer="false"
      @close="closePriceDrawer"
    >
      <div class="price-drawer-content">
        <div class="drawer-actions">
          <t-button v-if="!priceDrawerReadonly" theme="primary" block @click="saveBatchPrice">
            <template #icon><t-icon name="save" /></template>
            保存
          </t-button>
        </div>
        <t-form ref="priceDrawerFormRef" :data="priceDrawerForm" class="price-drawer-form">
          <div class="price-table">
            <div class="price-table__head">
              <span>价格层级</span>
              <span><span class="price-required-star">*</span>系数</span>
              <span><span class="price-required-star">*</span>价格</span>
            </div>
            <div v-for="(row, index) in batchPriceRows" :key="row.label" class="price-table__row">
              <span>{{ row.label }}</span>
              <t-input v-if="index === 0" class="price-input" model-value="1.00" disabled />
              <t-form-item
                v-else
                class="price-form-item"
                :name="`rows.${index}.ratio`"
                :rules="salesNumberFieldRules(`${row.label}系数`, 0)"
                label-width="0"
                :required-mark="false"
              >
                <t-input-number
                  v-model="row.ratio"
                  class="price-input"
                  large-number
                  :disabled="priceDrawerReadonly"
                  :decimal-places="2"
                  theme="normal"
                  @change="(value: unknown, context: SalesNumberChangeContext) => handleBatchRatioChange(index, value, context)"
                />
              </t-form-item>
              <t-form-item
                class="price-form-item"
                :name="`rows.${index}.price`"
                :rules="salesNumberFieldRules(row.label, 0)"
                label-width="0"
                :required-mark="false"
              >
                <t-input-number
                  v-model="row.price"
                  class="price-input"
                  large-number
                  :disabled="priceDrawerReadonly"
                  :decimal-places="2"
                  theme="normal"
                  @change="(value: unknown, context: SalesNumberChangeContext) => handleBatchPriceChange(index, value, context)"
                />
              </t-form-item>
            </div>
          </div>
        </t-form>
      </div>
    </t-drawer>

    <t-dialog
      v-model:visible="uploadPreviewDialogVisible"
      :header="uploadPreviewTitle"
      width="760px"
      placement="center"
      :footer="false"
    >
      <video
        v-if="uploadPreviewType === 'video' && uploadPreviewUrl"
        class="upload-large-preview"
        :src="uploadPreviewUrl"
        controls
      />
      <img
        v-else-if="uploadPreviewUrl"
        class="upload-large-preview"
        :src="uploadPreviewUrl"
        :alt="uploadPreviewTitle"
      />
    </t-dialog>

    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="confirmAction"
      :title="confirmTitle"
      object-type="大板"
      :object-name="confirmState.row?.name"
      @confirm="handleConfirmSubmit"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
    >
      {{ confirmState.content }}
    </AdminConfirmDialog>

    <t-dialog
      v-model:visible="reasonDialogVisible"
      :header="reasonState.type === 'reject' ? '驳回' : '下架'"
      width="520px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleReasonSubmit"
      @cancel="closeReasonDialog"
      @close="closeReasonDialog"
    >
      <t-form :data="reasonForm" label-width="96px" colon>
        <t-form-item :label="reasonState.type === 'reject' ? '驳回原因' : '下架原因'" required-mark>
          <t-select v-model="reasonForm.reason" placeholder="请选择">
            <t-option
              v-for="item in reasonState.type === 'reject' ? rejectReasons : offShelfReasons"
              :key="item"
              :label="item"
              :value="item"
            />
          </t-select>
        </t-form-item>
        <t-form-item label="详细说明">
          <t-textarea v-model="reasonForm.detail" placeholder="请输入" :autosize="{ minRows: 4, maxRows: 6 }" />
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { adminFeedback, AdminConfirmDialog, AdminPagination } from '@/components/foundation';
import {
  listSlabMarkupConfigurationOptions,
  type SlabMarkupConfigurationRecord,
} from '@/services/slabMarkupConfigurations';
import { listSlabOrigins, type SlabOriginRecord } from '@/services/slabOrigins';
import { listSlabVarieties, type SlabVarietyRecord } from '@/services/slabVarieties';
import {
  createSlab,
  deleteUnreferencedSlabImage,
  deleteSlab,
  getSlabPublishOptions,
  listSlabs,
  uploadSlabImage,
  updateSlab,
  updateSlabStatuses,
  type SlabPayload,
  type SlabPublisherType,
  type SlabPublishOptions,
  type SlabRecord,
  type SlabStatus,
  type SlabPrice,
} from '@/services/slabs';
import { listSuppliers, type SupplierRecord } from '@/services/suppliers';
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
type PublisherType = SlabPublisherType;
type ProductMode = 'create' | 'edit' | 'view';
type RowAction = 'price' | 'shelf' | 'edit' | 'reject' | 'delete' | 'offShelf' | 'restore' | 'purge';
type BatchAction = 'publish' | 'batchShelf' | 'batchOffShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';
type ConfirmType =
  | 'shelf'
  | 'delete'
  | 'restore'
  | 'reject'
  | 'savePrice'
  | 'batchShelf'
  | 'batchRestore'
  | 'purge'
  | 'batchPurge'
  | 'clearRecycle';
type UploadItemKey = 'main' | 'scan' | 'design' | 'video';
type SalesNumberChangeContext = { type?: string };

interface FilterState {
  keyword: string;
  variety: string;
  origin: string;
  texture: string;
  color: string;
  grade: string;
  supplier: string;
}

interface PriceGroup {
  cost: string;
  guide: string;
  level1: string;
  level2: string;
  level3: string;
}

interface DrawerPriceRow {
  configurationId?: number;
  label: string;
  ratio: string;
  price: string;
}

interface SlabItem {
  id: number;
  supplierId?: number;
  varietyId?: number;
  originId?: number;
  textureId?: number;
  colorId?: number;
  gradeId?: number;
  code: string;
  image: string;
  scanImageUrl?: string;
  designImageUrl?: string;
  videoUrl?: string;
  videoCoverUrl?: string;
  name: string;
  size: string;
  origin: string;
  texture: string;
  color: string;
  grade: string;
  tenant: string;
  store: string;
  publisherType: PublisherType;
  createdByName: string;
  createdAt: string;
  price: PriceGroup;
  status: SlabStatus;
  variety: string;
  sku: string;
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  toleranceMm?: number;
  corner1LengthMm?: number;
  corner1WidthMm?: number;
  corner2LengthMm?: number;
  corner2WidthMm?: number;
  corner3LengthMm?: number;
  corner3WidthMm?: number;
  corner4LengthMm?: number;
  corner4WidthMm?: number;
  areaSquareMeter?: number;
  markupPrices?: SlabPrice[];
}

interface ProductForm {
  variety: string;
  origin: string;
  textureId?: number;
  colorId?: number;
  gradeId?: number;
  length: string;
  width: string;
  height: string;
  tolerance: string;
  corner1Length: string;
  corner1Width: string;
  corner2Length: string;
  corner2Width: string;
  corner3Length: string;
  corner3Width: string;
  corner4Length: string;
  corner4Width: string;
  supplier: string;
  cost: string;
  stock: string;
  sku: string;
  guideRatio: string;
  guidePrice: string;
  level1Ratio: string;
  level1Price: string;
  level2Ratio: string;
  level2Price: string;
  level3Ratio: string;
  level3Price: string;
  markupPrices: Record<number, { ratio: string; price: string }>;
}

type CornerFieldKey =
  | 'corner1Length'
  | 'corner1Width'
  | 'corner2Length'
  | 'corner2Width'
  | 'corner3Length'
  | 'corner3Width'
  | 'corner4Length'
  | 'corner4Width';
type MeasurementField = 'length' | 'width' | 'height' | 'tolerance' | CornerFieldKey;
const tabs: { value: SlabStatus; label: string }[] = [
  { value: 'warehouse', label: '仓库中' },
  { value: 'selling', label: '出售中' },
  { value: 'offShelf', label: '已下架' },
  { value: 'soldOut', label: '已售完' },
  { value: 'recycle', label: '回收站' },
];

const pageSizeOptions = [10, 20, 50];
const rejectReasons = ['图片不清晰', '资料不完整', '规格填写异常', '价格信息缺失'];
const offShelfReasons = ['库存异常', '价格调整', '图片更新', '供应商申请'];

const makeFilterState = (): FilterState => ({
  keyword: '',
  variety: '',
  origin: '',
  texture: '',
  color: '',
  grade: '',
  supplier: '',
});

const makeProductForm = (): ProductForm => ({
  variety: '',
  origin: '',
  textureId: undefined,
  colorId: undefined,
  gradeId: undefined,
  length: '',
  width: '',
  height: '',
  tolerance: '',
  corner1Length: '',
  corner1Width: '',
  corner2Length: '',
  corner2Width: '',
  corner3Length: '',
  corner3Width: '',
  corner4Length: '',
  corner4Width: '',
  supplier: '',
  cost: '',
  stock: '',
  sku: '',
  guideRatio: '1.60',
  guidePrice: '',
  level1Ratio: '1.45',
  level1Price: '',
  level2Ratio: '1.30',
  level2Price: '',
  level3Ratio: '1.18',
  level3Price: '',
  markupPrices: {},
});

const activeTab = ref<SlabStatus>('warehouse');
const loading = ref(false);
const saving = ref(false);
const selectedKeys = ref<number[]>([]);
const productDialogVisible = ref(false);
const productMode = ref<ProductMode>('create');
const productTab = ref('images');
const editingRowId = ref<number | null>(null);
const productFormRef = ref<FormInstanceFunctions>();
const salesFormRef = ref<FormInstanceFunctions>();
const priceDrawerFormRef = ref<FormInstanceFunctions>();
const productForm = reactive<ProductForm>(makeProductForm());
const priceDrawerVisible = ref(false);
const priceDrawerRowId = ref<number | null>(null);
const confirmDialogVisible = ref(false);
const reasonDialogVisible = ref(false);
const uploadPreviews = reactive<
  Partial<Record<UploadItemKey, { name: string; url?: string; videoUrl?: string; coverUrl?: string }>>
>({});
const pendingUploadedUrls = new Set<string>();
const uploadErrors = reactive<Partial<Record<UploadItemKey, boolean>>>({});
const invalidMeasurementFields = reactive(new Set<MeasurementField>());
const stockHasLeadingZero = ref(false);
const uploadPreviewDialogVisible = ref(false);
const uploadPreviewTitle = ref('');
const uploadPreviewUrl = ref('');
const uploadPreviewType = ref<'image' | 'video'>('image');
const slabOrigins = ref<SlabOriginRecord[]>([]);
const slabVarieties = ref<SlabVarietyRecord[]>([]);
const slabSuppliers = ref<SupplierRecord[]>([]);
const markupConfigurations = ref<SlabMarkupConfigurationRecord[]>([]);
const publishOptions = reactive<SlabPublishOptions>({ textures: [], colorCategories: [], grades: [] });

const varietyOptions = computed(() => slabVarieties.value.map((item) => item.name));
const originOptions = computed(() => slabOrigins.value.map((item) => item.name));
const textureFilterOptions = computed(() => publishOptions.textures.map((item) => item.label));
const colorOptions = computed(() => publishOptions.colorCategories.flatMap((item) => item.children));
const formatGradeOption = (grade: SlabPublishOptions['grades'][number]) =>
  grade.description ? `${grade.label}（${grade.description}）` : grade.label;
const gradeFilterOptions = computed(() =>
  publishOptions.grades.map((item) => ({ value: formatGradeOption(item), label: formatGradeOption(item) })),
);
const colorCascaderOptions = computed(() =>
  publishOptions.colorCategories.map((category) => ({
    value: `category-${category.id}`,
    label: category.label,
    disabled: category.status === 'disabled',
    children: category.children.map((color) => ({
      value: color.id,
      label: color.label,
      disabled: color.status === 'disabled',
    })),
  })),
);
const colorFilterCascaderOptions = computed(() =>
  publishOptions.colorCategories.map((category) => ({
    value: `filter-category-${category.id}`,
    label: category.label,
    disabled: category.status === 'disabled',
    children: category.children.map((color) => ({
      value: color.label,
      label: color.label,
      disabled: color.status === 'disabled',
    })),
  })),
);
const suppliesSlabs = (supplier: SupplierRecord) =>
  supplier.supplyTypes.some(
    (type) => type.status !== 'disabled' && (type.code === 'slab' || type.name.trim() === '大板'),
  );
const publishSupplierOptions = computed(() =>
  slabSuppliers.value.filter((item) => item.status !== 'disabled' && suppliesSlabs(item)),
);
const supplierFilterOptions = computed(() => slabSuppliers.value.filter((item) => suppliesSlabs(item)));

const filters = reactive<Record<SlabStatus, FilterState>>({
  warehouse: makeFilterState(),
  selling: makeFilterState(),
  offShelf: makeFilterState(),
  soldOut: makeFilterState(),
  recycle: makeFilterState(),
});
const appliedFilters = reactive<Record<SlabStatus, FilterState>>({
  warehouse: makeFilterState(),
  selling: makeFilterState(),
  offShelf: makeFilterState(),
  soldOut: makeFilterState(),
  recycle: makeFilterState(),
});

const paginations = reactive<Record<SlabStatus, { current: number; pageSize: number }>>({
  warehouse: { current: 1, pageSize: 10 },
  selling: { current: 1, pageSize: 10 },
  offShelf: { current: 1, pageSize: 10 },
  soldOut: { current: 1, pageSize: 10 },
  recycle: { current: 1, pageSize: 10 },
});

const tableData = ref<SlabItem[]>([]);

const normalizeStatus = (status?: string): SlabStatus => {
  if (status === 'selling' || status === 'offShelf' || status === 'soldOut' || status === 'recycle') return status;
  return 'warehouse';
};

const normalizePublisherType = (publisherType?: string): PublisherType =>
  publisherType === '接口获取' ? '接口获取' : '平台发布';

const originById = (id?: number) => slabOrigins.value.find((item) => item.id === id);
const varietyById = (id?: number) => slabVarieties.value.find((item) => item.id === id);
const supplierById = (id?: number) => slabSuppliers.value.find((item) => item.id === id);
const publishOptionLabel = (options: SlabPublishOptions[keyof SlabPublishOptions], id?: number) =>
  options.find((item) => item.id === id)?.label || '-';
const gradeLabelById = (id?: number) => {
  const grade = publishOptions.grades.find((item) => item.id === id);
  return grade ? formatGradeOption(grade) : '-';
};
const varietyIdByName = (name: string) => slabVarieties.value.find((item) => item.name === name)?.id;
const originIdByName = (name: string) => slabOrigins.value.find((item) => item.name === name)?.id;
const supplierIdByName = (name: string) => publishSupplierOptions.value.find((item) => item.name === name)?.id;

const formatSize = (record: SlabRecord) => {
  const dimensions = [record.lengthMm, record.widthMm, record.thicknessMm];
  return dimensions.some((item) => item == null) ? '-' : `${dimensions.join(' x ')}mm`;
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const timestamp = new Date(`${value.replace(' ', 'T').replace(/Z$/, '')}Z`);
  if (Number.isNaN(timestamp.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
};

const toSlabItem = (record: SlabRecord): SlabItem => {
  const variety = varietyById(record.varietyId);
  const supplier = supplierById(record.supplierId);
  return {
    id: record.id,
    supplierId: record.supplierId,
    varietyId: record.varietyId,
    originId: record.originId,
    textureId: record.textureId,
    colorId: record.colorId,
    gradeId: record.gradeId,
    code: record.serialNo,
    image: record.mainImageUrl || '',
    scanImageUrl: record.scanImageUrl,
    designImageUrl: record.designImageUrl,
    videoUrl: record.videoUrl,
    videoCoverUrl: record.videoCoverUrl,
    name: record.name,
    size: formatSize(record),
    origin: record.originName || originById(record.originId)?.name || originById(variety?.originId)?.name || '-',
    texture: publishOptionLabel(publishOptions.textures, record.textureId),
    color: publishOptionLabel(colorOptions.value, record.colorId),
    grade: gradeLabelById(record.gradeId),
    tenant: record.supplierName || supplier?.name || (record.supplierId ? `供应商 #${record.supplierId}` : '平台自营'),
    store: record.warehouse || '-',
    publisherType: normalizePublisherType(record.publisherType),
    createdByName: record.createdByName?.trim() || '-',
    createdAt: formatDateTime(record.createdAt),
    price: {
      cost: record.costPrice == null ? '' : String(record.costPrice),
      guide: record.guidePrice == null ? '' : String(record.guidePrice),
      level1: '',
      level2: '',
      level3: '',
    },
    status: normalizeStatus(record.status),
    variety: record.varietyName || variety?.name || (record.varietyId ? `品种 #${record.varietyId}` : '-'),
    sku: record.serialNo,
    lengthMm: record.lengthMm,
    widthMm: record.widthMm,
    thicknessMm: record.thicknessMm,
    toleranceMm: record.toleranceMm,
    corner1LengthMm: record.corner1LengthMm,
    corner1WidthMm: record.corner1WidthMm,
    corner2LengthMm: record.corner2LengthMm,
    corner2WidthMm: record.corner2WidthMm,
    corner3LengthMm: record.corner3LengthMm,
    corner3WidthMm: record.corner3WidthMm,
    corner4LengthMm: record.corner4LengthMm,
    corner4WidthMm: record.corner4WidthMm,
    areaSquareMeter: record.areaSquareMeter,
    markupPrices: record.markupPrices,
  };
};

const toSlabPayload = (item: SlabItem, patch: Partial<SlabItem> = {}): SlabPayload => {
  const next = { ...item, ...patch };
  return {
    supplierId: next.supplierId,
    varietyId: next.varietyId,
    originId: next.originId,
    textureId: next.textureId,
    colorId: next.colorId,
    gradeId: next.gradeId,
    name: next.name,
    serialNo: next.code,
    warehouse: next.store === '-' ? undefined : next.store,
    publisherType: next.publisherType,
    mainImageUrl: next.image || undefined,
    scanImageUrl: next.scanImageUrl,
    designImageUrl: next.designImageUrl,
    videoUrl: next.videoUrl,
    videoCoverUrl: next.videoCoverUrl,
    lengthMm: next.lengthMm,
    widthMm: next.widthMm,
    thicknessMm: next.thicknessMm,
    toleranceMm: next.toleranceMm,
    corner1LengthMm: next.corner1LengthMm,
    corner1WidthMm: next.corner1WidthMm,
    corner2LengthMm: next.corner2LengthMm,
    corner2WidthMm: next.corner2WidthMm,
    corner3LengthMm: next.corner3LengthMm,
    corner3WidthMm: next.corner3WidthMm,
    corner4LengthMm: next.corner4LengthMm,
    corner4WidthMm: next.corner4WidthMm,
    areaSquareMeter: next.areaSquareMeter,
    costPrice: toNumber(next.price.cost),
    guidePrice: toNumber(next.price.guide),
    markupPrices: next.markupPrices,
    status: next.status,
  };
};

const upsertSlabItem = (record: SlabRecord) => {
  const nextItem = toSlabItem(record);
  const index = tableData.value.findIndex((item) => item.id === record.id);
  if (index >= 0) tableData.value[index] = nextItem;
  else tableData.value.unshift(nextItem);
  return nextItem;
};

const loadSlabs = async () => {
  loading.value = true;
  try {
    const [records, originsResult, varietiesResult, suppliersResult, publishOptionsResult, markupResult] =
      await Promise.all([
        listSlabs(),
        listSlabOrigins().catch(() => []),
        listSlabVarieties().catch(() => []),
        listSuppliers().catch(() => []),
        getSlabPublishOptions(),
        listSlabMarkupConfigurationOptions(),
      ]);
    slabOrigins.value = originsResult;
    slabVarieties.value = varietiesResult;
    slabSuppliers.value = suppliersResult;
    Object.assign(publishOptions, publishOptionsResult);
    markupConfigurations.value = markupResult;
    tableData.value = records.map(toSlabItem);
  } catch (error) {
    tableData.value = [];
    adminFeedback.actionError({ action: '加载大板数据', error, fallback: '请稍后重试' });
  } finally {
    loading.value = false;
  }
};

onMounted(loadSlabs);

const confirmState = reactive<{
  type: ConfirmType;
  row: SlabItem | null;
  content: string;
}>({
  type: 'shelf',
  row: null,
  content: '',
});
const confirmAction = computed(() => {
  const actionMap: Record<ConfirmType, string> = {
    shelf: '上架',
    delete: '删除',
    restore: '放回',
    reject: '驳回',
    savePrice: '保存价格',
    batchShelf: '批量上架',
    batchRestore: '批量放回',
    purge: '彻底删除',
    batchPurge: '批量彻底删除',
    clearRecycle: '清空回收站',
  };
  return actionMap[confirmState.type];
});
const confirmTitle = computed(() => {
  if (confirmState.type === 'restore') return '确认放回仓库';
  if (confirmState.type === 'batchRestore') return '确认批量放回仓库';
  return '';
});

const reasonState = reactive<{
  type: 'reject' | 'offShelf';
  row: SlabItem | null;
}>({
  type: 'reject',
  row: null,
});

const reasonForm = reactive({
  reason: '',
  detail: '',
});

const batchPriceRows = reactive<DrawerPriceRow[]>([]);
const priceDrawerForm = reactive({ rows: batchPriceRows });
const priceDrawerSize = computed(() => {
  const longestLabelLength = batchPriceRows.reduce((length, row) => Math.max(length, row.label.length), 0);
  return `${Math.max(620, longestLabelLength * 16 + 430)}px`;
});

const uploadItems: { key: UploadItemKey; title: string; label: string; required: boolean; accept: string }[] = [
  { key: 'main', title: '1:1主图', label: '点击上传图片', required: true, accept: 'image/*' },
  { key: 'scan', title: '扫描图', label: '点击上传图片', required: true, accept: 'image/*' },
  { key: 'design', title: '设计图', label: '点击上传图片', required: true, accept: 'image/*' },
  { key: 'video', title: '商品视频', label: '点击上传视频', required: false, accept: 'video/*' },
];

const cornerFields: { key: CornerFieldKey; label: string }[] = [
  { key: 'corner1Length', label: '扣角1长' },
  { key: 'corner1Width', label: '扣角1宽' },
  { key: 'corner2Length', label: '扣角2长' },
  { key: 'corner2Width', label: '扣角2宽' },
  { key: 'corner3Length', label: '扣角3长' },
  { key: 'corner3Width', label: '扣角3宽' },
  { key: 'corner4Length', label: '扣角4长' },
  { key: 'corner4Width', label: '扣角4宽' },
];

const salesPriceRows = computed(() =>
  markupConfigurations.value.map((item) => ({ id: item.id, label: item.name, markupRate: Number(item.markupRate) })),
);
const guidePriceRow = computed(() => salesPriceRows.value.find((item) => item.label === '指导价'));
const partnerPriceRows = computed(() => salesPriceRows.value.filter((item) => item.label !== '指导价'));
const guideRatioFieldName = computed(() =>
  guidePriceRow.value ? `markupPrices.${guidePriceRow.value.id}.ratio` : 'guideRatio',
);
const guidePriceFieldName = computed(() =>
  guidePriceRow.value ? `markupPrices.${guidePriceRow.value.id}.price` : 'guidePrice',
);

const isValidMeasurement = (value: unknown, required: boolean) => {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue) return !required;
  return /^(?:0\.\d{1,2}|[1-9]\d*(?:\.\d{1,2})?)$/.test(normalizedValue) && Number(normalizedValue) > 0;
};
const createOptionalMeasurementRule = (field: MeasurementField, label: string): FormRule => ({
  validator: (value) => !invalidMeasurementFields.has(field) && isValidMeasurement(value, false),
  message: `请输入正确的${label}`,
  type: 'error',
  trigger: 'blur',
});
const requiredSalesFieldRules = (message: string): FormRule[] => [
  { required: true, message, type: 'error', trigger: 'submit' },
];
const isValidSalesNumber = (value: unknown, minimum: number) => {
  const normalizedValue = String(value ?? '').trim();
  return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalizedValue) && Number(normalizedValue) >= minimum;
};
const salesNumberFieldRules = (label: string, minimum: number): FormRule[] => [
  { required: true, message: `请输入${label}`, type: 'error', trigger: 'submit' },
  {
    validator: (value) => Boolean(String(value ?? '').trim()),
    message: `请输入${label}`,
    type: 'error',
    trigger: 'blur',
  },
  {
    validator: (value) => !String(value ?? '').trim() || isValidSalesNumber(value, minimum),
    message: `请输入正确的${label}`,
    type: 'error',
    trigger: 'blur',
  },
];
const salesRules: Record<string, FormRule[]> = {
  supplier: requiredSalesFieldRules('请选择供应商'),
  stock: [
    { required: true, message: '请输入库存', type: 'error', trigger: 'submit' },
    {
      validator: (value) => Boolean(String(value ?? '').trim()),
      message: '请输入库存',
      type: 'error',
      trigger: 'blur',
    },
    {
      validator: (value) => !String(value ?? '').trim() || String(value).trim() !== '0',
      message: '库存不能为0',
      type: 'error',
      trigger: 'blur',
    },
    {
      validator: (value) => {
        const normalizedValue = String(value ?? '').trim();
        return !normalizedValue || normalizedValue === '0' || (!stockHasLeadingZero.value && /^[1-9]\d*$/.test(normalizedValue));
      },
      message: '请输入正确的库存',
      type: 'error',
      trigger: 'blur',
    },
    {
      validator: (value) => !String(value ?? '').trim() || String(value).trim() !== '0',
      message: '库存不能为0',
      type: 'error',
      trigger: 'submit',
    },
    {
      validator: (value) => {
        const normalizedValue = String(value ?? '').trim();
        return !normalizedValue || normalizedValue === '0' || (!stockHasLeadingZero.value && /^[1-9]\d*$/.test(normalizedValue));
      },
      message: '请输入正确的库存',
      type: 'error',
      trigger: 'submit',
    },
  ],
  sku: requiredSalesFieldRules('请输入SKU'),
  cost: salesNumberFieldRules('成本价', 0),
};
const stockInputProps = {
  onPaste: ({ e, pasteValue }: { e: ClipboardEvent; pasteValue: string }) => {
    if (!/^\d+$/.test(pasteValue)) e.preventDefault();
  },
};

const productRules: Record<string, FormRule[]> = {
  variety: [{ required: true, message: '请选择品种', type: 'error', trigger: 'submit' }],
  origin: [{ required: true, message: '请选择产地', type: 'error', trigger: 'submit' }],
  textureId: [{ required: true, message: '请选择纹理', type: 'error', trigger: 'submit' }],
  colorId: [{ required: true, message: '请选择色系', type: 'error', trigger: 'submit' }],
  gradeId: [{ required: true, message: '请选择等级', type: 'error', trigger: 'submit' }],
  length: [
    { required: true, message: '请输入长度', type: 'error', trigger: 'submit' },
    {
      validator: (value) => Boolean(String(value ?? '').trim()),
      message: '请输入长度',
      type: 'error',
      trigger: 'blur',
    },
    {
      validator: (value) => !String(value ?? '').trim() || isValidMeasurement(value, true),
      message: '请输入正确的长度',
      type: 'error',
      trigger: 'blur',
    },
  ],
  width: [
    { required: true, message: '请输入宽度', type: 'error', trigger: 'submit' },
    {
      validator: (value) => Boolean(String(value ?? '').trim()),
      message: '请输入宽度',
      type: 'error',
      trigger: 'blur',
    },
    {
      validator: (value) => !String(value ?? '').trim() || isValidMeasurement(value, true),
      message: '请输入正确的宽度',
      type: 'error',
      trigger: 'blur',
    },
  ],
  height: [
    { required: true, message: '请输入高度', type: 'error', trigger: 'submit' },
    {
      validator: (value) => Boolean(String(value ?? '').trim()),
      message: '请输入高度',
      type: 'error',
      trigger: 'blur',
    },
    {
      validator: (value) => !String(value ?? '').trim() || isValidMeasurement(value, true),
      message: '请输入正确的高度',
      type: 'error',
      trigger: 'blur',
    },
  ],
  tolerance: [createOptionalMeasurementRule('tolerance', '土误差')],
  ...Object.fromEntries(
    cornerFields.map((item) => [item.key, [createOptionalMeasurementRule(item.key, item.label)]]),
  ),
};

const columns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  const baseColumns: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'select', title: 'selectTitle', width: 48, align: 'center' },
    { colKey: 'image', title: '商品主图', width: 96, align: 'center' },
    { colKey: 'slab', title: '大板名称/ID/编码', minWidth: 220 },
    { colKey: 'variety', title: '品种', width: 140 },
    { colKey: 'origin', title: '产地', width: 110 },
    { colKey: 'texture', title: '纹理', width: 110 },
    { colKey: 'color', title: '色系', width: 110 },
    { colKey: 'grade', title: '等级', width: 160, align: 'center' },
    { colKey: 'size', title: '尺寸', width: 170 },
    { colKey: 'tenant', title: '供应商', width: 180 },
    { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
    { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
  ];

  baseColumns.push({ colKey: 'operation', title: '操作', width: 230, align: 'left', fixed: 'right' });

  return baseColumns;
});

const currentFilter = computed(() => filters[activeTab.value]);
const currentAppliedFilter = computed(() => appliedFilters[activeTab.value]);
const currentPagination = computed(() => paginations[activeTab.value]);
const selectedKeySet = computed(() => new Set(selectedKeys.value));
const currentPageIds = computed(() => pageData.value.map((item) => item.id));
const pageAllSelected = computed(
  () => currentPageIds.value.length > 0 && currentPageIds.value.every((id) => selectedKeySet.value.has(id)),
);
const pagePartiallySelected = computed(
  () => currentPageIds.value.some((id) => selectedKeySet.value.has(id)) && !pageAllSelected.value,
);
const priceDrawerReadonly = computed(() => activeTab.value === 'soldOut');
const productDialogTitle = computed(() => {
  if (productMode.value === 'create') return '发布商品';
  if (productMode.value === 'edit') return '编辑商品';
  return '查看商品';
});

const filteredData = computed(() => {
  const filter = currentAppliedFilter.value;
  return tableData.value.filter((item) => {
    const statusMatched = item.status === activeTab.value;
    const keyword = filter.keyword.trim().toLowerCase();
    const keywordMatched =
      !keyword ||
      String(item.id).includes(keyword) ||
      item.name.toLowerCase().includes(keyword) ||
      item.code.toLowerCase().includes(keyword);
    const varietyMatched = !filter.variety || item.variety === filter.variety;
    const originMatched = !filter.origin || item.origin === filter.origin;
    const textureMatched = !filter.texture || item.texture === filter.texture;
    const colorMatched = !filter.color || item.color === filter.color;
    const gradeMatched = !filter.grade || item.grade === filter.grade;
    const supplierKeyword = filter.supplier.trim().toLowerCase();
    const supplierMatched = !supplierKeyword || item.tenant.toLowerCase().includes(supplierKeyword);
    return (
      statusMatched &&
      keywordMatched &&
      varietyMatched &&
      originMatched &&
      textureMatched &&
      colorMatched &&
      gradeMatched &&
      supplierMatched
    );
  });
});

const pageData = computed(() => {
  const start = (currentPagination.value.current - 1) * currentPagination.value.pageSize;
  return filteredData.value.slice(start, start + currentPagination.value.pageSize);
});

const paginationTotal = computed(() => filteredData.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / currentPagination.value.pageSize), 1));
const batchButtons = computed(() => {
  const map: Record<
    SlabStatus,
    { label: string; action: BatchAction; theme: 'primary' | 'danger' | 'default'; icon: string; className?: string }[]
  > = {
    warehouse: [
      { label: '发布商品', action: 'publish', theme: 'primary', icon: 'add' },
      { label: '批量上架', action: 'batchShelf', theme: 'primary', icon: 'upload' },
    ],
    selling: [
      { label: '发布商品', action: 'publish', theme: 'primary', icon: 'add' },
      { label: '批量下架', action: 'batchOffShelf', theme: 'default', icon: 'download', className: 'brown-button' },
    ],
    offShelf: [{ label: '批量放回仓库', action: 'batchRestore', theme: 'primary', icon: 'rollback' }],
    soldOut: [],
    recycle: [
      { label: '批量放回仓库', action: 'batchRestore', theme: 'primary', icon: 'rollback' },
      { label: '批量彻底删除', action: 'batchPurge', theme: 'danger', icon: 'delete', className: 'dark-red-button' },
      { label: '清空回收站', action: 'clearRecycle', theme: 'danger', icon: 'clear' },
    ],
  };
  return map[activeTab.value];
});

const tabLabel = (tab: { label: string; value: SlabStatus }) => {
  const count = tableData.value.filter((item) => item.status === tab.value).length;
  return count ? `${tab.label} ${count}` : tab.label;
};

const rowActions = (
  row: SlabItem,
): { label: string; action: RowAction; theme: 'primary' | 'warning' | 'danger' | 'default' }[] => {
  if (activeTab.value === 'warehouse') {
    if (row.publisherType === '接口获取') {
      return [
        { label: '价格', action: 'price', theme: 'primary' },
        { label: '上架', action: 'shelf', theme: 'primary' },
        { label: '编辑', action: 'edit', theme: 'primary' },
        { label: '驳回', action: 'reject', theme: 'warning' },
      ];
    }
    return [
      { label: '价格', action: 'price', theme: 'primary' },
      { label: '上架', action: 'shelf', theme: 'primary' },
      { label: '编辑', action: 'edit', theme: 'primary' },
      { label: '删除', action: 'delete', theme: 'danger' },
    ];
  }
  if (activeTab.value === 'selling') {
    const actions: { label: string; action: RowAction; theme: 'primary' | 'warning' | 'danger' | 'default' }[] =
      row.publisherType === '接口获取'
        ? [
            { label: '价格', action: 'price', theme: 'primary' },
            { label: '编辑', action: 'edit', theme: 'primary' },
            { label: '驳回', action: 'reject', theme: 'warning' },
          ]
        : [
            { label: '价格', action: 'price', theme: 'primary' },
            { label: '下架', action: 'offShelf', theme: 'warning' },
          ];
    if (row.publisherType === '平台发布') {
      actions.push(
        { label: '编辑', action: 'edit', theme: 'primary' },
        { label: '删除', action: 'delete', theme: 'danger' },
      );
    }
    return actions;
  }
  if (activeTab.value === 'offShelf') {
    return [
      { label: '价格', action: 'price', theme: 'primary' },
      { label: '放回仓库', action: 'restore', theme: 'primary' },
      { label: '编辑', action: 'edit', theme: 'primary' },
      { label: '删除', action: 'delete', theme: 'danger' },
    ];
  }
  if (activeTab.value === 'soldOut') {
    return [{ label: '价格', action: 'price', theme: 'primary' }];
  }
  return [
    { label: '价格', action: 'price', theme: 'primary' },
    { label: '放回仓库', action: 'restore', theme: 'primary' },
    { label: '彻底删除', action: 'purge', theme: 'danger' },
  ];
};

const handleTabChange = () => {
  selectedKeys.value = [];
  ensureCurrentPage();
};

const handleSearch = () => {
  Object.assign(currentAppliedFilter.value, currentFilter.value);
  currentPagination.value.current = 1;
};

const handleReset = () => {
  Object.assign(currentFilter.value, makeFilterState());
  handleSearch();
};

const ensureCurrentPage = () => {
  if (currentPagination.value.current > pageCount.value) {
    currentPagination.value.current = pageCount.value;
  }
};

const toggleRow = (id: number, checked: boolean) => {
  if (checked) {
    selectedKeys.value = Array.from(new Set([...selectedKeys.value, id]));
  } else {
    selectedKeys.value = selectedKeys.value.filter((item) => item !== id);
  }
};

const toggleCurrentPage = (checked: boolean) => {
  if (checked) {
    selectedKeys.value = Array.from(new Set([...selectedKeys.value, ...currentPageIds.value]));
    return;
  }
  selectedKeys.value = selectedKeys.value.filter((id) => !currentPageIds.value.includes(id));
};

const toNumber = (value: string) => {
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatPrice = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const formatRatio = (value: number) => value.toFixed(2);

const calculateProductPrice = (configurationId: number) => {
  const cost = toNumber(productForm.cost);
  const editor = productForm.markupPrices[configurationId];
  const ratio = toNumber(editor?.ratio ?? '');
  if (
    !editor ||
    !isValidSalesNumber(productForm.cost, 0) ||
    !isValidSalesNumber(editor.ratio, 0)
  )
    return;
  editor.price = formatPrice(cost * ratio);
  clearSalesFieldError(`markupPrices.${configurationId}.price`);
};

const calculateProductRatio = (configurationId: number) => {
  const cost = toNumber(productForm.cost);
  const editor = productForm.markupPrices[configurationId];
  const price = toNumber(editor?.price ?? '');
  if (
    !editor ||
    !isValidSalesNumber(productForm.cost, 0) ||
    !isValidSalesNumber(editor.price, 0) ||
    !cost
  )
    return;
  editor.ratio = formatRatio(price / cost);
};

const calculateGuidePrice = () => {
  if (guidePriceRow.value) {
    calculateProductPrice(guidePriceRow.value.id);
    return;
  }
  const cost = toNumber(productForm.cost);
  const ratio = toNumber(productForm.guideRatio);
  if (!isValidSalesNumber(productForm.cost, 0) || !isValidSalesNumber(productForm.guideRatio, 0)) return;
  productForm.guidePrice = formatPrice(cost * ratio);
  clearSalesFieldError('guidePrice');
};

const calculateGuideRatio = () => {
  if (guidePriceRow.value) {
    calculateProductRatio(guidePriceRow.value.id);
    return;
  }
  const cost = toNumber(productForm.cost);
  const price = toNumber(productForm.guidePrice);
  if (!isValidSalesNumber(productForm.cost, 0) || !isValidSalesNumber(productForm.guidePrice, 0)) return;
  if (!cost) return;
  productForm.guideRatio = formatRatio(price / cost);
};

const recalculateProductPrices = () => {
  calculateGuidePrice();
  partnerPriceRows.value.forEach((item) => calculateProductPrice(item.id));
};

const initializeProductMarkupPrices = (prices: SlabPrice[] = []) => {
  const existingById = new Map(prices.map((item) => [item.markupConfigurationId, item]));
  productForm.markupPrices = Object.fromEntries(
    salesPriceRows.value.map((item) => {
      const existing = existingById.get(item.id);
      const ratio = existing ? 1 + Number(existing.markupRate) / 100 : 1 + item.markupRate / 100;
      return [item.id, { ratio: formatRatio(ratio), price: existing ? String(existing.price) : '' }];
    }),
  );
};

const calculateBatchPrice = (row: DrawerPriceRow) => {
  const costValue = batchPriceRows[0]?.price ?? '';
  const cost = toNumber(costValue);
  const ratio = toNumber(row.ratio);
  if (!isValidSalesNumber(costValue, 0) || !isValidSalesNumber(row.ratio, 0)) return;
  row.price = formatPrice(cost * ratio);
};

const calculateBatchRatio = (row: DrawerPriceRow) => {
  const costValue = batchPriceRows[0]?.price ?? '';
  const cost = toNumber(costValue);
  const price = toNumber(row.price);
  if (!isValidSalesNumber(costValue, 0) || !isValidSalesNumber(row.price, 0) || !cost) return;
  row.ratio = (price / cost).toFixed(2);
};

const clearPriceDrawerFieldError = (field: string) => {
  priceDrawerFormRef.value?.clearValidate([field]);
};

const handleBatchCostChange = (_value?: unknown, context?: SalesNumberChangeContext) => {
  if (context?.type === 'props') return;
  const costRow = batchPriceRows[0];
  if (!costRow) return;
  if (String(costRow.price ?? '').trim()) clearPriceDrawerFieldError('rows.0.price');
  if (!String(costRow.price ?? '').trim()) {
    batchPriceRows.slice(1).forEach((row, index) => {
      row.price = '';
      clearPriceDrawerFieldError(`rows.${index + 1}.price`);
    });
    return;
  }
  if (!isValidSalesNumber(costRow.price, 0)) return;
  batchPriceRows.slice(1).forEach((row, index) => {
    calculateBatchPrice(row);
    clearPriceDrawerFieldError(`rows.${index + 1}.price`);
  });
};

const handleBatchRatioChange = (
  index: number,
  _value?: unknown,
  context?: SalesNumberChangeContext,
) => {
  if (context?.type === 'props') return;
  const row = batchPriceRows[index];
  if (!row) return;
  const field = `rows.${index}.ratio`;
  if (!String(row.ratio ?? '').trim() || isValidSalesNumber(row.ratio, 0)) clearPriceDrawerFieldError(field);
  calculateBatchPrice(row);
  if (String(row.price ?? '').trim()) clearPriceDrawerFieldError(`rows.${index}.price`);
};

const handleBatchPriceChange = (
  index: number,
  _value?: unknown,
  context?: SalesNumberChangeContext,
) => {
  if (context?.type === 'props') return;
  const row = batchPriceRows[index];
  if (!row) return;
  if (String(row.price ?? '').trim()) clearPriceDrawerFieldError(`rows.${index}.price`);
  if (index === 0) {
    handleBatchCostChange(_value, context);
    return;
  }
  calculateBatchRatio(row);
  if (String(row.ratio ?? '').trim()) clearPriceDrawerFieldError(`rows.${index}.ratio`);
};

const fillPriceRows = (row: SlabItem) => {
  const snapshots = row.markupPrices ?? [];
  const snapshotsByConfigurationId = new Map(
    snapshots.map((item) => [item.markupConfigurationId, item]),
  );
  const guideConfiguration = markupConfigurations.value.find((configuration) => configuration.name === '指导价');
  const guideSnapshot = guideConfiguration
    ? snapshotsByConfigurationId.get(guideConfiguration.id)
    : snapshots.find(
        (price) => markupConfigurations.value.find((item) => item.id === price.markupConfigurationId)?.name === '指导价',
      );
  const cost = toNumber(row.price.cost);
  const guidePrice = guideSnapshot ? String(guideSnapshot.price) : row.price.guide;
  const guideRatio = guideSnapshot
    ? formatRatio(1 + Number(guideSnapshot.markupRate) / 100)
    : cost && guidePrice
      ? formatRatio(toNumber(guidePrice) / cost)
      : '1.60';
  const configuredRows: DrawerPriceRow[] = markupConfigurations.value
    .filter((configuration) => configuration.id !== guideConfiguration?.id)
    .map((configuration) => {
      const snapshot = snapshotsByConfigurationId.get(configuration.id);
      return {
        configurationId: configuration.id,
        label: configuration.name,
        ratio: snapshot
          ? formatRatio(1 + Number(snapshot.markupRate) / 100)
          : formatRatio(1 + Number(configuration.markupRate) / 100),
        price: snapshot ? String(snapshot.price) : cost ? formatPrice(cost * (1 + Number(configuration.markupRate) / 100)) : '',
      };
    });
  const unconfiguredRows: DrawerPriceRow[] = snapshots
    .filter(
      (snapshot) =>
        snapshot !== guideSnapshot &&
        !markupConfigurations.value.some((item) => item.id === snapshot.markupConfigurationId),
    )
    .map((snapshot) => ({
      configurationId: snapshot.markupConfigurationId,
      label: `价格项 #${snapshot.markupConfigurationId}`,
      ratio: formatRatio(1 + Number(snapshot.markupRate) / 100),
      price: String(snapshot.price),
    }));
  const priceRows: DrawerPriceRow[] = [
    { label: '成本价', ratio: '1.00', price: row.price.cost },
    {
      configurationId: guideConfiguration?.id,
      label: '指导价',
      ratio: guideRatio,
      price: guidePrice,
    },
    ...configuredRows,
    ...unconfiguredRows,
  ];
  batchPriceRows.splice(0, batchPriceRows.length, ...priceRows);
};

const openTableImage = (row: SlabItem) => {
  if (!row.image) return;
  uploadPreviewTitle.value = `${row.name} - 商品主图`;
  uploadPreviewUrl.value = row.image;
  uploadPreviewType.value = 'image';
  uploadPreviewDialogVisible.value = true;
};

const openPriceDrawer = (row: SlabItem) => {
  priceDrawerRowId.value = row.id;
  priceDrawerVisible.value = true;
  try {
    fillPriceRows(row);
  } catch (error) {
    adminFeedback.actionError({ action: '加载价格数据', error, fallback: '请稍后重试', target: row.name });
  }
  nextTick(() => priceDrawerFormRef.value?.clearValidate());
};

const resetProductForm = () => {
  Object.assign(productForm, makeProductForm());
  initializeProductMarkupPrices();
};

const fillProductForm = (row: SlabItem) => {
  Object.assign(productForm, {
    variety: row.variety,
    origin: row.origin,
    textureId: row.textureId,
    colorId: row.colorId,
    gradeId: row.gradeId,
    length: row.lengthMm == null ? '' : String(row.lengthMm),
    width: row.widthMm == null ? '' : String(row.widthMm),
    height: row.thicknessMm == null ? '' : String(row.thicknessMm),
    tolerance: row.toleranceMm == null ? '' : String(row.toleranceMm),
    corner1Length: row.corner1LengthMm == null ? '' : String(row.corner1LengthMm),
    corner1Width: row.corner1WidthMm == null ? '' : String(row.corner1WidthMm),
    corner2Length: row.corner2LengthMm == null ? '' : String(row.corner2LengthMm),
    corner2Width: row.corner2WidthMm == null ? '' : String(row.corner2WidthMm),
    corner3Length: row.corner3LengthMm == null ? '' : String(row.corner3LengthMm),
    corner3Width: row.corner3WidthMm == null ? '' : String(row.corner3WidthMm),
    corner4Length: row.corner4LengthMm == null ? '' : String(row.corner4LengthMm),
    corner4Width: row.corner4WidthMm == null ? '' : String(row.corner4WidthMm),
    supplier: row.tenant,
    cost: row.price.cost,
    stock: row.status === 'soldOut' ? '0' : '1',
    sku: row.sku,
    guideRatio: '1.60',
    guidePrice: row.price.guide,
    level1Ratio: '1.45',
    level1Price: row.price.level1,
    level2Ratio: '1.30',
    level2Price: row.price.level2,
    level3Ratio: '1.18',
    level3Price: row.price.level3,
  });
  initializeProductMarkupPrices(row.markupPrices);
};

const openProductDialog = (mode: ProductMode, row?: SlabItem) => {
  if (pendingUploadedUrls.size) {
    const staleUrls = [...pendingUploadedUrls];
    pendingUploadedUrls.clear();
    void Promise.allSettled(staleUrls.map((url) => deleteUnreferencedSlabImage(url)));
  }
  productMode.value = mode;
  productTab.value = mode === 'view' ? 'sales' : 'images';
  editingRowId.value = row?.id ?? null;
  resetProductForm();
  Object.keys(uploadPreviews).forEach((key) => {
    const uploadKey = key as UploadItemKey;
    const videoUrl = uploadPreviews[uploadKey]?.videoUrl;
    if (videoUrl?.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
    delete uploadPreviews[uploadKey];
  });
  Object.keys(uploadErrors).forEach((key) => delete uploadErrors[key as UploadItemKey]);
  uploadPreviewDialogVisible.value = false;
  uploadPreviewTitle.value = '';
  uploadPreviewUrl.value = '';
  uploadPreviewType.value = 'image';
  invalidMeasurementFields.clear();
  stockHasLeadingZero.value = false;
  if (row) fillProductForm(row);
  if (row?.image) {
    uploadPreviews.main = { name: '商品主图', url: row.image };
  }
  if (row?.scanImageUrl) {
    uploadPreviews.scan = { name: '扫描图', url: row.scanImageUrl };
  }
  if (row?.designImageUrl) {
    uploadPreviews.design = { name: '设计图', url: row.designImageUrl };
  }
  if (row?.videoUrl) {
    uploadPreviews.video = {
      name: '商品视频',
      videoUrl: row.videoUrl,
      coverUrl: row.videoCoverUrl,
    };
  }
  productDialogVisible.value = true;
};

const closeProductDialog = () => {
  productDialogVisible.value = false;
  productFormRef.value?.clearValidate();
  salesFormRef.value?.clearValidate();
  const abandonedUrls = [...pendingUploadedUrls];
  pendingUploadedUrls.clear();
  if (abandonedUrls.length) {
    void Promise.allSettled(abandonedUrls.map((url) => deleteUnreferencedSlabImage(url)));
  }
};

const clearProductFieldError = (field: keyof ProductForm) => {
  productFormRef.value?.clearValidate([field]);
};

const clearSalesFieldError = (field: string) => {
  salesFormRef.value?.clearValidate([field]);
};

const handleStockChange = (value?: unknown, context?: SalesNumberChangeContext) => {
  if (context?.type === 'props' || context?.type === 'blur') return;
  const normalizedValue = String(value ?? '').trim();
  stockHasLeadingZero.value = /^0\d+/.test(normalizedValue);
  clearSalesFieldError('stock');
};

const handleStockKeydown = (_value?: unknown, context?: { e?: KeyboardEvent }) => {
  const event = context?.e;
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return;
  const allowedKeys = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (/^\d$/.test(event.key) || allowedKeys.includes(event.key)) return;
  event.preventDefault();
};

const clearSalesNumberFieldError = (field: string, value: unknown, minimum: number) => {
  if (!String(value ?? '').trim() || isValidSalesNumber(value, minimum)) clearSalesFieldError(field);
};

const handleCostChange = (_value?: unknown, context?: SalesNumberChangeContext) => {
  if (context?.type === 'props') return;
  if (String(productForm.cost ?? '').trim()) clearSalesFieldError('cost');
  if (!String(productForm.cost ?? '').trim()) {
    productForm.guidePrice = '';
    clearSalesFieldError('guidePrice');
    Object.entries(productForm.markupPrices).forEach(([configurationId, editor]) => {
      editor.price = '';
      clearSalesFieldError(`markupPrices.${configurationId}.price`);
    });
    return;
  }
  if (!isValidSalesNumber(productForm.cost, 0)) return;
  recalculateProductPrices();
};

const handleGuideRatioChange = (_value?: unknown, context?: SalesNumberChangeContext) => {
  if (context?.type === 'props') return;
  const value = guidePriceRow.value
    ? productForm.markupPrices[guidePriceRow.value.id]?.ratio
    : productForm.guideRatio;
  clearSalesNumberFieldError(guideRatioFieldName.value, value, 0);
  calculateGuidePrice();
};

const handleGuidePriceChange = (_value?: unknown, context?: SalesNumberChangeContext) => {
  if (context?.type === 'props') return;
  const value = guidePriceRow.value
    ? productForm.markupPrices[guidePriceRow.value.id]?.price
    : productForm.guidePrice;
  if (String(value ?? '').trim()) clearSalesFieldError(guidePriceFieldName.value);
  calculateGuideRatio();
};

const handlePartnerRatioChange = (
  configurationId: number,
  _value?: unknown,
  context?: SalesNumberChangeContext,
) => {
  if (context?.type === 'props') return;
  clearSalesNumberFieldError(
    `markupPrices.${configurationId}.ratio`,
    productForm.markupPrices[configurationId]?.ratio,
    0,
  );
  calculateProductPrice(configurationId);
};

const handlePartnerPriceChange = (
  configurationId: number,
  _value?: unknown,
  context?: SalesNumberChangeContext,
) => {
  if (context?.type === 'props') return;
  const field = `markupPrices.${configurationId}.price`;
  if (String(productForm.markupPrices[configurationId]?.price ?? '').trim()) clearSalesFieldError(field);
  calculateProductRatio(configurationId);
};

const handleMeasurementChange = (field: MeasurementField) => {
  const value = String(productForm[field] ?? '').trim();
  if (!value || isValidMeasurement(value, true)) {
    invalidMeasurementFields.delete(field);
    clearProductFieldError(field);
  }
};

const handleMeasurementBlur = async (field: MeasurementField) => {
  const value = String(productForm[field] ?? '').trim();
  if (!value) {
    invalidMeasurementFields.delete(field);
    if (field === 'length' || field === 'width' || field === 'height') {
      await productFormRef.value?.validate({ fields: [field], trigger: 'blur', showErrorMessage: true });
    } else {
      clearProductFieldError(field);
    }
    return;
  }
  if (isValidMeasurement(value, true)) return;
  invalidMeasurementFields.add(field);
  await nextTick();
  await productFormRef.value?.validate({
    fields: [field],
    trigger: 'blur',
    showErrorMessage: true,
  });
};

const handleProductSubmit = async () => {
  if (productMode.value === 'view') {
    closeProductDialog();
    return;
  }
  const missingRequiredUploads = uploadItems.filter((item) => item.required && !uploadPreviews[item.key]);
  uploadItems.forEach((item) => {
    uploadErrors[item.key] = missingRequiredUploads.some((missingItem) => missingItem.key === item.key);
  });
  if (missingRequiredUploads.length > 0) {
    productTab.value = 'images';
    adminFeedback.warning('请上传必填图片');
    return;
  }
  const hasInvalidBaseInformation =
    !productForm.variety ||
    !productForm.origin ||
    productForm.textureId == null ||
    productForm.colorId == null ||
    productForm.gradeId == null ||
    !String(productForm.length ?? '').trim() ||
    !String(productForm.width ?? '').trim() ||
    !String(productForm.height ?? '').trim() ||
    !isValidMeasurement(productForm.length, true) ||
    !isValidMeasurement(productForm.width, true) ||
    !isValidMeasurement(productForm.height, true) ||
    !isValidMeasurement(productForm.tolerance, false) ||
    cornerFields.some((item) => !isValidMeasurement(productForm[item.key], false)) ||
    invalidMeasurementFields.size > 0;
  if (hasInvalidBaseInformation) {
    productTab.value = 'base';
    await nextTick();
    await productFormRef.value?.validate({ trigger: 'all', showErrorMessage: true });
    adminFeedback.warning('请完善基础信息');
    return;
  }
  const normalizedStock = String(productForm.stock ?? '').trim();
  const hasInvalidSalesPrice = salesPriceRows.value.some((item) => {
    const editor = productForm.markupPrices[item.id];
    return !editor || !isValidSalesNumber(editor.ratio, 0) || !isValidSalesNumber(editor.price, 0);
  });
  const hasInvalidGuidePrice =
    !guidePriceRow.value &&
    (!isValidSalesNumber(productForm.guideRatio, 0) || !isValidSalesNumber(productForm.guidePrice, 0));
  const hasInvalidSalesInformation =
    !String(productForm.supplier ?? '').trim() ||
    !String(productForm.sku ?? '').trim() ||
    !isValidSalesNumber(productForm.cost, 0) ||
    stockHasLeadingZero.value ||
    !/^[1-9]\d*$/.test(normalizedStock) ||
    hasInvalidSalesPrice ||
    hasInvalidGuidePrice;
  if (hasInvalidSalesInformation) {
    productTab.value = 'sales';
    await nextTick();
    await salesFormRef.value?.validate({ trigger: 'all', showErrorMessage: true });
    adminFeedback.warning(
      normalizedStock === '0'
        ? '库存不能为0'
        : stockHasLeadingZero.value || (normalizedStock && !/^[1-9]\d*$/.test(normalizedStock))
          ? '请输入正确的库存'
          : '请完善销售信息',
    );
    return;
  }
  const targetName = `${productForm.variety}大板`;
  const editingItem =
    editingRowId.value == null ? undefined : tableData.value.find((item) => item.id === editingRowId.value);
  const lengthMm = toNumber(productForm.length);
  const widthMm = toNumber(productForm.width);
  const thicknessMm = toNumber(productForm.height);
  const payload: SlabPayload = {
    supplierId: supplierIdByName(productForm.supplier) ?? editingItem?.supplierId,
    varietyId: varietyIdByName(productForm.variety),
    originId: originIdByName(productForm.origin),
    textureId: productForm.textureId,
    colorId: productForm.colorId,
    gradeId: productForm.gradeId,
    name: targetName,
    serialNo: productForm.sku.trim() || editingItem?.code || `SLAB-${Date.now()}`,
    warehouse: editingItem?.store && editingItem.store !== '-' ? editingItem.store : '平台仓',
    publisherType: editingItem?.publisherType || '平台发布',
    mainImageUrl: uploadPreviews.main?.url,
    scanImageUrl: uploadPreviews.scan?.url,
    designImageUrl: uploadPreviews.design?.url,
    videoUrl: uploadPreviews.video?.videoUrl,
    videoCoverUrl: uploadPreviews.video?.coverUrl,
    lengthMm,
    widthMm,
    thicknessMm,
    toleranceMm: productForm.tolerance ? toNumber(productForm.tolerance) : undefined,
    corner1LengthMm: productForm.corner1Length ? toNumber(productForm.corner1Length) : undefined,
    corner1WidthMm: productForm.corner1Width ? toNumber(productForm.corner1Width) : undefined,
    corner2LengthMm: productForm.corner2Length ? toNumber(productForm.corner2Length) : undefined,
    corner2WidthMm: productForm.corner2Width ? toNumber(productForm.corner2Width) : undefined,
    corner3LengthMm: productForm.corner3Length ? toNumber(productForm.corner3Length) : undefined,
    corner3WidthMm: productForm.corner3Width ? toNumber(productForm.corner3Width) : undefined,
    corner4LengthMm: productForm.corner4Length ? toNumber(productForm.corner4Length) : undefined,
    corner4WidthMm: productForm.corner4Width ? toNumber(productForm.corner4Width) : undefined,
    areaSquareMeter: lengthMm && widthMm ? Number(((lengthMm * widthMm) / 1_000_000).toFixed(2)) : undefined,
    costPrice: toNumber(productForm.cost),
    guidePrice: guidePriceRow.value
      ? toNumber(productForm.markupPrices[guidePriceRow.value.id]?.price ?? '')
      : toNumber(productForm.guidePrice),
    markupPrices: salesPriceRows.value.map((item) => ({
      markupConfigurationId: item.id,
      markupRate: Number(((toNumber(productForm.markupPrices[item.id].ratio) - 1) * 100).toFixed(4)),
      costPrice: toNumber(productForm.cost),
      price: toNumber(productForm.markupPrices[item.id].price),
      variantKey: '',
    })),
    status: editingItem?.status || 'warehouse',
  };

  saving.value = true;
  try {
    if (productMode.value === 'edit' && editingItem) {
      upsertSlabItem(await updateSlab(editingItem.id, payload));
    } else {
      upsertSlabItem(await createSlab(payload));
      activeTab.value = 'warehouse';
      paginations.warehouse.current = 1;
    }
    pendingUploadedUrls.clear();
    closeProductDialog();
    if (productMode.value === 'create') adminFeedback.created(targetName);
    else adminFeedback.actionSuccess({ action: '保存', target: targetName });
  } catch (error) {
    adminFeedback.actionError({
      action: productMode.value === 'create' ? '新增' : '保存',
      error,
      fallback: '请稍后重试',
      target: targetName,
    });
  } finally {
    saving.value = false;
  }
};

const createVideoCover = (videoUrl: string) =>
  new Promise<Blob>((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      const canvas = document.createElement('canvas');
      const maxWidth = 640;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('视频封面生成失败'));
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('视频封面生成失败'));
      }, 'image/jpeg', 0.85);
    };
    video.onerror = () => reject(new Error('视频读取失败'));
    video.src = videoUrl;
    video.load();
  });

const handleDirectUpload = async (item: (typeof uploadItems)[number], event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  let nextVideoUrl: string | undefined;
  try {
    const previousPreview = uploadPreviews[item.key];
    const previousVideoUrl = previousPreview?.videoUrl;
    if (file.type.startsWith('video/')) {
      nextVideoUrl = URL.createObjectURL(file);
      const cover = await createVideoCover(nextVideoUrl);
      const uploadedVideo = await uploadSlabImage(file);
      pendingUploadedUrls.add(uploadedVideo.url);
      let uploadedCover;
      try {
        uploadedCover = await uploadSlabImage(new File([cover], `${file.name}-cover.jpg`, { type: 'image/jpeg' }));
        pendingUploadedUrls.add(uploadedCover.url);
      } catch (error) {
        pendingUploadedUrls.delete(uploadedVideo.url);
        void deleteUnreferencedSlabImage(uploadedVideo.url);
        throw error;
      }
      uploadPreviews[item.key] = {
        name: file.name,
        videoUrl: uploadedVideo.url,
        coverUrl: uploadedCover.url,
      };
    } else {
      const uploaded = await uploadSlabImage(file);
      pendingUploadedUrls.add(uploaded.url);
      uploadPreviews[item.key] = { name: file.name, url: uploaded.url };
    }
    const replacedPendingUrls = [previousPreview?.url, previousPreview?.videoUrl, previousPreview?.coverUrl].filter(
      (url): url is string => Boolean(url && pendingUploadedUrls.has(url)),
    );
    replacedPendingUrls.forEach((url) => pendingUploadedUrls.delete(url));
    if (replacedPendingUrls.length) {
      void Promise.allSettled(replacedPendingUrls.map((url) => deleteUnreferencedSlabImage(url)));
    }
    if (previousVideoUrl?.startsWith('blob:')) URL.revokeObjectURL(previousVideoUrl);
    if (nextVideoUrl) URL.revokeObjectURL(nextVideoUrl);
    uploadErrors[item.key] = false;
    adminFeedback.actionSuccess({ action: '上传', target: item.title });
  } catch (error) {
    if (nextVideoUrl) URL.revokeObjectURL(nextVideoUrl);
    adminFeedback.actionError({ action: '上传', error, fallback: '请稍后重试', target: item.title });
  } finally {
    input.value = '';
  }
};

const openUploadPreview = (item: (typeof uploadItems)[number]) => {
  const preview = uploadPreviews[item.key];
  const previewUrl = preview?.videoUrl || preview?.url;
  if (!previewUrl) return;
  uploadPreviewTitle.value = item.title;
  uploadPreviewUrl.value = previewUrl;
  uploadPreviewType.value = preview?.videoUrl ? 'video' : 'image';
  uploadPreviewDialogVisible.value = true;
};

const removeUpload = (key: UploadItemKey) => {
  const removedPreview = uploadPreviews[key];
  const removedUrl = removedPreview?.videoUrl || removedPreview?.url;
  delete uploadPreviews[key];
  const removedPendingUrls = [removedPreview?.url, removedPreview?.videoUrl, removedPreview?.coverUrl].filter(
    (url): url is string => Boolean(url && pendingUploadedUrls.has(url)),
  );
  removedPendingUrls.forEach((url) => pendingUploadedUrls.delete(url));
  if (removedPendingUrls.length) {
    void Promise.allSettled(removedPendingUrls.map((url) => deleteUnreferencedSlabImage(url)));
  }
  uploadErrors[key] = false;
  if (removedUrl && uploadPreviewUrl.value === removedUrl) {
    uploadPreviewDialogVisible.value = false;
    uploadPreviewTitle.value = '';
    uploadPreviewUrl.value = '';
    uploadPreviewType.value = 'image';
  }
  if (removedPreview?.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(removedPreview.videoUrl);
};

const updateSlabStatus = async (id: number, status: SlabStatus) => {
  const item = tableData.value.find((candidate) => candidate.id === id);
  if (!item) return;
  await updateSlabStatuses([id], status);
  item.status = status;
};

const updateSelectedSlabStatuses = async (status: SlabStatus) => {
  const selectedIds = [...selectedKeys.value];
  await updateSlabStatuses(selectedIds, status);
  const selectedIdSet = new Set(selectedIds);
  tableData.value.forEach((item) => {
    if (selectedIdSet.has(item.id)) item.status = status;
  });
};

const handleBatchAction = async (action: BatchAction) => {
  if (action === 'publish') {
    openProductDialog('create');
    return;
  }
  if (action === 'batchShelf') {
    if (!selectedKeys.value.length) {
      adminFeedback.warning('请先选择大板');
      return;
    }
    openConfirm('batchShelf', null, '是否批量上架所选大板？');
    return;
  }
  if (action === 'batchOffShelf') {
    if (!selectedKeys.value.length) {
      adminFeedback.warning('请先选择大板');
      return;
    }
    const selectedCount = selectedKeys.value.length;
    saving.value = true;
    try {
      await updateSelectedSlabStatuses('offShelf');
      selectedKeys.value = [];
      adminFeedback.actionSuccess({ action: '批量下架', target: `${selectedCount} 个大板` });
    } catch (error) {
      adminFeedback.actionError({
        action: '批量下架',
        error,
        fallback: '请稍后重试',
        target: `${selectedCount} 个大板`,
      });
    } finally {
      saving.value = false;
    }
    return;
  }
  if (action === 'batchRestore') {
    if (!selectedKeys.value.length) {
      adminFeedback.warning('请先选择大板');
      return;
    }
    openConfirm('batchRestore', null, '是否批量放回仓库？');
    return;
  }
  if (action === 'batchPurge') {
    if (!selectedKeys.value.length) {
      adminFeedback.warning('请先选择大板');
      return;
    }
    openConfirm('batchPurge', null, '彻底删除后无法恢复，是否批量彻底删除所选大板？');
    return;
  }
  openConfirm('clearRecycle', null, '清空后所有回收站大板将无法恢复，是否清空回收站？');
};

const handleRowAction = (action: RowAction, row: SlabItem) => {
  if (action === 'price') openPriceDrawer(row);
  if (action === 'edit') openProductDialog('edit', row);
  if (action === 'shelf') openConfirm('shelf', row, `是否上架大板“${row.name}”？`);
  if (action === 'delete') openConfirm('delete', row, `是否删除大板“${row.name}”？`);
  if (action === 'restore') openConfirm('restore', row, `是否放回仓库“${row.name}”？`);
  if (action === 'purge') openConfirm('purge', row, `彻底删除后无法恢复，是否彻底删除大板“${row.name}”？`);
  if (action === 'reject') openReasonDialog('reject', row);
  if (action === 'offShelf') openReasonDialog('offShelf', row);
};

const openConfirm = (type: ConfirmType, row: SlabItem | null, content: string) => {
  confirmState.type = type;
  confirmState.row = row;
  confirmState.content = content;
  confirmDialogVisible.value = true;
};

const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
  confirmState.row = null;
};

const handleConfirmSubmit = async () => {
  const type = confirmState.type;
  const row = confirmState.row;
  const selectedCount = selectedKeys.value.length;
  const recycleIds = tableData.value.filter((item) => item.status === 'recycle').map((item) => item.id);
  saving.value = true;
  try {
    if (type === 'shelf' && row) await updateSlabStatus(row.id, 'selling');
    if (type === 'delete' && row) await updateSlabStatus(row.id, 'recycle');
    if (type === 'restore' && row) await updateSlabStatus(row.id, 'warehouse');
    if (type === 'reject' && row) await updateSlabStatus(row.id, 'recycle');
    if (type === 'savePrice' && row) {
      const costPrice = toNumber(batchPriceRows[0]?.price ?? '');
      const nextMarkupPrices: SlabPrice[] = batchPriceRows
        .slice(1)
        .filter((item): item is DrawerPriceRow & { configurationId: number } => item.configurationId != null)
        .map((item) => ({
          markupConfigurationId: item.configurationId,
          markupRate: Number(((toNumber(item.ratio) - 1) * 100).toFixed(4)),
          costPrice,
          price: toNumber(item.price),
          variantKey: '',
        }));
      const guidePrice = batchPriceRows.find((item) => item.label === '指导价')?.price;
      const nextPrice = {
        cost: String(costPrice),
        guide: guidePrice == null ? row.price.guide : String(toNumber(guidePrice)),
        level1: row.price.level1,
        level2: row.price.level2,
        level3: row.price.level3,
      };
      upsertSlabItem(
        await updateSlab(row.id, toSlabPayload(row, { price: nextPrice, markupPrices: nextMarkupPrices })),
      );
      closePriceDrawer();
    }
    if (type === 'batchRestore') {
      await updateSelectedSlabStatuses('warehouse');
    }
    if (type === 'batchShelf') {
      await updateSelectedSlabStatuses('selling');
    }
    if (type === 'purge' && row) {
      await deleteSlab(row.id);
      tableData.value = tableData.value.filter((item) => item.id !== row.id);
    }
    if (type === 'batchPurge') {
      const selectedIds = [...selectedKeys.value];
      await Promise.all(selectedIds.map((id) => deleteSlab(id)));
      const deletedIds = new Set(selectedIds);
      tableData.value = tableData.value.filter((item) => !deletedIds.has(item.id));
    }
    if (type === 'clearRecycle') {
      await Promise.all(recycleIds.map((id) => deleteSlab(id)));
      tableData.value = tableData.value.filter((item) => item.status !== 'recycle');
    }
    if (type !== 'savePrice') {
      selectedKeys.value = [];
      ensureCurrentPage();
    }
    closeConfirmDialog();
    if (type === 'delete' && row) adminFeedback.deleted(row.name);
    else if (type === 'shelf' && row) adminFeedback.actionSuccess({ action: '上架', target: row.name });
    else if (type === 'restore' && row) adminFeedback.actionSuccess({ action: '放回仓库', target: row.name });
    else if (type === 'reject' && row) adminFeedback.actionSuccess({ action: '驳回', target: row.name });
    else if (type === 'savePrice' && row) adminFeedback.actionSuccess({ action: '保存价格', target: row.name });
    else if (type === 'batchShelf') {
      adminFeedback.actionSuccess({ action: '批量上架', target: `${selectedCount} 个大板` });
    } else if (type === 'batchRestore') {
      adminFeedback.actionSuccess({ action: '批量放回仓库', target: `${selectedCount} 个大板` });
    } else if (type === 'purge' && row) {
      adminFeedback.actionSuccess({ action: '彻底删除', target: row.name });
    } else if (type === 'batchPurge') {
      adminFeedback.actionSuccess({ action: '批量彻底删除', target: `${selectedCount} 个大板` });
    } else if (type === 'clearRecycle') {
      adminFeedback.actionSuccess({ action: '清空回收站', target: `${recycleIds.length} 个大板` });
    }
  } catch (error) {
    if (type === 'batchPurge' || type === 'clearRecycle') await loadSlabs();
    const isBatchAction = type === 'batchShelf' || type === 'batchRestore' || type === 'batchPurge';
    adminFeedback.actionError({
      action: confirmAction.value,
      error,
      fallback: '请稍后重试',
      target: row?.name || (isBatchAction ? `${selectedCount} 个大板` : undefined),
    });
  } finally {
    saving.value = false;
  }
};

const openReasonDialog = (type: 'reject' | 'offShelf', row: SlabItem) => {
  reasonState.type = type;
  reasonState.row = row;
  reasonForm.reason = '';
  reasonForm.detail = '';
  reasonDialogVisible.value = true;
};

const closeReasonDialog = () => {
  reasonDialogVisible.value = false;
  reasonState.row = null;
};

const handleReasonSubmit = async () => {
  if (!reasonForm.reason) {
    adminFeedback.warning('请选择原因');
    return;
  }
  if (reasonState.type === 'offShelf' && reasonState.row) {
    saving.value = true;
    try {
      await updateSlabStatus(reasonState.row.id, 'offShelf');
      ensureCurrentPage();
      const targetName = reasonState.row.name;
      closeReasonDialog();
      adminFeedback.actionSuccess({ action: '下架', target: targetName });
    } catch (error) {
      adminFeedback.actionError({
        action: '下架',
        error,
        fallback: '请稍后重试',
        target: reasonState.row.name,
      });
    } finally {
      saving.value = false;
    }
    return;
  }
  if (reasonState.type === 'reject' && reasonState.row) {
    const row = reasonState.row;
    closeReasonDialog();
    openConfirm('reject', row, `是否驳回大板“${row.name}”？`);
    return;
  }
};

const closePriceDrawer = () => {
  priceDrawerVisible.value = false;
  priceDrawerRowId.value = null;
  priceDrawerFormRef.value?.clearValidate();
};

const saveBatchPrice = async () => {
  const hasInvalidPrice = batchPriceRows.some(
    (row, index) =>
      !isValidSalesNumber(row.price, 0) || (index > 0 && !isValidSalesNumber(row.ratio, 0)),
  );
  if (hasInvalidPrice) {
    await priceDrawerFormRef.value?.validate({ trigger: 'all', showErrorMessage: true });
    adminFeedback.warning('请完善价格信息');
    return;
  }
  const target = tableData.value.find((item) => item.id === priceDrawerRowId.value);
  if (target) {
    openConfirm('savePrice', target, `是否保存大板“${target.name}”的价格？`);
  }
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

.status-tabs {
  margin-bottom: var(--td-comp-margin-l);
}

.filter-row {
  width: 100%;
}

.filter-fields {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-m);
}

.filter-primary-row,
.filter-secondary-row {
  align-items: center;
  gap: var(--td-comp-margin-m);
}

.filter-primary-row {
  display: grid;
  grid-template-columns: 234px repeat(5, minmax(0, 1fr));
  width: 100%;
}

.filter-secondary-row {
  display: flex;
  width: 100%;
}

.filter-primary-row :deep(.t-form__item),
.filter-secondary-row :deep(.t-form__item) {
  margin-bottom: 0;
}

.filter-primary-row :deep(.t-form__item.slab-keyword-filter) {
  width: auto;
}

.filter-secondary-row :deep(.t-form__item.supplier-filter) {
  width: 234px;
}

.filter-actions {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: var(--td-comp-margin-s);
}

.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--td-comp-margin-l);
  margin-bottom: var(--td-comp-margin-l);
}

.toolbar-buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-comp-margin-s);
  min-height: 32px;
}

.selection-info {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-medium);
}

.brown-button {
  color: #fff;
  background: #8b5e34;
  border-color: #8b5e34;
}

.dark-red-button {
  color: #fff;
  background: #8f1d2c;
  border-color: #8f1d2c;
}

.slab-image {
  width: 64px;
  height: 64px;
  display: inline-flex;
  overflow: hidden;
  border-radius: 6px;
  border: 1px solid var(--td-component-border);
  background: var(--td-bg-color-secondarycontainer);
}

.slab-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: zoom-in;
}

.slab-image-placeholder {
  margin: auto;
  color: var(--td-text-color-placeholder);
  font-size: 12px;
}

.slab-meta {
  min-width: 0;
}

.slab-name {
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
}

.slab-code,
.store-text {
  display: block;
  margin-top: 4px;
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
}

.tenant-cell {
  display: grid;
  gap: 4px;
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-s);
}

.product-tabs {
  min-height: 460px;
}

.upload-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--td-comp-margin-l);
  padding-top: var(--td-comp-paddingTB-l);
}

.upload-box {
  height: 168px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--td-comp-margin-s);
  color: var(--td-text-color-secondary);
  cursor: pointer;
  border-radius: 6px;
  border: 1px dashed var(--td-component-border);
  background: var(--td-bg-color-secondarycontainer);
}

.upload-box.is-disabled {
  cursor: default;
}

.upload-box:hover:not(.is-disabled) {
  color: var(--td-brand-color);
  border-color: var(--td-brand-color);
}

.upload-box.is-error {
  border-color: var(--td-error-color);
}

.upload-delete-button {
  position: absolute;
  top: var(--td-comp-margin-xs);
  right: var(--td-comp-margin-xs);
  z-index: 1;
}

.upload-error {
  color: var(--td-error-color);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
}

.direct-upload-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.upload-preview {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 4px;
  cursor: zoom-in;
}

.upload-large-preview {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: 0 auto;
  object-fit: contain;
}

.required-star {
  position: absolute;
  top: 12px;
  left: 12px;
  color: var(--td-error-color);
}

.price-required-star {
  margin-right: 2px;
  color: var(--td-error-color);
}

.dialog-form-grid,
.dimension-grid,
.corner-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--td-comp-margin-m) var(--td-comp-margin-l);
  padding-top: var(--td-comp-paddingTB-l);
}

.dimension-grid,
.corner-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding-top: 0;
}

.dimension-grid > *,
.corner-grid > *,
.measurement-input {
  min-width: 0;
}

.measurement-input {
  width: 100%;
  max-width: 100%;
}

.section-title {
  margin: var(--td-comp-margin-l) 0 var(--td-comp-margin-s);
  color: var(--td-text-color-primary);
  font: var(--td-font-title-small);
}

.price-editor,
.price-table {
  margin-top: var(--td-comp-margin-l);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
  overflow: hidden;
}

.price-editor__head,
.price-editor__row {
  display: grid;
  grid-template-columns: 1fr 140px 140px;
  align-items: center;
  gap: var(--td-comp-margin-l);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  border-bottom: 1px solid var(--td-component-border);
}

.price-drawer-content {
  width: max-content;
  min-width: 540px;
}

.price-table__head,
.price-table__row {
  display: grid;
  grid-template-columns: minmax(140px, max-content) 160px 180px;
  gap: var(--td-comp-margin-l);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  border-bottom: 1px solid var(--td-component-border);
}

.price-table__head {
  align-items: center;
}

.price-table__head > span {
  white-space: nowrap;
}

.price-table__row {
  align-items: start;
}

.price-table__row > span {
  padding-top: 8px;
  white-space: nowrap;
}

.price-editor__head,
.price-table__head {
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-secondarycontainer);
  font: var(--td-font-body-medium);
}

.price-editor__row:last-child,
.price-table__row:last-child {
  border-bottom: 0;
}

.price-form-item {
  min-width: 0;
  margin-bottom: 0;
}

.price-form-item.t-form__item-with-extra {
  margin-bottom: var(--td-line-height-body-small);
}

.price-input {
  width: 100%;
  min-width: 0;
}

.drawer-actions {
  margin-bottom: var(--td-comp-margin-l);
}

@media (max-width: 1100px) {
  .upload-grid,
  .dimension-grid,
  .corner-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
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

  .filter-fields {
    width: 100%;
  }

  .filter-primary-row,
  .filter-secondary-row {
    gap: var(--td-comp-margin-s);
  }

  .filter-primary-row {
    display: flex;
    flex-wrap: wrap;
  }

  .filter-actions {
    margin-left: 0;
  }

  .filter-primary-row :deep(.t-form__item),
  .filter-secondary-row :deep(.t-form__item) {
    width: calc(50% - var(--td-comp-margin-s) / 2);
  }

  .filter-primary-row :deep(.t-form__item.slab-keyword-filter) {
    width: calc(50% - var(--td-comp-margin-s) / 2);
  }

  .filter-secondary-row :deep(.t-form__item.supplier-filter) {
    width: calc(50% - var(--td-comp-margin-s) / 2);
  }
}

@media (max-width: 640px) {
  .filter-primary-row :deep(.t-form__item),
  .filter-secondary-row :deep(.t-form__item) {
    width: 100%;
  }

  .filter-primary-row :deep(.t-form__item.slab-keyword-filter) {
    width: 100%;
  }

  .filter-secondary-row :deep(.t-form__item.supplier-filter) {
    width: 100%;
  }
}
</style>
