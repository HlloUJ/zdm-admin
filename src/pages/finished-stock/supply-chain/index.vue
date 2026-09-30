<template>
  <div class="admin-layout">
    <AdminTopNav />
    <div class="admin-shell">
      <AdminSideMenu />
      <main class="page" :class="{ 'page--form': formPageVisible }">
        <div v-if="formPageVisible" ref="formAnchorSlot" :style="{ height: `${formAnchorHeight}px` }">
          <AdminSectionCard class="form-anchor-card" :style="formAnchorStyle">
            <nav ref="formAnchorNav" class="form-anchor-nav" aria-label="商品信息分区导航">
              <t-space size="large">
                <t-link
                  v-for="section in formSections"
                  :key="section.key"
                  :href="`#finished-product-${section.key}`"
                  :theme="activeFormSection === section.key ? 'primary' : 'default'"
                  :aria-current="activeFormSection === section.key ? 'location' : undefined"
                  @click.prevent="scrollToFormSection(section.key)"
                >
                  {{ section.label }}
                </t-link>
              </t-space>
            </nav>
          </AdminSectionCard>
        </div>
        <header v-if="formPageVisible || !finishedTabs.length" class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item
                content="成品现货管理"
                :href="'/supply-chain/finished-stock-management'"
                :to="{ path: '/supply-chain/finished-stock-management' }"
                replace
                @click="closeFormPage"
              />
              <t-breadcrumb-item v-if="formPageVisible">{{ formPageTitle }}</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-link v-if="canViewOperationLogs" theme="primary" hover="color" @click="operationLogsVisible = true"
            >操作日志</t-link
          >
        </header>
        <template v-if="!formPageVisible && finishedTabs.length">
          <header class="page-header">
            <t-breadcrumb>
              <t-breadcrumb-item
                content="成品现货管理"
                :href="'/supply-chain/finished-stock-management'"
                :to="{
                  path: '/supply-chain/finished-stock-management',
                }"
                replace
                @click="closeFormPage"
              />
              <t-breadcrumb-item v-if="formPageVisible">{{ formPageTitle }}</t-breadcrumb-item>
            </t-breadcrumb>
            <t-link v-if="canViewOperationLogs" theme="primary" hover="color" @click="operationLogsVisible = true"
              >操作日志</t-link
            >
          </header>
          <AdminListLayout v-if="finishedTabs.length" class="finished-list-layout">
            <template #toolbar>
              <div class="list-controls">
                <t-tabs
                  v-if="showFinishedTabRail"
                  :value="activeTab"
                  class="status-tabs"
                  @change="
                    activeTab = String($event) as StockStatus;
                    handleTabChange();
                  "
                >
                  <t-tab-panel
                    v-for="tab in finishedTabs.map((tab) => ({ value: tab.value, label: tabLabel(tab) }))"
                    :key="tab.value"
                    :value="tab.value"
                    :label="tab.label"
                  />
                </t-tabs>
                <t-form class="zdm-admin-filter-form" label-width="auto" :data="currentFilter" colon>
                  <div class="filter-row">
                    <div class="filter-fields">
                      <t-form-item label="商品">
                        <t-input
                          :value="currentFilter.keyword"
                          clearable
                          placeholder="商品名称 / ID"
                          @change="updateManagementListFilter('keyword', String($event || ''))"
                          @enter="handleSearch()"
                        />
                      </t-form-item>
                      <t-form-item label="商品分类"
                        ><t-select-input
                          :value="currentFilter.category"
                          :value-display="currentFilter.category?.split(' / ').at(-1)"
                          :popup-visible="categoryFilterVisible"
                          :popup-props="{
                            placement: 'bottom-left',
                            overlayInnerStyle: { width: 'auto' },
                            popperOptions: { modifiers: [{ name: 'flip', enabled: false }] },
                          }"
                          clearable
                          placeholder="请选择"
                          @popup-visible-change="categoryFilterVisible = $event"
                          @clear="currentFilter.category = ''"
                        >
                          <template #suffixIcon
                            ><t-icon :name="categoryFilterVisible ? 'chevron-up' : 'chevron-down'"
                          /></template>
                          <template #panel>
                            <t-cascader-panel
                              v-if="categoryFilterVisible"
                              :value="''"
                              :options="categoryCascaderOptions"
                              :check-strictly="false"
                              trigger="hover"
                              @change="handleCategoryFilterChange"
                            />
                          </template> </t-select-input
                      ></t-form-item>
                      <t-form-item label="供应商">
                        <t-select
                          :value="currentFilter.supplier"
                          clearable
                          placeholder="请选择"
                          @change="updateManagementListFilter('supplier', String($event || ''))"
                        >
                          <t-option v-for="item in supplierOptions" :key="item" :label="item" :value="item" />
                        </t-select>
                      </t-form-item>
                    </div>
                    <div class="filter-actions">
                      <t-button theme="primary" @click="handleSearch()">
                        <template #icon><t-icon name="search" /></template>查询
                      </t-button>
                      <t-button theme="default" variant="base" @click="handleReset()">
                        <template #icon><t-icon name="refresh" /></template>重置
                      </t-button>
                    </div>
                  </div>
                </t-form>
                <div v-if="Boolean(batchButtons.length)" class="table-toolbar">
                  <div class="toolbar-buttons">
                    <t-button
                      v-for="action in managementToolbarActions"
                      :key="action.id"
                      :theme="action.theme"
                      :variant="action.variant"
                      :class="action.className"
                      :disabled="action.disabled"
                      @click="handleBatchAction(action.id as BatchAction)"
                    >
                      <template v-if="action.icon" #icon><t-icon :name="action.icon" /></template>
                      {{ action.label }}
                    </t-button>
                  </div>
                  <div class="selection-info">已选 {{ selectedKeys.length }} 项</div>
                </div>
              </div>
            </template>
            <template #table
              ><SourceUnavailableOverlay :rows="pageData.filter(sourceBlocked)">
                <FinishedRowWarnings :rows="pageData" :errors="shelfErrors" @close="(id) => delete shelfErrors[id]">
                  <t-table
                    :key="activeTab"
                    class="finished-stock-table"
                    :row-class-name="({ row }: { row: StockItem }) => (sourceBlocked(row) ? 'source-unavailable' : '')"
                    :row-attributes="
                      ({ row }: { row: StockItem }) =>
                        sourceBlocked(row)
                          ? { 'data-source-id': row.id, inert: true }
                          : shelfErrors[row.id]
                            ? { 'data-shelf-error-id': row.id }
                            : {}
                    "
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
                        :checked="selectedKeySet.has(row.id)"
                        @change="(checked: boolean) => toggleRow(row.id, checked)"
                      />
                    </template>
                    <template #image="{ row }">
                      <button
                        class="product-image preview-trigger"
                        type="button"
                        title="点击查看大图"
                        @click="openImagePreview(row)"
                      >
                        <img v-if="row.image" :src="row.image" :alt="row.name" />
                        <t-icon v-else name="image-off" />
                      </button>
                    </template>
                    <template #product="{ row }">
                      <div class="product-meta">
                        <div class="product-name">{{ row.name }}</div>
                        <div class="product-code">ID：{{ row.id }}</div>
                      </div>
                    </template>
                    <template #supplier="{ row }">
                      <div class="tenant-cell">
                        <span>{{ row.supplier }}</span>
                        <!-- TODO(warehouse-management): 仓库模块补全后改为展示商品关联的真实仓库，当前临时显示平台仓。 -->
                        <span class="store-text">平台仓</span>
                      </div>
                    </template>
                    <template #offShelfAt="{ row }">{{
                      row.offShelfAt ? formatDateTime(row.offShelfAt) : '未记录'
                    }}</template>
                    <template #createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
                    <template #offShelfReason="{ row }">
                      <div class="off-shelf-reason-cell">
                        <span>{{ row.offShelfReason || '—' }}</span>
                        <t-tooltip :content="row.offShelfDetail || '—'" placement="bottom-left">
                          <span class="off-shelf-reason-secondary">{{ row.offShelfDetail || '—' }}</span>
                        </t-tooltip>
                      </div>
                    </template>
                    <template #operation="{ row }">
                      <div class="table-actions">
                        <t-link
                          v-for="action in managementRowButtons"
                          :key="action.id"
                          :theme="action.theme"
                          hover="color"
                          @click="handleManagementRowButton(action.id, row)"
                          >{{ action.label }}</t-link
                        >
                      </div>
                    </template>
                    <template #empty>
                      <div class="table-empty">暂无数据</div>
                    </template>
                  </t-table>
                </FinishedRowWarnings>
                <template #overlay="{ row }">
                  <t-space align="center" size="small">
                    <t-icon name="info-circle" />
                    <span>{{ row.sourceMessage || '上游商品不可用' }}</span>
                  </t-space>
                  <t-space size="small">
                    <t-button
                      v-if="hasFinishedAction(['warehouse', 'selling'].includes(activeTab) ? 'edit' : 'detail')"
                      size="small"
                      theme="primary"
                      @click="handleRowAction('detail', row)"
                    >
                      详情
                    </t-button>
                    <t-button
                      v-if="hasFinishedAction('purge', 'recycle')"
                      size="small"
                      theme="danger"
                      variant="base"
                      @click="handleRowAction('purge', row)"
                      >彻底删除</t-button
                    >
                  </t-space>
                </template>
              </SourceUnavailableOverlay></template
            >
            <template #pagination>
              <AdminPagination
                :current="currentPagination.current"
                :page-size="currentPagination.pageSize"
                :total="paginationTotal"
                :page-size-options="pageSizeOptions"
                @update:current="currentPagination.current = $event"
                @update:page-size="currentPagination.pageSize = $event"
              />
            </template>
          </AdminListLayout> </template
        ><template v-else-if="formPageVisible">
          <section class="form-shell">
            <AdminSectionCard class="form-heading-card" aria-label="发布商品信息">
              <div class="form-title-row">
                <div>
                  <h1>{{ formPageTitle }}</h1>
                  <div class="selected-category">
                    当前分类：{{ selectedCategoryPath }}
                    <t-button
                      v-if="formPageMode === 'create'"
                      size="small"
                      variant="outline"
                      @click="openCategoryDialog"
                      >切换分类</t-button
                    >
                  </div>
                </div>
                <t-button theme="default" variant="base" @click="closeFormPage">
                  <template #icon><t-icon name="rollback" /></template>
                  返回列表
                </t-button>
              </div>
            </AdminSectionCard>
            <ProductDetail
              v-if="isOperationsEdit && editingProduct"
              class="readonly-product-fields"
              :product="editingProduct"
              :attribute-names="detailAttributeNames"
              :operations="true"
              :show-sales="false"
              @preview="openProductMediaPreview"
            />
            <AdminSectionCard
              v-if="!isOperationsEdit"
              id="finished-product-description"
              class="form-section"
              aria-label="图文描述"
            >
              <h2 class="form-section-title">图文描述</h2>
              <t-form :data="productForm" label-width="116px" colon>
                <t-form-item label="商品主图" required-mark help="最多上传5张图片，第一张作为商品封面">
                  <div class="upload-grid main-image-upload-grid">
                    <AdminMediaUpload
                      v-for="index in mainImageUploadIndexes"
                      :key="index"
                      v-model="mainImageSlots[index]"
                      :title="index === 0 ? '封面图' : `商品主图${index + 1}`"
                      :show-title="true"
                      accept="image/*"
                      :error-message="submitAttempted && !mainImageMedia && index === 0 ? '请上传图片' : ''"
                      :upload="(file) => uploadProductMedia(file, 'image')"
                      @preview="openProductMediaPreview($event, 'image')"
                      @removed="releasePendingProductMedia"
                    />
                  </div>
                </t-form-item>
                <t-form-item label="商品视频" required-mark help="最多上传1段视频">
                  <div class="upload-grid">
                    <AdminMediaUpload
                      v-model="videoMedia"
                      title="商品视频"
                      :show-title="false"
                      accept="video/*"
                      media-type="video"
                      :error-message="submitAttempted && !videoMedia ? '请上传视频' : ''"
                      :upload="(file) => uploadProductMedia(file, 'video')"
                      @preview="openProductMediaPreview($event, 'video')"
                      @removed="releasePendingProductMedia"
                    />
                  </div>
                </t-form-item>
                <t-form-item label="宝贝详情" required-mark>
                  <ProductRichEditor
                    v-model="productForm.detail"
                    :class="{ 'required-content-error': requiredFieldStatus(productForm.detail) }"
                    :aria-invalid="Boolean(requiredFieldStatus(productForm.detail))"
                    :upload="uploadProductMedia"
                    :release="releasePendingProductMedia"
                    @uploading="detailMediaUploading = $event"
                  />
                </t-form-item>
              </t-form>
            </AdminSectionCard>

            <AdminSectionCard
              v-if="!isOperationsEdit"
              id="finished-product-base"
              class="form-section"
              aria-label="基础信息"
            >
              <h2 class="form-section-title">基础信息</h2>
              <t-form :data="productForm" label-width="116px" colon>
                <t-form-item label="商品名称" required-mark>
                  <t-input
                    v-model="productForm.name"
                    :status="requiredFieldStatus(productForm.name)"
                    clearable
                    placeholder="请输入"
                    :maxlength="60"
                  />
                </t-form-item>
              </t-form>
              <section class="product-attributes" aria-labelledby="product-attributes-title">
                <h3 id="product-attributes-title" class="product-attributes-title">
                  <span
                    v-if="attributeFields.some((field) => field.required)"
                    class="product-attributes-required"
                    aria-label="必填"
                    >*</span
                  >
                  商品属性：
                </h3>
                <div class="product-attributes-panel">
                  <t-form :data="productForm" label-align="top" :colon="false">
                    <div class="product-attributes-grid">
                      <t-form-item
                        v-for="field in attributeFields"
                        :key="field.key"
                        :label="field.label"
                        :required-mark="field.required"
                      >
                        <template #label
                          ><span class="product-attribute-label">{{ field.label }}</span></template
                        >
                        <t-select
                          v-if="field.type === 'select'"
                          v-model="productForm[field.key]"
                          :status="field.required ? requiredFieldStatus(productForm[field.key]) : undefined"
                          clearable
                          placeholder="请选择"
                        >
                          <t-option v-for="item in field.options" :key="item" :label="item" :value="item" />
                        </t-select>
                        <t-input
                          v-else
                          v-model="productForm[field.key]"
                          :status="field.required ? requiredFieldStatus(productForm[field.key]) : undefined"
                          clearable
                          placeholder="请输入"
                        />
                      </t-form-item>
                    </div>
                  </t-form>
                </div>
              </section>
              <t-form class="supplier-form" :data="productForm" label-width="116px" colon>
                <t-form-item label="供应商">
                  <t-select v-model="productForm.supplier" clearable placeholder="请选择">
                    <t-option v-for="item in supplierOptions" :key="item" :label="item" :value="item" />
                  </t-select>
                </t-form-item>
              </t-form>
            </AdminSectionCard>

            <AdminSectionCard id="finished-product-sales" class="form-section" aria-label="销售信息">
              <h2 class="form-section-title">销售信息</h2>
              <t-form :data="productForm" label-width="116px" colon>
                <t-form-item label="销售规格" required-mark>
                  <t-button
                    v-if="!specRows.length && !isOperationsEdit"
                    :theme="submitAttempted ? 'danger' : 'primary'"
                    variant="outline"
                    @click="openSpecDialog"
                  >
                    <template #icon><t-icon name="add" /></template>
                    创建规格
                  </t-button>
                  <div v-if="specRows.length" class="spec-table-block">
                    <t-table
                      row-key="id"
                      :data="specRows"
                      :columns="specColumns"
                      :rowspan-and-colspan="specRowspanAndColspan"
                      table-content-width="max-content"
                      bordered
                      hover
                      table-layout="auto"
                    >
                      <template #specText="{ row }">
                        <div class="spec-name-cell">
                          <span>{{ row.specText || '-' }}</span>
                        </div>
                      </template>
                      <template v-for="field in salesAttributeFields" :key="field.key" #[field.key]="{ row }">
                        <span
                          v-if="confirmedSpecMode === 'layered' && confirmedLayeredFields.includes(field.key)"
                          :class="{ 'readonly-spec-value': isOperationsEdit }"
                        >
                          {{ row[field.key] || '-' }}
                        </span>
                        <span v-else-if="isOperationsEdit" class="readonly-spec-value">{{
                          row[field.key] || '-'
                        }}</span>
                        <t-select
                          v-else-if="field.type === 'select'"
                          v-model="row[field.key]"
                          clearable
                          :status="field.required ? requiredFieldStatus(row[field.key]) : undefined"
                          placeholder="请选择"
                        >
                          <t-option v-for="value in field.options" :key="value" :label="value" :value="value" />
                        </t-select>
                        <t-input
                          v-else
                          v-model="row[field.key]"
                          :status="field.required ? requiredFieldStatus(row[field.key]) : undefined"
                          placeholder="请输入"
                        />
                      </template>
                      <template #cost="{ row }">
                        <SpecPriceInput
                          v-model="row.cost"
                          class="decimal-input"
                          placeholder="价格"
                          label="价格"
                          :submitted="submitAttempted"
                          :disabled="isOperationsEdit"
                          @change="handleSpecCostChange(row, $event)"
                        />
                      </template>

                      <template #guide="{ row }">
                        <div class="price-pair">
                          <SpecPriceInput
                            v-model="row.guideCoefficient"
                            placeholder="系数"
                            label="系数"
                            :submitted="submitAttempted"
                            @change="handleSpecCoefficientChange(row, 'guideCoefficient', 'guide', $event)"
                          />
                          <SpecPriceInput
                            v-model="row.guide"
                            placeholder="价格"
                            label="价格"
                            :submitted="submitAttempted"
                            @change="handleSpecPriceChange(row, 'guide', 'guideCoefficient', $event)"
                          />
                        </div>
                      </template>
                      <template #level1="{ row }">
                        <div class="price-pair">
                          <t-input
                            v-model="row.level1Coefficient"
                            placeholder="系数"
                            @change="handleSpecCoefficientChange(row, 'level1Coefficient', 'level1', $event)"
                            @blur="formatDecimalValue(row, 'level1Coefficient')"
                          />
                          <t-input
                            v-model="row.level1"
                            placeholder="价格"
                            @change="handleSpecPriceChange(row, 'level1', 'level1Coefficient', $event)"
                            @blur="formatDecimalValue(row, 'level1')"
                          />
                        </div>
                      </template>
                      <template #level2="{ row }">
                        <div class="price-pair">
                          <t-input
                            v-model="row.level2Coefficient"
                            placeholder="系数"
                            @change="handleSpecCoefficientChange(row, 'level2Coefficient', 'level2', $event)"
                            @blur="formatDecimalValue(row, 'level2Coefficient')"
                          />
                          <t-input
                            v-model="row.level2"
                            placeholder="价格"
                            @change="handleSpecPriceChange(row, 'level2', 'level2Coefficient', $event)"
                            @blur="formatDecimalValue(row, 'level2')"
                          />
                        </div>
                      </template>
                      <template #level3="{ row }">
                        <div class="price-pair">
                          <t-input
                            v-model="row.level3Coefficient"
                            placeholder="系数"
                            @change="handleSpecCoefficientChange(row, 'level3Coefficient', 'level3', $event)"
                            @blur="formatDecimalValue(row, 'level3Coefficient')"
                          />
                          <t-input
                            v-model="row.level3"
                            placeholder="价格"
                            @change="handleSpecPriceChange(row, 'level3', 'level3Coefficient', $event)"
                            @blur="formatDecimalValue(row, 'level3')"
                          />
                        </div>
                      </template>
                      <template #quantity="{ row }">
                        <div class="quantity-editor">
                          <t-input-number
                            v-model="row.quantity"
                            :disabled="isOperationsEdit"
                            theme="normal"
                            :min="0"
                            :status="submitAttempted && !isValidSpecQuantity(row.quantity) ? 'error' : undefined"
                            :tips="
                              submitAttempted && !isValidSpecQuantity(row.quantity) ? '请输入大于 0 的数量' : undefined
                            "
                            placeholder="请输入"
                          />
                        </div>
                      </template>
                      <template v-if="!isOperationsEdit" #operation="{ row }">
                        <div class="table-actions">
                          <t-link theme="danger" hover="color" @click="deleteSpec(row.id)">删除</t-link>
                        </div>
                      </template>
                    </t-table>
                    <div class="spec-table-actions">
                      <t-button theme="primary" variant="outline" @click="openPriceDrawer">
                        <template #icon><t-icon name="edit" /></template>
                        批量填写
                      </t-button>
                      <t-button
                        v-if="!isOperationsEdit"
                        theme="primary"
                        variant="outline"
                        @click="openSpecDialog(true)"
                      >
                        <template #icon><t-icon name="setting" /></template>
                        编辑规格
                      </t-button>
                    </div>
                  </div>
                </t-form-item>
                <t-form-item label="总库存">
                  <t-input-number :model-value="totalStock" theme="normal" :min="0" disabled />
                </t-form-item>
                <t-form-item
                  v-if="!isOperationsEdit"
                  label="上架"
                  required-mark
                  :status="requiredFieldStatus(productForm.shelfNow)"
                >
                  <t-radio-group v-model="productForm.shelfNow">
                    <t-radio value="now" :disabled="!canChooseShelfNow">立刻上架</t-radio>
                    <t-radio value="later" :disabled="!canChooseShelfLater">暂不上架</t-radio>
                  </t-radio-group>
                </t-form-item>
              </t-form>
            </AdminSectionCard>

            <AdminSectionCard class="form-submit-bar">
              <t-button theme="primary" :loading="saving" @click="submitProductForm">
                <template #icon><t-icon name="check" /></template>
                提交商品信息
              </t-button>
              <t-button theme="default" variant="base" @click="closeFormPage">取消</t-button>
            </AdminSectionCard>
          </section>
        </template>
      </main>
    </div>
    <AdminDialog
      v-model:visible="categorySwitchWarningVisible"
      header="切换分类"
      confirm-btn="确认切换"
      cancel-btn="取消"
      @confirm="confirmCategorySwitchWarning"
    >
      切换分类后，表单填写的内容将清空
    </AdminDialog>
    <AdminDialog
      v-model:visible="categoryDialogVisible"
      header="选择商品分类"
      width="920px"
      confirm-btn="确认，下一步"
      cancel-btn="取消"
      @confirm="confirmCategory"
      @cancel="closeCategoryDialog"
      @close="closeCategoryDialog"
    >
      <div class="category-picker" data-testid="finished-category-picker">
        <div v-for="(column, columnIndex) in categoryPickerColumns" :key="columnIndex" class="category-column">
          <div class="category-column-title">第{{ columnIndex + 1 }}级分类</div>
          <div class="category-option-list">
            <button
              v-for="item in column"
              :key="item.id"
              type="button"
              :class="['category-option', categoryPickerSelection[columnIndex] === item.id && 'active']"
              @click="selectCategory(columnIndex, item.id)"
            >
              <span>{{ item.name }}</span>
              <t-icon v-if="hasCategoryChildren(item.id)" name="chevron-right" />
            </button>
            <t-empty v-if="column.length === 0" description="请先选择上级分类" />
          </div>
        </div>
      </div>
      <div v-if="categoryPickerPath" class="category-picker-path">已选择：{{ categoryPickerPath }}</div>
    </AdminDialog>
    <AdminDialog
      v-model:visible="specDialogVisible"
      header="创建规格"
      width="920px"
      :footer="false"
      @close="closeSpecDialog"
    >
      <div class="spec-dialog">
        <t-radio-group :value="specMode" @change="requestSpecModeChange">
          <t-radio value="single">单层展示：自定义填写规格</t-radio>
          <t-radio value="layered">分层展示：选择标准属性构建规格</t-radio>
        </t-radio-group>

        <t-alert v-if="specDraftError" theme="error" :message="specDraftError" />
        <div v-if="specMode === 'single'" class="single-spec-editor">
          <div class="spec-section-title">商品规格</div>
          <div class="single-spec-list">
            <div v-for="(item, index) in singleSpecs" :key="item.id" class="single-spec-row">
              <t-input
                v-model="item.text"
                :status="isDuplicateSingleSpec(item) ? 'error' : specDraftFieldStatus(item.text, item.id)"
                placeholder="请输入规格文本，如 1500*800*750mm"
              />
              <t-button shape="square" variant="text" theme="danger" @click="removeSingleSpec(index)">
                <t-icon name="delete" />
              </t-button>
              <t-button
                :class="{ 'spec-add-hidden': index !== singleSpecs.length - 1 }"
                shape="square"
                theme="default"
                variant="outline"
                title="新增规格项"
                aria-label="新增规格项"
                @click="addSingleSpec"
              >
                <t-icon name="add" />
              </t-button>
            </div>
          </div>
        </div>

        <div v-else class="layered-spec-editor">
          <div class="selected-tags">
            <button
              v-for="group in specGroups"
              :key="group.field"
              type="button"
              :draggable="!isSpecGroupDisabled(group)"
              :disabled="isSpecGroupDisabled(group)"
              :title="isSpecGroupDisabled(group) ? '最多选择 3 个销售属性' : '拖拽调整属性顺序，点击选择属性'"
              :class="['spec-attr-tag', { active: group.selected, disabled: isSpecGroupDisabled(group) }]"
              @dragstart="startSpecGroupDrag($event, group.field)"
              @dragover.prevent
              @drop.prevent="dropSpecGroup(group.field)"
              @dragend="draggedSpecField = null"
              @click="toggleSpecGroup(group)"
            >
              <t-icon name="move" />
              {{ group.name }}
            </button>
          </div>
          <div v-if="!specGroups.length" class="layered-empty">当前分类暂无已发布的属性模板</div>
          <div v-else-if="!selectedSpecGroups.length" class="layered-empty">请选择销售属性标签</div>
          <div
            v-for="group in selectedSpecGroups"
            :key="group.field"
            class="spec-group"
            @dragover.prevent
            @drop.prevent="dropSpecGroup(group.field)"
          >
            <div
              class="spec-group-head"
              draggable="true"
              title="拖拽调整属性顺序"
              @dragstart="startSpecGroupDrag($event, group.field)"
              @dragend="draggedSpecField = null"
            >
              <div class="spec-group-title">
                <t-icon name="move" />
                <span v-if="salesAttributeByKey(group.field)?.required" style="color: var(--td-error-color)">* </span
                >{{ group.name }}
              </div>
            </div>
            <div class="layered-values">
              <div
                v-for="(value, index) in group.values"
                :key="value.id"
                class="layered-value-row"
                @dragover.prevent
                @drop.prevent="dropSpecValue($event, group, value.id)"
              >
                <span
                  class="spec-value-drag-handle"
                  draggable="true"
                  title="拖拽调整属性值顺序"
                  aria-label="拖拽调整属性值顺序"
                  @dragstart.stop="startSpecValueDrag($event, group.field, value.id)"
                  @dragend.stop="draggedSpecValue = null"
                >
                  <t-icon name="move" />
                </span>
                <t-select
                  v-if="salesAttributeByKey(group.field)?.type === 'select'"
                  :value="value.value"
                  :status="specDraftFieldStatus(value.value, value.id)"
                  clearable
                  placeholder="请选择属性值"
                  @change="value.value = String($event ?? '')"
                >
                  <t-option
                    v-for="item in salesAttributeByKey(group.field)?.options"
                    :key="item"
                    :label="item"
                    :value="item"
                    :disabled="isSpecOptionSelected(group, value.id, item)"
                  />
                </t-select>
                <t-input
                  v-else
                  v-model="value.value"
                  :status="isDuplicateSpecValue(group, value) ? 'error' : specDraftFieldStatus(value.value, value.id)"
                  placeholder="请输入属性值"
                />
                <t-button shape="square" variant="text" theme="danger" @click="removeSpecValue(group.name, index)">
                  <t-icon name="delete" />
                </t-button>
                <t-button
                  :class="{ 'spec-add-hidden': index !== group.values.length - 1 || !canAddSpecValue(group) }"
                  shape="square"
                  variant="outline"
                  aria-label="新增属性值"
                  title="新增属性值"
                  @click="addSpecValue(group.name)"
                >
                  <t-icon name="add" />
                </t-button>
              </div>
            </div>
          </div>
        </div>

        <div class="spec-dialog-footer">
          <t-button theme="primary" variant="text" @click="resetSpecDialog">重置</t-button>
          <t-button theme="primary" @click="confirmCreateSpec">确认创建</t-button>
          <t-button theme="default" variant="base" @click="closeSpecDialog">取消</t-button>
        </div>
      </div>
    </AdminDialog>
    <AdminDialog
      v-model:visible="specModeConfirmVisible"
      header="切换展示模式"
      confirm-btn="确认切换"
      cancel-btn="取消"
      @confirm="confirmSpecModeChange"
      @cancel="specModeConfirmVisible = false"
      @close="specModeConfirmVisible = false"
    >
      {{ specModeConfirmMessage }}
    </AdminDialog>
    <t-drawer
      v-model:visible="priceDrawerVisible"
      header="批量填写"
      placement="right"
      size="1180px"
      lazy
      destroy-on-close
      :footer="false"
      @close="closePriceDrawer"
    >
      <div class="drawer-head">
        <div>
          <strong>批量填写</strong>
          <span>按规格属性值圈定范围，再填写要覆盖的字段</span>
        </div>
        <t-button theme="primary" @click="savePriceDrawer">
          <template #icon><t-icon name="save" /></template>
          保存
        </t-button>
      </div>

      <div class="batch-fill-panel">
        <section class="batch-section">
          <div class="batch-section-head">
            <strong>选择批量范围</strong>
            <span>未选择属性值时默认填充全部规格</span>
          </div>
          <div class="batch-filter-list">
            <div v-for="filter in batchFilterOptions" :key="filter.field" class="batch-filter-row">
              <div class="batch-filter-label">{{ filter.label }}</div>
              <div class="batch-filter-values">
                <button
                  type="button"
                  :class="['batch-chip', !batchFillFilters[filter.field].length && 'active']"
                  @click="clearBatchFilterField(filter.field)"
                >
                  全部
                </button>
                <button
                  v-for="value in filter.values"
                  :key="value"
                  type="button"
                  :class="['batch-chip', isBatchFilterValueSelected(filter.field, value) && 'active']"
                  @click="toggleBatchFilterValue(filter.field, value)"
                >
                  {{ value }}
                </button>
              </div>
            </div>
          </div>
          <div class="batch-match-tip">当前将批量填充 {{ batchFillMatchedRows.length }} 条规格</div>
        </section>

        <section class="batch-section">
          <div class="batch-section-head">
            <strong>填写字段</strong>
            <span>留空的字段不会覆盖原规格数据</span>
          </div>
          <div class="batch-field-grid">
            <t-form-item v-if="!isOperationsEdit" label="成本价">
              <SpecPriceInput
                v-model="batchFillForm.cost"
                placeholder="价格"
                label="价格"
                optional
                :submitted="batchFillSubmitted"
                @change="handleBatchCostChange"
              />
            </t-form-item>

            <t-form-item v-if="!isOperationsEdit" label="数量">
              <t-input-number v-model="batchFillForm.quantity" theme="normal" :min="0" />
            </t-form-item>
            <t-form-item
              v-for="field in isOperationsEdit ? [] : batchEditableSalesFields"
              :key="field.key"
              :label="field.label"
            >
              <t-select
                v-if="field.type === 'select'"
                v-model="batchSalesAttributes[field.key]"
                clearable
                placeholder="请选择"
              >
                <t-option v-for="value in field.options" :key="value" :label="value" :value="value" />
              </t-select>
              <t-input v-else v-model="batchSalesAttributes[field.key]" clearable placeholder="请输入" />
            </t-form-item>
          </div>
        </section>
      </div>
    </t-drawer>
    <t-dialog
      v-model:visible="reasonDialogVisible"
      header="下架"
      width="520px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="submitReason"
      @cancel="closeReasonDialog"
      @close="closeReasonDialog"
    >
      <t-form :data="reasonForm" label-width="96px" colon>
        <t-form-item label="下架原因" required-mark>
          <t-select v-model="reasonForm.reason" placeholder="请选择">
            <t-option v-for="item in offShelfReasons" :key="item" :label="item" :value="item" />
          </t-select>
        </t-form-item>
        <t-form-item label="详细说明">
          <t-textarea v-model="reasonForm.detail" placeholder="请输入" :autosize="{ minRows: 4, maxRows: 6 }" />
        </t-form-item>
      </t-form>
    </t-dialog>
    <t-drawer
      v-model:visible="detailDialogVisible"
      header="商品详情"
      :close-btn="false"
      size="min(1240px, 100vw)"
      placement="right"
      :footer="false"
      @close="closeDetailDialog"
    >
      <ProductDetail
        v-if="detailProduct"
        :product="detailProduct"
        :attribute-names="detailAttributeNames"
        :operations="false"
        :enabled-level-ids="enabledPriceLevels.map((level) => level.id)"
        @preview="openProductMediaPreview"
      />
    </t-drawer>
    <t-dialog
      v-model:visible="imagePreviewVisible"
      :header="imagePreviewTitle"
      width="960px"
      placement="center"
      :prevent-scroll-through="false"
      :footer="false"
      @close="closeImagePreview"
    >
      <div class="image-preview-dialog">
        <video
          v-if="imagePreviewVisible && productPreviewType === 'video'"
          :src="imagePreviewSrc"
          controls
          autoplay
          playsinline
          aria-label="商品视频播放器"
        />
        <img v-else-if="imagePreviewVisible" :src="imagePreviewSrc" :alt="imagePreviewTitle" />
      </div>
    </t-dialog>
    <FinishedOperationLogs v-if="canViewOperationLogs" v-model:visible="operationLogsVisible" />
    <AdminConfirmDialog
      v-model:visible="confirmDialogVisible"
      :action="confirmAction"
      object-type="商品"
      :object-name="confirmState.product?.name"
      @confirm="handleConfirm"
      @cancel="closeConfirmDialog"
      @close="closeConfirmDialog"
    >
      {{ confirmState.content }}
    </AdminConfirmDialog>
  </div>
</template>

<script setup lang="ts">
import { buildFinishedProductPayload, buildFinishedOperationsPricePayload } from '../shared/finishedStockPayload';
import type {
  FinishedStockToolbarAction,
  FinishedStockRowAction,
  StockStatus,
  PublisherType,
  RowAction,
  BatchAction,
  FormSectionKey,
  SpecMode,
  LayeredSpecField,
  BatchFilterField,
  DecimalField,
  ConfirmType,
  ProductFormMode,
  TabConfig,
  FilterState,
  PaginationState,
  StockItem,
  ProductForm,
  SpecRow,
  PriceRow,
  BatchFillForm,
  SingleSpecItem,
  LayeredSpecDraft,
  SpecValue,
  SpecGroup,
  CategoryCascaderOption,
} from '../shared/finishedStockPageModel';
import { formatProductDateTime as formatDateTime } from '@/utils/formatProductDateTime';
import { materializeLayeredSpec, rebuildLayeredSpecs, specIdentity } from '../management/specModeConversion';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import { finishedStockActions } from '../shared/finishedStockActions';
import ProductRichEditor from '@/components/ProductRichEditor.vue';
import PriceSourceToggle from '../management/components/PriceSourceToggle.vue';
import SpecPriceInput from '../management/components/SpecPriceInput.vue';
import FinishedOperationLogs from '../management/components/FinishedOperationLogs.vue';
import { usePermissionTabs } from '@/composables/usePermissionTabs';
import { hasPermission } from '@/services/adminPermissions';
import { getLoginUser } from '@/services/auth';
import { isValidSpecPriceNumber } from '../management/priceValidation';
import { copySpecDimensions, orderLayeredRows, editableSalesFields } from '../management/layeredSpecs';
import { resetProductForm } from '../management/productFormState';
import {
  adminFeedback,
  AdminConfirmDialog,
  AdminDialog,
  AdminMediaUpload,
  AdminSectionCard,
  getSafeErrorMessage,
  type AdminMediaValue,
} from '@/components/foundation';
import {
  getFinishedGuidePriceSetting,
  listFinishedMarkupConfigurationOptions,
  type FinishedMarkupConfigurationRecord,
} from '@/services/finishedMarkupConfigurations';
import {
  createFinishedProduct,
  checkFinishedProductShelf,
  listFinishedProductPriceLevelOptions,
  type FinishedProductPriceLevelOption,
  deleteFinishedProduct,
  listFinishedProducts,
  getFinishedProductDetail,
  listFinishedProductFormOptions,
  releaseTemporaryFinishedProductMedia,
  updateFinishedProduct,
  uploadFinishedProductMedia,
  type FinishedProductAttributeEntry,
  type FinishedProductPayload,
  type FinishedSpecDimension,
  type FinishedProductRecord,
  type FinishedProductGuidePrice,
  type FinishedProductPrice,
  type FinishedProductVariant,
} from '@/services/finishedProducts';
import { type ProductCategoryRecord } from '@/services/productCategories';
import {
  listFinishedProductTemplateAttributes,
  type FinishedProductTemplateAttribute,
} from '@/services/finishedProducts';
import { type ProductAttributeRecord } from '@/services/productAttributes';
import { type SupplierRecord } from '@/services/suppliers';
import { sortByOffShelfAtDesc } from '../management/offShelfSorting';
import { sortByCreatedAtDesc } from '@/services/recordSorting';
import ProductDetail from '../management/components/ProductDetail.vue';
import SourceUnavailableOverlay from '../management/components/SourceUnavailableOverlay.vue';
import FinishedRowWarnings from '../management/components/FinishedRowWarnings.vue';
import { AdminListLayout, AdminPagination } from '@/components/foundation';
import { computed, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
const tabs: TabConfig[] = [
  { value: 'warehouse', label: '仓库中' },
  { value: 'selling', label: '已上架' },
  { value: 'offShelf', label: '已下架' },
  { value: 'soldOut', label: '已售完' },
  { value: 'recycle', label: '回收站' },
];
const pageSizeOptions = [10, 20, 50];
const offShelfReasons = ['库存异常', '价格调整', '图片更新', '供应商申请'];
const productPermissionPrefix = computed(() => `${'supply-chain'}.finished-stock-management`);
const sourceBlocked = (row: StockItem) => false;
const activeTab = ref<StockStatus>('warehouse');
const finishedScope: Record<StockStatus, string> = {
  warehouse: 'warehouse',
  selling: 'selling',
  offShelf: 'off-shelf',
  soldOut: 'sold-out',
  recycle: 'recycle',
};
const hasFinishedAction = (action: string, status = activeTab.value) =>
  hasPermission(getLoginUser(), `${productPermissionPrefix.value}.${finishedScope[status]}.${action}`);
const { visibleTabs: finishedTabs, showTabRail: showFinishedTabRail } = usePermissionTabs({
  tabs,
  activeTab,
  canAccess: (tab) => hasFinishedAction('view', tab.value),
});
const finishedActionCodes: Record<string, string> = {
  publish: 'publish',
  batchShelf: 'batch-shelf',
  batchOffShelf: 'batch-off-shelf',
  batchRestore: 'batch-restore',
  batchPurge: 'batch-purge',
  clearRecycle: 'clear',
  shelf: 'shelf',
  offShelf: 'off-shelf',
  edit: 'edit',
  delete: 'delete',
  detail: 'detail',
  price: 'price',
  restore: 'restore',
  purge: 'purge',
};
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const saving = ref(false);
const selectedKeys = ref<number[]>([]);
const formPageVisible = ref(false);
const formPageMode = ref<ProductFormMode>('create');
const isOperationsEdit = computed(() => false);
const activeFormSection = ref<FormSectionKey>('description');
const formAnchorNav = ref<HTMLElement>();
const formAnchorSlot = ref<HTMLElement>();
const formAnchorHeight = ref(72);
const formAnchorStyle = ref({ left: '0px', width: '0px', top: '64px' });
const updateFormAnchorPosition = () => {
  const slot = formAnchorSlot.value;
  if (!slot) return;
  const rect = slot.getBoundingClientRect();
  const top = Math.max(0, document.querySelector('.top-nav')?.getBoundingClientRect().bottom ?? 0);
  formAnchorStyle.value = { left: `${rect.left}px`, width: `${rect.width}px`, top: `${top}px` };
  formAnchorHeight.value = formAnchorNav.value?.parentElement?.getBoundingClientRect().height ?? 72;
};
watch(
  formAnchorSlot,
  (slot, _previous, onCleanup) => {
    if (!slot) return;
    const observer = new ResizeObserver(updateFormAnchorPosition);
    observer.observe(slot);
    if (formAnchorNav.value?.parentElement) observer.observe(formAnchorNav.value.parentElement);
    window.addEventListener('scroll', updateFormAnchorPosition, { passive: true });
    window.addEventListener('resize', updateFormAnchorPosition);
    updateFormAnchorPosition();
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener('scroll', updateFormAnchorPosition);
      window.removeEventListener('resize', updateFormAnchorPosition);
    });
  },
  { flush: 'post' },
);
const formSections = computed<
  {
    key: FormSectionKey;
    label: string;
  }[]
>(() =>
  isOperationsEdit.value
    ? [{ key: 'sales', label: '销售信息' }]
    : [
        { key: 'description', label: '图文描述' },
        { key: 'base', label: '基础信息' },
        { key: 'sales', label: '销售信息' },
      ],
);
const scrollToFormSection = (key: FormSectionKey) => {
  const section = document.getElementById(`finished-product-${key}`);
  if (!section) return;
  activeFormSection.value = key;
  updateFormAnchorPosition();
  const offset = Number.parseFloat(formAnchorStyle.value.top) + formAnchorHeight.value + 16;
  window.scrollTo({
    top: Math.max(0, window.scrollY + section.getBoundingClientRect().top - offset),
    behavior: 'smooth',
  });
};
const categoryDialogVisible = ref(false);
const categorySwitchWarningVisible = ref(false);
const productMediaUploading = ref(0);
const specDialogVisible = ref(false);
const validatedSpecDraftIds = ref(new Set<number>());
const specDraftFieldStatus = (value: string, id: number) =>
  validatedSpecDraftIds.value.has(id) && !value?.trim() ? 'error' : undefined;
const priceDrawerVisible = ref(false);
const reasonDialogVisible = ref(false);
const confirmDialogVisible = ref(false);
const detailDialogVisible = ref(false);
const imagePreviewVisible = ref(false);
const detailProduct = ref<StockItem | null>(null);
const editingProduct = ref<StockItem | null>(null);
const imagePreviewSrc = ref('');
const imagePreviewTitle = ref('商品主图');
const productPreviewType = ref<'image' | 'video'>('image');
const selectedCategoryId = ref<number>();
const selectedCategoryPath = ref('');
const categoryPickerSelection = ref<number[]>([]);
const specMode = ref<SpecMode>('single');
const confirmedSpecMode = ref<SpecMode>('single');
const confirmedLayeredFields = ref<LayeredSpecField[]>([]);
const confirmedSpecDimensions = ref<FinishedSpecDimension[]>([]);
const confirmedImageField = ref<LayeredSpecField | null>(null);
const singleSpecs = ref<SingleSpecItem[]>([{ id: Date.now(), text: '', imageUploaded: false }]);
const priceRows = ref<PriceRow[]>([]);
const specRows = ref<SpecRow[]>([]);
const batchFillFilters = reactive<Record<BatchFilterField, string[]>>({
  specText: [],
  material: [],
  length: [],
  color: [],
  size: [],
});
const submitAttempted = ref(false);
const isValidSpecQuantity = (value: unknown) =>
  String(value ?? '').trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
const requiredFieldStatus = (value: unknown) =>
  submitAttempted.value && !String(value ?? '').trim() ? 'error' : undefined;
const mainImageSlots = ref<(AdminMediaValue | undefined)[]>(Array.from({ length: 5 }));
const mainImages = computed(() => mainImageSlots.value.filter((item): item is AdminMediaValue => Boolean(item)));
const mainImageUploadIndexes = [0, 1, 2, 3, 4];
const mainImageMedia = computed(() => mainImageSlots.value[0]);
const videoMedia = ref<AdminMediaValue>();
const pendingUploadedMediaIds = new Set<number>();
const productCategories = ref<ProductCategoryRecord[]>([]);
const productAttributes = ref<ProductAttributeRecord[]>([]);
const categoryAttributeBindings = ref<FinishedProductTemplateAttribute[]>([]);
let templateRefresh: Promise<void> | undefined;
const refreshCategoryAttributeBindings = () => {
  if (!templateRefresh) {
    templateRefresh = listFinishedProductTemplateAttributes()
      .then((bindings) => {
        categoryAttributeBindings.value = bindings;
      })
      .finally(() => {
        templateRefresh = undefined;
      });
  }
  return templateRefresh;
};
const refreshVisibleProductTemplate = () => {
  if (!formPageVisible.value || document.visibilityState === 'hidden') return;
  void Promise.all([refreshCategoryAttributeBindings(), refreshPriceConfigurations()]).catch(() => {
    adminFeedback.error('发布配置刷新失败，请重试');
  });
};
watch([formPageVisible, selectedCategoryId], refreshVisibleProductTemplate, { flush: 'post' });
const productSuppliers = ref<SupplierRecord[]>([]);
const markupConfigurations = ref<FinishedMarkupConfigurationRecord[]>([]);
const enabledPriceLevels = ref<FinishedProductPriceLevelOption[]>([]);
const productPriceLevels = computed(() => {
  return [...enabledPriceLevels.value]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map((level) => {
      const configuration = markupConfigurations.value.find(
        (item) => item.storeLevelId === level.id && item.status === 'enabled',
      );
      return {
        id: level.id,
        name: level.name,
        configurationId: configuration?.id,
        priceCoefficient: configuration == null ? undefined : Number(configuration.priceCoefficient),
      };
    });
});
let priceConfigurationRefresh: Promise<void> | undefined;
const refreshPriceConfigurations = () => {
  if (!priceConfigurationRefresh)
    priceConfigurationRefresh = Promise.all([Promise.resolve([]), Promise.resolve(undefined), Promise.resolve([])])
      .then(([configurations, guide, levels]) => {
        enabledPriceLevels.value = levels;
        markupConfigurations.value = configurations;
        guidePriceSettingCoefficient.value = undefined;
        for (const level of productPriceLevels.value) {
          batchMarkupPrices.value[level.id] ??= { coefficient: '', price: '' };
        }
        for (const row of specRows.value) {
          const defaults = createMarkupEditors();
          for (const [key, editor] of Object.entries(defaults)) {
            const id = Number(key);
            if (!row.markupPrices[id]) {
              row.markupPrices[id] = editor;
              const cost = decimalNumber(row.cost);
              if (formPageMode.value === 'create' && cost !== null && editor.coefficient)
                editor.price = (cost * Number(editor.coefficient)).toFixed(2);
            }
          }
        }
      })
      .finally(() => {
        priceConfigurationRefresh = undefined;
      });
  return priceConfigurationRefresh;
};
const guidePriceSettingCoefficient = ref<number>();
const dataItems = ref<StockItem[]>([]);
const shelfErrors = reactive<Record<number, string>>({});
const checkingShelf = ref(false);
const categoryCascaderOptions = computed<CategoryCascaderOption[]>(() => {
  const enabled = productCategories.value.filter(
    (category) => category.scope === 'finished' && category.status !== 'disabled',
  );
  const childrenByParent = new Map<number | undefined, ProductCategoryRecord[]>();
  enabled.forEach((category) => {
    const parentId = category.parentId ?? undefined;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(category);
    childrenByParent.set(parentId, siblings);
  });
  const build = (parentId?: number, parentPath = ''): CategoryCascaderOption[] =>
    (childrenByParent.get(parentId) ?? [])
      .sort((first, second) => (first.sortOrder ?? 0) - (second.sortOrder ?? 0) || first.id - second.id)
      .map((category) => {
        const path = parentPath ? `${parentPath} / ${category.name}` : category.name;
        const children = build(category.id, path);
        return { label: category.name, value: path, ...(children.length ? { children } : {}) };
      });
  return build(undefined);
});
const enabledFinishedCategories = computed(() =>
  productCategories.value
    .filter((category) => category.scope === 'finished' && category.status !== 'disabled')
    .sort((first, second) => (first.sortOrder ?? 0) - (second.sortOrder ?? 0) || first.id - second.id),
);
const categoryChildrenByParent = computed(() => {
  const children = new Map<number | undefined, ProductCategoryRecord[]>();
  enabledFinishedCategories.value.forEach((category) => {
    const parentId = category.parentId ?? undefined;
    const siblings = children.get(parentId) ?? [];
    siblings.push(category);
    children.set(parentId, siblings);
  });
  return children;
});
const categoryPickerColumns = computed(() => {
  const columns: ProductCategoryRecord[][] = [categoryChildrenByParent.value.get(undefined) ?? []];
  for (let level = 1; level < 3; level += 1) {
    const parentId = categoryPickerSelection.value[level - 1];
    columns.push(parentId == null ? [] : (categoryChildrenByParent.value.get(parentId) ?? []));
  }
  for (let level = 3; ; level += 1) {
    const parentId = categoryPickerSelection.value[level - 1];
    if (parentId == null) break;
    const children = categoryChildrenByParent.value.get(parentId) ?? [];
    if (!children.length) break;
    columns.push(children);
  }
  return columns;
});
const categoryPickerPath = computed(() => {
  const categoryById = new Map(enabledFinishedCategories.value.map((category) => [category.id, category]));
  return categoryPickerSelection.value
    .map((categoryId) => categoryById.get(categoryId)?.name)
    .filter(Boolean)
    .join(' > ');
});
const hasCategoryChildren = (categoryId: number) => Boolean(categoryChildrenByParent.value.get(categoryId)?.length);
const categoryPathIds = (categoryId?: number) => {
  if (categoryId == null) return [];
  const categoryById = new Map(enabledFinishedCategories.value.map((category) => [category.id, category]));
  const path: number[] = [];
  let current = categoryById.get(categoryId);
  while (current) {
    path.unshift(current.id);
    current = current.parentId == null ? undefined : categoryById.get(current.parentId);
  }
  return path;
};
const defaultFilter = (): FilterState => ({
  keyword: '',
  category: '',
  supplier: '',
});
const filters = reactive<Record<StockStatus, FilterState>>({
  warehouse: defaultFilter(),
  selling: defaultFilter(),
  offShelf: defaultFilter(),
  soldOut: defaultFilter(),
  recycle: defaultFilter(),
});
const appliedFilters = reactive<Record<StockStatus, FilterState>>({
  warehouse: defaultFilter(),
  selling: defaultFilter(),
  offShelf: defaultFilter(),
  soldOut: defaultFilter(),
  recycle: defaultFilter(),
});
const paginations = reactive<Record<StockStatus, PaginationState>>({
  warehouse: { current: 1, pageSize: 10 },
  selling: { current: 1, pageSize: 10 },
  offShelf: { current: 1, pageSize: 10 },
  soldOut: { current: 1, pageSize: 10 },
  recycle: { current: 1, pageSize: 10 },
});
const createEmptyProductForm = (): ProductForm => ({
  supplier: '',
  name: '',
  brand: '',
  model: '',
  style: '',
  shape: '',
  material: '',
  craftTexture: '',
  layers: '',
  functionText: '',
  waterproof: '',
  loadBearing: '',
  origin: '',
  installDesc: '',
  detail: '',
  totalStock: 0,
  merchantCode: '',
  shelfNow: 'later',
});
const productForm = reactive<ProductForm>(createEmptyProductForm());
const createEmptyBatchFillForm = (): BatchFillForm => ({
  cost: '',
  guideCoefficient: '',
  guide: '',
  level1Coefficient: '',
  level1: '',
  level2Coefficient: '',
  level2: '',
  level3Coefficient: '',
  level3: '',
  quantity: null,
});
const batchFillForm = reactive<BatchFillForm>(createEmptyBatchFillForm());
const batchFillSubmitted = ref(false);
const batchSalesAttributes = ref<Record<string, string>>({});
const batchMarkupPrices = ref<
  Record<
    number,
    {
      coefficient: string;
      price: string;
    }
  >
>({});
const templateAttributeFields = computed(() => {
  const fields = categoryAttributeBindings.value
    .filter((attribute) => attribute.categoryId === selectedCategoryId.value)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((attribute) => ({
      key: `attribute_${attribute.attributeId}` as const,
      role: attribute.attributeRole,
      attributeId: attribute.attributeId,
      label: attribute.name,
      required: attribute.requiredFlag,
      type: attribute.valueType === 'select' ? ('select' as const) : ('input' as const),
      options: attribute.options.map((option) => option.value),
    }));
  for (const dimension of confirmedSpecDimensions.value) {
    const existing = fields.find((field) => field.key === dimension.key);
    if (existing) existing.label = dimension.name;
    else if (/^attribute_\d+$/.test(dimension.key))
      fields.push({
        key: dimension.key as `attribute_${number}`,
        attributeId: Number(dimension.key.slice(10)),
        role: 'sales',
        label: dimension.name,
        required: false,
        type: 'input',
        options: [],
      });
  }
  const product = editingProduct.value;
  if (product && product.categoryId === selectedCategoryId.value) {
    for (const entry of product.attributes) {
      if (!fields.some((field) => field.attributeId === entry.attributeId)) {
        fields.push({
          key: `attribute_${entry.attributeId}`,
          role: 'product',
          attributeId: entry.attributeId,
          label: entry.attributeName,
          required: false,
          type: 'input',
          options: [],
        });
      }
    }
    for (const variant of product.variants) {
      for (const key of Object.keys(variant.salesAttributes ?? {})) {
        if (!/^attribute_\d+$/.test(key)) continue;
        const attributeId = Number(key.slice(10));
        if (!fields.some((field) => field.attributeId === attributeId)) {
          fields.push({
            key: `attribute_${attributeId}`,
            role: 'sales',
            attributeId,
            label:
              productAttributes.value.find((attribute) => attribute.id === attributeId)?.name ??
              `销售属性 ${attributeId}`,
            required: false,
            type: 'input',
            options: [],
          });
        }
      }
    }
  }
  return fields;
});
const attributeFields = computed(() => templateAttributeFields.value.filter((field) => field.role === 'product'));
const salesAttributeFields = computed(() => templateAttributeFields.value.filter((field) => field.role === 'sales'));
const layeredFieldLabels = computed<Record<string, string>>(() => ({
  ...Object.fromEntries(confirmedSpecDimensions.value.map((dimension) => [dimension.key, dimension.name])),
  ...Object.fromEntries(salesAttributeFields.value.map((field) => [field.key, field.label])),
}));
const skuAttributeFields = computed(() =>
  salesAttributeFields.value.filter(
    (field) =>
      confirmedLayeredFields.value.includes(field.key) ||
      categoryAttributeBindings.value.some(
        (binding) =>
          binding.categoryId === selectedCategoryId.value &&
          binding.attributeId === field.attributeId &&
          binding.attributeRole === 'sales' &&
          binding.skuFlag === true,
      ),
  ),
);
const specGroups = reactive<SpecGroup[]>([]);
watch(
  skuAttributeFields,
  (fields) => {
    const existing = new Map(specGroups.map((group) => [group.field, group]));
    specGroups.splice(
      0,
      specGroups.length,
      ...[...fields]
        .sort((a, b) => {
          const order = [...existing.keys()];
          const rank = (key: LayeredSpecField) => (order.includes(key) ? order.indexOf(key) : order.length);
          return rank(a.key) - rank(b.key);
        })
        .map((field) =>
          existing.has(field.key)
            ? { ...existing.get(field.key)!, name: field.label }
            : {
                field: field.key,
                name: field.label,
                selected: false,
                withImage: false,
                values: [{ id: Date.now() + field.attributeId, value: '', imageUploaded: false }],
              },
        ),
    );
    fields.forEach((field) => {
      batchFillFilters[field.key] ??= [];
    });
  },
  { immediate: true },
);
const salesAttributeByKey = (key: LayeredSpecField) => salesAttributeFields.value.find((field) => field.key === key);
const reasonState = reactive<{
  product: StockItem | null;
  isBatch: boolean;
}>({
  product: null,
  isBatch: false,
});
const reasonForm = reactive({
  reason: '',
  detail: '',
});
const confirmState = reactive<{
  type: ConfirmType;
  product: StockItem | null;
  content: string;
}>({
  type: 'shelf',
  product: null,
  content: '',
});
const confirmAction = computed(() => {
  const actionMap: Record<ConfirmType, string> = {
    shelf: '上架',
    delete: '删除',
    restore: '放回',
    purge: '彻底删除',
    batchShelf: '批量上架',
    batchRestore: '批量放回到仓库',
    batchPurge: '批量彻底删除',
    clearRecycle: '清空回收站',
  };
  return actionMap[confirmState.type];
});
const isFinishedSupplyType = (type: SupplierRecord['supplyTypes'][number]) =>
  type.status !== 'disabled' && (type.code === 'finished' || type.name === '成品' || type.name === '成品现货');
const supplierOptions = computed(() => {
  return productSuppliers.value
    .filter((supplier) => supplier.status !== 'disabled' && supplier.supplyTypes.some(isFinishedSupplyType))
    .map((supplier) => supplier.name);
});
const countByStatus = computed<Record<StockStatus, number>>(() => ({
  warehouse: dataItems.value.filter((item) => item.status === 'warehouse').length,
  selling: dataItems.value.filter((item) => item.status === 'selling').length,
  offShelf: dataItems.value.filter((item) => item.status === 'offShelf').length,
  soldOut: dataItems.value.filter((item) => item.status === 'soldOut').length,
  recycle: dataItems.value.filter((item) => item.status === 'recycle').length,
}));
const normalizeStatus = (status?: string): StockStatus =>
  status === 'selling' || status === 'offShelf' || status === 'soldOut' || status === 'recycle' ? status : 'warehouse';
const normalizePublisherType = (value?: string): PublisherType => (value === '接口获取' ? '接口获取' : '平台发布');
const categoryPathById = (categoryId?: number) => {
  if (!categoryId) return '未分类';
  const categoryMap = new Map(productCategories.value.map((category) => [category.id, category]));
  const names: string[] = [];
  let current = categoryMap.get(categoryId);
  while (current) {
    names.unshift(current.name);
    current = current.parentId ? categoryMap.get(current.parentId) : undefined;
  }
  return names.length ? names.join(' / ') : '未分类';
};
const supplierNameById = (supplierId?: number) =>
  productSuppliers.value.find((supplier) => supplier.id === supplierId)?.name ?? '平台自营';
const supplierIdByName = (name: string) =>
  productSuppliers.value.find((supplier) => supplier.name === name && supplier.status !== 'disabled')?.id ??
  productSuppliers.value.find(
    (supplier) => supplier.supplyTypes.some(isFinishedSupplyType) && supplier.status !== 'disabled',
  )?.id;
const formatPriceRange = (guidePrice?: number) => {
  const value = Number(guidePrice ?? 0);
  return value > 0 ? `￥${value.toFixed(2)}` : '-';
};
const toStockItem = (record: FinishedProductRecord): StockItem => {
  record = {
    ...record,
    offShelfReason: record.sourceOffShelfReason,
    offShelfDetail: record.sourceOffShelfDetail,
    offShelfAt: record.sourceOffShelfAt,
  };
  const status = normalizeStatus(record.sourceStatus);
  const publisherType = normalizePublisherType(record.publisherType);
  return {
    id: record.id,
    sourceUnavailable: record.sourceUnavailable,
    sourceStatus: record.sourceStatus,
    sourceMessage: record.sourceMessage,
    code: record.sku ?? '',
    createdByName: record.createdByName?.trim() || '-',
    offShelfByName: record.offShelfByName?.trim() || '未记录',
    createdAt: record.createdAt,
    image: record.mainImageUrl || '',
    name: record.name,
    categoryId: record.categoryId,
    supplierId: record.supplierId,
    category: categoryPathById(record.categoryId),
    stock: status === 'soldOut' ? 0 : (record.totalStock ?? 0),
    supplier: supplierNameById(record.supplierId),
    publisherType,
    isExternalSupplier: Boolean(record.supplierId),
    guidePrice: record.guidePrice,
    guidePrices: record.guidePrices,
    markupPrices: record.markupPrices,
    mainImageMediaId: record.mainImageMediaId,
    mainImageMediaIds: record.mainImageMediaIds,
    mainImageUrls: record.mainImageUrls,
    videoMediaId: record.videoMediaId,
    videoUrl: record.videoUrl,
    detail: record.detail || '',
    attributes: record.attributes ?? [],
    variants: record.variants ?? [],
    specDimensions: record.specDimensions,
    priceRange: formatPriceRange(record.guidePrice),
    status,
    offShelfReason: record.offShelfReason,
    offShelfAt: record.offShelfAt,
    offShelfDetail: record.offShelfDetail,
  };
};
const toProductPayload = (item: StockItem, patch: Partial<StockItem> = {}): FinishedProductPayload => {
  const nextItem = { ...item, ...patch };
  return {
    categoryId: nextItem.categoryId,
    supplierId: nextItem.supplierId,
    name: nextItem.name,
    sku: nextItem.code,
    mainImageMediaId: nextItem.mainImageMediaId!,
    mainImageMediaIds: nextItem.mainImageMediaIds,
    videoMediaId: nextItem.videoMediaId!,
    detail: nextItem.detail,
    totalStock: nextItem.stock,
    guidePrice: nextItem.guidePrice,
    guidePrices: nextItem.guidePrices,
    markupPrices: nextItem.markupPrices,
    attributes: nextItem.attributes,
    variants: nextItem.variants,
    specDimensions: nextItem.specDimensions,
    offShelfReason: nextItem.offShelfReason,
    offShelfDetail: nextItem.offShelfDetail,
    status: nextItem.status,
  };
};
const loadInventoryData = async () => {
  if (!finishedTabs.value.length) return;
  loading.value = true;
  try {
    const [options, products, markupResult, guideSetting, bindings] = await Promise.all([
      listFinishedProductFormOptions(),
      listFinishedProducts(),
      Promise.resolve([]),
      Promise.resolve(undefined),
      listFinishedProductTemplateAttributes(),
    ]);
    productCategories.value = options.categories;
    productAttributes.value = options.attributes;
    categoryAttributeBindings.value = bindings;
    productSuppliers.value = options.suppliers;
    markupConfigurations.value = markupResult;
    guidePriceSettingCoefficient.value = undefined;
    dataItems.value = products.map(toStockItem);
    selectedKeys.value = [];
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '成品库存加载失败');
  } finally {
    loading.value = false;
  }
};
const categoryFilterVisible = ref(false);
const currentFilter = computed(() => filters[activeTab.value]);
const handleCategoryFilterChange = (value: unknown) => {
  if (typeof value !== 'string' || !value) return;
  currentFilter.value.category = value;
  categoryFilterVisible.value = false;
};
const currentAppliedFilter = computed(() => appliedFilters[activeTab.value]);
const currentPagination = computed(() => paginations[activeTab.value]);
const selectedKeySet = computed(() => new Set(selectedKeys.value));
const formPageTitle = computed(() => (formPageMode.value === 'create' ? '发布商品' : '编辑商品'));
const hasLegacyEditPermission = () => hasPermission(getLoginUser(), `${productPermissionPrefix.value}.edit`);
const canChooseShelfNow = computed(
  () =>
    (!editingProduct.value && (hasFinishedAction('shelf', 'warehouse') || hasFinishedAction('publish', 'selling'))) ||
    editingProduct.value?.status === 'selling' ||
    hasLegacyEditPermission() ||
    hasFinishedAction('shelf', editingProduct.value?.status || 'warehouse') ||
    hasFinishedAction('batch-shelf', editingProduct.value?.status || 'warehouse'),
);
const canChooseShelfLater = computed(
  () => !editingProduct.value || editingProduct.value.status === 'warehouse' || hasLegacyEditPermission(),
);
const totalStock = computed(() => specRows.value.reduce((sum, row) => sum + Number(row.quantity || 0), 0));
const detailMediaUploading = ref(false);
const productListPath = computed(() => '/supply-chain/finished-stock-management');
const handleMenuReselect = (event: Event) => {
  const detail = (
    event as CustomEvent<{
      path?: string;
    }>
  ).detail;
  if (detail?.path === productListPath.value) {
    closeFormPage();
  }
};
onMounted(() => {
  window.addEventListener('admin-menu-reselect', handleMenuReselect);
  window.addEventListener('focus', refreshVisibleProductTemplate);
  document.addEventListener('visibilitychange', refreshVisibleProductTemplate);
  loadInventoryData();
});
onBeforeUnmount(() => {
  window.removeEventListener('admin-menu-reselect', handleMenuReselect);
  window.removeEventListener('focus', refreshVisibleProductTemplate);
  document.removeEventListener('visibilitychange', refreshVisibleProductTemplate);
});
const filteredData = computed(() => {
  const filter = currentAppliedFilter.value;
  const keyword = filter.keyword.trim().toLocaleLowerCase();
  const sorted =
    activeTab.value === 'offShelf' ? sortByOffShelfAtDesc(dataItems.value) : sortByCreatedAtDesc(dataItems.value);
  return sorted.filter((item) => {
    if (item.status !== activeTab.value) return false;
    if (
      keyword &&
      ![item.name, String(item.id), item.code].some((value) => value.toLocaleLowerCase().includes(keyword))
    )
      return false;
    if (filter.category && item.category !== filter.category) return false;
    if (filter.supplier && item.supplier !== filter.supplier) return false;
    return true;
  });
});
const paginationTotal = computed(() => filteredData.value.length);
const pageData = computed(() => {
  const start = (currentPagination.value.current - 1) * currentPagination.value.pageSize;
  return filteredData.value.slice(start, start + currentPagination.value.pageSize);
});
const pageAllSelected = computed(
  () => pageData.value.length > 0 && pageData.value.every((item) => selectedKeySet.value.has(item.id)),
);
const pagePartiallySelected = computed(
  () => pageData.value.some((item) => selectedKeySet.value.has(item.id)) && !pageAllSelected.value,
);
const batchButtons = computed(() => {
  const map: Record<
    StockStatus,
    {
      action: BatchAction;
      label: string;
      theme: string;
      icon: string;
      className?: string;
    }[]
  > = {
    warehouse: [
      { action: 'publish', label: '发布商品', theme: 'primary', icon: 'add' },
      { action: 'batchShelf', label: '批量上架', theme: 'primary', icon: 'upload' },
    ],
    selling: [
      { action: 'publish', label: '发布商品', theme: 'primary', icon: 'add' },
      { action: 'batchOffShelf', label: '批量下架', theme: 'default', icon: 'download', className: 'brown-button' },
    ],
    offShelf: [{ action: 'batchRestore', label: '批量放回到仓库', theme: 'primary', icon: 'rollback' }],
    soldOut: [],
    recycle: [
      { action: 'batchRestore', label: '批量放回到仓库', theme: 'primary', icon: 'rollback' },
      { action: 'batchPurge', label: '批量彻底删除', theme: 'danger', icon: 'delete', className: 'deep-danger-button' },
      { action: 'clearRecycle', label: '清空回收站', theme: 'danger', icon: 'clear' },
    ],
  };
  return map[activeTab.value].filter((button) => hasFinishedAction(finishedActionCodes[button.action]));
});
const managementToolbarActions = computed<FinishedStockToolbarAction[]>(() =>
  batchButtons.value.map((button) => ({
    id: button.action,
    label: button.label,
    theme: button.theme as FinishedStockToolbarAction['theme'],
    icon: button.icon,
    className: button.className,
  })),
);
// Fixed pixel widths; update only when the tab action buttons change.
const operationWidths = {
  warehouse: 190,
  selling: 152,
  offShelf: 180,
  soldOut: 104,
  recycle: 208,
};
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  const base: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'image', title: '商品主图', width: 96 },
    { colKey: 'product', title: '商品名称/ID', minWidth: 220 },
    { colKey: 'supplier', title: '供应商', width: 180 },
    {
      colKey: activeTab.value === 'offShelf' ? 'offShelfByName' : 'createdByName',
      title: activeTab.value === 'offShelf' ? '下架人' : '创建人',
      width: 120,
      align: 'center',
    },
    {
      colKey: activeTab.value === 'offShelf' ? 'offShelfAt' : 'createdAt',
      title: activeTab.value === 'offShelf' ? '下架时间' : '创建时间',
      width: 180,
      align: 'center',
    },
  ];
  if (activeTab.value !== 'soldOut') {
    base.unshift({ colKey: 'select', title: 'selectTitle', width: 52, align: 'center' });
  }
  if (activeTab.value === 'offShelf') {
    base.splice(4, 0, { colKey: 'offShelfReason', title: '下架原因/详细说明', minWidth: 240 });
  }
  base.push({
    colKey: 'operation',
    title: '操作',
    width: operationWidths[activeTab.value],
    align: 'left',
    fixed: 'right',
  });
  return base;
});
const requiredColumnTitle = (label: string) => () =>
  h('span', [label, h('span', { class: 'spec-required-star', style: { color: 'var(--td-error-color)' } }, '*')]);
const specColumns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  const priceColumnsBase: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'cost', title: requiredColumnTitle('成本价'), minWidth: 80 },
    { colKey: 'guide', title: requiredColumnTitle('指导价'), minWidth: 148 },
    ...productPriceLevels.value.map((item) => ({
      colKey: `markup-${item.id}`,
      title: requiredColumnTitle(item.name),
      minWidth: 176,
    })),
    { colKey: 'quantity', title: requiredColumnTitle('数量'), minWidth: 80 },
  ];
  const tailColumns: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'operation', title: '操作', width: 76, align: 'left', fixed: 'right' },
  ];
  const createSalesColumn = (field: (typeof salesAttributeFields.value)[number]): PrimaryTableCol<TableRowData> => ({
    colKey: field.key,
    title: field.required ? requiredColumnTitle(field.label) : field.label,
  });
  const orderedSpecColumns: PrimaryTableCol<TableRowData>[] =
    confirmedSpecMode.value === 'single'
      ? [{ colKey: 'specText', title: '商品规格', minWidth: 100 }]
      : confirmedLayeredFields.value.map((key) => {
          const field = salesAttributeByKey(key);
          return field ? createSalesColumn(field) : { colKey: key, title: layeredFieldLabels.value[key] || key };
        });
  const remainingSalesColumns = salesAttributeFields.value
    .filter((field) => confirmedSpecMode.value === 'single' || !confirmedLayeredFields.value.includes(field.key))
    .map(createSalesColumn);
  return [
    ...orderedSpecColumns,
    ...priceColumnsBase.filter((col) => !String(col.colKey).startsWith('markup-') && col.colKey !== 'guide'),
    ...remainingSalesColumns,
    ...(!isOperationsEdit.value ? tailColumns : []),
  ];
});
const specRowspanAndColspan = ({
  rowIndex,
  col,
}: {
  rowIndex: number;
  col: {
    colKey?: string;
  };
}) => {
  if (confirmedSpecMode.value !== 'layered') return {};
  const fieldIndex = confirmedLayeredFields.value.findIndex((field) => field === col.colKey);
  if (fieldIndex < 0) return {};
  const parentFields = confirmedLayeredFields.value.slice(0, fieldIndex + 1);
  const row = specRows.value[rowIndex];
  if (!row) return {};
  const sameGroup = (candidate: SpecRow) => parentFields.every((field) => candidate[field] === row[field]);
  if (rowIndex > 0 && sameGroup(specRows.value[rowIndex - 1])) return { rowspan: 0, colspan: 0 };
  let rowspan = 1;
  while (rowIndex + rowspan < specRows.value.length && sameGroup(specRows.value[rowIndex + rowspan])) rowspan += 1;
  return { rowspan, colspan: 1 };
};
const batchEditableSalesFields = computed(() =>
  editableSalesFields(
    salesAttributeFields.value,
    confirmedSpecMode.value === 'layered' ? confirmedLayeredFields.value : [],
  ),
);
const batchFilterFields = computed<BatchFilterField[]>(() =>
  confirmedSpecMode.value === 'single' ? ['specText'] : confirmedLayeredFields.value,
);
const batchFilterOptions = computed(() =>
  batchFilterFields.value.map((field) => ({
    field,
    label: field === 'specText' ? '商品规格' : layeredFieldLabels.value[field],
    values: Array.from(new Set(specRows.value.map((row) => String(row[field] || '')).filter(Boolean))),
  })),
);
const isBatchFilterValueSelected = (field: BatchFilterField, value: string) =>
  (batchFillFilters[field] ?? []).includes(value);
const batchFillMatchedRows = computed(() =>
  specRows.value.filter((row) =>
    batchFilterFields.value.every((field) => {
      const selectedValues = batchFillFilters[field] ?? [];
      return selectedValues.length === 0 || selectedValues.includes(String(row[field] || ''));
    }),
  ),
);
const tabLabel = (tab: TabConfig) => {
  const count = countByStatus.value[tab.value];
  return count ? `${tab.label} ${count}` : tab.label;
};
const rowActions = () => finishedStockActions[activeTab.value].filter((action) => hasFinishedAction(action.permission));
const managementRowButtons = computed<FinishedStockRowAction[]>(() => [
  ...rowActions().map((action) => ({
    id: action.id,
    label: action.label,
    theme: action.theme as FinishedStockRowAction['theme'],
  })),
]);
const handleManagementRowButton = (action: string, row: StockItem) => {
  handleRowAction(action as RowAction, row);
};
const handleTabChange = () => {
  selectedKeys.value = [];
};
const updateManagementListFilter = (field: 'keyword' | 'supplier', value: string) => {
  currentFilter.value[field] = value;
};
const handleSearch = () => {
  Object.assign(currentAppliedFilter.value, currentFilter.value);
  currentPagination.value.current = 1;
};
const handleReset = () => {
  Object.assign(filters[activeTab.value], defaultFilter());
  handleSearch();
};
const toggleRow = (id: number, checked: boolean) => {
  if (dataItems.value.some((row) => row.id === id && sourceBlocked(row))) return;
  if (checked) {
    selectedKeys.value = Array.from(new Set([...selectedKeys.value, id]));
  } else {
    selectedKeys.value = selectedKeys.value.filter((item) => item !== id);
  }
};
const toggleCurrentPage = (checked: boolean) => {
  if (checked) {
    selectedKeys.value = Array.from(
      new Set([...selectedKeys.value, ...pageData.value.filter((item) => !sourceBlocked(item)).map((item) => item.id)]),
    );
  } else {
    const currentIds = new Set(pageData.value.map((item) => item.id));
    selectedKeys.value = selectedKeys.value.filter((id) => !currentIds.has(id));
  }
};
const handleBatchAction = (action: BatchAction) => {
  if (action === 'publish') {
    openCategoryDialog();
    return;
  }
  if (action !== 'clearRecycle' && selectedKeys.value.length === 0) {
    adminFeedback.warning('请先选择商品');
    return;
  }
  if (action === 'batchShelf') {
    openConfirm('batchShelf', null, '是否批量上架所选成品现货？');
    return;
  }
  if (action === 'batchOffShelf') {
    openReasonDialog('offShelf', null, true);
    return;
  }
  if (action === 'batchRestore') {
    openConfirm('batchRestore', null, '是否将所选成品现货放回仓库？');
    return;
  }
  if (action === 'batchPurge') {
    openConfirm('batchPurge', null, '是否批量彻底删除所选成品现货？');
    return;
  }
  openConfirm('clearRecycle', null, '是否清空回收站？');
};
const handleRowAction = async (action: RowAction, row: StockItem) => {
  if (sourceBlocked(row) && !['purge', 'detail'].includes(action)) return;
  if (action === 'detail') {
    void openProductDetail(row);
    return;
  }
  if (action === 'edit') {
    void openProductEditor(row);
    return;
  }
  if (action === 'shelf') {
    openConfirm('shelf', row, `是否上架商品“${row.name}”？`);
    return;
  }
  if (action === 'offShelf') {
    openReasonDialog('offShelf', row, false);
    return;
  }
  if (action === 'restore') {
    openConfirm('restore', row, `是否放回仓库“${row.name}”？`);
    return;
  }
  if (action === 'delete') {
    openConfirm('delete', row, `是否删除商品“${row.name}”？`);
    return;
  }
  openConfirm('purge', row, `是否彻底删除商品“${row.name}”？`);
};
const hasProductFormContent = () => {
  const defaults = createEmptyProductForm();
  return (
    Object.entries(productForm).some(
      ([key, value]) => String(value ?? '').trim() !== String(defaults[key] ?? '').trim(),
    ) ||
    mainImages.value.length > 0 ||
    Boolean(videoMedia.value) ||
    specRows.value.length > 0 ||
    singleSpecs.value.some((item) => item.text.trim() || item.imageUploaded) ||
    specGroups.some((group) => group.selected || group.values.some((item) => (item.value ?? '').trim()))
  );
};
const showCategoryPicker = () => {
  categoryPickerSelection.value = categoryPathIds(selectedCategoryId.value);
  categoryDialogVisible.value = true;
};
const confirmCategorySwitchWarning = () => {
  categorySwitchWarningVisible.value = false;
  showCategoryPicker();
};
const openCategoryDialog = () => {
  if (formPageVisible.value && formPageMode.value === 'edit') return;
  if (productMediaUploading.value || detailMediaUploading.value) {
    adminFeedback.warning('请等待媒体上传完成后切换分类');
    return;
  }
  if (formPageVisible.value && hasProductFormContent()) {
    categorySwitchWarningVisible.value = true;
    return;
  }
  if (!formPageVisible.value) {
    selectedCategoryId.value = undefined;
    selectedCategoryPath.value = '';
  }
  showCategoryPicker();
};
const closeCategoryDialog = () => {
  categoryDialogVisible.value = false;
};
const selectCategory = (columnIndex: number, categoryId: number) => {
  categoryPickerSelection.value = [...categoryPickerSelection.value.slice(0, columnIndex), categoryId];
};
const confirmCategory = () => {
  if (formPageVisible.value && formPageMode.value === 'edit') return;
  const categoryId = categoryPickerSelection.value.at(-1);
  if (categoryId == null) {
    adminFeedback.warning('请选择成品现货分类');
    return;
  }
  if (hasCategoryChildren(categoryId)) {
    adminFeedback.warning('请继续选择下级分类');
    return;
  }
  if (formPageVisible.value && categoryId !== selectedCategoryId.value) {
    const editingTarget = editingProduct.value;
    const pendingIds = [...pendingUploadedMediaIds];
    pendingUploadedMediaIds.clear();
    openFormPage(formPageMode.value);
    editingProduct.value = editingTarget;
    clearSpecDraft();
    Object.assign(batchFillForm, createEmptyBatchFillForm());
    pendingIds.forEach((mediaId) => void releaseTemporaryFinishedProductMedia(mediaId).catch(() => undefined));
  }
  selectedCategoryId.value = categoryId;
  selectedCategoryPath.value = categoryPickerPath.value;
  closeCategoryDialog();
  if (!formPageVisible.value) openFormPage('create');
};
const createDraftId = () => Date.now() + Math.floor(Math.random() * 100000);
const createSingleSpecItem = (text = '', imageUploaded = false): SingleSpecItem => ({
  id: createDraftId(),
  text,
  imageUploaded,
});
const createSpecValue = (value = '', imageUploaded = false): SpecValue => ({
  id: createDraftId(),
  value,
  imageUploaded,
});
const createMarkupEditors = (prices: FinishedProductPrice[] = []) => {
  const existingById = new Map(prices.map((item) => [item.storeLevelId, item]));
  return Object.fromEntries(
    productPriceLevels.value.map((configuration) => {
      const existing = existingById.get(configuration.id);
      const coefficient = existing ? Number(existing.priceCoefficient) : configuration.priceCoefficient;
      return [
        configuration.id,
        {
          coefficient: coefficient == null ? '' : coefficient.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''),
          price: existing ? String(existing.price) : '',
          priceSource: existing
            ? (existing.priceSource ?? 'manual')
            : configuration.configurationId
              ? ('auto' as const)
              : ('manual' as const),
          sourceConfigurationId:
            existing?.sourceConfigurationId ?? (existing ? undefined : configuration.configurationId),
        },
      ];
    }),
  );
};
const defaultGuideCoefficient = () =>
  guidePriceSettingCoefficient.value == null
    ? ''
    : Number(guidePriceSettingCoefficient.value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
const createBaseSpecRow = (partial: Partial<SpecRow>): SpecRow => ({
  id: createDraftId(),
  mode: confirmedSpecMode.value,
  specText: '',
  specImage: false,
  material: '',
  materialImage: false,
  length: '',
  lengthImage: false,
  color: '',
  colorImage: false,
  size: '',
  sizeImage: false,
  costCoefficient: '',
  cost: '',
  guideCoefficient: defaultGuideCoefficient(),
  guide: '',
  level1Coefficient: '',
  level1: '',
  level2Coefficient: '',
  level2: '',
  level3Coefficient: '',
  level3: '',
  quantity: null,
  markupPrices: createMarkupEditors(),
  ...partial,
});
const createEditSpecRows = (row: StockItem): SpecRow[] => {
  if (row.variants.length) {
    return row.variants.map((variant, index) => {
      const markupPrices = row.markupPrices?.filter((price) => price.skuId === variant.id) ?? [];
      const guidePrice = row.guidePrices?.find((price) => price.skuId === variant.id);
      return createBaseSpecRow({
        id: row.id * 100 + index + 1,
        mode: variant.displayMode,
        specText: variant.displayMode === 'single' ? variant.variantLabel : '',
        ...variant.salesAttributes,
        material: variant.material || '',
        length: variant.lengthValue || '',
        color: variant.color || '',
        size: variant.sizeValue || '',
        costCoefficient: '1',
        cost: String(variant.costPrice ?? guidePrice?.costPrice ?? markupPrices[0]?.costPrice ?? ''),
        guideCoefficient: guidePrice == null ? '' : String(Number(guidePrice.priceCoefficient)),
        guide: guidePrice == null ? '' : String(guidePrice.price),
        quantity: variant.stock,
        skuId: variant.id,
        markupPrices: createMarkupEditors(markupPrices),
      });
    });
  }
  return [
    createBaseSpecRow({
      id: row.id * 10 + 1,
      mode: 'single',
      specText: row.name,
      guideCoefficient: '',
      guide: row.guidePrice == null ? '' : String(row.guidePrice),
      quantity: row.stock,
      merchantCode: row.code,
    }),
  ];
};
const openFormPage = (mode: ProductFormMode, row?: StockItem) => {
  formPageMode.value = mode;
  formPageVisible.value = true;
  editingProduct.value = row || null;
  if (route.query.form !== mode) {
    router.replace({ path: productListPath.value, query: { form: mode } });
  }
  activeFormSection.value = isOperationsEdit.value ? 'sales' : 'description';
  submitAttempted.value = false;
  resetProductForm(productForm, createEmptyProductForm());
  specRows.value = [];
  priceRows.value = [];
  confirmedSpecMode.value = 'single';
  confirmedLayeredFields.value = [];
  confirmedSpecDimensions.value = [];
  confirmedImageField.value = null;
  mainImageSlots.value = Array.from({ length: 5 });
  videoMedia.value = undefined;
  if (row) {
    productForm.name = row.name;
    productForm.merchantCode = row.code;
    productForm.totalStock = row.stock;
    productForm.supplier = row.supplier;
    productForm.shelfNow = row.status === 'selling' ? 'now' : 'later';
    productForm.detail = row.detail;
    row.attributes.forEach((attribute) => {
      productForm[`attribute_${attribute.attributeId}`] = attribute.value;
    });
    selectedCategoryId.value = row.categoryId;
    selectedCategoryPath.value = row.category.replaceAll('/', ' > ');
    specRows.value = createEditSpecRows(row);
    confirmedSpecMode.value = row.variants[0]?.displayMode ?? 'single';
    confirmedSpecDimensions.value = copySpecDimensions(row.specDimensions);
    if (confirmedSpecMode.value === 'layered') {
      specRows.value = orderLayeredRows(specRows.value, confirmedSpecDimensions.value);
    }
    confirmedLayeredFields.value = (
      row.specDimensions?.length
        ? row.specDimensions.map((dimension) => dimension.key)
        : skuAttributeFields.value
            .map((field) => field.key)
            .filter((field) => row.variants.some((variant) => variant.salesAttributes?.[field]))
    ) as LayeredSpecField[];
    if (confirmedSpecMode.value === 'layered' && !row.specDimensions?.length) {
      adminFeedback.warning('此商品缺少历史规格顺序，请在编辑规格中核对后保存');
    }
    confirmedImageField.value = null;
    priceRows.value = specRows.value.map(specToPriceRow);
    const imageIds = row.mainImageMediaIds ?? (row.mainImageMediaId ? [row.mainImageMediaId] : []);
    mainImageSlots.value = Array.from({ length: 5 }, (_, index) =>
      imageIds[index]
        ? {
            name: `${row.name}-主图${index + 1}`,
            mediaId: imageIds[index],
            url: row.mainImageUrls?.[index] ?? row.image,
          }
        : undefined,
    );
    videoMedia.value = row.videoMediaId
      ? { name: `${row.name}-视频`, mediaId: row.videoMediaId, url: row.videoUrl }
      : undefined;
  }
};
const closeFormPage = () => {
  if (pendingUploadedMediaIds.size) {
    const pendingIds = [...pendingUploadedMediaIds];
    pendingUploadedMediaIds.clear();
    pendingIds.forEach((mediaId) => void releaseTemporaryFinishedProductMedia(mediaId));
  }
  formPageVisible.value = false;
  editingProduct.value = null;
  if (route.path === productListPath.value && Object.keys(route.query).length) {
    router.replace({ path: productListPath.value });
  }
};
const uploadProductMedia = async (file: File, expectedType: 'image' | 'video'): Promise<AdminMediaValue> => {
  productMediaUploading.value += 1;
  try {
    const uploaded = await uploadFinishedProductMedia(file);
    if (uploaded.mediaType !== expectedType) {
      await releaseTemporaryFinishedProductMedia(uploaded.id);
      throw new Error(expectedType === 'image' ? '请选择图片文件' : '请选择视频文件');
    }
    pendingUploadedMediaIds.add(uploaded.id);
    return { name: file.name, mediaId: uploaded.id, url: uploaded.url };
  } finally {
    productMediaUploading.value -= 1;
  }
};
const releasePendingProductMedia = (media: AdminMediaValue) => {
  const mediaId = media.mediaId;
  if (!mediaId || !pendingUploadedMediaIds.has(mediaId)) return;
  pendingUploadedMediaIds.delete(mediaId);
  void releaseTemporaryFinishedProductMedia(mediaId);
};
const formatDecimalValue = (row: SpecRow | PriceRow | BatchFillForm, field: DecimalField) => {
  const rawValue = String(row[field] ?? '').trim();
  if (!rawValue) {
    row[field] = '';
    return;
  }
  const value = Number(rawValue);
  row[field] = Number.isFinite(value) ? value.toFixed(2) : '';
};
const decimalNumber = (value: string) => {
  if (!isValidSpecPriceNumber(value)) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};
const syncSpecPriceByCoefficient = (row: SpecRow, coefficientField: DecimalField, priceField: DecimalField) => {
  const cost = decimalNumber(row.cost);
  const coefficient = decimalNumber(row[coefficientField]);
  if (cost === null || coefficient === null) return;
  row[priceField] = (cost * coefficient).toFixed(2);
};
const syncSpecCoefficientByPrice = (row: SpecRow, priceField: DecimalField, coefficientField: DecimalField) => {
  const cost = decimalNumber(row.cost);
  const price = decimalNumber(row[priceField]);
  if (cost === null || cost === 0 || price === null) return;
  row[coefficientField] = (price / cost).toFixed(2);
};
const syncAllSpecPricesByCost = (row: SpecRow) => {
  (
    [
      ['guideCoefficient', 'guide'],
      ['level1Coefficient', 'level1'],
      ['level2Coefficient', 'level2'],
      ['level3Coefficient', 'level3'],
    ] as [DecimalField, DecimalField][]
  ).forEach(([coefficientField, priceField]) => {
    syncSpecPriceByCoefficient(row, coefficientField, priceField);
  });
  productPriceLevels.value.forEach((configuration) => {
    const editor = row.markupPrices[configuration.id];
    const cost = decimalNumber(row.cost);
    const coefficient = decimalNumber(editor?.coefficient);
    if (editor && cost !== null && coefficient !== null) editor.price = (cost * coefficient).toFixed(2);
  });
};
const handleSpecCostChange = (row: SpecRow, value: unknown) => {
  row.cost = String(value ?? '');
  if (!row.cost.trim()) {
    row.guide = '';
    Object.values(row.markupPrices).forEach((editor) => {
      editor.price = '';
    });
    return;
  }
  if (!isValidSpecPriceNumber(row.cost)) return;
  syncAllSpecPricesByCost(row);
};
const handleSpecCoefficientChange = (
  row: SpecRow,
  coefficientField: DecimalField,
  priceField: DecimalField,
  value: unknown,
) => {
  row[coefficientField] = String(value ?? '');
  if (!isValidSpecPriceNumber(row[coefficientField])) return;
  syncSpecPriceByCoefficient(row, coefficientField, priceField);
};
const handleSpecPriceChange = (
  row: SpecRow,
  priceField: DecimalField,
  coefficientField: DecimalField,
  value: unknown,
) => {
  row[priceField] = String(value ?? '');
  if (!isValidSpecPriceNumber(row[priceField])) return;
  syncSpecCoefficientByPrice(row, priceField, coefficientField);
};
const toggleSpecPriceSource = (row: SpecRow, levelId: number) => {
  const editor = row.markupPrices[levelId];
  if (editor.priceSource === 'auto') {
    editor.priceSource = 'manual';
    editor.sourceConfigurationId = undefined;
  } else restoreSpecAutoPrice(row, levelId);
};
const restoreSpecAutoPrice = (row: SpecRow, levelId: number) => {
  const configuration = productPriceLevels.value.find((level) => level.id === levelId);
  if (!configuration?.configurationId || configuration.priceCoefficient == null) return;
  const editor = row.markupPrices[levelId];
  editor.coefficient = String(configuration.priceCoefficient);
  editor.priceSource = 'auto';
  editor.sourceConfigurationId = configuration.configurationId;
  if (isValidSpecPriceNumber(row.cost)) editor.price = (Number(row.cost) * configuration.priceCoefficient).toFixed(2);
};
const markSpecPriceManual = (row: SpecRow, levelId: number) => {
  row.markupPrices[levelId].priceSource = 'manual';
  row.markupPrices[levelId].sourceConfigurationId = undefined;
};
const handleMarkupCoefficientChange = (row: SpecRow, configurationId: number, value: unknown) => {
  const editor = row.markupPrices[configurationId];
  if (!editor) return;
  editor.coefficient = String(value ?? '');
  if (!isValidSpecPriceNumber(editor.coefficient)) return;
  const cost = decimalNumber(row.cost);
  const coefficient = decimalNumber(editor.coefficient);
  if (cost !== null && coefficient !== null && coefficient >= 0) editor.price = (cost * coefficient).toFixed(2);
};
const handleMarkupPriceChange = (row: SpecRow, configurationId: number, value: unknown) => {
  const editor = row.markupPrices[configurationId];
  if (!editor) return;
  editor.price = String(value ?? '');
  if (!isValidSpecPriceNumber(editor.price)) return;
  const cost = decimalNumber(row.cost);
  const price = decimalNumber(editor.price);
  if (cost !== null && cost > 0 && price !== null && price >= 0) editor.coefficient = (price / cost).toFixed(2);
};
const syncBatchPriceByCoefficient = (coefficientField: DecimalField, priceField: DecimalField) => {
  if (!isValidSpecPriceNumber(batchFillForm.cost) || !isValidSpecPriceNumber(batchFillForm[coefficientField])) return;
  const cost = decimalNumber(batchFillForm.cost);
  const coefficient = decimalNumber(batchFillForm[coefficientField]);
  if (cost === null || coefficient === null) return;
  batchFillForm[priceField] = (cost * coefficient).toFixed(2);
};
const syncBatchCoefficientByPrice = (priceField: DecimalField, coefficientField: DecimalField) => {
  if (!isValidSpecPriceNumber(batchFillForm.cost) || !isValidSpecPriceNumber(batchFillForm[priceField])) return;
  const cost = decimalNumber(batchFillForm.cost);
  const price = decimalNumber(batchFillForm[priceField]);
  if (cost === null || cost === 0 || price === null) return;
  batchFillForm[coefficientField] = (price / cost).toFixed(2);
};
const syncAllBatchPricesByCost = () => {
  (
    [
      ['guideCoefficient', 'guide'],
      ['level1Coefficient', 'level1'],
      ['level2Coefficient', 'level2'],
      ['level3Coefficient', 'level3'],
    ] as [DecimalField, DecimalField][]
  ).forEach(([coefficientField, priceField]) => {
    syncBatchPriceByCoefficient(coefficientField, priceField);
  });
};
const handleBatchMarkupChange = (id: number, field: 'coefficient' | 'price', value: unknown) => {
  const editor = batchMarkupPrices.value[id];
  editor[field] = String(value ?? '');
  if (!isValidSpecPriceNumber(editor[field]) || !isValidSpecPriceNumber(batchFillForm.cost)) return;
  const cost = decimalNumber(batchFillForm.cost);
  const amount = decimalNumber(editor[field]);
  if (cost === null || amount === null) return;
  if (field === 'coefficient') editor.price = (cost * amount).toFixed(2);
  else if (cost > 0) editor.coefficient = (amount / cost).toFixed(2);
};
const handleBatchCostChange = (value: unknown) => {
  batchFillForm.cost = String(value ?? '');
  if (!isValidSpecPriceNumber(batchFillForm.cost)) return;
  syncAllBatchPricesByCost();
  for (const [id, editor] of Object.entries(batchMarkupPrices.value)) {
    handleBatchMarkupChange(Number(id), 'coefficient', editor.coefficient);
  }
};
const handleBatchCoefficientChange = (coefficientField: DecimalField, priceField: DecimalField, value: unknown) => {
  batchFillForm[coefficientField] = String(value ?? '');
  syncBatchPriceByCoefficient(coefficientField, priceField);
};
const handleBatchPriceChange = (priceField: DecimalField, coefficientField: DecimalField, value: unknown) => {
  batchFillForm[priceField] = String(value ?? '');
  syncBatchCoefficientByPrice(priceField, coefficientField);
};
const openSpecDialog = async (preserveCurrent = false) => {
  validatedSpecDraftIds.value = new Set();
  try {
    await refreshPriceConfigurations();
  } catch {
    adminFeedback.error('价格配置加载失败，请重试');
    return;
  }
  clearSpecDraft();
  if (preserveCurrent && specRows.value.length) hydrateSpecDialogFromRows();
  if (specMode.value === 'single') {
    singleSpecs.value.forEach((item, index) => {
      item.sourceRow = cloneSpecDraft(specRows.value[index]);
    });
  } else {
    useLinkedLayeredDrafts.value = true;
    layeredSpecDrafts.value = specRows.value.map((row) => createLinkedSpecDraft(row));
    linkedSpecStructure.value = currentSpecStructure();
  }
  specOpeningDraft = captureSpecDraft();
  specDialogVisible.value = true;
};
const closeSpecDialog = () => {
  specModeConfirmVisible.value = false;
  specDialogVisible.value = false;
};
const layeredSpecDrafts = ref<LayeredSpecDraft[]>([]);
const useLinkedLayeredDrafts = ref(false);
const linkedSpecStructure = ref('');
const currentSpecStructure = () =>
  JSON.stringify(
    specGroups
      .filter((group) => group.selected)
      .map((group) => [group.field, group.values.map((value) => value.id).sort((a, b) => a - b)])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
const specDraftError = ref('');
const cloneSpecDraft = <T,>(value: T): T => (value == null ? value : JSON.parse(JSON.stringify(value)));
const captureSpecDraft = () =>
  cloneSpecDraft({
    mode: specMode.value,
    singles: singleSpecs.value,
    groups: specGroups,
    layered: layeredSpecDrafts.value,
    useLinkedRows: useLinkedLayeredDrafts.value,
    linkedStructure: linkedSpecStructure.value,
  });
let specOpeningDraft: ReturnType<typeof captureSpecDraft> | undefined;
const createLinkedSpecDraft = (source: SpecRow): LayeredSpecDraft => {
  const row = cloneSpecDraft(source);
  const valueIds: LayeredSpecDraft['valueIds'] = {};
  specGroups.forEach((group) => {
    const value = String(row[group.field] ?? '');
    const match =
      group.values.find((item) => item.id === row._specValueIds?.[group.field]) ||
      (value.trim()
        ? group.values.find((item) => normalizeLayeredValue(group.field, item.value) === value)
        : undefined);
    if (match) valueIds[group.field] = match.id;
  });
  return {
    id: row.id,
    sourceRow: row,
    valueIds,
  };
};
const specModeConfirmVisible = ref(false);
const pendingSpecMode = ref<SpecMode>('single');
const specModeConfirmMessage =
  '您正在从【单层展示】切换至【分层展示】。本次切换将清空已填写的规格数据，请按分层结构重新配置。点击下方「重置」可恢复本次打开时的配置。';
const requestSpecModeChange = (value: unknown) => {
  if ((value !== 'single' && value !== 'layered') || value === specMode.value) return;
  if (value === 'layered' && singleSpecs.value.some((item) => item.text.trim())) {
    pendingSpecMode.value = value;
    specModeConfirmVisible.value = true;
    return;
  }
  handleSpecModeChange(value);
};
const confirmSpecModeChange = () => {
  specModeConfirmVisible.value = false;
  if (specDialogVisible.value) handleSpecModeChange(pendingSpecMode.value);
};
const handleSpecModeChange = (value: SpecMode) => {
  if (value === specMode.value) return;
  clearSpecDraft(false);
  specMode.value = value;
};
const materializeSpecDraft = (draft: LayeredSpecDraft): SpecRow =>
  materializeLayeredSpec(draft.sourceRow, draft.valueIds, selectedSpecGroups.value);
const clearSpecDraft = (resetMode = true) => {
  validatedSpecDraftIds.value = new Set();
  specDraftError.value = '';
  layeredSpecDrafts.value = [];
  useLinkedLayeredDrafts.value = false;
  linkedSpecStructure.value = '';
  if (resetMode) {
    specMode.value = 'single';
  }
  singleSpecs.value = [createSingleSpecItem()];
  specGroups.forEach((group) => {
    group.selected = false;
    group.withImage = false;
    group.values = [createSpecValue()];
  });
};
const draggedSpecValue = ref<{
  field: LayeredSpecField;
  id: number;
} | null>(null);
const startSpecValueDrag = (event: DragEvent, field: LayeredSpecField, id: number) => {
  draggedSpecField.value = null;
  draggedSpecValue.value = { field, id };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(id));
  }
};
const dropSpecValue = (event: DragEvent, group: SpecGroup, targetId: number) => {
  const source = draggedSpecValue.value;
  if (!source) return;
  event.stopPropagation();
  draggedSpecValue.value = null;
  if (source.field !== group.field) return;
  const sourceIndex = group.values.findIndex((value) => value.id === source.id);
  const targetIndex = group.values.findIndex((value) => value.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
  const [value] = group.values.splice(sourceIndex, 1);
  group.values.splice(targetIndex, 0, value);
};
const draggedSpecField = ref<LayeredSpecField | null>(null);
const startSpecGroupDrag = (event: DragEvent, field: LayeredSpecField) => {
  draggedSpecValue.value = null;
  draggedSpecField.value = field;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', field);
  }
};
const dropSpecGroup = (targetField: LayeredSpecField) => {
  const sourceIndex = specGroups.findIndex((group) => group.field === draggedSpecField.value);
  const targetIndex = specGroups.findIndex((group) => group.field === targetField);
  draggedSpecField.value = null;
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
  const [group] = specGroups.splice(sourceIndex, 1);
  specGroups.splice(targetIndex, 0, group);
};
const selectedSpecGroups = computed(() => specGroups.filter((group) => group.selected));
const selectedImageGroup = computed(() => selectedSpecGroups.value.find((group) => group.withImage));
const addSingleSpec = () => {
  singleSpecs.value.push(createSingleSpecItem());
};
const removeSingleSpec = (index: number) => {
  if (singleSpecs.value.length <= 1) {
    adminFeedback.warning('至少需要输入一个商品规格');
    return;
  }
  singleSpecs.value.splice(index, 1);
};
const isDuplicateSingleSpec = (current: SingleSpecItem) => {
  const text = current.text.trim();
  return text !== '' && singleSpecs.value.some((item) => item.id !== current.id && item.text.trim() === text);
};
const isDuplicateSpecValue = (group: SpecGroup, current: SpecValue) => {
  if (salesAttributeByKey(group.field)?.type === 'select') return false;
  const value = (current.value ?? '').trim();
  return value !== '' && group.values.some((item) => item.id !== current.id && (item.value ?? '').trim() === value);
};
const isSpecOptionSelected = (group: SpecGroup, currentId: number, option: string) =>
  group.values.some((value) => value.id !== currentId && value.value === option);
const canAddSpecValue = (group: SpecGroup) => {
  const field = salesAttributeByKey(group.field);
  return field?.type !== 'select' || group.values.length < (field.options?.length ?? 0);
};
const addSpecValue = (name: string) => {
  const group = specGroups.find((item) => item.name === name);
  if (!group || !canAddSpecValue(group)) return;
  group.values.push(createSpecValue());
};
const removeSpecValue = (name: string, index: number) => {
  const group = specGroups.find((item) => item.name === name);
  if (!group) return;
  if (group.values.length <= 1) {
    adminFeedback.warning('至少需要输入一个属性值');
    return;
  }
  const [removed] = group.values.splice(index, 1);
  layeredSpecDrafts.value.forEach((draft) => {
    if (draft.valueIds[group.field] === removed?.id) delete draft.valueIds[group.field];
  });
};
const MAX_SPEC_GROUPS = 3;
const isSpecGroupDisabled = (group: SpecGroup) => !group.selected && selectedSpecGroups.value.length >= MAX_SPEC_GROUPS;
const toggleSpecGroup = (group: SpecGroup) => {
  if (isSpecGroupDisabled(group)) return;
  group.selected = !group.selected;
  if (!group.selected) {
    group.withImage = false;
    group.values = [createSpecValue()];
    layeredSpecDrafts.value.forEach((draft) => {
      delete draft.valueIds[group.field];
      draft.sourceRow[group.field] = '';
      draft.sourceRow[`${group.field}Image`] = false;
      if (draft.sourceRow._specValueIds) delete draft.sourceRow._specValueIds[group.field];
    });
    return;
  }
};
const resetSpecDialog = () => {
  if (!specOpeningDraft) {
    clearSpecDraft();
    return;
  }
  const saved = cloneSpecDraft(specOpeningDraft);
  specMode.value = saved.mode;
  singleSpecs.value = saved.singles;
  specGroups.splice(0, specGroups.length, ...saved.groups);
  validatedSpecDraftIds.value = new Set();
  layeredSpecDrafts.value = saved.layered;
  useLinkedLayeredDrafts.value = saved.useLinkedRows;
  linkedSpecStructure.value = saved.linkedStructure;
  specDraftError.value = '';
};
const hydrateSpecDialogFromRows = () => {
  specMode.value = confirmedSpecMode.value;
  if (confirmedSpecMode.value === 'single') {
    singleSpecs.value = specRows.value.map((row) => createSingleSpecItem(row.specText, row.specImage));
    if (!singleSpecs.value.length) singleSpecs.value = [createSingleSpecItem()];
    return;
  }
  const dimensionOrder = confirmedLayeredFields.value;
  specGroups.sort((a, b) => {
    const rank = (key: LayeredSpecField) =>
      dimensionOrder.includes(key) ? dimensionOrder.indexOf(key) : dimensionOrder.length;
    return rank(a.field) - rank(b.field);
  });
  let hasHydratedImageGroup = false;
  specGroups.forEach((group) => {
    const imageKey = `${group.field}Image` as 'materialImage' | 'lengthImage' | 'colorImage' | 'sizeImage';
    group.selected = confirmedLayeredFields.value.includes(group.field);
    const rowHasImage = specRows.value.some((row) => Boolean(row[imageKey]));
    group.withImage = rowHasImage && !hasHydratedImageGroup;
    if (group.withImage) hasHydratedImageGroup = true;
    group.values = Array.from(
      new Map(specRows.value.map((row) => [row[group.field], Boolean(row[imageKey])])).entries(),
    )
      .filter(([value]) => value)
      .map(([value, imageUploaded]) =>
        createSpecValue(group.field === 'length' ? value.replace('mm', '') : value, group.withImage && imageUploaded),
      );
    const dimension = confirmedSpecDimensions.value.find((item) => item.key === group.field);
    if (dimension) group.values.sort((a, b) => dimension.values.indexOf(a.value) - dimension.values.indexOf(b.value));
    if (!group.values.length) group.values = [createSpecValue()];
  });
};
const confirmCreateSpec = () => {
  specDraftError.value = '';
  validatedSpecDraftIds.value = new Set(
    specMode.value === 'single'
      ? singleSpecs.value.map((item) => item.id)
      : selectedSpecGroups.value.flatMap((group) => group.values.map((item) => item.id)),
  );
  if (specMode.value === 'layered' && selectedSpecGroups.value.length > MAX_SPEC_GROUPS) {
    specDraftError.value = '最多选择 3 个销售属性';
    return;
  }
  if (specMode.value === 'layered' && !selectedSpecGroups.value.length) {
    specDraftError.value = '请选择销售属性并填写规格属性值';
    return;
  }
  const hasEmptyValue =
    specMode.value === 'single'
      ? singleSpecs.value.some((item) => !item.text.trim())
      : selectedSpecGroups.value.some((group) => group.values.some((item) => !(item.value ?? '').trim()));
  if (hasEmptyValue) {
    specDraftError.value =
      specMode.value === 'single' ? '商品规格不能为空，请填写后再确认创建' : '请填写所有规格属性值后再确认创建';
    return;
  }
  if (specMode.value === 'single' && singleSpecs.value.some(isDuplicateSingleSpec)) {
    specDraftError.value = '商品规格名称不能重复，请修改后再确认创建';
    return;
  }
  if (
    specMode.value === 'layered' &&
    selectedSpecGroups.value.some((group) => group.values.some((value) => isDuplicateSpecValue(group, value)))
  ) {
    specDraftError.value = '同一属性的值不能重复，请修改后再确认创建';
    return;
  }
  const rows =
    specMode.value === 'single'
      ? singleSpecs.value.map((item) =>
          createBaseSpecRow({
            ...cloneSpecDraft(item.sourceRow || {}),
            mode: 'single',
            specText: item.text.trim(),
            specImage: item.imageUploaded,
          }),
        )
      : buildLayeredSpecRows();
  if (!rows.length) {
    specDraftError.value = '请至少配置一条商品规格';
    return;
  }
  const fields = selectedSpecGroups.value.map((group) => group.field);
  if (specMode.value === 'layered' && rows.some((row) => fields.some((field) => !String(row[field] || '').trim()))) {
    specDraftError.value = '请补充每条规格的属性值后再确认创建';
    return;
  }
  if (specMode.value === 'layered' && new Set(rows.map((row) => specIdentity(row, fields))).size !== rows.length) {
    specDraftError.value = '规格组合不能重复，请修改后再确认创建';
    return;
  }
  confirmedSpecDimensions.value =
    specMode.value === 'layered'
      ? selectedSpecGroups.value.map((group) => ({
          key: group.field,
          name: group.name,
          values: group.values.map((item) => normalizeLayeredValue(group.field, item.value)),
        }))
      : [];
  confirmedSpecMode.value = specMode.value;
  confirmedLayeredFields.value = specMode.value === 'layered' ? fields : [];
  confirmedImageField.value = specMode.value === 'layered' ? selectedImageGroup.value?.field || null : null;
  specRows.value = specMode.value === 'layered' ? orderLayeredRows(rows, confirmedSpecDimensions.value) : rows;
  priceRows.value = specRows.value.map(specToPriceRow);
  closeSpecDialog();
  adminFeedback.success('规格表格已生成');
};
const normalizeLayeredValue = (field: LayeredSpecField, value: string | null | undefined) => {
  const text = (value ?? '').trim();
  return field === 'length' && text && !text.endsWith('mm') ? `${text}mm` : text;
};
const buildLayeredSpecRows = () => {
  const groups = selectedSpecGroups.value;
  const fields = groups.map((group) => group.field);
  if (useLinkedLayeredDrafts.value) {
    const rows = layeredSpecDrafts.value.map(materializeSpecDraft);
    const bindingsComplete = layeredSpecDrafts.value.every((draft) =>
      groups.every((group) => group.values.some((value) => value.id === draft.valueIds[group.field])),
    );
    // An unchanged sparse set stays sparse; edited dimensions are regenerated below.
    if (
      linkedSpecStructure.value === currentSpecStructure() &&
      bindingsComplete &&
      new Set(rows.map((row) => specIdentity(row, fields))).size === rows.length
    )
      return rows;
  }
  const normalizedGroups = groups.map((group) => ({
    ...group,
    values: group.values
      .map((item) => ({ ...item, value: normalizeLayeredValue(group.field, item.value) }))
      .filter((item) => item.value),
  }));
  return rebuildLayeredSpecs(
    normalizedGroups,
    layeredSpecDrafts.value,
    () => createBaseSpecRow({ mode: 'layered', quantity: null }),
    salesAttributeFields.value.map((field) => field.key),
  );
};
const specToPriceRow = (row: SpecRow): PriceRow => ({
  ...Object.fromEntries(salesAttributeFields.value.map((field) => [field.key, row[field.key]])),
  id: row.id,
  mode: row.mode,
  specText: row.specText,
  material: row.material,
  length: row.length,
  color: row.color,
  size: row.size,
  stock: row.quantity ?? 0,
  costCoefficient: row.costCoefficient,
  cost: row.cost,
  guideCoefficient: row.guideCoefficient,
  guide: row.guide,
  level1Coefficient: row.level1Coefficient,
  level1: row.level1,
  level2Coefficient: row.level2Coefficient,
  level2: row.level2,
  level3Coefficient: row.level3Coefficient,
  level3: row.level3,
});
const operationLogsVisible = ref(false);
const canViewOperationLogs = computed(() =>
  hasPermission(getLoginUser(), `${productPermissionPrefix.value}.operation-log.view`),
);
const openPriceDrawer = () => {
  resetBatchFillState();
  priceDrawerVisible.value = true;
};
const closePriceDrawer = () => {
  priceDrawerVisible.value = false;
};
const resetBatchFillState = () => {
  batchFillSubmitted.value = false;
  batchSalesAttributes.value = Object.fromEntries(salesAttributeFields.value.map((field) => [field.key, '']));
  batchMarkupPrices.value = Object.fromEntries(
    productPriceLevels.value.map((level) => [level.id, { coefficient: '', price: '' }]),
  );
  batchFilterFields.value.forEach((field) => {
    batchFillFilters[field] = [];
  });
  Object.assign(batchFillForm, createEmptyBatchFillForm());
};
const toggleBatchFilterValue = (field: BatchFilterField, value: string) => {
  const values = batchFillFilters[field] ?? [];
  batchFillFilters[field] = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
};
const clearBatchFilterField = (field: BatchFilterField) => {
  batchFillFilters[field] = [];
};
const savePriceDrawer = () => {
  {
    batchFillSubmitted.value = true;
    const priceInputs = [
      batchFillForm.cost,
      batchFillForm.guideCoefficient,
      batchFillForm.guide,
      ...productPriceLevels.value.flatMap((level) => {
        const editor = batchMarkupPrices.value[level.id];
        return [editor.coefficient, editor.price];
      }),
    ];
    if (priceInputs.some((value) => String(value ?? '').trim() && !isValidSpecPriceNumber(value))) {
      adminFeedback.error('请输入正确的价格或系数');
      return;
    }
    const matchedIds = new Set(batchFillMatchedRows.value.map((row) => row.id));
    if (!matchedIds.size) {
      adminFeedback.warning('当前条件下没有可批量填写的规格');
      return;
    }
    specRows.value = specRows.value.map((row) => {
      return matchedIds.has(row.id)
        ? {
            ...row,
            ...Object.fromEntries(
              batchEditableSalesFields.value
                .filter((field) => batchSalesAttributes.value[field.key]?.trim())
                .map((field) => [field.key, batchSalesAttributes.value[field.key]]),
            ),
            markupPrices: Object.fromEntries(
              productPriceLevels.value.map((level) => {
                const original = row.markupPrices[level.id];
                const input = batchMarkupPrices.value[level.id];
                const cost = decimalNumber(batchFillForm.cost || row.cost);
                const editor = { ...original };
                if (input.coefficient || input.price) {
                  editor.priceSource = 'manual';
                  editor.sourceConfigurationId = undefined;
                }
                if (input.coefficient) editor.coefficient = input.coefficient;
                if (input.price) {
                  editor.price = input.price;
                  if (!input.coefficient && cost !== null && cost > 0)
                    editor.coefficient = (Number(input.price) / cost).toFixed(2);
                } else if ((batchFillForm.cost || input.coefficient) && cost !== null && editor.coefficient) {
                  editor.price = (cost * Number(editor.coefficient)).toFixed(2);
                }
                return [level.id, editor];
              }),
            ),
            cost: batchFillForm.cost || row.cost,
            guideCoefficient:
              batchFillForm.guideCoefficient ||
              (batchFillForm.guide && Number(batchFillForm.cost || row.cost) > 0
                ? (Number(batchFillForm.guide) / Number(batchFillForm.cost || row.cost)).toFixed(2)
                : row.guideCoefficient),
            guide:
              batchFillForm.guide ||
              ((batchFillForm.cost || batchFillForm.guideCoefficient) &&
              decimalNumber(batchFillForm.cost || row.cost) !== null &&
              decimalNumber(batchFillForm.guideCoefficient || row.guideCoefficient) !== null
                ? (
                    Number(batchFillForm.cost || row.cost) *
                    Number(batchFillForm.guideCoefficient || row.guideCoefficient)
                  ).toFixed(2)
                : row.guide),
            level1Coefficient: batchFillForm.level1Coefficient || row.level1Coefficient,
            level1: batchFillForm.level1 || row.level1,
            level2Coefficient: batchFillForm.level2Coefficient || row.level2Coefficient,
            level2: batchFillForm.level2 || row.level2,
            level3Coefficient: batchFillForm.level3Coefficient || row.level3Coefficient,
            level3: batchFillForm.level3 || row.level3,
            quantity: batchFillForm.quantity ?? row.quantity,
          }
        : row;
    });
    priceRows.value = specRows.value.map(specToPriceRow);
    adminFeedback.success(`已批量填充 ${matchedIds.size} 条规格`);
  }
  closePriceDrawer();
};
const deleteSpec = (id: number) => {
  specRows.value = specRows.value.filter((item) => item.id !== id);
};
const validateProductForm = () => {
  if (isOperationsEdit.value) {
    const valid =
      specRows.value.length > 0 &&
      specRows.value.every(
        (row) =>
          isValidSpecPriceNumber(row.guideCoefficient) &&
          isValidSpecPriceNumber(row.guide) &&
          productPriceLevels.value.every((configuration) => {
            const editor = row.markupPrices[configuration.id];
            return isValidSpecPriceNumber(editor?.coefficient) && isValidSpecPriceNumber(editor?.price);
          }),
      );
    if (!valid) adminFeedback.warning('请完善每条规格的指导价和合伙人价格');
    return valid;
  }
  if (confirmedSpecMode.value === 'layered') {
    if (!confirmedSpecDimensions.value.length) {
      adminFeedback.error('请先编辑并确认分层规格，补齐属性顺序');
      return false;
    }
    const combinations = specRows.value.map((row) =>
      JSON.stringify(confirmedLayeredFields.value.map((key) => row[key])),
    );
    if (new Set(combinations).size !== combinations.length) {
      adminFeedback.error('销售规格组合重复，请重新编辑规格');
      return false;
    }
  }
  const pricesComplete = specRows.value.every(
    (row) =>
      isValidSpecPriceNumber(row.cost) &&
      productPriceLevels.value.every((configuration) => {
        const editor = row.markupPrices[configuration.id];
        return isValidSpecPriceNumber(editor?.coefficient) && isValidSpecPriceNumber(editor?.price);
      }),
  );
  const checks: {
    valid: boolean;
    tab: FormSectionKey;
    message: string;
  }[] = [
    { valid: Boolean(mainImageMedia.value?.mediaId), tab: 'description', message: '请上传商品主图' },
    { valid: Boolean(videoMedia.value?.mediaId), tab: 'description', message: '请上传商品视频' },
    { valid: Boolean(productForm.detail.trim()), tab: 'description', message: '请输入宝贝详情' },
    { valid: Boolean(productForm.name.trim()), tab: 'base', message: '请输入商品名称' },
    {
      valid: attributeFields.value.every((field) => !field.required || String(productForm[field.key] ?? '').trim()),
      tab: 'base',
      message: `请填写${attributeFields.value.find((field) => field.required && !String(productForm[field.key] ?? '').trim())?.label ?? '必填商品属性'}`,
    },
    { valid: Boolean(productForm.supplier), tab: 'base', message: '请选择供应商' },
    { valid: selectedCategoryId.value != null, tab: 'base', message: '请选择商品分类' },
    { valid: specRows.value.length > 0, tab: 'sales', message: '请创建销售规格' },
    {
      valid: specRows.value.every((row) => isValidSpecQuantity(row.quantity)),
      tab: 'sales',
      message: '请输入每条规格大于 0 的数量',
    },
    {
      valid: specRows.value.every((row) =>
        salesAttributeFields.value.every((field) => !field.required || String(row[field.key] ?? '').trim()),
      ),
      tab: 'sales',
      message: `请填写每条规格的${salesAttributeFields.value.find((field) => field.required && specRows.value.some((row) => !String(row[field.key] ?? '').trim()))?.label ?? '必填销售属性'}`,
    },
    {
      valid: true,
      tab: 'sales',
      message: '请先配置成品指导价默认系数',
    },
    {
      valid: pricesComplete,
      tab: 'sales',
      message: '请完善每条规格的成本价',
    },
    { valid: true, tab: 'sales', message: '请选择上架方式' },
  ];
  const failed = checks.find((item) => !item.valid);
  if (failed) {
    scrollToFormSection(failed.tab);
    adminFeedback.warning(failed.message);
    return false;
  }
  return true;
};
const specVariantLabel = (row: SpecRow) =>
  row.specText ||
  (confirmedSpecMode.value === 'layered'
    ? confirmedLayeredFields.value
    : salesAttributeFields.value.map((field) => field.key)
  )
    .map((key) => String(row[key] ?? '').trim())
    .filter(Boolean)
    .join(' / ') ||
  '未命名规格';
const buildProductPayloadFromForm = (): FinishedProductPayload =>
  buildFinishedProductPayload({
    totalStock: totalStock.value,
    form: productForm,
    specRows: specRows.value,
    categoryId: selectedCategoryId.value,
    supplierId: supplierIdByName(productForm.supplier),
    mainImageMediaId: mainImageMedia.value!.mediaId!,
    mainImageMediaIds: mainImages.value.map((image) => image.mediaId!),
    videoMediaId: videoMedia.value!.mediaId!,
    attributeFields: attributeFields.value,
    salesAttributeFields: salesAttributeFields.value,
    specMode: confirmedSpecMode.value,
    specDimensions: confirmedSpecDimensions.value,
    variantLabel: specVariantLabel,
    offShelfReason: editingProduct.value?.offShelfReason,
    offShelfDetail: editingProduct.value?.offShelfDetail,
  });
const buildOperationsPricePayload = (): Pick<
  FinishedProductPayload,
  'name' | 'status' | 'guidePrices' | 'markupPrices'
> =>
  buildFinishedOperationsPricePayload({
    name: editingProduct.value!.name,
    status: editingProduct.value!.status,
    specRows: specRows.value,
    priceLevels: productPriceLevels.value,
    variantLabel: specVariantLabel,
  });
const upsertStockItem = (record: FinishedProductRecord, offShelfReason?: string) => {
  const nextItem = toStockItem(record);
  if (offShelfReason) nextItem.offShelfReason = offShelfReason;
  const index = dataItems.value.findIndex((item) => item.id === record.id);
  if (index >= 0) dataItems.value[index] = nextItem;
  else dataItems.value.unshift(nextItem);
  return nextItem;
};
const submitProductForm = async () => {
  submitAttempted.value = true;
  if (isOperationsEdit.value && editingProduct.value) {
    if (!validateProductForm()) return;
    saving.value = true;
    try {
      upsertStockItem(await updateFinishedProduct(editingProduct.value.id, buildOperationsPricePayload()));
      formPageVisible.value = false;
      adminFeedback.success(`已保存“${editingProduct.value.name}”`);
    } catch (error) {
      adminFeedback.error(getSafeErrorMessage(error, '商品价格保存失败'));
    } finally {
      saving.value = false;
    }
    return;
  }
  if (detailMediaUploading.value) {
    adminFeedback.warning('请等待详情媒体上传完成');
    return;
  }
  try {
    await refreshCategoryAttributeBindings();
  } catch {
    adminFeedback.error('商品属性模板刷新失败，请重试');
    return;
  }
  if (!validateProductForm()) return;
  const isCreate = formPageMode.value !== 'edit' || !editingProduct.value;
  saving.value = true;
  try {
    const payload = buildProductPayloadFromForm();
    if (formPageMode.value === 'edit' && editingProduct.value) {
      const updated = await updateFinishedProduct(editingProduct.value.id, payload);
      upsertStockItem(updated);
    } else {
      const created = await createFinishedProduct(payload);
      upsertStockItem(created);
    }
    pendingUploadedMediaIds.forEach((mediaId) => {
      void releaseTemporaryFinishedProductMedia(mediaId).catch(() => undefined);
    });
    pendingUploadedMediaIds.clear();
    formPageVisible.value = false;
    if (isCreate) {
      adminFeedback.created(payload.name);
    } else {
      adminFeedback.success('商品信息已保存');
    }
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '商品提交失败');
  } finally {
    saving.value = false;
  }
};
const openReasonDialog = (_type: 'offShelf', product: StockItem | null, isBatch: boolean) => {
  reasonState.product = product;
  reasonState.isBatch = isBatch;
  reasonForm.reason = '';
  reasonForm.detail = '';
  reasonDialogVisible.value = true;
};
const closeReasonDialog = () => {
  reasonDialogVisible.value = false;
};
const submitReason = async () => {
  if (!reasonForm.reason) {
    adminFeedback.warning('请选择原因');
    return;
  }
  closeReasonDialog();
  saving.value = true;
  try {
    if (reasonState.isBatch) {
      await Promise.all(
        selectedKeys.value.map((id) =>
          updateProductStatus(id, 'offShelf', reasonForm.reason, reasonForm.detail.trim()),
        ),
      );
      selectedKeys.value = [];
      adminFeedback.success('已批量下架');
    } else if (reasonState.product) {
      await updateProductStatus(reasonState.product.id, 'offShelf', reasonForm.reason, reasonForm.detail.trim());
      adminFeedback.success('商品已下架');
    }
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  } finally {
    saving.value = false;
  }
};
const openConfirm = (type: ConfirmType, product: StockItem | null, content: string) => {
  confirmState.type = type;
  confirmState.product = product;
  confirmState.content = content;
  confirmDialogVisible.value = true;
};
const closeConfirmDialog = () => {
  confirmDialogVisible.value = false;
};
const detailAttributeNames = computed(() =>
  Object.fromEntries(productAttributes.value.map((attribute) => [`attribute_${attribute.id}`, attribute.name])),
);
const openProductEditor = async (row: StockItem) => {
  try {
    await refreshPriceConfigurations();
    const latest = (await listFinishedProducts()).find((product) => product.id === row.id);
    if (!latest) {
      adminFeedback.error('商品不存在，请刷新列表');
      return;
    }
    openFormPage('edit', toStockItem(latest));
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '商品资料加载失败'));
  }
};
const openProductDetail = async (row: StockItem) => {
  try {
    const [latest, levels] = await Promise.all([
      listFinishedProducts().then((products) => products.find((product) => product.id === row.id)),
      Promise.resolve(null),
    ]);
    if (!latest) {
      adminFeedback.error('商品不存在，请刷新列表');
      return;
    }
    if (levels) enabledPriceLevels.value = levels;
    detailProduct.value = toStockItem(latest);
    detailDialogVisible.value = true;
  } catch {
    adminFeedback.error('商品详情加载失败，请重试');
  }
};
const closeDetailDialog = () => {
  detailDialogVisible.value = false;
  detailProduct.value = null;
};
const openProductMediaPreview = (media: Pick<AdminMediaValue, 'url'> | undefined, type: 'image' | 'video') => {
  if (!media?.url) return;
  productPreviewType.value = type;
  imagePreviewSrc.value = media.url;
  imagePreviewTitle.value = type === 'image' ? '商品主图' : '商品视频';
  imagePreviewVisible.value = true;
};
const openImagePreview = (row: StockItem) => {
  productPreviewType.value = 'image';
  imagePreviewSrc.value = row.image;
  imagePreviewTitle.value = `${row.name} · 商品主图`;
  imagePreviewVisible.value = true;
};
const closeImagePreview = () => {
  imagePreviewVisible.value = false;
  imagePreviewSrc.value = '';
};
const updateProductStatus = async (id: number, status: StockStatus, reason?: string, detail?: string) => {
  const item = dataItems.value.find((product) => product.id === id);
  if (!item) return;
  const afterStock = status === 'soldOut' ? 0 : item.stock;
  const updated = await updateFinishedProduct(
    id,
    toProductPayload(item, {
      status,
      stock: afterStock,
      offShelfReason: status === 'offShelf' ? reason || item.offShelfReason : undefined,
      offShelfDetail: status === 'offShelf' ? (detail ?? item.offShelfDetail) : undefined,
    }),
  );
  upsertStockItem(updated, status === 'offShelf' ? reason || item.offShelfReason || '运营调整' : undefined);
};
const handleConfirm = async () => {
  const type = confirmState.type;
  const product = confirmState.product;
  const selectedCount = selectedKeys.value.length;
  const recycleCount = dataItems.value.filter((item) => item.status === 'recycle').length;
  saving.value = true;
  try {
    if (type === 'shelf' && product) {
      await updateProductStatus(product.id, 'selling');
    } else if (type === 'delete' && product) {
      await updateProductStatus(product.id, 'recycle');
    } else if (type === 'restore' && product) {
      await updateProductStatus(product.id, 'warehouse');
    } else if (type === 'purge' && product) {
      await deleteFinishedProduct(product.id);
      dataItems.value = dataItems.value.filter((item) => item.id !== product.id);
    } else if (type === 'batchShelf') {
      {
        // Publishing rebuilds prices; finish each transaction before starting the next product.
        for (const id of [...selectedKeys.value]) {
          await updateProductStatus(id, 'selling');
          selectedKeys.value = selectedKeys.value.filter((selectedId) => selectedId !== id);
        }
      }
    } else if (type === 'batchRestore') {
      await Promise.all(selectedKeys.value.map((id) => updateProductStatus(id, 'warehouse')));
      selectedKeys.value = [];
    } else if (type === 'batchPurge') {
      await Promise.all(selectedKeys.value.map((id) => deleteFinishedProduct(id)));
      const selected = new Set(selectedKeys.value);
      dataItems.value = dataItems.value.filter((item) => !selected.has(item.id));
      selectedKeys.value = [];
    } else if (type === 'clearRecycle') {
      const recycleIds = dataItems.value.filter((item) => item.status === 'recycle').map((item) => item.id);
      await Promise.all(recycleIds.map((id) => deleteFinishedProduct(id)));
      dataItems.value = dataItems.value.filter((item) => item.status !== 'recycle');
      selectedKeys.value = [];
    }
    closeConfirmDialog();
    if ((type === 'delete' || type === 'purge') && product) {
      adminFeedback.deleted(product.name);
    } else if (type === 'batchPurge') {
      adminFeedback.deleted(`${selectedCount} 个商品`);
    } else if (type === 'clearRecycle') {
      adminFeedback.deleted(`${recycleCount} 个回收站商品`);
    } else {
      adminFeedback.success('操作已完成');
    }
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '操作失败');
  } finally {
    saving.value = false;
  }
};
</script>

<style scoped src="./index.css"></style>
