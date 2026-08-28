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
          <div class="page-header-actions">
            <t-link v-if="canViewOperationLogs" theme="primary" hover="color" @click="openOperationLogDrawer">
              操作日志
            </t-link>
          </div>
        </header>

        <section class="filter-card">
          <t-tabs v-if="showSlabTabRail" v-model="activeTab" class="status-tabs" @change="handleTabChange">
            <t-tab-panel v-for="tab in slabTabs" :key="tab.value" :value="tab.value" :label="tabLabel(tab)" />
          </t-tabs>

          <t-form :data="currentFilter" label-width="44px" colon>
            <div class="filter-row">
              <div class="filter-fields">
                <div class="filter-primary-row" :class="{ 'off-shelf-filter-row': activeTab === 'offShelf' }">
                  <t-form-item label="大板" class="slab-keyword-filter">
                    <t-input v-model="currentFilter.keyword" clearable placeholder="大板名称/ID/SKU" />
                  </t-form-item>
                  <t-form-item label="品种">
                    <t-select v-model="currentFilter.variety" clearable filterable placeholder="请选择">
                      <t-option v-for="item in varietyOptions" :key="item" :label="item" :value="item" />
                    </t-select>
                  </t-form-item>
                  <template v-if="activeTab === 'offShelf'">
                    <t-form-item label="下架原因" label-width="72px">
                      <t-select v-model="currentFilter.offShelfReason" clearable filterable placeholder="请选择">
                        <t-option v-for="item in offShelfReasons" :key="item" :label="item" :value="item" />
                      </t-select>
                    </t-form-item>
                    <t-form-item label="下架人" label-width="60px">
                      <t-input v-model="currentFilter.offShelvedBy" clearable placeholder="请输入下架人" />
                    </t-form-item>
                    <t-form-item label="下架时间" label-width="72px" class="off-shelf-date-filter">
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
                  </template>
                </div>
                <div class="filter-secondary-row">
                  <t-form-item
                    v-if="activeTab !== 'offShelf'"
                    label="供应商"
                    label-width="60px"
                    class="supplier-filter"
                  >
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
                <div class="slab-code">SKU：{{ row.code }}</div>
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
                <span class="off-shelf-reason-primary">{{ latestOffShelfRecord(row)?.standardReason || '-' }}</span>
                <div class="off-shelf-reason-detail-row">
                  <t-tooltip
                    class="off-shelf-detail-tooltip"
                    :content="latestOffShelfRecord(row)?.detailReason || '-'"
                    placement="bottom-left"
                  >
                    <span class="off-shelf-reason-secondary">{{ latestOffShelfRecord(row)?.detailReason || '-' }}</span>
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
            <AdminMediaUpload
              v-for="item in uploadItems"
              :key="item.key"
              v-model="uploadPreviews[item.key]"
              :title="item.title"
              :label="item.label"
              :required="item.required"
              :accept="item.accept"
              :disabled="productMode === 'view'"
              :error-message="uploadErrors[item.key] ? `请上传${item.title}` : ''"
              :upload="(file) => uploadSlabMedia(item, file)"
              @uploaded="uploadErrors[item.key] = false"
              @removed="releasePendingUpload"
              @preview="openUploadPreview(item)"
            />
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
                    :label="item.label"
                    :value="item.label"
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
                <span><span class="price-required-star">*</span>价格系数</span>
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
                  :rules="salesNumberFieldRules('指导价的价格系数', 0)"
                  label-width="0"
                  :required-mark="false"
                >
                  <t-input-number
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
                <span>
                  {{ item.label }}
                  <t-tag :theme="priceSourceTheme(productForm.markupPrices[item.id]?.priceSource)" variant="light">
                    {{ priceSourceLabel(productForm.markupPrices[item.id]?.priceSource, item.id) }}
                  </t-tag>
                  <t-link
                    v-if="
                      productMode !== 'view' &&
                      canRestoreAutoPrice(item.id, productForm.markupPrices[item.id]?.priceSource)
                    "
                    theme="primary"
                    hover="color"
                    @click="restoreProductAutoPrice(item.id)"
                  >
                    恢复跟随配置
                  </t-link>
                </span>
                <t-form-item
                  class="price-form-item"
                  :name="`markupPrices.${item.id}.ratio`"
                  :rules="salesNumberFieldRules(`${item.label}的价格系数`, 0)"
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
                    @change="
                      (value: unknown, context: SalesNumberChangeContext) =>
                        handlePartnerRatioChange(item.id, value, context)
                    "
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
                    @change="
                      (value: unknown, context: SalesNumberChangeContext) =>
                        handlePartnerPriceChange(item.id, value, context)
                    "
                  />
                </t-form-item>
              </div>
            </div>
          </t-form>
        </t-tab-panel>
      </t-tabs>
    </t-dialog>

    <t-drawer
      v-model:visible="detailDrawerVisible"
      header="大板详情"
      placement="right"
      size="760px"
      :footer="false"
      @close="closeDetailDrawer"
    >
      <div v-if="detailDrawerRow" class="slab-detail-drawer">
        <section class="slab-detail-section">
          <h3>图片</h3>
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
        </section>

        <section class="slab-detail-section">
          <h3>基础信息</h3>
          <t-descriptions bordered :column="2">
            <t-descriptions-item label="大板名称" :span="2">{{ detailDrawerRow.name }}</t-descriptions-item>
            <t-descriptions-item label="ID">{{ detailDrawerRow.id }}</t-descriptions-item>
            <t-descriptions-item label="SKU">{{ detailDrawerRow.code }}</t-descriptions-item>
            <t-descriptions-item label="品种">{{ detailDrawerRow.variety }}</t-descriptions-item>
            <t-descriptions-item label="产地">{{ detailDrawerRow.origin }}</t-descriptions-item>
            <t-descriptions-item label="纹理">{{ detailDrawerRow.texture }}</t-descriptions-item>
            <t-descriptions-item label="色系">{{ detailDrawerRow.color }}</t-descriptions-item>
            <t-descriptions-item label="等级">{{ detailDrawerRow.grade }}</t-descriptions-item>
            <t-descriptions-item label="尺寸">{{ detailDrawerRow.size }}</t-descriptions-item>
            <t-descriptions-item label="误差">{{ formatMillimeter(detailDrawerRow.toleranceMm) }}</t-descriptions-item>
            <t-descriptions-item label="面积">{{ formatArea(detailDrawerRow.areaSquareMeter) }}</t-descriptions-item>
            <t-descriptions-item label="扣角1">{{ formatCorner(detailDrawerRow, 1) }}</t-descriptions-item>
            <t-descriptions-item label="扣角2">{{ formatCorner(detailDrawerRow, 2) }}</t-descriptions-item>
            <t-descriptions-item label="扣角3">{{ formatCorner(detailDrawerRow, 3) }}</t-descriptions-item>
            <t-descriptions-item label="扣角4">{{ formatCorner(detailDrawerRow, 4) }}</t-descriptions-item>
          </t-descriptions>
        </section>

        <section class="slab-detail-section">
          <h3>销售信息</h3>
          <t-descriptions bordered :column="2">
            <t-descriptions-item label="供应商">{{ detailDrawerRow.tenant }}</t-descriptions-item>
            <t-descriptions-item label="仓库">{{ detailDrawerRow.store }}</t-descriptions-item>
            <t-descriptions-item label="发布方式">{{ detailDrawerRow.publisherType }}</t-descriptions-item>
            <t-descriptions-item label="创建人">{{ detailDrawerRow.createdByName }}</t-descriptions-item>
            <t-descriptions-item label="创建时间" :span="2">{{ detailDrawerRow.createdAt }}</t-descriptions-item>
          </t-descriptions>
          <div class="price-table detail-price-table">
            <div class="price-table__head">
              <span>价格层级</span>
              <span>价格系数</span>
              <span>价格</span>
            </div>
            <div
              v-for="row in detailPriceRows"
              :key="`${row.configurationId ?? row.label}-${row.label}`"
              class="price-table__row"
            >
              <span>{{ row.label }}</span>
              <span>{{ row.ratio || '-' }}</span>
              <span>{{ row.price || '-' }}</span>
            </div>
          </div>
        </section>
      </div>
    </t-drawer>

    <t-drawer
      v-model:visible="operationLogDrawerVisible"
      header="操作日志"
      placement="right"
      size="min(1240px, 100vw)"
      :footer="false"
    >
      <div class="operation-log-drawer">
        <t-form :data="operationLogFilter" label-width="44px" colon>
          <div class="operation-log-filters">
            <t-form-item label="大板" class="operation-log-keyword-filter">
              <t-input v-model="operationLogFilter.keyword" clearable placeholder="大板名称/ID/SKU" />
            </t-form-item>
            <t-form-item label="操作类型" label-width="72px">
              <t-select v-model="operationLogFilter.operationType" clearable placeholder="请选择">
                <t-option v-for="item in operationTypeOptions" :key="item.value" v-bind="item" />
              </t-select>
            </t-form-item>
            <t-form-item label="操作人" label-width="60px" class="operation-log-operator-filter">
              <t-input v-model="operationLogFilter.operatorName" clearable placeholder="请输入操作人" />
            </t-form-item>
            <t-form-item label="操作时间" label-width="72px" class="operation-log-date-filter">
              <t-date-range-picker
                v-model="operationLogFilter.dateRange"
                class="operation-log-date-picker"
                clearable
                allow-input
                value-type="YYYY-MM-DD"
                :placeholder="['开始日期', '结束日期']"
              />
            </t-form-item>
            <div class="operation-log-filter-actions">
              <t-button theme="primary" @click="handleOperationLogSearch">
                <template #icon><t-icon name="search" /></template>
                查询
              </t-button>
              <t-button theme="default" variant="base" @click="handleOperationLogReset">
                <template #icon><t-icon name="refresh" /></template>
                重置
              </t-button>
            </div>
          </div>
        </t-form>
        <t-table
          row-key="id"
          :data="operationLogs"
          :columns="operationLogColumns"
          :loading="operationLogLoading"
          table-layout="fixed"
          hover
        >
          <template #slab="{ row }">
            <div class="slab-meta">
              <div class="slab-name">{{ row.slabName }}</div>
              <div class="slab-code">ID：{{ row.slabId }}</div>
              <div class="slab-code">SKU：{{ row.slabSerialNo }}</div>
            </div>
          </template>
          <template #operationType="{ row }">{{ operationTypeLabel(row.operationType) }}</template>
          <template #summary="{ row }">
            <div class="operation-log-summary">
              <span>{{ row.operationSummary || '-' }}</span>
              <span v-if="row.standardReason || row.detailReason" class="slab-code">
                {{ [row.standardReason, row.detailReason].filter(Boolean).join('：') }}
              </span>
            </div>
          </template>
          <template #operatedAt="{ row }">{{ formatDateTime(row.operatedAt) }}</template>
          <template #operation="{ row }">
            <t-link theme="primary" hover="color" @click="openOperationLogDetail(row)">详情</t-link>
          </template>
        </t-table>
        <t-empty v-if="!operationLogLoading && !operationLogs.length" description="暂无操作日志" />
        <AdminPagination
          v-if="operationLogTotal"
          v-model:current="operationLogPagination.current"
          v-model:page-size="operationLogPagination.pageSize"
          :total="operationLogTotal"
          :page-size-options="pageSizeOptions"
          @change="loadOperationLogs"
        />
      </div>
    </t-drawer>

    <AdminDialog
      v-model:visible="operationLogDetailVisible"
      header="操作详情"
      width="960px"
      dialog-class-name="operation-log-detail-dialog"
      :cancel-btn="null"
      confirm-btn="关闭"
      @confirm="operationLogDetailVisible = false"
    >
      <template v-if="operationLogDetail">
        <div class="operation-log-detail">
          <div class="operation-log-detail__section-title">操作信息</div>
          <t-descriptions bordered :column="3">
            <t-descriptions-item label="大板名称">{{ operationLogDetail.slabName }}</t-descriptions-item>
            <t-descriptions-item label="SKU">{{ operationLogDetail.slabSerialNo }}</t-descriptions-item>
            <t-descriptions-item label="操作类型">
              {{ operationTypeLabel(operationLogDetail.operationType) }}
            </t-descriptions-item>
            <t-descriptions-item label="操作人">{{ operationLogDetail.operatorName }}</t-descriptions-item>
            <t-descriptions-item label="操作时间">{{
              formatDateTime(operationLogDetail.operatedAt)
            }}</t-descriptions-item>
            <t-descriptions-item label="操作来源">{{
              operationSourceLabel(operationLogDetail.operationSource)
            }}</t-descriptions-item>
            <t-descriptions-item label="操作内容" :span="2">
              {{ operationLogDetail.operationSummary || '未填写' }}
            </t-descriptions-item>
            <t-descriptions-item label="状态变化">
              {{ formatStatusChange(operationLogDetail) }}
            </t-descriptions-item>
          </t-descriptions>

          <template v-if="operationLogChangeRows.length">
            <div class="operation-log-detail__section-title operation-log-detail__section-title--spaced">
              变更对比
              <t-tag theme="primary" variant="light">{{ operationLogChangeRows.length }} 项</t-tag>
            </div>
            <div class="operation-log-diff-list">
              <div v-for="row in operationLogChangeRows" :key="row.field" class="operation-log-diff-item">
                <div class="operation-log-diff-item__field">{{ row.field }}</div>
                <div v-if="row.mediaType" class="operation-log-media-after">
                  <div class="operation-log-diff-value operation-log-diff-value--after">
                    <span class="operation-log-diff-value__label">修改后</span>
                    <img
                      v-if="row.afterMedia?.available && row.afterMedia.url && row.afterMedia.mediaType === 'image'"
                      class="operation-log-media-preview operation-log-media-preview--image"
                      :src="row.afterMedia.url"
                      :alt="`${row.field}修改后`"
                      @click="openOperationLogMediaPreview(row.afterMedia, `${row.field} - 修改后`)"
                    />
                    <video
                      v-else-if="
                        row.afterMedia?.available && row.afterMedia.url && row.afterMedia.mediaType === 'video'
                      "
                      class="operation-log-media-preview operation-log-media-preview--video"
                      :src="row.afterMedia.url"
                      preload="metadata"
                      muted
                      playsinline
                      @click="openOperationLogMediaPreview(row.afterMedia, `${row.field} - 修改后`)"
                    />
                    <span v-else class="operation-log-media-empty">{{ mediaAfterFallback(row.afterMedia) }}</span>
                  </div>
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
                      <span>价格：{{ tier.beforePrice }}</span>
                    </div>
                    <t-icon name="arrow-right" class="operation-log-diff-arrow" />
                    <div class="operation-log-diff-value operation-log-diff-value--after">
                      <span>价格系数：{{ tier.afterCoefficient }}</span>
                      <span>价格：{{ tier.afterPrice }}</span>
                    </div>
                  </template>
                </div>
                <div v-else class="operation-log-diff-comparison">
                  <div class="operation-log-diff-value operation-log-diff-value--before">
                    <span class="operation-log-diff-value__label">修改前</span>
                    <span>{{ row.before }}</span>
                  </div>
                  <t-icon name="arrow-right" class="operation-log-diff-arrow" />
                  <div class="operation-log-diff-value operation-log-diff-value--after">
                    <span class="operation-log-diff-value__label">修改后</span>
                    <span>{{ row.after }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template
            v-if="operationLogDetail.standardReason || operationLogDetail.detailReason || operationLogDetail.batchNo"
          >
            <div class="operation-log-detail__section-title operation-log-detail__section-title--spaced">操作说明</div>
            <t-descriptions bordered :column="2">
              <t-descriptions-item label="原因">{{
                operationLogDetail.standardReason || '未填写'
              }}</t-descriptions-item>
              <t-descriptions-item label="批次号">{{ operationLogDetail.batchNo || '未填写' }}</t-descriptions-item>
              <t-descriptions-item label="详细说明" :span="2">
                <span class="operation-log-detail__long-text">{{ operationLogDetail.detailReason || '未填写' }}</span>
              </t-descriptions-item>
            </t-descriptions>
          </template>
        </div>
      </template>
    </AdminDialog>

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
              <span><span class="price-required-star">*</span>价格系数</span>
              <span><span class="price-required-star">*</span>价格</span>
            </div>
            <div v-for="(row, index) in batchPriceRows" :key="row.label" class="price-table__row">
              <span>
                {{ row.label }}
                <template v-if="row.configurationId != null">
                  <t-tag :theme="priceSourceTheme(row.priceSource)" variant="light">
                    {{ priceSourceLabel(row.priceSource, row.configurationId) }}
                  </t-tag>
                  <t-link
                    v-if="!priceDrawerReadonly && canRestoreAutoPrice(row.configurationId, row.priceSource)"
                    theme="primary"
                    hover="color"
                    @click="restoreBatchAutoPrice(row)"
                  >
                    恢复跟随配置
                  </t-link>
                </template>
              </span>
              <t-input v-if="index === 0" class="price-input" model-value="1.00" disabled />
              <t-form-item
                v-else
                class="price-form-item"
                :name="`rows.${index}.ratio`"
                :rules="salesNumberFieldRules(`${row.label}的价格系数`, 0)"
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
                  @change="
                    (value: unknown, context: SalesNumberChangeContext) => handleBatchRatioChange(index, value, context)
                  "
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
                  @change="
                    (value: unknown, context: SalesNumberChangeContext) => handleBatchPriceChange(index, value, context)
                  "
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
import type { FormInstanceFunctions, FormRule, PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import {
  adminFeedback,
  AdminConfirmDialog,
  AdminDialog,
  AdminMediaUpload,
  AdminPagination,
  type AdminMediaValue,
} from '@/components/foundation';
import {
  getSlabGuidePriceSetting,
  listSlabMarkupConfigurationOptions,
  type SlabMarkupConfigurationRecord,
} from '@/services/slabMarkupConfigurations';
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
  removeSlab,
  releaseTemporarySlabMedia,
  resolveSlabPublishTargetStatus,
  uploadSlabImage,
  updateSlab,
  updateSlabStatuses,
  type SlabPayload,
  type SlabOperationLogRecord,
  type SlabOperationType,
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
type SalesNumberChangeContext = { type?: string };

interface FilterState {
  keyword: string;
  variety: string;
  origin: string;
  texture: string;
  color: string;
  grade: string;
  supplier: string;
  offShelfReason: string;
  offShelvedBy: string;
  offShelfDateRange: string[];
}

interface OperationLogFilterState {
  keyword: string;
  operationType: '' | SlabOperationType;
  operatorName: string;
  dateRange: string[];
}

interface OperationLogChangeRow {
  field: string;
  before: string;
  after: string;
  priceTiers?: OperationLogPriceTierRow[];
  mediaType?: 'image' | 'video';
  afterMedia?: OperationLogMediaValue;
}

interface OperationLogPriceTierRow {
  key: string;
  label: string;
  beforeCoefficient: string;
  beforePrice: string;
  afterCoefficient: string;
  afterPrice: string;
}

interface OperationLogMediaValue {
  available: boolean;
  url?: string;
  mediaType: 'image' | 'video';
  mimeType?: string;
  originalName?: string;
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
  priceSource?: 'auto' | 'manual';
  sourceConfigurationId?: number;
}

interface DetailMediaItem {
  label: string;
  url?: string;
  coverUrl?: string;
  type: 'image' | 'video';
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
  mainImageMediaId?: number;
  scanImageMediaId?: number;
  designImageMediaId?: number;
  videoMediaId?: number;
  videoCoverMediaId?: number;
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
  guidePriceCoefficient?: number;
  markupPrices?: SlabPrice[];
  offShelfRecords: SlabOffShelfRecord[];
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
  markupPrices: Record<
    number,
    { ratio: string; price: string; priceSource: 'auto' | 'manual'; sourceConfigurationId?: number }
  >;
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
const tabs: { value: SlabTab; label: string }[] = [
  { value: 'warehouse', label: '仓库中' },
  { value: 'selling', label: '出售中' },
  { value: 'offShelf', label: '已下架' },
  { value: 'soldOut', label: '已售完' },
  { value: 'recycle', label: '回收站' },
];

const pageSizeOptions = [10, 20, 50];
const externalDeleteReasons = ['图片不清晰', '资料不完整', '规格填写异常', '价格信息缺失', '其他'];
const offShelfReasons = ['库存异常', '价格调整', '图片更新', '供应商申请'];

const makeFilterState = (): FilterState => ({
  keyword: '',
  variety: '',
  origin: '',
  texture: '',
  color: '',
  grade: '',
  supplier: '',
  offShelfReason: '',
  offShelvedBy: '',
  offShelfDateRange: [],
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
  guideRatio: '',
  guidePrice: '',
  level1Ratio: '1.45',
  level1Price: '',
  level2Ratio: '1.30',
  level2Price: '',
  level3Ratio: '1.18',
  level3Price: '',
  markupPrices: {},
});

const activeTab = ref<SlabTab>('warehouse');
const loginUser = computed(() => getLoginUser());
const slabPermissionScope: Record<SlabTab, string> = {
  warehouse: 'warehouse',
  selling: 'selling',
  offShelf: 'off-shelf',
  soldOut: 'sold-out',
  recycle: 'recycle',
};
const slabPermission = (status: SlabTab, action: string) =>
  `admin.slab-management.${slabPermissionScope[status]}.${action}`;
const hasSlabAction = (status: SlabTab, action: string) =>
  hasPermission(loginUser.value, slabPermission(status, action));
const canViewOperationLogs = computed(() => hasPermission(loginUser.value, 'admin.slab-management.operation-log.view'));
const { visibleTabs: slabTabs, showTabRail: showSlabTabRail } = usePermissionTabs({
  tabs,
  activeTab,
  canAccess: (tab) => hasSlabAction(tab.value, 'view'),
});
const loading = ref(false);
const saving = ref(false);
const selectedKeys = ref<number[]>([]);
const productDialogVisible = ref(false);
const productMode = ref<ProductMode>('create');
const publishTargetStatus = ref<SlabPublishTargetStatus>('warehouse');
const productTab = ref('images');
const editingRowId = ref<number | null>(null);
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
const operationTypeOptions: { label: string; value: SlabOperationType }[] = [
  { label: '创建大板', value: 'CREATE' },
  { label: '编辑信息', value: 'UPDATE' },
  { label: '修改价格', value: 'PRICE_UPDATE' },
  { label: '上架', value: 'SHELF' },
  { label: '下架', value: 'OFF_SHELF' },
  { label: '放回仓库', value: 'RESTORE_WAREHOUSE' },
  { label: '恢复大板', value: 'RESTORE_RECYCLE' },
  { label: '移入回收站', value: 'DELETE_TO_RECYCLE' },
  { label: '物理删除', value: 'PHYSICAL_DELETE' },
  { label: '彻底删除', value: 'PURGE' },
  { label: '状态变更', value: 'STATUS_UPDATE' },
];
const operationTypeLabel = (type: SlabOperationType) =>
  operationTypeOptions.find((item) => item.value === type)?.label || type;
const operationLogColumns: PrimaryTableCol<SlabOperationLogRecord>[] = [
  { colKey: 'slab', title: '大板名称/ID/SKU', minWidth: 220 },
  { colKey: 'operationType', title: '操作类型', width: 110 },
  { colKey: 'summary', title: '操作内容', minWidth: 220 },
  { colKey: 'operatorName', title: '操作人', width: 110 },
  { colKey: 'operatedAt', title: '操作时间', width: 170 },
  { colKey: 'operation', title: '操作', width: 72, fixed: 'right' },
];
const formatPriceTierChanges = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return String(item ?? '-');
      const price = item as {
        configurationId?: number;
        storeLevelId?: number;
        storeLevelName?: string;
        priceCoefficient?: number;
        markupRate?: number;
        price?: number;
      };
      const levelId = price.storeLevelId ?? price.configurationId;
      const label =
        price.storeLevelName ||
        markupConfigurations.value.find((configuration) => configuration.storeLevelId === levelId)?.name ||
        `门店级别 ${levelId ?? '-'}`;
      const coefficient =
        price.priceCoefficient == null
          ? price.markupRate == null
            ? '-'
            : (1 + Number(price.markupRate) / 100).toFixed(2)
          : Number(price.priceCoefficient).toFixed(2);
      const formattedPrice = price.price == null ? '-' : Number(price.price).toFixed(2);
      return `${label}：价格系数 ${coefficient}，价格 ${formattedPrice}`;
    })
    .join('；');
};
const formatOperationValue = (value: unknown, field?: string): string => {
  if (value == null || value === '') return '未填写';
  if (field === '价格层级') return formatPriceTierChanges(value) || '未填写';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};
const normalizePriceTierChanges = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const price = item as {
      configurationId?: number;
      storeLevelId?: number;
      storeLevelName?: string;
      priceCoefficient?: number;
      markupRate?: number;
      price?: number;
    };
    const levelId = price.storeLevelId ?? price.configurationId;
    const key = String(levelId ?? 'unknown');
    return [
      {
        key,
        label:
          price.storeLevelName ||
          markupConfigurations.value.find((configuration) => configuration.storeLevelId === levelId)?.name ||
          `门店级别 ${levelId ?? '-'}`,
        coefficient:
          price.priceCoefficient == null
            ? price.markupRate == null
              ? '未填写'
              : (1 + Number(price.markupRate) / 100).toFixed(2)
            : Number(price.priceCoefficient).toFixed(2),
        price: price.price == null ? '未填写' : Number(price.price).toFixed(2),
      },
    ];
  });
};
const buildPriceTierComparison = (before: unknown, after: unknown): OperationLogPriceTierRow[] => {
  const beforeTiers = normalizePriceTierChanges(before);
  const afterTiers = normalizePriceTierChanges(after);
  const keys = [...new Set([...beforeTiers.map((item) => item.key), ...afterTiers.map((item) => item.key)])];
  return keys.map((key) => {
    const beforeTier = beforeTiers.find((item) => item.key === key);
    const afterTier = afterTiers.find((item) => item.key === key);
    return {
      key,
      label: afterTier?.label || beforeTier?.label || `价格层级 ${key}`,
      beforeCoefficient: beforeTier?.coefficient || '未填写',
      beforePrice: beforeTier?.price || '未填写',
      afterCoefficient: afterTier?.coefficient || '未填写',
      afterPrice: afterTier?.price || '未填写',
    };
  });
};
const operationLogReferenceLabels: Record<string, string> = {
  供应商ID: '供应商',
  品种ID: '品种',
  产地ID: '产地',
  纹理ID: '纹理',
  色系ID: '色系',
  等级ID: '等级',
  商品视频: '视频',
};
const operationLogMediaTypes: Record<string, 'image' | 'video'> = {
  '1:1主图': 'image',
  扫描图: 'image',
  设计图: 'image',
  商品视频: 'video',
};
const operationLogFieldOrder = [
  '1:1主图',
  '扫描图',
  '设计图',
  '商品视频',
  '大板名称',
  '品种ID',
  '产地ID',
  '纹理ID',
  '色系ID',
  '等级ID',
  '长度',
  '宽度',
  '高度',
  '误差',
  '扣角1长',
  '扣角1宽',
  '扣角2长',
  '扣角2宽',
  '扣角3长',
  '扣角3宽',
  '扣角4长',
  '扣角4宽',
  '供应商ID',
  'SKU',
  '成本价',
  '指导价系数',
  '指导价',
  '价格层级',
];
const operationLogFieldOrderIndex = new Map(operationLogFieldOrder.map((field, index) => [field, index]));
const normalizeOperationLogMedia = (value: unknown, field: string): OperationLogMediaValue | undefined => {
  if (value == null || value === '') return undefined;
  const fallbackType = operationLogMediaTypes[field];
  if (typeof value !== 'object') {
    return { available: false, mediaType: fallbackType };
  }
  const media = value as Partial<OperationLogMediaValue>;
  return {
    available: Boolean(media.available && media.url),
    url: media.url,
    mediaType: media.mediaType === 'video' ? 'video' : fallbackType,
    mimeType: media.mimeType,
    originalName: media.originalName,
  };
};
const mediaAfterFallback = (media?: OperationLogMediaValue) => (media ? '媒体文件已清理' : '已删除');
const operationLogChangeRows = computed<OperationLogChangeRow[]>(() => {
  const details = operationLogDetail.value?.changeDetails;
  if (!details) return [];
  try {
    const parsed = JSON.parse(details) as Record<string, { before?: unknown; after?: unknown }>;
    return Object.entries(parsed)
      .filter(([field]) => !['面积', '视频封面'].includes(field))
      .sort(
        ([leftField], [rightField]) =>
          (operationLogFieldOrderIndex.get(leftField) ?? Number.MAX_SAFE_INTEGER) -
          (operationLogFieldOrderIndex.get(rightField) ?? Number.MAX_SAFE_INTEGER),
      )
      .map(([field, change]) => {
        const priceTiers = field === '价格层级' ? buildPriceTierComparison(change.before, change.after) : undefined;
        const mediaType = operationLogMediaTypes[field];
        return {
          field: operationLogReferenceLabels[field] || field,
          before: formatOperationValue(change.before, field),
          after: formatOperationValue(change.after, field),
          priceTiers,
          mediaType,
          afterMedia: mediaType ? normalizeOperationLogMedia(change.after, field) : undefined,
        };
      });
  } catch {
    return [];
  }
});
const operationSourceLabel = (source: SlabOperationLogRecord['operationSource']) =>
  ({ MANUAL: '平台操作', EXTERNAL_API: '外部接口', SYSTEM: '系统任务' })[source] || source;
const operationStatusLabels: Record<SlabStatus, string> = {
  warehouse: '仓库中',
  selling: '出售中',
  offShelf: '已下架',
  soldOut: '已售完',
  recycle: '回收站',
};
const formatStatusChange = (record: SlabOperationLogRecord) => {
  if (!record.beforeStatus && !record.afterStatus) return '-';
  return `${record.beforeStatus ? operationStatusLabels[record.beforeStatus] : '-'} → ${
    record.afterStatus ? operationStatusLabels[record.afterStatus] : '-'
  }`;
};
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

const paginations = reactive<Record<SlabTab, { current: number; pageSize: number }>>({
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

const formatMillimeter = (value?: number) => (value == null ? '-' : `${value}mm`);
const formatArea = (value?: number) => (value == null ? '-' : `${value}㎡`);
const formatCorner = (row: SlabItem, index: 1 | 2 | 3 | 4) => {
  const length = row[`corner${index}LengthMm`];
  const width = row[`corner${index}WidthMm`];
  if (length == null && width == null) return '-';
  return `${length ?? '-'} × ${width ?? '-'}mm`;
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
    offShelfRecords: record.offShelfRecords ?? [],
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
    mainImageMediaId: next.mainImageMediaId,
    scanImageMediaId: next.scanImageMediaId,
    designImageMediaId: next.designImageMediaId,
    videoMediaId: next.videoMediaId,
    videoCoverMediaId: next.videoCoverMediaId,
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
    guidePriceCoefficient: next.guidePriceCoefficient,
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
    const [records, publishOptionsResult, markupResult, guideSetting] = await Promise.all([
      listSlabs(),
      getSlabPublishOptions(),
      listSlabMarkupConfigurationOptions(),
      getSlabGuidePriceSetting(),
    ]);
    Object.assign(publishOptions, publishOptionsResult);
    markupConfigurations.value = markupResult;
    guidePriceSettingCoefficient.value = guideSetting?.priceCoefficient;
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
  reason: [{ required: true, message: reasonState.type === 'deleteExternal' ? '请选择删除原因' : '请选择下架原因' }],
  detail: [],
}));

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
  }[] = savedPrices.map((price) => ({
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
    const configuration = markupConfigurations.value.find((item) => item.storeLevelId === level.id);
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
const guideRatioFieldName = computed(() => 'guideRatio');
const guidePriceFieldName = computed(() => 'guidePrice');

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
  ...Object.fromEntries(cornerFields.map((item) => [item.key, [createOptionalMeasurementRule(item.key, item.label)]])),
};

const columns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  if (activeTab.value === 'offShelf') {
    return [
      { colKey: 'select', title: 'selectTitle', width: 48, align: 'center' },
      { colKey: 'image', title: '商品主图', width: 96, align: 'center' },
      { colKey: 'slab', title: '大板名称/ID/SKU', minWidth: 220 },
      { colKey: 'variety', title: '品种', width: 140 },
      { colKey: 'offShelfReason', title: '下架原因/详细说明', minWidth: 240 },
      { colKey: 'offShelvedByName', title: '下架人', width: 120, align: 'center' },
      { colKey: 'offShelvedAt', title: '下架时间', width: 180, align: 'center' },
      { colKey: 'operation', title: '操作', width: 190, align: 'left', fixed: 'right' },
    ];
  }

  const baseColumns: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'select', title: 'selectTitle', width: 48, align: 'center' },
    { colKey: 'image', title: '商品主图', width: 96, align: 'center' },
    { colKey: 'slab', title: '大板名称/ID/SKU', minWidth: 220 },
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
const priceDrawerReadonly = computed(() => activeTab.value === 'soldOut' || activeTab.value === 'recycle');
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

const paginationTotal = computed(() => filteredData.value.length);
const pageCount = computed(() => Math.max(Math.ceil(paginationTotal.value / currentPagination.value.pageSize), 1));
const batchButtons = computed(() => {
  const map: Record<
    SlabTab,
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
    actions: { label: string; action: RowAction; theme: 'primary' | 'warning' | 'danger' | 'default' }[],
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
      { label: '价格', action: 'price', theme: 'primary' },
      { label: '上架', action: 'shelf', theme: 'primary' },
      { label: '编辑', action: 'edit', theme: 'primary' },
      { label: '删除', action: 'delete', theme: 'danger' },
    ]);
  }
  if (activeTab.value === 'selling') {
    return filterActions([
      { label: '价格', action: 'price', theme: 'primary' },
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
    return filterActions([{ label: '价格', action: 'price', theme: 'primary' }]);
  }
  return filterActions([
    { label: '价格', action: 'price', theme: 'primary' },
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
const activeConfigurationForLevel = (storeLevelId: number) =>
  markupConfigurations.value.find((item) => item.storeLevelId === storeLevelId);
const priceSourceTheme = (source?: 'auto' | 'manual') => (source === 'auto' ? 'success' : 'warning');
const priceSourceLabel = (source: 'auto' | 'manual' | undefined, storeLevelId: number) => {
  if (source !== 'auto') return '手工价格';
  return activeConfigurationForLevel(storeLevelId) ? '跟随配置' : '配置已停用';
};
const canRestoreAutoPrice = (storeLevelId: number, source?: 'auto' | 'manual') =>
  source === 'manual' && Boolean(activeConfigurationForLevel(storeLevelId));

const calculateProductPrice = (configurationId: number) => {
  const cost = toNumber(productForm.cost);
  const editor = productForm.markupPrices[configurationId];
  const ratio = toNumber(editor?.ratio ?? '');
  if (!editor || !isValidSalesNumber(productForm.cost, 0) || !isValidSalesNumber(editor.ratio, 0)) return;
  editor.price = formatPrice(cost * ratio);
  clearSalesFieldError(`markupPrices.${configurationId}.price`);
};

const calculateProductRatio = (configurationId: number) => {
  const cost = toNumber(productForm.cost);
  const editor = productForm.markupPrices[configurationId];
  const price = toNumber(editor?.price ?? '');
  if (!editor || !isValidSalesNumber(productForm.cost, 0) || !isValidSalesNumber(editor.price, 0) || !cost) return;
  editor.ratio = formatRatio(price / cost);
};

const calculateGuidePrice = () => {
  const cost = toNumber(productForm.cost);
  const ratio = toNumber(productForm.guideRatio);
  if (!isValidSalesNumber(productForm.cost, 0) || !isValidSalesNumber(productForm.guideRatio, 0)) return;
  productForm.guidePrice = formatPrice(cost * ratio);
  clearSalesFieldError('guidePrice');
};

const calculateGuideRatio = () => {
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
          price: existing ? String(existing.price) : cost && ratio != null ? formatPrice(cost * ratio) : '',
          priceSource: existing?.priceSource ?? item.priceSource ?? 'manual',
          sourceConfigurationId: existing?.sourceConfigurationId ?? item.sourceConfigurationId,
        },
      ];
    }),
  );
};

const restoreProductAutoPrice = (storeLevelId: number) => {
  const configuration = activeConfigurationForLevel(storeLevelId);
  const editor = productForm.markupPrices[storeLevelId];
  if (!configuration || !editor) return;
  editor.ratio = formatRatio(Number(configuration.priceCoefficient));
  editor.priceSource = 'auto';
  editor.sourceConfigurationId = configuration.id;
  calculateProductPrice(storeLevelId);
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

const restoreBatchAutoPrice = (row: DrawerPriceRow) => {
  if (row.configurationId == null) return;
  const configuration = activeConfigurationForLevel(row.configurationId);
  if (!configuration) return;
  row.ratio = formatRatio(Number(configuration.priceCoefficient));
  row.priceSource = 'auto';
  row.sourceConfigurationId = configuration.id;
  calculateBatchPrice(row);
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

const handleBatchRatioChange = (index: number, _value?: unknown, context?: SalesNumberChangeContext) => {
  if (context?.type === 'props') return;
  const row = batchPriceRows[index];
  if (!row) return;
  if (row.configurationId != null) {
    row.priceSource = 'manual';
    row.sourceConfigurationId = undefined;
  }
  const field = `rows.${index}.ratio`;
  if (!String(row.ratio ?? '').trim() || isValidSalesNumber(row.ratio, 0)) clearPriceDrawerFieldError(field);
  calculateBatchPrice(row);
  if (String(row.price ?? '').trim()) clearPriceDrawerFieldError(`rows.${index}.price`);
};

const handleBatchPriceChange = (index: number, _value?: unknown, context?: SalesNumberChangeContext) => {
  if (context?.type === 'props') return;
  const row = batchPriceRows[index];
  if (!row) return;
  if (String(row.price ?? '').trim()) clearPriceDrawerFieldError(`rows.${index}.price`);
  if (index === 0) {
    handleBatchCostChange(_value, context);
    return;
  }
  if (row.configurationId != null) {
    row.priceSource = 'manual';
    row.sourceConfigurationId = undefined;
  }
  calculateBatchRatio(row);
  if (String(row.ratio ?? '').trim()) clearPriceDrawerFieldError(`rows.${index}.ratio`);
};

const buildPriceRows = (row: SlabItem): DrawerPriceRow[] => {
  const snapshots = row.markupPrices ?? [];
  const cost = toNumber(row.price.cost);
  const guidePrice = row.price.guide;
  const guideRatio =
    row.guidePriceCoefficient != null
      ? formatRatio(row.guidePriceCoefficient)
      : cost > 0 && String(guidePrice).trim()
        ? formatRatio(toNumber(guidePrice) / cost)
        : '';
  const configuredRows: DrawerPriceRow[] = snapshots.map((snapshot) => ({
    configurationId: snapshot.storeLevelId,
    label:
      publishOptions.storeLevels.find((level) => level.id === snapshot.storeLevelId)?.label ||
      markupConfigurations.value.find((item) => item.storeLevelId === snapshot.storeLevelId)?.name ||
      snapshot.storeLevelName ||
      `门店级别${snapshot.storeLevelId}`,
    ratio: formatRatio(Number(snapshot.priceCoefficient)),
    price: String(snapshot.price),
    priceSource: snapshot.priceSource ?? 'manual',
    sourceConfigurationId: snapshot.sourceConfigurationId,
  }));
  const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.storeLevelId));
  publishOptions.storeLevels.forEach((level) => {
    if (snapshotIds.has(level.id)) return;
    const configuration = markupConfigurations.value.find((item) => item.storeLevelId === level.id);
    const ratio = configuration == null ? '' : formatRatio(Number(configuration.priceCoefficient));
    configuredRows.push({
      configurationId: level.id,
      label: level.label,
      ratio,
      price: cost && ratio ? formatPrice(cost * toNumber(ratio)) : '',
      priceSource: configuration == null ? 'manual' : 'auto',
      sourceConfigurationId: configuration?.id,
    });
  });
  return [
    { label: '成本价', ratio: '1.00', price: row.price.cost },
    {
      label: '指导价',
      ratio: guideRatio,
      price: guidePrice,
    },
    ...sortRowsByStoreLevel(configuredRows, (configuredRow) => configuredRow.configurationId),
  ];
};

const fillPriceRows = (row: SlabItem) => {
  batchPriceRows.splice(0, batchPriceRows.length, ...buildPriceRows(row));
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
  uploadPreviewTitle.value = title;
  uploadPreviewUrl.value = media.url;
  uploadPreviewType.value = media.mediaType;
  uploadPreviewDialogVisible.value = true;
};

const openDetailDrawer = (row: SlabItem) => {
  detailDrawerRow.value = row;
  detailPriceRows.value = buildPriceRows(row);
  detailDrawerVisible.value = true;
};

const closeDetailDrawer = () => {
  detailDrawerVisible.value = false;
  detailDrawerRow.value = null;
  detailPriceRows.value = [];
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
  const hasSalesInformation = Boolean(row.supplierId || row.sku.trim() || row.price.cost || row.markupPrices?.length);
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
    supplier: row.supplierId ? row.tenant : '',
    cost: row.price.cost,
    stock: row.status === 'soldOut' ? '0' : hasSalesInformation ? '1' : '',
    sku: row.sku,
    guideRatio:
      row.guidePriceCoefficient != null
        ? formatRatio(row.guidePriceCoefficient)
        : row.price.cost && row.price.guide
          ? formatRatio(toNumber(row.price.guide) / toNumber(row.price.cost))
          : '',
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
  if (pendingUploadedMediaIds.size) {
    const staleMediaIds = [...pendingUploadedMediaIds];
    pendingUploadedMediaIds.clear();
    void Promise.allSettled(staleMediaIds.map((mediaId) => releaseTemporarySlabMedia(mediaId)));
  }
  productMode.value = mode;
  if (mode === 'create') {
    publishTargetStatus.value = resolveSlabPublishTargetStatus(activeTab.value);
  }
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
  clearSalesNumberFieldError(guideRatioFieldName.value, productForm.guideRatio, 0);
  calculateGuidePrice();
};

const handleGuidePriceChange = (_value?: unknown, context?: SalesNumberChangeContext) => {
  if (context?.type === 'props') return;
  if (String(productForm.guidePrice ?? '').trim()) clearSalesFieldError(guidePriceFieldName.value);
  calculateGuideRatio();
};

const handlePartnerRatioChange = (configurationId: number, _value?: unknown, context?: SalesNumberChangeContext) => {
  if (context?.type === 'props') return;
  const editor = productForm.markupPrices[configurationId];
  if (editor) {
    editor.priceSource = 'manual';
    editor.sourceConfigurationId = undefined;
  }
  clearSalesNumberFieldError(
    `markupPrices.${configurationId}.ratio`,
    productForm.markupPrices[configurationId]?.ratio,
    0,
  );
  calculateProductPrice(configurationId);
};

const handlePartnerPriceChange = (configurationId: number, _value?: unknown, context?: SalesNumberChangeContext) => {
  if (context?.type === 'props') return;
  const editor = productForm.markupPrices[configurationId];
  if (editor) {
    editor.priceSource = 'manual';
    editor.sourceConfigurationId = undefined;
  }
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
  if (productMode.value === 'create' && guidePriceSettingCoefficient.value == null) {
    productTab.value = 'sales';
    adminFeedback.warning('请先配置大板指导价默认价格系数');
    return;
  }
  const normalizedStock = String(productForm.stock ?? '').trim();
  const hasInvalidSalesPrice = salesPriceRows.value.some((item) => {
    const editor = productForm.markupPrices[item.id];
    return !editor || !isValidSalesNumber(editor.ratio, 0) || !isValidSalesNumber(editor.price, 0);
  });
  const hasInvalidGuidePrice =
    !isValidSalesNumber(productForm.guideRatio, 0) || !isValidSalesNumber(productForm.guidePrice, 0);
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
    areaSquareMeter: lengthMm && widthMm ? Number(((lengthMm * widthMm) / 1_000_000).toFixed(2)) : undefined,
    costPrice: toNumber(productForm.cost),
    guidePrice: toNumber(productForm.guidePrice),
    guidePriceCoefficient: Number(toNumber(productForm.guideRatio).toFixed(4)),
    markupPrices: salesPriceRows.value.map((item) => ({
      storeLevelId: item.id,
      priceCoefficient: Number(toNumber(productForm.markupPrices[item.id].ratio).toFixed(4)),
      costPrice: toNumber(productForm.cost),
      price: toNumber(productForm.markupPrices[item.id].price),
      priceSource: productForm.markupPrices[item.id].priceSource,
      sourceConfigurationId: productForm.markupPrices[item.id].sourceConfigurationId,
      variantKey: '',
    })),
    status: editingItem?.status || publishTargetStatus.value,
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

const uploadSlabMedia = async (item: (typeof uploadItems)[number], file: File): Promise<AdminMediaValue> => {
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
  if (!row.supplierId || !row.sku.trim()) return '请完善大板销售信息后再上架';
  if (!isValidSalesNumber(row.price.cost, 0) || !isValidSalesNumber(row.price.guide, 0)) {
    return '请完善大板价格后再上架';
  }
  if (!(row.markupPrices ?? []).length) {
    return '请完善全部大板价格后再上架';
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
    const selectedKeySet = new Set(selectedKeys.value);
    if (!canStartShelf(tableData.value.filter((item) => selectedKeySet.has(item.id)))) return;
    openConfirm('batchShelf', null, '是否批量上架所选大板？');
    return;
  }
  if (action === 'batchOffShelf') {
    if (!selectedKeys.value.length) {
      adminFeedback.warning('请先选择大板');
      return;
    }
    openReasonDialog('offShelf', null, true);
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
  if (action === 'detail') openDetailDrawer(row);
  if (action === 'price') openPriceDrawer(row);
  if (action === 'edit') openProductDialog('edit', row);
  if (action === 'shelf' && canStartShelf([row])) openConfirm('shelf', row, `是否上架大板“${row.name}”？`);
  if (action === 'delete') {
    if (row.publisherType === '接口获取') openReasonDialog('deleteExternal', row);
    else openConfirm('delete', row, `删除后大板将进入回收站，是否删除大板“${row.name}”？`);
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

const openOperationLogDetail = (record: SlabOperationLogRecord) => {
  operationLogDetail.value = record;
  operationLogDetailVisible.value = true;
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
    if (type === 'delete' && row) {
      await removeSlab(row.id);
      row.status = 'recycle';
    }
    if (type === 'restore' && row) await updateSlabStatus(row.id, 'warehouse');
    if (type === 'savePrice' && row) {
      const costPrice = toNumber(batchPriceRows[0]?.price ?? '');
      const nextMarkupPrices: SlabPrice[] = batchPriceRows
        .slice(1)
        .filter((item): item is DrawerPriceRow & { configurationId: number } => item.configurationId != null)
        .map((item) => ({
          storeLevelId: item.configurationId,
          priceCoefficient: Number(toNumber(item.ratio).toFixed(4)),
          costPrice,
          price: toNumber(item.price),
          priceSource: item.priceSource,
          sourceConfigurationId: item.sourceConfigurationId,
          variantKey: '',
        }));
      const guidePrice = batchPriceRows.find((item) => item.label === '指导价')?.price;
      const guidePriceCoefficient = batchPriceRows.find((item) => item.label === '指导价')?.ratio;
      const nextPrice = {
        cost: String(costPrice),
        guide: guidePrice == null ? row.price.guide : String(toNumber(guidePrice)),
        level1: row.price.level1,
        level2: row.price.level2,
        level3: row.price.level3,
      };
      upsertSlabItem(
        await updateSlab(
          row.id,
          toSlabPayload(row, {
            price: nextPrice,
            guidePriceCoefficient:
              guidePriceCoefficient == null ? row.guidePriceCoefficient : toNumber(guidePriceCoefficient),
            markupPrices: nextMarkupPrices,
          }),
        ),
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

const openReasonDialog = (type: 'deleteExternal' | 'offShelf', row: SlabItem | null, isBatch = false) => {
  reasonState.type = type;
  reasonState.row = row;
  reasonState.isBatch = isBatch;
  reasonForm.reason = '';
  reasonForm.detail = '';
  reasonDialogVisible.value = true;
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
  const hasInvalidPrice = batchPriceRows.some(
    (row, index) => !isValidSalesNumber(row.price, 0) || (index > 0 && !isValidSalesNumber(row.ratio, 0)),
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

.page-header-actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-m);
}

.operation-log-drawer {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-l);
}

.operation-log-filters {
  display: grid;
  grid-template-columns: 234px minmax(150px, 180px) minmax(150px, 180px) 332px auto;
  align-items: center;
  gap: var(--td-comp-margin-m);
}

.operation-log-filters :deep(.t-form__item) {
  margin-bottom: 0;
}

.operation-log-keyword-filter {
  width: 234px;
}

.operation-log-date-filter {
  width: 332px;
}

.operation-log-date-picker {
  width: 260px;
}

.operation-log-filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
}

.operation-log-summary {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-xs);
  white-space: normal;
  word-break: break-word;
}

.operation-log-detail__section-title {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  margin-bottom: var(--td-comp-margin-m);
  color: var(--td-text-color-primary);
  font: var(--td-font-title-medium);
}

.operation-log-detail__section-title--spaced {
  margin-top: var(--td-comp-margin-xl);
}

.operation-log-detail__long-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.operation-log-diff-list {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-m);
}

.operation-log-diff-item {
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.operation-log-diff-item__field {
  margin-bottom: var(--td-comp-margin-s);
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
  font-weight: 600;
}

.operation-log-diff-comparison {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr);
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.operation-log-diff-value {
  display: flex;
  min-height: 64px;
  flex-direction: column;
  justify-content: center;
  gap: var(--td-comp-margin-xs);
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-m);
  border-radius: var(--td-radius-default);
  color: var(--td-text-color-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.operation-log-diff-value--before {
  background: var(--td-bg-color-secondarycontainer);
}

.operation-log-diff-value--after {
  background: var(--td-brand-color-light);
}

.operation-log-diff-value__label,
.operation-log-price-diff__header {
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
}

.operation-log-diff-arrow {
  justify-self: center;
  color: var(--td-brand-color);
  font-size: var(--td-font-size-title-medium);
}

.operation-log-media-preview {
  display: block;
  width: 180px;
  height: 108px;
  max-width: 100%;
  border-radius: var(--td-radius-default);
  object-fit: cover;
}

.operation-log-media-preview--image,
.operation-log-media-preview--video {
  cursor: pointer;
}

.operation-log-media-preview--video {
  background: var(--td-bg-color-secondarycontainer);
}

.operation-log-media-after {
  max-width: calc(50% - 20px);
}

.operation-log-media-empty {
  color: var(--td-text-color-placeholder);
}

.operation-log-price-diff {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr) 24px minmax(0, 1fr);
  align-items: center;
  gap: var(--td-comp-margin-s);
}

.operation-log-price-diff__header {
  padding: 0 var(--td-comp-paddingLR-m);
}

.operation-log-price-diff__tier {
  color: var(--td-text-color-primary);
  word-break: break-word;
}

.operation-log-price-diff__arrow-placeholder {
  width: 24px;
}

.external-delete-warning {
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

.filter-primary-row.off-shelf-filter-row {
  grid-template-columns: 234px repeat(3, minmax(160px, 1fr)) minmax(300px, 1.5fr);
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

.filter-primary-row :deep(.t-form__item.off-shelf-date-filter) {
  min-width: 300px;
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

.off-shelf-reason-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.off-shelf-reason-primary {
  color: var(--td-text-color-primary);
  font: var(--td-font-body-medium);
  font-weight: 400;
}

.off-shelf-detail-tooltip {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
}

.off-shelf-reason-secondary {
  display: block;
  min-width: 0;
  overflow: hidden;
  color: var(--td-text-color-placeholder);
  font: var(--td-font-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.off-shelf-history-detail {
  white-space: normal;
  overflow-wrap: anywhere;
}

.off-shelf-reason-detail-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 2px;
}

.off-shelf-history-trigger {
  flex: none;
  opacity: 0;
  transition: opacity 0.15s linear;
}

.off-shelf-reason-cell:hover .off-shelf-history-trigger,
.off-shelf-reason-cell:focus-within .off-shelf-history-trigger {
  opacity: 1;
}

.slab-detail-drawer {
  display: grid;
  gap: var(--td-comp-margin-xl);
}

.slab-detail-section {
  display: grid;
  gap: var(--td-comp-margin-m);
}

.slab-detail-section h3 {
  margin: 0;
  color: var(--td-text-color-primary);
  font: var(--td-font-title-small);
}

.slab-detail-media-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--td-comp-margin-m);
}

.slab-detail-media {
  display: grid;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  color: inherit;
  text-align: left;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.slab-detail-media:not(:disabled) {
  cursor: zoom-in;
}

.slab-detail-media:disabled {
  cursor: default;
}

.slab-detail-media img,
.slab-detail-media-placeholder {
  width: 100%;
  height: 104px;
}

.slab-detail-media img {
  object-fit: cover;
}

.slab-detail-media-placeholder {
  display: grid;
  place-items: center;
  color: var(--td-text-color-placeholder);
  background: var(--td-bg-color-secondarycontainer);
  font: var(--td-font-body-small);
}

.slab-detail-media-label {
  padding: var(--td-comp-paddingTB-xs) var(--td-comp-paddingLR-s);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
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

.upload-large-preview {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: 0 auto;
  object-fit: contain;
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

.detail-price-table {
  margin-top: 0;
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
