<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header v-show="!isProductFormPage" class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item>大板管理</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <div class="page-header-actions">
            <t-link v-if="canViewOperationLogs" theme="primary" hover="color" @click="openOperationLogDrawer">
              操作日志
            </t-link>
          </div>
        </header>

        <AdminListLayout v-show="!isProductFormPage" class="slab-list-layout">
          <template #toolbar>
            <div class="list-controls">
              <t-tabs v-if="showSlabTabRail" v-model="activeTab" class="status-tabs" @change="handleTabChange">
                <t-tab-panel v-for="tab in slabTabs" :key="tab.value" :value="tab.value" :label="tabLabel(tab)" />
              </t-tabs>

              <t-form class="zdm-admin-filter-form" label-width="auto" :data="currentFilter" colon>
                <div class="filter-row">
                  <div class="filter-fields">
                    <div class="filter-primary-row" :class="{ 'off-shelf-filter-row': activeTab === 'offShelf' }">
                      <t-form-item label="大板" class="slab-keyword-filter">
                        <t-input v-model="currentFilter.keyword" clearable placeholder="大板名称/ID/大板编号" />
                      </t-form-item>
                      <t-form-item label="品种">
                        <t-select v-model="currentFilter.variety" clearable filterable placeholder="请选择">
                          <t-option v-for="item in varietyOptions" :key="item" :label="item" :value="item" />
                        </t-select>
                      </t-form-item>
                      <template v-if="activeTab === 'offShelf'">
                        <t-form-item label="下架原因">
                          <t-select v-model="currentFilter.offShelfReason" clearable filterable placeholder="请选择">
                            <t-option v-for="item in offShelfReasons" :key="item" :label="item" :value="item" />
                          </t-select>
                        </t-form-item>
                        <t-form-item label="下架人">
                          <t-input v-model="currentFilter.offShelvedBy" clearable placeholder="请输入下架人" />
                        </t-form-item>
                      </template>
                      <template v-else>
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
                      </template>
                    </div>
                    <div class="filter-secondary-row">
                      <t-form-item v-if="activeTab === 'offShelf'" label="下架时间" class="off-shelf-date-filter">
                        <t-date-range-picker
                          v-model="currentFilter.offShelfDateRange"
                          clearable
                          allow-input
                          value-type="YYYY-MM-DD"
                          start="day"
                          end="day"
                          :placeholder="['开始日期', '结束日期']"
                        />
                      </t-form-item>
                      <t-form-item v-if="activeTab !== 'offShelf'" label="等级" class="grade-filter">
                        <t-select v-model="currentFilter.grade" clearable filterable placeholder="请选择">
                          <t-option
                            v-for="item in gradeFilterOptions"
                            :key="item.value"
                            :label="item.label"
                            :value="item.value"
                          />
                        </t-select>
                      </t-form-item>
                      <t-form-item v-if="activeTab !== 'offShelf'" label="供应商" class="supplier-filter">
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

              <div class="table-toolbar">
                <div class="toolbar-buttons">
                  <t-button
                    v-for="button in batchButtons"
                    :key="button.action"
                    :theme="button.theme"
                    :class="button.className"
                    :disabled="saving"
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
            </div>
          </template>
          <template #table>
            <SourceUnavailableOverlay :rows="pageData.filter(sourceBlocked)">
              <SlabRowWarnings :rows="pageData" :errors="shelfErrors" @close="(id) => delete shelfErrors[id]">
                <t-table
                  :row-attributes="
                    ({ row }: { row: SlabItem }) =>
                      sourceBlocked(row)
                        ? { 'data-source-id': row.id, inert: true }
                        : shelfErrors[row.id]
                          ? { 'data-shelf-error-id': row.id }
                          : {}
                  "
                  :row-class-name="({ row }: { row: SlabItem }) => (sourceBlocked(row) ? 'source-unavailable' : '')"
                  row-key="id"
                  :data="pageData"
                  :columns="columns"
                  :loading="loading"
                  hover
                  table-layout="fixed"
                >
                  <template #selectTitle>
                    <t-checkbox
                      :checked="pageAllSelected"
                      :indeterminate="pagePartiallySelected"
                      @change="toggleCurrentPage"
                    />
                  </template>
                  <template #select="{ row }">
                    <t-checkbox
                      :disabled="sourceBlocked(row)"
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
                        :tabindex="sourceBlocked(row) ? -1 : 0"
                        @click="!sourceBlocked(row) && openTableImage(row)"
                        @keydown.enter="!sourceBlocked(row) && openTableImage(row)"
                      />
                      <span v-else class="slab-image-placeholder">暂无主图</span>
                    </div>
                  </template>
                  <template #slab="{ row }">
                    <div class="slab-meta">
                      <div class="slab-name">{{ row.name }}</div>
                      <div class="slab-code">ID：{{ row.id }}</div>
                      <div class="slab-code">大板编号：{{ row.code }}</div>
                    </div>
                  </template>
                  <template #tenant="{ row }">
                    <div class="tenant-cell">
                      <span>{{ row.tenant }}</span>
                      <span class="store-text">{{ row.store }}</span>
                    </div>
                  </template>
                  <template #offShelfReason="{ row }">
                    <div class="off-shelf-reason-cell">
                      <span class="off-shelf-reason-primary">{{
                        latestOffShelfRecord(row)?.standardReason || '-'
                      }}</span>
                      <div class="off-shelf-reason-detail-row">
                        <t-tooltip
                          class="off-shelf-detail-tooltip"
                          :content="latestOffShelfRecord(row)?.detailReason || '-'"
                          placement="bottom-left"
                        >
                          <span class="off-shelf-reason-secondary">{{
                            latestOffShelfRecord(row)?.detailReason || '-'
                          }}</span>
                        </t-tooltip>
                        <t-tooltip content="查看历史下架原因">
                          <t-button
                            class="off-shelf-history-trigger"
                            variant="text"
                            shape="square"
                            size="small"
                            aria-label="查看历史下架原因"
                            @click="openOffShelfHistory(row)"
                          >
                            <template #icon><t-icon name="browse" /></template>
                          </t-button>
                        </t-tooltip>
                      </div>
                    </div>
                  </template>
                  <template #offShelvedByName="{ row }">
                    {{ latestOffShelfRecord(row)?.offShelvedByName || '-' }}
                  </template>
                  <template #offShelvedAt="{ row }">
                    {{ formatDateTime(latestOffShelfRecord(row)?.offShelvedAt) }}
                  </template>
                  <template #operation="{ row }">
                    <div class="table-actions">
                      <t-link
                        v-for="action in rowActions()"
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
              </SlabRowWarnings>
              <template #overlay="{ row }">
                <t-space align="center" size="small">
                  <t-icon name="info-circle" />
                  <span>{{ row.sourceMessage || '上游商品不可用' }}</span>
                </t-space>
                <t-space size="small">
                  <t-button
                    v-if="hasSlabAction(activeTab, ['warehouse', 'selling'].includes(activeTab) ? 'edit' : 'detail')"
                    size="small"
                    theme="primary"
                    @click="handleRowAction('detail', row)"
                    >详情</t-button
                  >
                  <t-button
                    v-if="hasSlabAction('recycle', 'purge')"
                    size="small"
                    theme="danger"
                    variant="base"
                    @click="handleRowAction('purge', row)"
                    >彻底删除</t-button
                  >
                </t-space>
              </template>
            </SourceUnavailableOverlay>
          </template>
          <template #pagination>
            <AdminPagination
              v-model:current="currentPagination.current"
              v-model:page-size="currentPagination.pageSize"
              :total="paginationTotal"
              :page-size-options="pageSizeOptions"
            />
          </template>
        </AdminListLayout>
        <SlabProductFormLayout
          ref="productLayoutRef"
          v-model:visible="productDialogVisible"
          v-model:active-section="productTab"
          :mode="productMode"
          :title="productDialogTitle"
          :loading="saving"
          @confirm="handleProductSubmit"
          @close="closeProductDialog"
        >
          <template #images>
            <div class="upload-grid" :class="{ 'publish-upload-grid': isProductFormPage }">
              <AdminMediaUpload
                v-for="item in uploadItems"
                :key="item.key"
                v-model="uploadPreviews[item.key]"
                :title="item.title"
                :label="isProductFormPage ? '点击上传' : item.label"
                :required="item.required"
                :accept="item.accept"
                :disabled="readonlyProductFields"
                :error-message="uploadErrors[item.key] ? `请上传${item.title}` : ''"
                :upload="(file) => uploadSlabMedia(item, file)"
                @uploaded="uploadErrors[item.key] = false"
                @removed="releasePendingUpload"
                @click.capture="handleUploadBoxClick(item, $event)"
                @preview="openUploadPreview(item)"
              />
            </div>
          </template>
          <template #base>
            <t-form
              ref="productFormRef"
              :data="productForm"
              :rules="productRules"
              :label-width="isProductFormPage ? '116px' : '92px'"
              colon
            >
              <div class="dialog-form-grid" :class="{ 'publish-base-grid': isProductFormPage }">
                <t-form-item label="品种" name="variety">
                  <t-select
                    v-model="productForm.variety"
                    :disabled="readonlyProductFields"
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
                    :disabled="readonlyProductFields"
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
                    :disabled="readonlyProductFields"
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
                    :disabled="readonlyProductFields"
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
                    :disabled="readonlyProductFields"
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
              <div class="section-title">尺寸（mm）</div>
              <div class="dimension-grid">
                <t-form-item label="长" name="length" required-mark>
                  <t-input-number
                    v-model="productForm.length"
                    class="measurement-input"
                    large-number
                    :disabled="readonlyProductFields"
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
                    :disabled="readonlyProductFields"
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
                    :disabled="readonlyProductFields"
                    :decimal-places="2"
                    theme="normal"
                    placeholder="请输入"
                    @blur="handleMeasurementBlur('height')"
                    @change="handleMeasurementChange('height')"
                  />
                </t-form-item>
                <t-form-item v-if="isProductFormPage" label="面积" name="area">
                  <t-input
                    :model-value="productAreaSquareMeter == null ? '' : productAreaSquareMeter.toFixed(2)"
                    disabled
                    placeholder=""
                    suffix="㎡"
                  />
                </t-form-item>
                <t-form-item :label="isProductFormPage ? '±误差' : '土误差'" name="tolerance">
                  <t-input-number
                    v-model="productForm.tolerance"
                    class="measurement-input"
                    large-number
                    :disabled="readonlyProductFields"
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
                    :disabled="readonlyProductFields"
                    :decimal-places="2"
                    theme="normal"
                    placeholder="请输入"
                    @blur="handleMeasurementBlur(item.key)"
                    @change="handleMeasurementChange(item.key)"
                  />
                </t-form-item>
              </div>
            </t-form>
          </template>
          <template #sales>
            <t-form
              ref="salesFormRef"
              :class="{ 'publish-sales-form': isProductFormPage }"
              :data="productForm"
              :rules="salesRules"
              :label-width="isProductFormPage ? '116px' : '96px'"
              colon
            >
              <t-form-item label="成本价" name="cost" required-mark>
                <SpecPriceInput
                  v-model="productForm.cost"
                  label="成本价"
                  placeholder="请输入"
                  :submitted="productPriceSubmitted"
                  :disabled="readonlyProductFields"
                  @change="handleCostChange"
                />
              </t-form-item>
              <div :class="isProductFormPage ? undefined : 'dialog-form-grid'">
                <t-form-item label="供应商" name="supplier" required-mark>
                  <t-select
                    v-model="productForm.supplier"
                    :disabled="readonlyProductFields"
                    filterable
                    placeholder="请选择"
                    @change="clearSalesFieldError('supplier')"
                  >
                    <t-option
                      v-for="item in publishSupplierOptions"
                      :key="item.id"
                      :label="item.label"
                      :value="item.label"
                    />
                  </t-select>
                </t-form-item>
                <t-form-item label="库存" name="stock" required-mark>
                  <t-input-number
                    v-model="productForm.stock"
                    large-number
                    :disabled="readonlyProductFields"
                    :decimal-places="0"
                    :input-props="stockInputProps"
                    theme="normal"
                    placeholder="请输入"
                    @change="handleStockChange"
                    @keydown="handleStockKeydown"
                  />
                </t-form-item>
                <t-form-item label="大板编号" name="sku">
                  <t-input
                    v-model="productForm.sku"
                    :disabled="readonlyProductFields"
                    placeholder="请输入"
                    @change="clearSalesFieldError('sku')"
                  />
                </t-form-item>
              </div>
              <t-form-item v-if="isProductFormPage" label="上架" required-mark>
                <t-radio-group v-model="publishTargetStatus">
                  <t-radio value="selling" :disabled="!canPublishToShelf">立刻上架</t-radio>
                  <t-radio value="warehouse" :disabled="productMode === 'edit' && editingSourceStatus === 'selling'"
                    >暂不上架</t-radio
                  >
                </t-radio-group>
              </t-form-item>
            </t-form>
          </template>
        </SlabProductFormLayout>
      </main>
    </div>

    <t-drawer
      v-model:visible="detailDrawerVisible"
      header="大板详情"
      placement="right"
      size="min(1240px, 100vw)"
      :footer="false"
      @close="closeDetailDrawer"
    >
      <t-space v-if="detailDrawerRow" direction="vertical" size="large" class="slab-detail-drawer">
        <AdminSectionCard class="slab-detail-section">
          <h3 class="slab-detail-section-title">图文描述</h3>
          <div class="slab-detail-media-grid">
            <button
              v-for="media in detailMediaItems"
              :key="media.label"
              class="slab-detail-media"
              type="button"
              :disabled="!media.url"
              @click="openMediaPreview(media)"
            >
              <img v-if="media.url && media.type === 'image'" :src="media.url" :alt="media.label" />
              <img v-else-if="media.url && media.coverUrl" :src="media.coverUrl" :alt="`${media.label}封面`" />
              <span v-else-if="media.url" class="slab-detail-media-placeholder">点击查看{{ media.label }}</span>
              <span v-else class="slab-detail-media-placeholder">暂无{{ media.label }}</span>
              <span class="slab-detail-media-label">{{ media.label }}</span>
            </button>
          </div>
        </AdminSectionCard>

        <AdminSectionCard class="slab-detail-section">
          <h3 class="slab-detail-section-title">基础信息</h3>
          <t-descriptions bordered :column="3">
            <t-descriptions-item label="大板名称" :span="2">{{ detailDrawerRow.name }}</t-descriptions-item>
            <t-descriptions-item label="ID">{{ detailDrawerRow.id }}</t-descriptions-item>
            <t-descriptions-item label="品种">{{ detailDrawerRow.variety }}</t-descriptions-item>
            <t-descriptions-item label="产地">{{ detailDrawerRow.origin }}</t-descriptions-item>
            <t-descriptions-item label="纹理">{{ detailDrawerRow.texture }}</t-descriptions-item>
            <t-descriptions-item label="色系">{{ detailDrawerRow.color }}</t-descriptions-item>
            <t-descriptions-item label="等级">{{ detailDrawerRow.grade }}</t-descriptions-item>
            <t-descriptions-item label="长（mm）">{{ detailDrawerRow.lengthMm ?? '-' }}</t-descriptions-item>
            <t-descriptions-item label="宽（mm）">{{ detailDrawerRow.widthMm ?? '-' }}</t-descriptions-item>
            <t-descriptions-item label="高（mm）">{{ detailDrawerRow.thicknessMm ?? '-' }}</t-descriptions-item>
            <t-descriptions-item label="面积（㎡）">{{ detailDrawerRow.areaSquareMeter ?? '-' }}</t-descriptions-item>
            <t-descriptions-item label="±误差（mm）">{{ detailDrawerRow.toleranceMm ?? '-' }}</t-descriptions-item>
            <t-descriptions-item label="扣角1长（mm）">{{
              detailDrawerRow.corner1LengthMm ?? '-'
            }}</t-descriptions-item>
            <t-descriptions-item label="扣角1宽（mm）">{{ detailDrawerRow.corner1WidthMm ?? '-' }}</t-descriptions-item>
            <t-descriptions-item label="扣角2长（mm）">{{
              detailDrawerRow.corner2LengthMm ?? '-'
            }}</t-descriptions-item>
            <t-descriptions-item label="扣角2宽（mm）">{{ detailDrawerRow.corner2WidthMm ?? '-' }}</t-descriptions-item>
            <t-descriptions-item label="扣角3长（mm）">{{
              detailDrawerRow.corner3LengthMm ?? '-'
            }}</t-descriptions-item>
            <t-descriptions-item label="扣角3宽（mm）">{{ detailDrawerRow.corner3WidthMm ?? '-' }}</t-descriptions-item>
            <t-descriptions-item label="扣角4长（mm）">{{
              detailDrawerRow.corner4LengthMm ?? '-'
            }}</t-descriptions-item>
            <t-descriptions-item label="扣角4宽（mm）">{{ detailDrawerRow.corner4WidthMm ?? '-' }}</t-descriptions-item>
          </t-descriptions>
        </AdminSectionCard>

        <AdminSectionCard class="slab-detail-section">
          <h3 class="slab-detail-section-title">销售信息</h3>
          <t-descriptions bordered :column="3">
            <t-descriptions-item label="成本价">{{
              detailPriceRows.find((row) => row.label === '成本价')?.price ?? '-'
            }}</t-descriptions-item>
            <t-descriptions-item label="供应商">{{ detailDrawerRow.tenant }}</t-descriptions-item>
            <t-descriptions-item label="库存">{{ detailDrawerRow.stock ?? '-' }}</t-descriptions-item>
            <t-descriptions-item label="大板编号" :span="3">{{ detailDrawerRow.code }}</t-descriptions-item>
          </t-descriptions>
        </AdminSectionCard>
      </t-space>
    </t-drawer>

    <ProductOperationLogTemplate
      v-model:visible="operationLogDrawerVisible"
      v-model:detail-visible="operationLogDetailVisible"
      :records="operationLogRows"
      :detail="operationLogDetailRow"
      :total="operationLogTotal"
      :loading="operationLogLoading"
      :filter="operationLogFilter"
      :pagination="operationLogPagination"
      :type-options="operationTypeOptions"
      subject-label="大板"
      subject-code-label="大板编号"
      keyword-placeholder="大板名称/ID/大板编号"
      :status-label="operationLogStatusLabel"
      :format-time="formatDateTime"
      :source-label="operationLogSourceLabel"
      :show-reason="operationLogShowReason"
      @filter-change="updateOperationLogFilter"
      @search="handleOperationLogSearch"
      @reset="handleOperationLogReset"
      @page-change="changeOperationLogPage"
      @open-detail="openOperationLogDetailById"
    >
      <template #detail>
        <div v-if="operationLogDetail" class="operation-log-detail">
          <template v-if="operationLogIsCreate && operationLogChangeRows.length">
            <t-space direction="vertical" size="large" class="slab-creation-sections">
              <AdminSectionCard>
                <h3 class="slab-creation-title">图文描述</h3>
                <div class="slab-creation-media-grid">
                  <template v-for="row in creationLogImages" :key="row.field">
                    <div class="operation-log-media-card">
                      <div class="operation-log-media-card__title">{{ row.field }}</div>
                      <button
                        class="operation-log-media-card__preview"
                        type="button"
                        :disabled="!row.afterMedia?.available"
                        :aria-label="`查看${row.field}`"
                        @click="row.afterMedia && openOperationLogMediaPreview(row.afterMedia, row.field)"
                      >
                        <img
                          v-if="row.afterMedia?.available && row.afterMedia.url && row.afterMedia.mediaType === 'image'"
                          :src="row.afterMedia.url"
                          :alt="row.field"
                        />
                        <video
                          v-else-if="
                            row.afterMedia?.available && row.afterMedia.url && row.afterMedia.mediaType === 'video'
                          "
                          :src="row.afterMedia.url"
                          preload="metadata"
                          muted
                          playsinline
                        />
                        <span v-else>{{ mediaAfterFallback(row.afterMedia) }}</span>
                      </button>
                      <div class="operation-log-media-card__hint">
                        {{
                          row.afterMedia?.available
                            ? row.afterMedia.message ||
                              (row.afterMedia.mediaType === 'video' ? '点击播放视频' : '点击查看大图')
                            : '暂无可预览内容'
                        }}
                      </div>
                    </div>
                  </template>
                </div>
              </AdminSectionCard>
              <AdminSectionCard>
                <h3 class="slab-creation-title">基础信息</h3>
                <t-descriptions bordered :column="3" layout="horizontal">
                  <t-descriptions-item label="大板名称" :span="3">
                    {{ operationLogDetail.slabName }}
                  </t-descriptions-item>
                  <t-descriptions-item v-for="row in creationLogBase" :key="row.field" :label="row.field">
                    {{ row.after }}
                  </t-descriptions-item>
                </t-descriptions>
              </AdminSectionCard>
              <AdminSectionCard>
                <h3 class="slab-creation-title">销售信息</h3>
                <t-descriptions bordered :column="3" layout="horizontal">
                  <t-descriptions-item v-for="row in creationLogSales" :key="row.field" :label="row.field">
                    {{ row.after }}
                  </t-descriptions-item>
                </t-descriptions>
              </AdminSectionCard>
            </t-space>
          </template>
          <template v-else-if="operationLogChangeRows.length && operationLogDetail?.operationType !== 'OFF_SHELF'">
            <div class="operation-log-detail__section-title operation-log-detail__section-title--spaced">
              {{ operationLogIsCreate ? '创建时信息' : '变更对比' }}
              <t-tag theme="primary" variant="light">{{ operationLogChangeRows.length }} 项</t-tag>
            </div>
            <div class="operation-log-diff-list">
              <div v-for="row in operationLogChangeRows" :key="row.field" class="operation-log-diff-item">
                <div class="operation-log-diff-item__field">{{ row.field }}</div>
                <t-row v-if="row.mediaType" :gutter="16">
                  <t-col
                    v-for="side in [
                      { label: '修改前', media: row.beforeMedia },
                      { label: '修改后', media: row.afterMedia },
                    ]"
                    :key="side.label"
                    :span="6"
                  >
                    <t-space direction="vertical">
                      <span>{{ side.label }}</span>
                      <ProductLogFieldValue
                        :label="`${row.field} - ${side.label}`"
                        is-media
                        :media="side.media"
                        :missing="!side.media"
                        @preview="
                          openOperationLogMediaPreview(
                            { ...$event, mediaType: $event.mediaType === 'video' ? 'video' : 'image' },
                            `${row.field} - ${side.label}`,
                          )
                        "
                      />
                    </t-space>
                  </t-col>
                </t-row>
                <div v-else-if="operationLogIsCreate" class="operation-log-media-after">
                  <ProductLogFieldValue :label="row.field" :value="row.after" />
                </div>
                <div v-else-if="row.priceTiers?.length" class="operation-log-price-diff">
                  <div class="operation-log-price-diff__header">价格层级</div>
                  <div class="operation-log-price-diff__header">修改前</div>
                  <div class="operation-log-price-diff__arrow-placeholder" />
                  <div class="operation-log-price-diff__header">修改后</div>
                  <template v-for="tier in row.priceTiers" :key="tier.key">
                    <div class="operation-log-price-diff__tier">{{ tier.label }}</div>
                    <div class="operation-log-diff-value operation-log-diff-value--before">
                      <span>价格系数：{{ tier.beforeCoefficient }}</span>
                      <t-space align="center" size="small">
                        <span>价格：{{ tier.beforePrice }}</span>
                        <PriceSourceToggle
                          v-if="tier.beforeSource"
                          :source="tier.beforeSource"
                          :available="false"
                          readonly
                        />
                      </t-space>
                    </div>
                    <t-icon name="arrow-right" class="operation-log-diff-arrow" />
                    <div class="operation-log-diff-value operation-log-diff-value--after">
                      <span>价格系数：{{ tier.afterCoefficient }}</span>
                      <t-space align="center" size="small">
                        <span>价格：{{ tier.afterPrice }}</span>
                        <PriceSourceToggle
                          v-if="tier.afterSource"
                          :source="tier.afterSource"
                          :available="false"
                          readonly
                        />
                      </t-space>
                    </div>
                  </template>
                </div>
                <div v-else class="operation-log-diff-comparison">
                  <div class="operation-log-diff-value operation-log-diff-value--before">
                    <span class="operation-log-diff-value__label">修改前</span>
                    <ProductLogFieldValue :label="row.field" :value="row.before" />
                  </div>
                  <t-icon name="arrow-right" class="operation-log-diff-arrow" />
                  <div class="operation-log-diff-value operation-log-diff-value--after">
                    <span class="operation-log-diff-value__label">{{
                      operationLogIsCreate ? '创建时' : '修改后'
                    }}</span>
                    <ProductLogFieldValue :label="row.field" :value="row.after" />
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>
    </ProductOperationLogTemplate>

    <t-drawer
      v-model:visible="priceDrawerVisible"
      header="价格编辑器"
      placement="right"
      :size="priceDrawerSize"
      :footer="false"
      @close="closePriceDrawer"
    >
      <div class="price-drawer-content price-drawer-content--source">
        <div class="drawer-actions">
          <t-button v-if="!priceDrawerReadonly" theme="primary" block @click="saveBatchPrice">
            <template #icon><t-icon name="save" /></template>
            保存
          </t-button>
        </div>
        <div class="source-cost-editor">
          <span>成本价<span class="price-required-star">*</span></span>
          <SpecPriceInput
            v-if="batchPriceRows[0]"
            v-model="batchPriceRows[0].price"
            label="成本价"
            placeholder="成本价"
            :submitted="drawerPriceSubmitted"
            :disabled="priceDrawerReadonly"
          />
        </div>
      </div>
    </t-drawer>

    <t-dialog
      v-model:visible="uploadPreviewDialogVisible"
      :header="uploadPreviewTitle"
      width="760px"
      placement="center"
      :prevent-scroll-through="false"
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
      :header="reasonDialogTitle"
      width="520px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="handleReasonSubmit"
      @cancel="closeReasonDialog"
      @close="closeReasonDialog"
    >
      <t-form ref="reasonFormRef" :data="reasonForm" :rules="reasonFormRules" label-width="96px" colon>
        <t-alert
          v-if="reasonState.type === 'deleteExternal'"
          class="external-delete-warning"
          theme="warning"
          message="该大板为外部系统创建，删除后将物理移除该大板，且不会进入回收站，操作不可恢复。"
        />
        <t-form-item
          name="reason"
          :label="reasonState.type === 'deleteExternal' ? '删除原因' : '下架原因'"
          required-mark
        >
          <t-select v-model="reasonForm.reason" placeholder="请选择">
            <t-option
              v-for="item in reasonState.type === 'deleteExternal' ? externalDeleteReasons : offShelfReasons"
              :key="item"
              :label="item"
              :value="item"
            />
          </t-select>
        </t-form-item>
        <t-form-item name="detail" label="详细说明">
          <t-textarea v-model="reasonForm.detail" placeholder="请输入" :autosize="{ minRows: 4, maxRows: 6 }" />
        </t-form-item>
      </t-form>
    </t-dialog>

    <AdminDialog
      v-model:visible="offShelfHistoryVisible"
      header="历史下架原因"
      width="800px"
      confirm-btn="关闭"
      :cancel-btn="null"
      @confirm="closeOffShelfHistory"
      @close="closeOffShelfHistory"
    >
      <t-table
        v-if="offShelfHistoryRecords.length"
        row-key="id"
        :data="offShelfHistoryRecords"
        :columns="offShelfHistoryColumns"
        table-layout="fixed"
      >
        <template #detailReason="{ row }">
          <div class="off-shelf-history-detail">{{ row.detailReason || '-' }}</div>
        </template>
        <template #offShelvedAt="{ row }">{{ formatDateTime(row.offShelvedAt) }}</template>
      </t-table>
      <t-empty v-else description="暂无下架记录" />
    </AdminDialog>
  </div>
</template>

<script setup lang="ts">
import { fillSlabProductForm, formatPrice, formatRatio, toNumber } from '../shared/slabPageMapping';
import { buildSlabPriceRows } from '../shared/slabPriceRows';
import { useSlabOperationLogPresentation } from '../shared/slabOperationLogPresentation';
import {
  tabs,
  pageSizeOptions,
  externalDeleteReasons,
  offShelfReasons,
  makeFilterState,
  makeProductForm,
  type FilterState,
  type OperationLogFilterState,
  type OperationLogMediaValue,
  type DrawerPriceRow,
  type DetailMediaItem,
  type SlabItem,
  type ProductForm,
  type CornerFieldKey,
  type MeasurementField,
} from '../shared/slabPageModel';
import { formatProductDateTime as formatDateTime } from '@/utils/formatProductDateTime';
import SlabProductFormLayout from '../management/components/SlabProductFormLayout.vue';
import PriceSourceToggle from '@/pages/finished-stock/management/components/PriceSourceToggle.vue';
import SpecPriceInput from '@/pages/finished-stock/management/components/SpecPriceInput.vue';
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import SlabRowWarnings from '../management/components/SlabRowWarnings.vue';
import SourceUnavailableOverlay from '@/pages/finished-stock/management/components/SourceUnavailableOverlay.vue';
import ProductOperationLogTemplate from '@/components/product-logs/ProductOperationLogTemplate.vue';
import ProductLogFieldValue from '@/components/product-logs/ProductLogFieldValue.vue';
import { productLogFilterOptions, type ProductOperationLogRow } from '@/services/productOperationLog';
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import {
  adminFeedback,
  AdminConfirmDialog,
  AdminDialog,
  AdminMediaUpload,
  AdminListLayout,
  AdminPagination,
  AdminSectionCard,
  type AdminMediaValue,
} from '@/components/foundation';
import { type SlabMarkupConfigurationRecord } from '@/services/slabMarkupConfigurations';
import { createVideoFirstFrame } from '@/services/media';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import {
  clearRecycleSlabs,
  createSlab,
  deleteSlab,
  deleteSlabs,
  getSlabPublishOptions,
  listSlabOperationLogs,
  listSlabs,
  getSlabDetail,
  removeSlab,
  releaseTemporarySlabMedia,
  resolveSlabPublishTargetStatus,
  uploadSlabImage,
  updateSlab,
  updateSlabSourceCost,
  updateSlabStatuses,
  checkSlabAction,
  type SlabPayload,
  type SlabOperationLogRecord,
  type SlabOffShelfRecord,
  type SlabPublishTargetStatus,
  type SlabPublisherType,
  type SlabPublishOptions,
  type SlabRecord,
  type SlabStatus,
  type SlabPrice,
} from '@/services/slabs';
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
type PublisherType = SlabPublisherType;
type SlabTab = SlabStatus;
type ProductMode = 'create' | 'edit' | 'view';
type RowAction = 'detail' | 'price' | 'shelf' | 'edit' | 'delete' | 'offShelf' | 'restore' | 'purge';
type BatchAction = 'publish' | 'batchShelf' | 'batchOffShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';
type ConfirmType =
  | 'shelf'
  | 'delete'
  | 'restore'
  | 'savePrice'
  | 'batchShelf'
  | 'batchRestore'
  | 'purge'
  | 'batchPurge'
  | 'clearRecycle';
type UploadItemKey = 'main' | 'scan' | 'design' | 'video';
type SalesNumberChangeContext = {
  type?: string;
};
const activeTab = ref<SlabTab>('warehouse');
const loginUser = computed(() => getLoginUser());
const productPermissionPrefix = computed(() => `${'supply-chain'}.slab-management`);
const sourceBlocked = (_row: SlabItem) => false;
const slabPermissionScope: Record<SlabTab, string> = {
  warehouse: 'warehouse',
  selling: 'selling',
  offShelf: 'off-shelf',
  soldOut: 'sold-out',
  recycle: 'recycle',
};
const slabPermission = (status: SlabTab, action: string) =>
  `${productPermissionPrefix.value}.${slabPermissionScope[status]}.${action}`;
const hasSlabAction = (status: SlabTab, action: string) =>
  hasPermission(loginUser.value, slabPermission(status, action));
const canViewOperationLogs = computed(() =>
  hasPermission(loginUser.value, `${productPermissionPrefix.value}.operation-log.view`),
);
const { visibleTabs: slabTabs, showTabRail: showSlabTabRail } = usePermissionTabs({
  tabs,
  activeTab,
  canAccess: (tab) => hasSlabAction(tab.value, 'view'),
});
const loading = ref(false);
const saving = ref(false);
const selectedKeys = ref<number[]>([]);
const productDialogVisible = ref(false);
const productPriceSubmitted = ref(false);
const drawerPriceSubmitted = ref(false);
const productPriceSession = ref(0);
const drawerPriceSession = ref(0);
const productMode = ref<ProductMode>('create');
const readonlyProductFields = computed(() => productMode.value === 'view');
const isProductFormPage = computed(() => productDialogVisible.value && productMode.value !== 'view');
const productLayoutRef = ref<InstanceType<typeof SlabProductFormLayout>>();
const focusProductSection = (key: string) => {
  productTab.value = key;
  void productLayoutRef.value?.scrollToSection(key);
};
const publishTargetStatus = ref<SlabPublishTargetStatus>('warehouse');
const productTab = ref('images');
const editingRowId = ref<number | null>(null);
const editingSourceStatus = computed(() => tableData.value.find((row) => row.id === editingRowId.value)?.status);
const canPublishToShelf = computed(
  () =>
    editingSourceStatus.value === 'selling' ||
    hasSlabAction('warehouse', 'shelf') ||
    (productMode.value === 'create' && hasSlabAction('selling', 'publish')),
);
const productFormRef = ref<FormInstanceFunctions>();
const salesFormRef = ref<FormInstanceFunctions>();
const priceDrawerFormRef = ref<FormInstanceFunctions>();
const reasonFormRef = ref<FormInstanceFunctions>();
const productForm = reactive<ProductForm>(makeProductForm());
const priceDrawerVisible = ref(false);
const priceDrawerRowId = ref<number | null>(null);
const detailDrawerVisible = ref(false);
const detailDrawerRow = ref<SlabItem | null>(null);
const operationLogDrawerVisible = ref(false);
const operationLogLoading = ref(false);
const operationLogs = ref<SlabOperationLogRecord[]>([]);
const operationLogTotal = ref(0);
const operationLogDetailVisible = ref(false);
const operationLogDetail = ref<SlabOperationLogRecord | null>(null);
const makeOperationLogFilter = (): OperationLogFilterState => ({
  keyword: '',
  operationType: '',
  operatorName: '',
  dateRange: [],
});
const operationLogFilter = reactive(makeOperationLogFilter());
const appliedOperationLogFilter = reactive(makeOperationLogFilter());
const operationLogPagination = reactive({ current: 1, pageSize: 10 });
const updateOperationLogFilter = (field: string, value: string | string[]) =>
  Object.assign(operationLogFilter, { [field]: value });
const changeOperationLogPage = (page: { current: number; pageSize: number }) => {
  Object.assign(operationLogPagination, page);
  void loadOperationLogs();
};
const detailPriceRows = ref<DrawerPriceRow[]>([]);
const detailMediaItems = computed<DetailMediaItem[]>(() => {
  const row = detailDrawerRow.value;
  if (!row) return [];
  return [
    { label: '1:1主图', url: row.image, type: 'image' },
    { label: '扫描图', url: row.scanImageUrl, type: 'image' },
    { label: '设计图', url: row.designImageUrl, type: 'image' },
    { label: '商品视频', url: row.videoUrl, coverUrl: row.videoCoverUrl, type: 'video' },
  ];
});
const confirmDialogVisible = ref(false);
const reasonDialogVisible = ref(false);
const offShelfHistoryVisible = ref(false);
const offShelfHistoryRow = ref<SlabItem | null>(null);
const offShelfHistoryRecords = computed(() =>
  [...(offShelfHistoryRow.value?.offShelfRecords ?? [])].sort((left, right) => {
    const timeDifference = offShelfTimestamp(right) - offShelfTimestamp(left);
    return timeDifference || right.id - left.id;
  }),
);
const offShelfHistoryColumns: PrimaryTableCol<SlabOffShelfRecord>[] = [
  { colKey: 'standardReason', title: '下架原因', width: 120 },
  { colKey: 'detailReason', title: '详细说明', minWidth: 240 },
  { colKey: 'offShelvedByName', title: '下架人', width: 110 },
  { colKey: 'offShelvedAt', title: '下架时间', width: 170 },
];
const operationTypeOptions = computed(() => productLogFilterOptions('supply-chain'));
const toOperationLogRow = (row: SlabOperationLogRecord): ProductOperationLogRow => ({
  id: row.id,
  subjectName: row.slabName,
  subjectId: row.slabId,
  subjectCode: row.slabSerialNo,
  operationType: row.operationType,
  operationSummary: row.operationSummary,
  operatorName: row.operatorName,
  operatedAt: row.operatedAt,
  operationSource: row.operationSource,
  beforeStatus: row.beforeStatus,
  afterStatus: row.afterStatus,
  standardReason: row.standardReason,
  detailReason: row.detailReason,
});
const operationLogRows = computed(() => operationLogs.value.map(toOperationLogRow));
const operationLogDetailRow = computed(() => operationLogDetail.value && toOperationLogRow(operationLogDetail.value));
const operationLogSourceLabel = (row: ProductOperationLogRow) =>
  operationSourceLabel((row.operationSource || 'MANUAL') as SlabOperationLogRecord['operationSource']);
const operationLogShowReason = (row: ProductOperationLogRow) =>
  !['SOURCE_OFF_SHELF', 'SOURCE_DELETE_TO_RECYCLE', 'SOURCE_PURGE'].includes(row.operationType);
const {
  mediaAfterFallback,
  operationLogIsCreate,
  operationLogChangeRows,
  creationLogImages,
  creationLogBase,
  creationLogSales,
} = useSlabOperationLogPresentation(
  operationLogDetail,
  () => markupConfigurations.value,
  () => operationStatusLabels,
);
const operationSourceLabel = (source: SlabOperationLogRecord['operationSource']) =>
  ({
    MANUAL: '供应链协同系统',
    EXTERNAL_API: '外部接口',
    SYSTEM: '系统任务',
    SUPPLY_CHAIN: '供应链协同系统',
  })[source] || source;
const operationStatusLabels: Record<string, string> = {
  warehouse: '仓库中',
  selling: '已上架',
  offShelf: '已下架',
  soldOut: '已售完',
  recycle: '回收站',
  purged: '已彻底删除',
};
const operationLogStatusLabel = (value?: string | null) => (value ? operationStatusLabels[value] || value : '—');
const uploadPreviews = reactive<Partial<Record<UploadItemKey, AdminMediaValue>>>({});
const pendingUploadedMediaIds = new Set<number>();
const uploadErrors = reactive<Partial<Record<UploadItemKey, boolean>>>({});
const invalidMeasurementFields = reactive(new Set<MeasurementField>());
const stockHasLeadingZero = ref(false);
const uploadPreviewDialogVisible = ref(false);
const uploadPreviewTitle = ref('');
const uploadPreviewUrl = ref('');
const uploadPreviewType = ref<'image' | 'video'>('image');
const markupConfigurations = ref<SlabMarkupConfigurationRecord[]>([]);
const guidePriceSettingCoefficient = ref<number>();
const publishOptions = reactive<SlabPublishOptions>({
  varieties: [],
  origins: [],
  textures: [],
  colorCategories: [],
  grades: [],
  suppliers: [],
  storeLevels: [],
});
const varietyOptions = computed(() => publishOptions.varieties.map((item) => item.label));
const originOptions = computed(() => publishOptions.origins.map((item) => item.label));
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
const publishSupplierOptions = computed(() => publishOptions.suppliers);
const supplierFilterOptions = computed(() =>
  publishOptions.suppliers.map((item) => ({ id: item.id, name: item.label })),
);
const filters = reactive<Record<SlabTab, FilterState>>({
  warehouse: makeFilterState(),
  selling: makeFilterState(),
  offShelf: makeFilterState(),
  soldOut: makeFilterState(),
  recycle: makeFilterState(),
});
const appliedFilters = reactive<Record<SlabTab, FilterState>>({
  warehouse: makeFilterState(),
  selling: makeFilterState(),
  offShelf: makeFilterState(),
  soldOut: makeFilterState(),
  recycle: makeFilterState(),
});
const paginations = reactive<
  Record<
    SlabTab,
    {
      current: number;
      pageSize: number;
    }
  >
>({
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
const originById = (id?: number) => publishOptions.origins.find((item) => item.id === id);
const varietyById = (id?: number) => publishOptions.varieties.find((item) => item.id === id);
const supplierById = (id?: number) => publishOptions.suppliers.find((item) => item.id === id);
const publishOptionLabel = (options: SlabPublishOptions[keyof SlabPublishOptions], id?: number) =>
  options.find((item) => item.id === id)?.label || '-';
const gradeLabelById = (id?: number) => {
  const grade = publishOptions.grades.find((item) => item.id === id);
  return grade ? formatGradeOption(grade) : '-';
};
const varietyIdByName = (name: string) => publishOptions.varieties.find((item) => item.label === name)?.id;
const originIdByName = (name: string) => publishOptions.origins.find((item) => item.label === name)?.id;
const supplierIdByName = (name: string) => publishSupplierOptions.value.find((item) => item.label === name)?.id;
const formatSize = (record: SlabRecord) => {
  const dimensions = [record.lengthMm, record.widthMm, record.thicknessMm];
  return dimensions.some((item) => item == null) ? '-' : `${dimensions.join(' x ')}mm`;
};
const offShelfTimestamp = (record?: SlabOffShelfRecord) => {
  if (!record?.offShelvedAt) return 0;
  const timestamp = new Date(record.offShelvedAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};
const latestOffShelfRecord = (row: SlabItem) =>
  row.offShelfRecords.reduce<SlabOffShelfRecord | undefined>((latest, current) => {
    if (!latest) return current;
    const timeDifference = offShelfTimestamp(current) - offShelfTimestamp(latest);
    return timeDifference > 0 || (timeDifference === 0 && current.id > latest.id) ? current : latest;
  }, undefined);
const productAreaSquareMeter = computed(() => {
  if (!isValidMeasurement(productForm.length, true) || !isValidMeasurement(productForm.width, true)) return undefined;
  const length = Number(productForm.length);
  const width = Number(productForm.width);
  if (!(length > 0 && width > 0)) return undefined;
  return Number(((length * width) / 1000000).toFixed(2));
});
const toSlabItem = (record: SlabRecord): SlabItem => {
  record = { ...record, status: record.sourceStatus as SlabRecord['status'] };
  const variety = varietyById(record.varietyId);
  const supplier = supplierById(record.supplierId);
  return {
    id: record.id,
    sourceUnavailable: record.sourceUnavailable,
    sourceStatus: record.sourceStatus,
    sourceMessage: record.sourceMessage,
    stock: record.stock,
    sourceOffShelfRecords: record.sourceOffShelfRecords,
    supplierId: record.supplierId,
    varietyId: record.varietyId,
    originId: record.originId,
    textureId: record.textureId,
    colorId: record.colorId,
    gradeId: record.gradeId,
    code: record.serialNo ?? '',
    image: record.mainImageUrl || '',
    mainImageMediaId: record.mainImageMediaId,
    scanImageMediaId: record.scanImageMediaId,
    designImageMediaId: record.designImageMediaId,
    videoMediaId: record.videoMediaId,
    videoCoverMediaId: record.videoCoverMediaId,
    scanImageUrl: record.scanImageUrl,
    designImageUrl: record.designImageUrl,
    videoUrl: record.videoUrl,
    videoCoverUrl: record.videoCoverUrl,
    name: record.name,
    size: formatSize(record),
    origin: record.originName || originById(record.originId)?.label || '-',
    texture: publishOptionLabel(publishOptions.textures, record.textureId),
    color: publishOptionLabel(colorOptions.value, record.colorId),
    grade: gradeLabelById(record.gradeId),
    tenant: record.supplierName || supplier?.label || (record.supplierId ? `供应商 #${record.supplierId}` : '平台自营'),
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
    guidePriceCoefficient: record.guidePriceCoefficient,
    status: normalizeStatus(record.status),
    variety: record.varietyName || variety?.label || (record.varietyId ? `品种 #${record.varietyId}` : '-'),
    sku: record.serialNo ?? '',
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
    offShelfRecords: record.offShelfRecords ?? [],
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
    const [records, publishOptionsResult, markupResult] = await Promise.all([
      listSlabs(),
      getSlabPublishOptions(),
      Promise.resolve([]),
      Promise.resolve(undefined),
    ]);
    Object.assign(publishOptions, publishOptionsResult);
    markupConfigurations.value = markupResult;
    guidePriceSettingCoefficient.value = undefined;
    tableData.value = records.map(toSlabItem);
    const selectableIds = new Set(tableData.value.filter((row) => !sourceBlocked(row)).map((row) => row.id));
    selectedKeys.value = selectedKeys.value.filter((id) => selectableIds.has(id));
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
  if (confirmState.type === 'restore') return '是否放回仓库';
  if (confirmState.type === 'batchRestore') return '是否批量放回到仓库';
  return '';
});
const reasonState = reactive<{
  type: 'deleteExternal' | 'offShelf';
  row: SlabItem | null;
  isBatch: boolean;
}>({
  type: 'offShelf',
  row: null,
  isBatch: false,
});
const reasonDialogTitle = computed(() => {
  if (reasonState.type === 'deleteExternal') return '删除大板';
  return reasonState.isBatch ? '批量下架' : '下架';
});
const reasonForm = reactive({
  reason: '',
  detail: '',
});
const reasonFormRules = computed<Record<string, FormRule[]>>(() => ({
  reason: [
    {
      required: true,
      trigger: 'submit',
      message: reasonState.type === 'deleteExternal' ? '请选择删除原因' : '请选择下架原因',
    },
  ],
  detail: [],
}));
const batchPriceRows = reactive<DrawerPriceRow[]>([]);
const priceDrawerSize = computed(() => {
  return 'min(calc(200px + 2 * var(--td-comp-paddingLR-l)), calc(100vw - 32px))';
});
const uploadItems: {
  key: UploadItemKey;
  title: string;
  label: string;
  required: boolean;
  accept: string;
}[] = [
  { key: 'main', title: '1:1主图', label: '点击上传图片', required: true, accept: 'image/*' },
  { key: 'scan', title: '扫描图', label: '点击上传图片', required: true, accept: 'image/*' },
  { key: 'design', title: '设计图', label: '点击上传图片', required: true, accept: 'image/*' },
  { key: 'video', title: '商品视频', label: '点击上传视频', required: false, accept: 'video/*' },
];
const cornerFields: {
  key: CornerFieldKey;
  label: string;
}[] = [
  { key: 'corner1Length', label: '扣角1长' },
  { key: 'corner1Width', label: '扣角1宽' },
  { key: 'corner2Length', label: '扣角2长' },
  { key: 'corner2Width', label: '扣角2宽' },
  { key: 'corner3Length', label: '扣角3长' },
  { key: 'corner3Width', label: '扣角3宽' },
  { key: 'corner4Length', label: '扣角4长' },
  { key: 'corner4Width', label: '扣角4宽' },
];
function sortRowsByStoreLevel<T>(rows: T[], resolveId: (row: T) => number | undefined): T[] {
  const orderById = new Map(publishOptions.storeLevels.map((level, index) => [level.id, index]));
  return [...rows].sort((left, right) => {
    const leftOrder = orderById.get(resolveId(left) ?? -1) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderById.get(resolveId(right) ?? -1) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}
const salesPriceRows = computed(() => {
  const savedPrices =
    editingRowId.value == null
      ? []
      : (tableData.value.find((item) => item.id === editingRowId.value)?.markupPrices ?? []);
  const rows: {
    id: number;
    label: string;
    priceCoefficient?: number;
    priceSource?: 'auto' | 'manual';
    sourceConfigurationId?: number;
  }[] = savedPrices
    .filter((price) => publishOptions.storeLevels.some((level) => level.id === price.storeLevelId))
    .map((price) => ({
      id: price.storeLevelId,
      label:
        publishOptions.storeLevels.find((level) => level.id === price.storeLevelId)?.label ||
        markupConfigurations.value.find((item) => item.storeLevelId === price.storeLevelId)?.name ||
        price.storeLevelName ||
        `门店级别${price.storeLevelId}`,
      priceCoefficient: Number(price.priceCoefficient),
      priceSource: price.priceSource ?? 'manual',
      sourceConfigurationId: price.sourceConfigurationId,
    }));
  const savedIds = new Set(rows.map((item) => item.id));
  publishOptions.storeLevels.forEach((level) => {
    if (savedIds.has(level.id)) return;
    const configuration = markupConfigurations.value.find(
      (item) => item.storeLevelId === level.id && item.status === 'enabled',
    );
    rows.push({
      id: level.id,
      label: level.label,
      priceCoefficient: configuration == null ? undefined : Number(configuration.priceCoefficient),
      priceSource: configuration == null ? 'manual' : 'auto',
      sourceConfigurationId: configuration?.id,
    });
  });
  return sortRowsByStoreLevel(rows, (row) => row.id);
});
const partnerPriceRows = computed(() => salesPriceRows.value);
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
        return (
          !normalizedValue ||
          normalizedValue === '0' ||
          (!stockHasLeadingZero.value && /^[1-9]\d*$/.test(normalizedValue))
        );
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
        return (
          !normalizedValue ||
          normalizedValue === '0' ||
          (!stockHasLeadingZero.value && /^[1-9]\d*$/.test(normalizedValue))
        );
      },
      message: '请输入正确的库存',
      type: 'error',
      trigger: 'submit',
    },
  ],
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
  ...Object.fromEntries(cornerFields.map((item) => [item.key, [createOptionalMeasurementRule(item.key, item.label)]])),
};
// Fixed pixel widths; update only when the tab action buttons change.
const operationWidths = {
  warehouse: 184,
  selling: 148,
  offShelf: 176,
  soldOut: 104,
  recycle: 204,
};
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  if (activeTab.value === 'offShelf') {
    return [
      { colKey: 'select', title: 'selectTitle', width: 48, align: 'center' },
      { colKey: 'image', title: '商品主图', width: 96, align: 'center' },
      { colKey: 'slab', title: '大板名称/ID/大板编号', minWidth: 220 },
      { colKey: 'variety', title: '品种', width: 140 },
      { colKey: 'offShelfReason', title: '下架原因/详细说明', minWidth: 240 },
      { colKey: 'offShelvedByName', title: '下架人', width: 120, align: 'center' },
      { colKey: 'offShelvedAt', title: '下架时间', width: 180, align: 'center' },
      {
        colKey: 'operation',
        title: '操作',
        width: operationWidths[activeTab.value],
        align: 'left',
        fixed: 'right',
      },
    ];
  }
  const baseColumns: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'select', title: 'selectTitle', width: 48, align: 'center' },
    { colKey: 'image', title: '商品主图', width: 96, align: 'center' },
    { colKey: 'slab', title: '大板名称/ID/大板编号', minWidth: 220 },
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
  baseColumns.push({
    colKey: 'operation',
    title: '操作',
    width: operationWidths[activeTab.value],
    align: 'left',
    fixed: 'right',
  });
  return baseColumns;
});
const currentFilter = computed(() => filters[activeTab.value]);
const currentAppliedFilter = computed(() => appliedFilters[activeTab.value]);
const currentPagination = computed(() => paginations[activeTab.value]);
const selectedKeySet = computed(() => new Set(selectedKeys.value));
const currentPageIds = computed(() => pageData.value.filter((item) => !sourceBlocked(item)).map((item) => item.id));
const pageAllSelected = computed(
  () => currentPageIds.value.length > 0 && currentPageIds.value.every((id) => selectedKeySet.value.has(id)),
);
const pagePartiallySelected = computed(
  () => currentPageIds.value.some((id) => selectedKeySet.value.has(id)) && !pageAllSelected.value,
);
const priceDrawerReadonly = computed(
  () => activeTab.value === 'soldOut' || activeTab.value === 'recycle' || activeTab.value === 'offShelf',
);
const productDialogTitle = computed(() => {
  if (productMode.value === 'create') return '发布商品';
  if (productMode.value === 'edit') return '编辑商品';
  return '查看商品';
});
const filteredData = computed(() => {
  const filter = currentAppliedFilter.value;
  const matchedItems = tableData.value.filter((item) => {
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
    const latestRecord = latestOffShelfRecord(item);
    const offShelfReasonMatched =
      activeTab.value !== 'offShelf' ||
      !filter.offShelfReason ||
      latestRecord?.standardReason === filter.offShelfReason;
    const offShelvedByKeyword = filter.offShelvedBy.trim().toLowerCase();
    const offShelvedByMatched =
      activeTab.value !== 'offShelf' ||
      !offShelvedByKeyword ||
      latestRecord?.offShelvedByName.toLowerCase().includes(offShelvedByKeyword);
    const [offShelfStartDate, offShelfEndDate] = filter.offShelfDateRange;
    const offShelfTime = offShelfTimestamp(latestRecord);
    const offShelfDateMatched =
      activeTab.value !== 'offShelf' ||
      ((!offShelfStartDate || offShelfTime >= new Date(`${offShelfStartDate}T00:00:00`).getTime()) &&
        (!offShelfEndDate || offShelfTime <= new Date(`${offShelfEndDate}T23:59:59.999`).getTime()));
    return (
      statusMatched &&
      keywordMatched &&
      varietyMatched &&
      originMatched &&
      textureMatched &&
      colorMatched &&
      gradeMatched &&
      supplierMatched &&
      offShelfReasonMatched &&
      offShelvedByMatched &&
      offShelfDateMatched
    );
  });
  if (activeTab.value !== 'offShelf') return matchedItems;
  return matchedItems.sort((left, right) => {
    const leftRecord = latestOffShelfRecord(left);
    const rightRecord = latestOffShelfRecord(right);
    const timeDifference = offShelfTimestamp(rightRecord) - offShelfTimestamp(leftRecord);
    return timeDifference || (rightRecord?.id ?? 0) - (leftRecord?.id ?? 0) || right.id - left.id;
  });
});
const pageData = computed(() => {
  const start = (currentPagination.value.current - 1) * currentPagination.value.pageSize;
  return filteredData.value.slice(start, start + currentPagination.value.pageSize);
});
const shelfErrors = reactive<Record<number, string>>({});
const paginationTotal = computed(() => filteredData.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / currentPagination.value.pageSize), 1));
const batchButtons = computed(() => {
  const map: Record<
    SlabTab,
    {
      label: string;
      action: BatchAction;
      theme: 'primary' | 'danger' | 'default';
      icon: string;
      className?: string;
    }[]
  > = {
    warehouse: [
      { label: '发布商品', action: 'publish', theme: 'primary', icon: 'add' },
      { label: '批量上架', action: 'batchShelf', theme: 'primary', icon: 'upload' },
    ],
    selling: [
      { label: '发布商品', action: 'publish', theme: 'primary', icon: 'add' },
      { label: '批量下架', action: 'batchOffShelf', theme: 'default', icon: 'download', className: 'brown-button' },
    ],
    offShelf: [{ label: '批量放回到仓库', action: 'batchRestore', theme: 'primary', icon: 'rollback' }],
    soldOut: [],
    recycle: [
      { label: '批量放回到仓库', action: 'batchRestore', theme: 'primary', icon: 'rollback' },
      { label: '批量彻底删除', action: 'batchPurge', theme: 'danger', icon: 'delete', className: 'dark-red-button' },
      { label: '清空回收站', action: 'clearRecycle', theme: 'danger', icon: 'clear' },
    ],
  };
  const actionPermissions: Record<BatchAction, string> = {
    publish: 'publish',
    batchShelf: 'batch-shelf',
    batchOffShelf: 'batch-off-shelf',
    batchRestore: 'batch-restore',
    batchPurge: 'batch-purge',
    clearRecycle: 'clear',
  };
  return map[activeTab.value].filter((button) => hasSlabAction(activeTab.value, actionPermissions[button.action]));
});
const tabLabel = (tab: { label: string; value: SlabTab }) => {
  const count = tableData.value.filter((item) => item.status === tab.value).length;
  return count ? `${tab.label} ${count}` : tab.label;
};
const rowActions = (): {
  label: string;
  action: RowAction;
  theme: 'primary' | 'warning' | 'danger' | 'default';
}[] => {
  const filterActions = (
    actions: {
      label: string;
      action: RowAction;
      theme: 'primary' | 'warning' | 'danger' | 'default';
    }[],
  ) => {
    const actionPermissions: Partial<Record<RowAction, string>> = {
      detail: 'detail',
      price: 'price',
      shelf: 'shelf',
      edit: 'edit',
      delete: 'delete',
      offShelf: 'off-shelf',
      restore: 'restore',
      purge: 'purge',
    };
    return actions.filter((action) => hasSlabAction(activeTab.value, actionPermissions[action.action]!));
  };
  if (activeTab.value === 'warehouse') {
    return filterActions([
      { label: '上架', action: 'shelf', theme: 'primary' },
      { label: '编辑', action: 'edit', theme: 'primary' },
      { label: '删除', action: 'delete', theme: 'danger' },
    ]);
  }
  if (activeTab.value === 'selling') {
    return filterActions([
      { label: '下架', action: 'offShelf', theme: 'warning' },
      { label: '编辑', action: 'edit', theme: 'primary' },
    ]);
  }
  if (activeTab.value === 'offShelf') {
    return filterActions([
      { label: '详情', action: 'detail', theme: 'primary' },
      { label: '放回仓库', action: 'restore', theme: 'primary' },
      { label: '删除', action: 'delete', theme: 'danger' },
    ]);
  }
  if (activeTab.value === 'soldOut') {
    return filterActions([{ label: '详情', action: 'detail', theme: 'primary' }]);
  }
  return filterActions([
    { label: '详情', action: 'detail', theme: 'primary' },
    { label: '放回仓库', action: 'restore', theme: 'primary' },
    { label: '彻底删除', action: 'purge', theme: 'danger' },
  ]);
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
  if (tableData.value.some((row) => row.id === id && sourceBlocked(row))) return;
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
const calculateProductPrice = (configurationId: number) => {
  const cost = toNumber(productForm.cost);
  const editor = productForm.markupPrices[configurationId];
  const ratio = toNumber(editor?.ratio ?? '');
  if (!editor || !isValidSalesNumber(productForm.cost, 0) || !isValidSalesNumber(editor.ratio, 0)) return;
  editor.price = formatPrice(cost * ratio);
  clearSalesFieldError(`markupPrices.${configurationId}.price`);
};
const calculateGuidePrice = () => {
  const cost = toNumber(productForm.cost);
  const ratio = toNumber(productForm.guideRatio);
  if (!isValidSalesNumber(productForm.cost, 0) || !isValidSalesNumber(productForm.guideRatio, 0)) return;
  productForm.guidePrice = formatPrice(cost * ratio);
  clearSalesFieldError('guidePrice');
};
const recalculateProductPrices = () => {
  calculateGuidePrice();
  partnerPriceRows.value.forEach((item) => calculateProductPrice(item.id));
};
const initializeProductMarkupPrices = (prices: SlabPrice[] = []) => {
  const existingById = new Map(prices.map((item) => [item.storeLevelId, item]));
  const cost = toNumber(productForm.cost);
  productForm.markupPrices = Object.fromEntries(
    salesPriceRows.value.map((item) => {
      const existing = existingById.get(item.id);
      const ratio = existing ? Number(existing.priceCoefficient) : item.priceCoefficient;
      return [
        item.id,
        {
          ratio: ratio == null ? '' : formatRatio(ratio),
          price: existing
            ? String(existing.price)
            : productMode.value === 'create' && cost && ratio != null
              ? formatPrice(cost * ratio)
              : '',
          priceSource: existing?.priceSource ?? item.priceSource ?? 'manual',
          sourceConfigurationId: existing?.sourceConfigurationId ?? item.sourceConfigurationId,
        },
      ];
    }),
  );
};
const buildPriceRows = (row: SlabItem, mode: 'detail' | 'edit' = 'detail'): DrawerPriceRow[] =>
  buildSlabPriceRows(row, mode, publishOptions.storeLevels, markupConfigurations.value);
const fillPriceRows = (row: SlabItem) => {
  batchPriceRows.splice(0, batchPriceRows.length, ...buildPriceRows(row, 'edit'));
};
const openTableImage = (row: SlabItem) => {
  if (!row.image) return;
  uploadPreviewTitle.value = `${row.name} - 商品主图`;
  uploadPreviewUrl.value = row.image;
  uploadPreviewType.value = 'image';
  uploadPreviewDialogVisible.value = true;
};
const openMediaPreview = (media: DetailMediaItem) => {
  if (!media.url) return;
  uploadPreviewTitle.value = `${detailDrawerRow.value?.name ?? '大板'} - ${media.label}`;
  uploadPreviewUrl.value = media.url;
  uploadPreviewType.value = media.type;
  uploadPreviewDialogVisible.value = true;
};
const openOperationLogMediaPreview = (media: OperationLogMediaValue, title: string) => {
  if (!media.url) return;
  uploadPreviewTitle.value = media.message ? `${title}（${media.message}）` : title;
  uploadPreviewUrl.value = media.url;
  uploadPreviewType.value = media.mediaType;
  uploadPreviewDialogVisible.value = true;
};
const openDetailDrawer = async (row: SlabItem) => {
  try {
    const latest = toSlabItem(await getSlabDetail(row.id));
    detailDrawerRow.value = latest;
    detailPriceRows.value = buildPriceRows(latest);
    detailDrawerVisible.value = true;
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '大板详情加载失败，请重试');
  }
};
const openProductEditor = async (row: SlabItem) => {
  try {
    const [latest, options, configurations] = await Promise.all([
      getSlabDetail(row.id),
      getSlabPublishOptions(),
      Promise.resolve([]),
    ]);
    Object.assign(publishOptions, options);
    markupConfigurations.value = configurations;
    openProductDialog('edit', toSlabItem(latest));
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '大板资料加载失败，请重试');
  }
};
const closeDetailDrawer = () => {
  detailDrawerVisible.value = false;
  detailDrawerRow.value = null;
  detailPriceRows.value = [];
};
const openPriceDrawer = (row: SlabItem) => {
  drawerPriceSubmitted.value = false;
  drawerPriceSession.value += 1;
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
const fillProductForm = (row: SlabItem) => fillSlabProductForm(row, productForm, initializeProductMarkupPrices);
const openProductDialog = (mode: ProductMode, row?: SlabItem) => {
  productPriceSubmitted.value = false;
  productPriceSession.value += 1;
  if (pendingUploadedMediaIds.size) {
    const staleMediaIds = [...pendingUploadedMediaIds];
    pendingUploadedMediaIds.clear();
    void Promise.allSettled(staleMediaIds.map((mediaId) => releaseTemporarySlabMedia(mediaId)));
  }
  productMode.value = mode;
  publishTargetStatus.value =
    mode === 'create' ? 'warehouse' : resolveSlabPublishTargetStatus(row?.status || activeTab.value);
  productTab.value = mode === 'view' ? 'sales' : 'images';
  editingRowId.value = row?.id ?? null;
  resetProductForm();
  if (mode === 'create' && guidePriceSettingCoefficient.value != null) {
    productForm.guideRatio = formatRatio(guidePriceSettingCoefficient.value);
  }
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
    uploadPreviews.main = { name: '商品主图', mediaId: row.mainImageMediaId, url: row.image };
  }
  if (row?.scanImageUrl) {
    uploadPreviews.scan = { name: '扫描图', mediaId: row.scanImageMediaId, url: row.scanImageUrl };
  }
  if (row?.designImageUrl) {
    uploadPreviews.design = { name: '设计图', mediaId: row.designImageMediaId, url: row.designImageUrl };
  }
  if (row?.videoUrl) {
    uploadPreviews.video = {
      name: '商品视频',
      videoMediaId: row.videoMediaId,
      videoUrl: row.videoUrl,
      coverMediaId: row.videoCoverMediaId,
      coverUrl: row.videoCoverUrl,
    };
  }
  productDialogVisible.value = true;
};
const closeProductDialog = () => {
  productDialogVisible.value = false;
  productFormRef.value?.clearValidate();
  salesFormRef.value?.clearValidate();
  const abandonedMediaIds = [...pendingUploadedMediaIds];
  pendingUploadedMediaIds.clear();
  if (abandonedMediaIds.length) {
    void Promise.allSettled(abandonedMediaIds.map((mediaId) => releaseTemporarySlabMedia(mediaId)));
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
const handleStockKeydown = (
  _value?: unknown,
  context?: {
    e?: KeyboardEvent;
  },
) => {
  const event = context?.e;
  if (!event || event.ctrlKey || event.metaKey || event.altKey) return;
  const allowedKeys = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (/^\d$/.test(event.key) || allowedKeys.includes(event.key)) return;
  event.preventDefault();
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
  productPriceSubmitted.value = true;
  if (productMode.value === 'view') {
    closeProductDialog();
    return;
  }
  const missingRequiredUploads = uploadItems.filter((item) => item.required && !uploadPreviews[item.key]);
  uploadItems.forEach((item) => {
    uploadErrors[item.key] = missingRequiredUploads.some((missingItem) => missingItem.key === item.key);
  });
  if (missingRequiredUploads.length > 0) {
    focusProductSection('images');
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
    focusProductSection('base');
    await nextTick();
    await productFormRef.value?.validate({ trigger: 'all', showErrorMessage: true });
    adminFeedback.warning('请完善基础信息');
    return;
  }
  const normalizedStock = String(productForm.stock ?? '').trim();
  const hasInvalidSalesPrice = false;
  const hasInvalidGuidePrice = false;
  const hasInvalidSalesInformation =
    !String(productForm.supplier ?? '').trim() ||
    !isValidSalesNumber(productForm.cost, 0) ||
    stockHasLeadingZero.value ||
    !/^[1-9]\d*$/.test(normalizedStock) ||
    hasInvalidSalesPrice ||
    hasInvalidGuidePrice;
  if (hasInvalidSalesInformation) {
    focusProductSection('sales');
    await nextTick();
    await salesFormRef.value?.validate({ trigger: 'all', showErrorMessage: true });
    adminFeedback.warning(
      normalizedStock === '0'
        ? '库存不能为0'
        : stockHasLeadingZero.value || (normalizedStock && !/^[1-9]\d*$/.test(normalizedStock))
          ? '请输入正确的库存'
          : hasInvalidSalesPrice || hasInvalidGuidePrice || !isValidSalesNumber(productForm.cost, 0)
            ? '请完善价格信息'
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
    stock: Number(normalizedStock),
    supplierId: supplierIdByName(productForm.supplier) ?? editingItem?.supplierId,
    varietyId: varietyIdByName(productForm.variety),
    originId: originIdByName(productForm.origin),
    textureId: productForm.textureId,
    colorId: productForm.colorId,
    gradeId: productForm.gradeId,
    name: targetName,
    serialNo: productForm.sku.trim(),
    warehouse: editingItem?.store && editingItem.store !== '-' ? editingItem.store : '平台仓',
    publisherType: editingItem?.publisherType || '平台发布',
    mainImageMediaId: uploadPreviews.main?.mediaId,
    scanImageMediaId: uploadPreviews.scan?.mediaId,
    designImageMediaId: uploadPreviews.design?.mediaId,
    videoMediaId: uploadPreviews.video?.videoMediaId,
    videoCoverMediaId: uploadPreviews.video?.coverMediaId,
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
    areaSquareMeter: productAreaSquareMeter.value,
    costPrice: toNumber(productForm.cost),
    guidePrice: undefined,
    guidePriceCoefficient: undefined,
    markupPrices: undefined,
    status: publishTargetStatus.value,
  };
  saving.value = true;
  try {
    if (productMode.value === 'edit' && editingItem) {
      upsertSlabItem(await updateSlab(editingItem.id, payload));
    } else {
      upsertSlabItem(await createSlab(payload));
      activeTab.value = publishTargetStatus.value;
      paginations[publishTargetStatus.value].current = 1;
    }
    pendingUploadedMediaIds.clear();
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
const uploadSlabMedia = async (_item: (typeof uploadItems)[number], file: File): Promise<AdminMediaValue> => {
  let nextVideoUrl: string | undefined;
  try {
    if (file.type.startsWith('video/')) {
      nextVideoUrl = URL.createObjectURL(file);
      const cover = await createVideoFirstFrame(nextVideoUrl);
      const uploadedVideo = await uploadSlabImage(file);
      pendingUploadedMediaIds.add(uploadedVideo.id);
      let uploadedCover;
      try {
        uploadedCover = await uploadSlabImage(new File([cover], `${file.name}-cover.jpg`, { type: 'image/jpeg' }));
        pendingUploadedMediaIds.add(uploadedCover.id);
      } catch (error) {
        pendingUploadedMediaIds.delete(uploadedVideo.id);
        void releaseTemporarySlabMedia(uploadedVideo.id);
        throw error;
      }
      return {
        name: file.name,
        videoMediaId: uploadedVideo.id,
        videoUrl: uploadedVideo.url,
        coverMediaId: uploadedCover.id,
        coverUrl: uploadedCover.url,
      };
    } else {
      const uploaded = await uploadSlabImage(file);
      pendingUploadedMediaIds.add(uploaded.id);
      return { name: file.name, mediaId: uploaded.id, url: uploaded.url };
    }
  } finally {
    if (nextVideoUrl) URL.revokeObjectURL(nextVideoUrl);
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
const handleUploadBoxClick = (item: (typeof uploadItems)[number], event: MouseEvent) => {
  const preview = uploadPreviews[item.key];
  if (!preview?.videoUrl && !preview?.url) return;
  if (event.target instanceof Element && event.target.closest('.admin-media-upload__delete')) return;
  event.preventDefault();
  event.stopPropagation();
  openUploadPreview(item);
};
const releasePendingUpload = (removed: AdminMediaValue) => {
  const removedPendingMediaIds = [removed.mediaId, removed.videoMediaId, removed.coverMediaId].filter(
    (mediaId): mediaId is number => Boolean(mediaId && pendingUploadedMediaIds.has(mediaId)),
  );
  removedPendingMediaIds.forEach((mediaId) => pendingUploadedMediaIds.delete(mediaId));
  if (removedPendingMediaIds.length) {
    void Promise.allSettled(removedPendingMediaIds.map((mediaId) => releaseTemporarySlabMedia(mediaId)));
  }
  const removedUrl = removed.videoUrl || removed.url;
  if (removedUrl && uploadPreviewUrl.value === removedUrl) {
    uploadPreviewDialogVisible.value = false;
    uploadPreviewTitle.value = '';
    uploadPreviewUrl.value = '';
    uploadPreviewType.value = 'image';
  }
};
const updateSlabStatus = async (id: number, status: SlabStatus, reason?: string, detail?: string) => {
  const item = tableData.value.find((candidate) => candidate.id === id);
  if (!item) return;
  await updateSlabStatuses([id], status, reason, detail);
  item.status = status;
};
const updateSelectedSlabStatuses = async (status: SlabStatus, reason?: string, detail?: string) => {
  const selectedIds = [...selectedKeys.value];
  await updateSlabStatuses(selectedIds, status, reason, detail);
  const selectedIdSet = new Set(selectedIds);
  tableData.value.forEach((item) => {
    if (!selectedIdSet.has(item.id)) return;
    item.status = status;
  });
};
const shelfBlockingMessage = (row: SlabItem) => {
  if (!row.mainImageMediaId || !row.scanImageMediaId || !row.designImageMediaId) {
    return '请完善大板图片后再上架';
  }
  if (
    !row.varietyId ||
    !row.originId ||
    !row.textureId ||
    !row.colorId ||
    !row.gradeId ||
    row.lengthMm == null ||
    row.widthMm == null ||
    row.thicknessMm == null
  ) {
    return '请完善大板基础信息后再上架';
  }
  if (!row.supplierId) return '请完善大板销售信息后再上架';
  if (!isValidSalesNumber(row.price.cost, 0)) {
    return '请完善大板价格后再上架';
  }
  return '';
};
const canStartShelf = (rows: SlabItem[]) => {
  const blockedRow = rows.find((row) => shelfBlockingMessage(row));
  if (!blockedRow) return true;
  const message = shelfBlockingMessage(blockedRow);
  adminFeedback.warning(rows.length > 1 ? `“${blockedRow.name}”：${message}` : message);
  return false;
};
const checkingAction = ref(false);
const canStartAction = async (
  ids: number[],
  action: 'shelf' | 'offShelf' | 'restore' | 'delete' | 'purge' | 'clearRecycle',
) => {
  if (checkingAction.value) return false;
  checkingAction.value = true;
  try {
    await checkSlabAction(ids, action);
    return true;
  } catch (error) {
    await loadSlabs();
    if (tableData.value.some((row) => ids.includes(row.id) && sourceBlocked(row))) return false;
    const message = error instanceof Error ? error.message : '当前商品无法执行此操作';
    adminFeedback.warning(action === 'shelf' && message === '请完善全部大板价格' ? `${message}后再上架` : message);
    return false;
  } finally {
    checkingAction.value = false;
  }
};
const handleBatchAction = async (action: BatchAction) => {
  if (saving.value) return;
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
    if (!(await canStartAction([...selectedKeys.value], 'offShelf'))) return;
    openReasonDialog('offShelf', null, true);
    return;
  }
  if (action === 'batchRestore') {
    if (!selectedKeys.value.length) {
      adminFeedback.warning('请先选择大板');
      return;
    }
    if (!(await canStartAction([...selectedKeys.value], 'restore'))) return;
    openConfirm('batchRestore', null, '是否批量放回到仓库？');
    return;
  }
  if (action === 'batchPurge') {
    if (!selectedKeys.value.length) {
      adminFeedback.warning('请先选择大板');
      return;
    }
    if (!(await canStartAction([...selectedKeys.value], 'purge'))) return;
    openConfirm('batchPurge', null, '彻底删除后无法恢复，是否批量彻底删除所选大板？');
    return;
  }
  if (!(await canStartAction([], 'clearRecycle'))) return;
  openConfirm('clearRecycle', null, '清空后所有回收站大板将无法恢复，是否清空回收站？');
};
const handleRowAction = async (action: RowAction, row: SlabItem) => {
  if (sourceBlocked(row) && !['purge', 'detail'].includes(action)) return;
  if (['shelf', 'offShelf', 'restore', 'delete', 'purge'].includes(action)) {
    if (
      !(await canStartAction(
        [row.id],
        action as 'shelf' | 'offShelf' | 'restore' | 'delete' | 'purge' | 'clearRecycle',
      ))
    )
      return;
  }
  if (action === 'detail') void openDetailDrawer(row);
  if (action === 'price') openPriceDrawer(row);
  if (action === 'edit') void openProductEditor(row);
  if (action === 'shelf' && canStartShelf([row])) openConfirm('shelf', row, `是否上架大板“${row.name}”？`);
  if (action === 'delete') {
    openConfirm('delete', row, `删除后大板将进入回收站，是否删除大板“${row.name}”？`);
  }
  if (action === 'restore') openConfirm('restore', row, `是否放回仓库“${row.name}”？`);
  if (action === 'purge') openConfirm('purge', row, `彻底删除后无法恢复，是否彻底删除大板“${row.name}”？`);
  if (action === 'offShelf') openReasonDialog('offShelf', row);
};
const loadOperationLogs = async () => {
  operationLogLoading.value = true;
  try {
    const [startDate, endDate] = appliedOperationLogFilter.dateRange;
    const result = await listSlabOperationLogs({
      keyword: appliedOperationLogFilter.keyword.trim(),
      operationType: appliedOperationLogFilter.operationType,
      operatorName: appliedOperationLogFilter.operatorName.trim(),
      startDate,
      endDate,
      page: operationLogPagination.current,
      pageSize: operationLogPagination.pageSize,
    });
    operationLogs.value = result.records;
    operationLogTotal.value = result.total;
  } catch (error) {
    adminFeedback.actionError({ action: '加载操作日志', error, fallback: '请稍后重试' });
  } finally {
    operationLogLoading.value = false;
  }
};
const openOperationLogDrawer = async () => {
  operationLogDrawerVisible.value = true;
  operationLogPagination.current = 1;
  await loadOperationLogs();
};
const handleOperationLogSearch = async () => {
  Object.assign(appliedOperationLogFilter, operationLogFilter, { dateRange: [...operationLogFilter.dateRange] });
  operationLogPagination.current = 1;
  await loadOperationLogs();
};
const handleOperationLogReset = async () => {
  Object.assign(operationLogFilter, makeOperationLogFilter());
  await handleOperationLogSearch();
};
const openOperationLogDetailById = (id: number) => {
  operationLogDetail.value = operationLogs.value.find((record) => record.id === id) || null;
  operationLogDetailVisible.value = Boolean(operationLogDetail.value);
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
  if (saving.value) return;
  const type = confirmState.type;
  const row = confirmState.row;
  const selectedCount = selectedKeys.value.length;
  const recycleIds = tableData.value.filter((item) => item.status === 'recycle').map((item) => item.id);
  saving.value = true;
  try {
    if (type === 'shelf' && row) await updateSlabStatus(row.id, 'selling');
    if (type === 'delete' && row) {
      await removeSlab(row.id);
      row.status = 'recycle';
    }
    if (type === 'restore' && row) await updateSlabStatus(row.id, 'warehouse');
    if (type === 'savePrice' && row) {
      const costPrice = toNumber(batchPriceRows[0]?.price ?? '');
      {
        upsertSlabItem(await updateSlabSourceCost(row.id, costPrice));
        closePriceDrawer();
      }
    }
    if (type === 'batchRestore') {
      await updateSelectedSlabStatuses('warehouse');
    }
    if (type === 'batchShelf') {
      const ids = [...selectedKeys.value];
      const failed = new Map<number, string>();
      let succeeded = 0;
      for (const id of ids) {
        delete shelfErrors[id];
        try {
          await updateSlabStatus(id, 'selling');
          succeeded++;
        } catch (error) {
          failed.set(id, error instanceof Error ? error.message : '上架失败，请重试');
        }
      }
      await loadSlabs();
      for (const [id, message] of failed) {
        const latest = tableData.value.find((item) => item.id === id);
        if (latest?.status === 'selling') {
          succeeded++;
          failed.delete(id);
        } else if (latest && !sourceBlocked(latest)) {
          shelfErrors[id] = message;
        }
      }
      selectedKeys.value = ids.filter(
        (id) =>
          failed.has(id) &&
          tableData.value.some((item) => item.id === id && !sourceBlocked(item) && item.status === 'warehouse'),
      );
      ensureCurrentPage();
      closeConfirmDialog();
      const message = `已上架 ${succeeded} 个大板，未上架 ${failed.size} 个大板`;
      if (failed.size) adminFeedback.warning(message);
      else adminFeedback.success(message);
      return;
    }
    if (type === 'purge' && row) {
      await deleteSlab(row.id);
      tableData.value = tableData.value.filter((item) => item.id !== row.id);
    }
    if (type === 'batchPurge') {
      const selectedIds = [...selectedKeys.value];
      await deleteSlabs(selectedIds);
      const deletedIds = new Set(selectedIds);
      tableData.value = tableData.value.filter((item) => !deletedIds.has(item.id));
    }
    if (type === 'clearRecycle') {
      await clearRecycleSlabs();
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
    else if (type === 'savePrice' && row) adminFeedback.success('价格保存成功');
    else if (type === 'batchRestore') {
      adminFeedback.actionSuccess({ action: '批量放回到仓库', target: `${selectedCount} 个大板` });
    } else if (type === 'purge' && row) {
      adminFeedback.actionSuccess({ action: '彻底删除', target: row.name });
    } else if (type === 'batchPurge') {
      adminFeedback.actionSuccess({ action: '批量彻底删除', target: `${selectedCount} 个大板` });
    } else if (type === 'clearRecycle') {
      adminFeedback.actionSuccess({ action: '清空回收站', target: `${recycleIds.length} 个大板` });
    }
  } catch (error) {
    await loadSlabs();
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
const openReasonDialog = (type: 'deleteExternal' | 'offShelf', row: SlabItem | null, isBatch = false) => {
  reasonState.type = type;
  reasonState.row = row;
  reasonState.isBatch = isBatch;
  reasonForm.reason = '';
  reasonForm.detail = '';
  reasonDialogVisible.value = true;
  nextTick(() => reasonFormRef.value?.clearValidate());
};
const closeReasonDialog = () => {
  reasonDialogVisible.value = false;
  reasonState.row = null;
  reasonState.isBatch = false;
  reasonFormRef.value?.clearValidate();
};
const openOffShelfHistory = (row: SlabItem) => {
  offShelfHistoryRow.value = row;
  offShelfHistoryVisible.value = true;
};
const closeOffShelfHistory = () => {
  offShelfHistoryVisible.value = false;
  offShelfHistoryRow.value = null;
};
const handleReasonSubmit = async () => {
  if (!reasonForm.reason) {
    await reasonFormRef.value?.validate({ trigger: 'submit', showErrorMessage: true });
    adminFeedback.warning(reasonState.type === 'deleteExternal' ? '请选择删除原因' : '请选择下架原因');
    return;
  }
  const validation = await reasonFormRef.value?.validate({ trigger: 'submit', showErrorMessage: true });
  if (validation !== true) {
    adminFeedback.warning(reasonState.type === 'deleteExternal' ? '请完善删除信息' : '请选择原因');
    return;
  }
  if (reasonState.type === 'offShelf' && reasonState.isBatch) {
    const selectedCount = selectedKeys.value.length;
    saving.value = true;
    try {
      await updateSelectedSlabStatuses('offShelf', reasonForm.reason, reasonForm.detail.trim() || undefined);
      selectedKeys.value = [];
      await loadSlabs();
      ensureCurrentPage();
      closeReasonDialog();
      adminFeedback.actionSuccess({ action: '批量下架', target: `${selectedCount} 个大板` });
    } catch (error) {
      await loadSlabs();
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
  if (reasonState.type === 'offShelf' && reasonState.row) {
    saving.value = true;
    try {
      await updateSlabStatus(reasonState.row.id, 'offShelf', reasonForm.reason, reasonForm.detail.trim() || undefined);
      await loadSlabs();
      ensureCurrentPage();
      const targetName = reasonState.row.name;
      closeReasonDialog();
      adminFeedback.actionSuccess({ action: '下架', target: targetName });
    } catch (error) {
      await loadSlabs();
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
  if (reasonState.type === 'deleteExternal' && reasonState.row) {
    const row = reasonState.row;
    saving.value = true;
    try {
      await removeSlab(row.id, {
        reason: reasonForm.reason.trim(),
        detail: reasonForm.detail.trim(),
      });
      tableData.value = tableData.value.filter((item) => item.id !== row.id);
      ensureCurrentPage();
      closeReasonDialog();
      adminFeedback.actionSuccess({ action: '删除', target: row.name });
    } catch (error) {
      await loadSlabs();
      adminFeedback.actionError({ action: '删除', error, fallback: '请稍后重试', target: row.name });
    } finally {
      saving.value = false;
    }
  }
};
const closePriceDrawer = () => {
  priceDrawerVisible.value = false;
  priceDrawerRowId.value = null;
  priceDrawerFormRef.value?.clearValidate();
};
const saveBatchPrice = async () => {
  if (priceDrawerReadonly.value || saving.value) return;
  drawerPriceSubmitted.value = true;
  const hasInvalidPrice = !isValidSalesNumber(batchPriceRows[0]?.price ?? '', 0);
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

<style scoped src="../shared/index.css"></style>
