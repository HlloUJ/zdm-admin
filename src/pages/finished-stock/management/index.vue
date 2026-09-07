<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
        <header class="page-header">
          <div>
            <t-breadcrumb>
              <t-breadcrumb-item
                content="成品现货管理"
                href="/finished-stock-management"
                :to="{ path: '/finished-stock-management' }"
                replace
                @click="closeFormPage"
              />
              <t-breadcrumb-item v-if="formPageVisible">{{ formPageTitle }}</t-breadcrumb-item>
            </t-breadcrumb>
          </div>
          <t-tag theme="primary" variant="light">全平台共用成品现货库</t-tag>
        </header>

        <template v-if="!formPageVisible">
          <section class="filter-card">
            <t-tabs v-model="activeTab" class="status-tabs" @change="handleTabChange">
              <t-tab-panel v-for="tab in tabs" :key="tab.value" :value="tab.value" :label="tabLabel(tab)" />
            </t-tabs>

            <t-form :data="currentFilter" label-width="76px" colon>
              <div class="filter-row">
                <div class="filter-fields">
                  <t-form-item label="ID">
                    <t-input v-model="currentFilter.id" clearable placeholder="请输入" />
                  </t-form-item>
                  <t-form-item label="商品名称">
                    <t-input v-model="currentFilter.name" clearable placeholder="请输入" />
                  </t-form-item>
                  <t-form-item label="平台分类">
                    <t-cascader
                      v-model="currentFilter.category"
                      :options="categoryCascaderOptions"
                      clearable
                      :check-strictly="false"
                      placeholder="请选择"
                      trigger="hover"
                    />
                  </t-form-item>
                  <t-form-item label="供应商">
                    <t-select v-model="currentFilter.supplier" clearable placeholder="请选择">
                      <t-option v-for="item in supplierOptions" :key="item" :label="item" :value="item" />
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
            <div v-if="batchButtons.length" class="table-toolbar">
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
                  <div class="product-code">编码：{{ row.code }}</div>
                </div>
              </template>
              <template #supplier="{ row }">
                <div class="tenant-cell">
                  <div>{{ row.supplier }}</div>
                  <div class="tenant-tags">
                    <t-tag variant="light" class="publisher-tag platform-publish">
                      {{ row.publisherType }}
                    </t-tag>
                  </div>
                </div>
              </template>
              <template #stock="{ row }">
                <strong>{{ activeTab === 'soldOut' ? 0 : row.stock }}</strong>
              </template>
              <template #price="{ row }">
                <t-link theme="primary" hover="color" @click="openPriceDrawer('view', row)">查看</t-link>
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
              <template #empty>
                <div class="table-empty">暂无数据</div>
              </template>
            </t-table>

            <AdminPagination
              v-model:current="currentPagination.current"
              v-model:page-size="currentPagination.pageSize"
              :total="paginationTotal"
              :page-size-options="pageSizeOptions"
            />
          </section>
        </template>

        <template v-else>
          <section class="form-shell">
            <div class="form-title-row">
              <div>
                <h1>{{ formPageTitle }}</h1>
                <div class="selected-category">
                  当前分类：{{ selectedCategoryPath }}
                  <t-button size="small" variant="outline" @click="openCategoryDialog">切换分类</t-button>
                </div>
              </div>
              <t-button theme="default" variant="base" @click="closeFormPage">
                <template #icon><t-icon name="rollback" /></template>
                返回列表
              </t-button>
            </div>

            <t-tabs v-model="formTab" class="form-tabs">
              <t-tab-panel value="description" label="图文描述">
                <div class="form-section">
                  <div class="upload-grid">
                    <AdminMediaUpload
                      v-model="mainImageMedia"
                      title="商品主图"
                      accept="image/*"
                      required
                      :error-message="submitAttempted && !mainImageMedia ? '请上传图片' : ''"
                      :upload="(file) => uploadProductMedia(file, 'image')"
                      @removed="releasePendingProductMedia"
                    />
                    <AdminMediaUpload
                      v-model="videoMedia"
                      title="商品视频"
                      accept="video/*"
                      required
                      :error-message="submitAttempted && !videoMedia ? '请上传视频' : ''"
                      :upload="(file) => uploadProductMedia(file, 'video')"
                      @removed="releasePendingProductMedia"
                    />
                  </div>
                  <t-form :data="productForm" label-width="84px" colon>
                    <t-form-item label="宝贝详情" required-mark>
                      <ProductRichEditor v-model="productForm.detail" :cover="formEditorCover" />
                    </t-form-item>
                  </t-form>
                </div>
              </t-tab-panel>

              <t-tab-panel value="base" label="基础信息">
                <div class="form-section">
                  <t-form :data="productForm" label-width="116px" colon>
                    <div class="form-grid two">
                      <t-form-item label="供应商">
                        <t-select v-model="productForm.supplier" clearable placeholder="请选择">
                          <t-option v-for="item in supplierOptions" :key="item" :label="item" :value="item" />
                        </t-select>
                      </t-form-item>
                      <t-form-item label="商品名称" required-mark>
                        <t-input v-model="productForm.name" clearable placeholder="请输入" :maxlength="60" />
                      </t-form-item>
                    </div>

                    <div class="section-title">商品属性</div>
                    <div class="form-grid three">
                      <t-form-item v-for="field in attributeFields" :key="field.key" :label="field.label">
                        <t-select
                          v-if="field.type === 'select'"
                          v-model="productForm[field.key]"
                          clearable
                          placeholder="请选择"
                        >
                          <t-option v-for="item in field.options" :key="item" :label="item" :value="item" />
                        </t-select>
                        <t-input v-else v-model="productForm[field.key]" clearable placeholder="请输入" />
                      </t-form-item>
                    </div>
                  </t-form>
                </div>
              </t-tab-panel>

              <t-tab-panel value="sales" label="销售信息">
                <div class="form-section">
                  <t-form :data="productForm" label-width="112px" colon>
                    <div class="sales-head">
                      <t-form-item label="销售规格" required-mark>
                        <t-button v-if="!specRows.length" theme="primary" variant="outline" @click="openSpecDialog">
                          <template #icon><t-icon name="add" /></template>
                          创建规格
                        </t-button>
                      </t-form-item>
                    </div>
                    <div class="form-grid three">
                      <t-form-item label="总库存">
                        <t-input-number :model-value="totalStock" theme="normal" :min="0" disabled />
                      </t-form-item>
                      <t-form-item label="商家编码" required-mark>
                        <t-input v-model="productForm.merchantCode" clearable placeholder="请输入" :maxlength="60" />
                      </t-form-item>
                      <t-form-item label="上架" required-mark>
                        <t-radio-group v-model="productForm.shelfNow">
                          <t-radio value="now">立刻上架</t-radio>
                          <t-radio value="later">暂不上架</t-radio>
                        </t-radio-group>
                      </t-form-item>
                    </div>
                  </t-form>

                  <div v-if="specRows.length" class="spec-table-block">
                    <div class="spec-toolbar">
                      <span>规格表格</span>
                    </div>
                    <t-table
                      row-key="id"
                      :data="specRows"
                      :columns="specColumns"
                      :rowspan-and-colspan="specRowspanAndColspan"
                      hover
                      table-layout="fixed"
                    >
                      <template #specText="{ row }">
                        <div class="spec-name-cell">
                          <span>{{ row.specText || '-' }}</span>
                        </div>
                      </template>
                      <template #material="{ row }">
                        <t-select v-if="row.mode === 'single'" v-model="row.material" placeholder="请选择">
                          <t-option v-for="item in materialOptions" :key="item" :label="item" :value="item" />
                        </t-select>
                        <div v-else class="spec-name-cell">
                          <span>{{ row.material || '-' }}</span>
                        </div>
                      </template>
                      <template #length="{ row }">
                        <div class="spec-name-cell">
                          <span>{{ row.length || '-' }}</span>
                        </div>
                      </template>
                      <template #color="{ row }">
                        <div class="spec-name-cell">
                          <span>{{ row.color || '-' }}</span>
                        </div>
                      </template>
                      <template #size="{ row }">
                        <div class="spec-name-cell">
                          <span>{{ row.size || '-' }}</span>
                        </div>
                      </template>
                      <template #cost="{ row }">
                        <t-input
                          v-model="row.cost"
                          class="decimal-input"
                          placeholder="价格"
                          @change="handleSpecCostChange(row, $event)"
                          @blur="formatDecimalValue(row, 'cost')"
                        />
                      </template>
                      <template
                        v-for="configuration in productPriceLevels"
                        #[`markup-${configuration.id}`]="{ row }"
                        :key="configuration.id"
                      >
                        <div class="price-pair">
                          <t-input
                            v-model="row.markupPrices[configuration.id].coefficient"
                            placeholder="价格系数"
                            @change="handleMarkupCoefficientChange(row, configuration.id, $event)"
                          />
                          <t-input
                            v-model="row.markupPrices[configuration.id].price"
                            placeholder="价格"
                            @change="handleMarkupPriceChange(row, configuration.id, $event)"
                          />
                        </div>
                      </template>
                      <template #guide="{ row }">
                        <div class="price-pair">
                          <t-input
                            v-model="row.guideCoefficient"
                            placeholder="价格系数"
                            @change="handleSpecCoefficientChange(row, 'guideCoefficient', 'guide', $event)"
                            @blur="formatDecimalValue(row, 'guideCoefficient')"
                          />
                          <t-input
                            v-model="row.guide"
                            placeholder="价格"
                            @change="handleSpecPriceChange(row, 'guide', 'guideCoefficient', $event)"
                            @blur="formatDecimalValue(row, 'guide')"
                          />
                        </div>
                      </template>
                      <template #level1="{ row }">
                        <div class="price-pair">
                          <t-input
                            v-model="row.level1Coefficient"
                            placeholder="价格系数"
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
                            placeholder="价格系数"
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
                            placeholder="价格系数"
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
                          <t-input-number v-model="row.quantity" theme="normal" :min="0" />
                        </div>
                      </template>
                      <template #merchantCode="{ row }">
                        <t-input v-model="row.merchantCode" placeholder="请输入" />
                      </template>
                      <template #operation="{ row }">
                        <div class="table-actions">
                          <t-link theme="danger" hover="color" @click="deleteSpec(row.id)">删除</t-link>
                        </div>
                      </template>
                    </t-table>
                    <div class="spec-table-actions">
                      <t-button theme="primary" variant="outline" @click="openPriceDrawer('batchFill')">
                        <template #icon><t-icon name="edit" /></template>
                        批量填写
                      </t-button>
                      <t-button theme="primary" variant="outline" @click="openSpecDialog(true)">
                        <template #icon><t-icon name="setting" /></template>
                        编辑规格
                      </t-button>
                    </div>
                  </div>
                </div>
              </t-tab-panel>
            </t-tabs>

            <div class="form-submit-bar">
              <t-button theme="primary" :loading="saving" @click="submitProductForm">
                <template #icon><t-icon name="check" /></template>
                提交商品信息
              </t-button>
              <t-button theme="default" variant="base" @click="closeFormPage">取消</t-button>
            </div>
          </section>
        </template>
      </main>
    </div>

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

    <t-dialog
      v-model:visible="specDialogVisible"
      header="选择展示模式"
      width="920px"
      placement="center"
      :footer="false"
      @close="closeSpecDialog"
    >
      <div class="spec-dialog">
        <t-radio-group v-model="specMode" @change="handleSpecModeChange">
          <t-radio value="single">单层展示：自定义填写规格</t-radio>
          <t-radio value="layered">分层展示：选择标准属性构建规格</t-radio>
        </t-radio-group>

        <div v-if="specMode === 'single'" class="single-spec-editor">
          <div class="spec-section-title">商品规格</div>
          <div class="single-spec-list">
            <div v-for="(item, index) in singleSpecs" :key="item.id" class="single-spec-row">
              <t-input v-model="item.text" placeholder="请输入规格文本，如 1500*800*750mm" />
              <t-button shape="square" variant="text" theme="danger" @click="removeSingleSpec(index)">
                <t-icon name="delete" />
              </t-button>
            </div>
          </div>
          <t-button class="spec-add-button" theme="default" variant="outline" @click="addSingleSpec">
            <template #icon><t-icon name="add" /></template>
            新增规格项
          </t-button>
        </div>

        <div v-else class="layered-spec-editor">
          <div class="selected-tags">
            <button
              v-for="group in specGroups"
              :key="group.name"
              type="button"
              :class="[
                'spec-attr-tag',
                group.selected && 'active',
                !group.selected && selectedSpecGroups.length >= 3 && 'disabled',
              ]"
              @click="toggleSpecGroup(group)"
            >
              {{ group.name }}
            </button>
          </div>
          <div v-if="!selectedSpecGroups.length" class="layered-empty">请选择销售属性标签</div>
          <div v-for="group in selectedSpecGroups" :key="group.name" class="spec-group">
            <div class="spec-group-head">
              <div class="spec-group-title">{{ group.name }}</div>
            </div>
            <div v-for="(value, index) in group.values" :key="value.id" class="layered-value-row">
              <t-select
                v-if="group.name === '大理石台面材质'"
                v-model="value.value"
                clearable
                placeholder="请选择属性值"
              >
                <t-option v-for="item in materialOptions" :key="item" :label="item" :value="item" />
              </t-select>
              <t-input v-else v-model="value.value" placeholder="请输入属性值" />
              <t-button shape="square" variant="text" theme="danger" @click="removeSpecValue(group.name, index)">
                <t-icon name="delete" />
              </t-button>
            </div>
            <t-button class="spec-add-button" size="small" variant="outline" @click="addSpecValue(group.name)">
              <template #icon><t-icon name="add" /></template>
              新增属性值
            </t-button>
          </div>
        </div>

        <div class="spec-dialog-footer">
          <t-button theme="primary" variant="text" @click="resetSpecDialog">重置</t-button>
          <t-button theme="primary" @click="confirmCreateSpec">确认创建</t-button>
          <t-button theme="default" variant="base" @click="closeSpecDialog">取消</t-button>
        </div>
      </div>
    </t-dialog>

    <t-drawer
      v-model:visible="priceDrawerVisible"
      :header="priceDrawerMode === 'view' ? '价格编辑器' : '批量填写'"
      placement="right"
      size="1180px"
      lazy
      destroy-on-close
      :footer="false"
      @close="closePriceDrawer"
    >
      <div class="drawer-head">
        <div>
          <strong>{{ priceDrawerMode === 'view' ? '价格明细' : '批量填写' }}</strong>
          <span>{{
            priceDrawerMode === 'view' ? '查看当前商品的规格库存与阶梯价格' : '按规格属性值圈定范围，再填写要覆盖的字段'
          }}</span>
        </div>
        <t-button v-if="priceDrawerMode !== 'view'" theme="primary" @click="savePriceDrawer">
          <template #icon><t-icon name="save" /></template>
          保存
        </t-button>
      </div>

      <template v-if="priceDrawerMode === 'batchFill'">
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
              <t-form-item label="成本价">
                <t-input
                  v-model="batchFillForm.cost"
                  placeholder="价格"
                  @change="handleBatchCostChange"
                  @blur="formatDecimalValue(batchFillForm, 'cost')"
                />
              </t-form-item>
              <t-form-item label="指导价">
                <div class="price-pair wide">
                  <t-input
                    v-model="batchFillForm.guideCoefficient"
                    placeholder="价格系数"
                    @change="handleBatchCoefficientChange('guideCoefficient', 'guide', $event)"
                    @blur="formatDecimalValue(batchFillForm, 'guideCoefficient')"
                  />
                  <t-input
                    v-model="batchFillForm.guide"
                    placeholder="价格"
                    @change="handleBatchPriceChange('guide', 'guideCoefficient', $event)"
                    @blur="formatDecimalValue(batchFillForm, 'guide')"
                  />
                </div>
              </t-form-item>
              <t-form-item label="1级合伙人">
                <div class="price-pair wide">
                  <t-input
                    v-model="batchFillForm.level1Coefficient"
                    placeholder="价格系数"
                    @change="handleBatchCoefficientChange('level1Coefficient', 'level1', $event)"
                    @blur="formatDecimalValue(batchFillForm, 'level1Coefficient')"
                  />
                  <t-input
                    v-model="batchFillForm.level1"
                    placeholder="价格"
                    @change="handleBatchPriceChange('level1', 'level1Coefficient', $event)"
                    @blur="formatDecimalValue(batchFillForm, 'level1')"
                  />
                </div>
              </t-form-item>
              <t-form-item label="2级合伙人">
                <div class="price-pair wide">
                  <t-input
                    v-model="batchFillForm.level2Coefficient"
                    placeholder="价格系数"
                    @change="handleBatchCoefficientChange('level2Coefficient', 'level2', $event)"
                    @blur="formatDecimalValue(batchFillForm, 'level2Coefficient')"
                  />
                  <t-input
                    v-model="batchFillForm.level2"
                    placeholder="价格"
                    @change="handleBatchPriceChange('level2', 'level2Coefficient', $event)"
                    @blur="formatDecimalValue(batchFillForm, 'level2')"
                  />
                </div>
              </t-form-item>
              <t-form-item label="3级合伙人">
                <div class="price-pair wide">
                  <t-input
                    v-model="batchFillForm.level3Coefficient"
                    placeholder="价格系数"
                    @change="handleBatchCoefficientChange('level3Coefficient', 'level3', $event)"
                    @blur="formatDecimalValue(batchFillForm, 'level3Coefficient')"
                  />
                  <t-input
                    v-model="batchFillForm.level3"
                    placeholder="价格"
                    @change="handleBatchPriceChange('level3', 'level3Coefficient', $event)"
                    @blur="formatDecimalValue(batchFillForm, 'level3')"
                  />
                </div>
              </t-form-item>
              <t-form-item label="数量">
                <t-input-number v-model="batchFillForm.quantity" theme="normal" :min="0" />
              </t-form-item>
              <t-form-item label="商家编码">
                <t-input v-model="batchFillForm.merchantCode" placeholder="请输入" />
              </t-form-item>
            </div>
          </section>
        </div>
      </template>

      <t-table v-else row-key="id" :data="priceRows" :columns="priceColumns" hover table-layout="fixed">
        <template #stock="{ row }">
          <t-input-number
            v-model="row.stock"
            class="stock-input"
            theme="normal"
            :min="0"
            :disabled="priceDrawerMode === 'view'"
          />
        </template>
        <template #cost="{ row }">
          <t-input
            v-model="row.cost"
            class="decimal-input"
            placeholder="价格"
            :disabled="priceDrawerMode === 'view'"
            @change="limitDecimalInput(row, 'cost', $event)"
            @blur="formatDecimalValue(row, 'cost')"
          />
        </template>
        <template #guide="{ row }">
          <div class="price-pair">
            <t-input
              v-model="row.guideCoefficient"
              placeholder="价格系数"
              :disabled="priceDrawerMode === 'view'"
              @change="limitDecimalInput(row, 'guideCoefficient', $event)"
              @blur="formatDecimalValue(row, 'guideCoefficient')"
            />
            <t-input
              v-model="row.guide"
              placeholder="价格"
              :disabled="priceDrawerMode === 'view'"
              @change="limitDecimalInput(row, 'guide', $event)"
              @blur="formatDecimalValue(row, 'guide')"
            />
          </div>
        </template>
        <template #level1="{ row }">
          <div class="price-pair">
            <t-input
              v-model="row.level1Coefficient"
              placeholder="价格系数"
              :disabled="priceDrawerMode === 'view'"
              @change="limitDecimalInput(row, 'level1Coefficient', $event)"
              @blur="formatDecimalValue(row, 'level1Coefficient')"
            />
            <t-input
              v-model="row.level1"
              placeholder="价格"
              :disabled="priceDrawerMode === 'view'"
              @change="limitDecimalInput(row, 'level1', $event)"
              @blur="formatDecimalValue(row, 'level1')"
            />
          </div>
        </template>
        <template #level2="{ row }">
          <div class="price-pair">
            <t-input
              v-model="row.level2Coefficient"
              placeholder="价格系数"
              :disabled="priceDrawerMode === 'view'"
              @change="limitDecimalInput(row, 'level2Coefficient', $event)"
              @blur="formatDecimalValue(row, 'level2Coefficient')"
            />
            <t-input
              v-model="row.level2"
              placeholder="价格"
              :disabled="priceDrawerMode === 'view'"
              @change="limitDecimalInput(row, 'level2', $event)"
              @blur="formatDecimalValue(row, 'level2')"
            />
          </div>
        </template>
        <template #level3="{ row }">
          <div class="price-pair">
            <t-input
              v-model="row.level3Coefficient"
              placeholder="价格系数"
              :disabled="priceDrawerMode === 'view'"
              @change="limitDecimalInput(row, 'level3Coefficient', $event)"
              @blur="formatDecimalValue(row, 'level3Coefficient')"
            />
            <t-input
              v-model="row.level3"
              placeholder="价格"
              :disabled="priceDrawerMode === 'view'"
              @change="limitDecimalInput(row, 'level3', $event)"
              @blur="formatDecimalValue(row, 'level3')"
            />
          </div>
        </template>
      </t-table>
    </t-drawer>

    <t-drawer
      v-model:visible="movementDrawerVisible"
      header="库存流水"
      placement="right"
      size="780px"
      lazy
      destroy-on-close
      :footer="false"
      @close="closeMovementDrawer"
    >
      <div class="movement-drawer">
        <div v-if="movementTarget" class="movement-head">
          <div>
            <strong>{{ movementTarget.name }}</strong>
            <span>ID：{{ movementTarget.id }} ｜ 编码：{{ movementTarget.code }}</span>
          </div>
          <t-tag :theme="movementTarget.status === 'selling' ? 'success' : 'primary'" variant="light">
            当前库存 {{ movementTarget.stock }}
          </t-tag>
        </div>

        <t-table
          row-key="id"
          :data="movementRows"
          :columns="movementColumns"
          :loading="movementLoading"
          hover
          table-layout="fixed"
        >
          <template #movementType="{ row }">{{ movementTypeLabel(row.movementType) }}</template>
          <template #quantity="{ row }">
            <span :class="movementQuantityClass(row.quantity)">{{ formatMovementQuantity(row.quantity) }}</span>
          </template>
          <template #stockChange="{ row }">
            {{ formatMovementNumber(row.beforeQuantity) }} → {{ formatMovementNumber(row.afterQuantity) }}
          </template>
          <template #createdAt="{ row }">{{ formatMovementTime(row.createdAt) }}</template>
          <template #empty>
            <div class="table-empty">暂无库存流水</div>
          </template>
        </t-table>
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

    <t-dialog
      v-model:visible="detailDialogVisible"
      header="商品详情"
      width="760px"
      placement="center"
      :footer="false"
      @close="closeDetailDialog"
    >
      <div v-if="detailProduct" class="detail-panel">
        <img v-if="detailProduct.image" :src="detailProduct.image" :alt="detailProduct.name" />
        <div class="detail-info">
          <h2>{{ detailProduct.name }}</h2>
          <p>ID：{{ detailProduct.id }} ｜ 编码：{{ detailProduct.code }}</p>
          <p>分类：{{ detailProduct.category }} ｜ 库存：{{ activeTab === 'soldOut' ? 0 : detailProduct.stock }}</p>
          <p>供应商：{{ detailProduct.supplier }}</p>
          <p>价格区间：{{ detailProduct.priceRange }}</p>
          <p v-if="detailProduct.offShelfReason">下架原因：{{ detailProduct.offShelfReason }}</p>
        </div>
      </div>
    </t-dialog>

    <t-dialog
      v-model:visible="imagePreviewVisible"
      :header="imagePreviewTitle"
      width="960px"
      placement="center"
      :footer="false"
      @close="closeImagePreview"
    >
      <div class="image-preview-dialog">
        <img :src="imagePreviewSrc" :alt="imagePreviewTitle" />
      </div>
    </t-dialog>

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
import type { PrimaryTableCol, RowspanColspan, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import ProductRichEditor from '@/components/ProductRichEditor.vue';
import {
  adminFeedback,
  AdminConfirmDialog,
  AdminDialog,
  AdminMediaUpload,
  AdminPagination,
  type AdminMediaValue,
} from '@/components/foundation';
import {
  getFinishedGuidePriceSetting,
  listFinishedMarkupConfigurationOptions,
  type FinishedMarkupConfigurationRecord,
} from '@/services/finishedMarkupConfigurations';
import {
  createFinishedProduct,
  deleteFinishedProduct,
  listFinishedProducts,
  releaseTemporaryFinishedProductMedia,
  updateFinishedProduct,
  uploadFinishedProductMedia,
  type FinishedProductAttributeEntry,
  type FinishedProductPayload,
  type FinishedProductRecord,
  type FinishedProductGuidePrice,
  type FinishedProductPrice,
  type FinishedProductVariant,
} from '@/services/finishedProducts';
import {
  createInventoryMovement,
  listInventoryMovements,
  type InventoryMovementRecord,
  type MovementType,
} from '@/services/inventoryMovements';
import { listProductCategories, type ProductCategoryRecord } from '@/services/productCategories';
import { listProductAttributes, type ProductAttributeRecord } from '@/services/productAttributes';
import { listProductAttributeValues, type ProductAttributeValueRecord } from '@/services/productAttributeValues';
import { listSuppliers, type SupplierRecord } from '@/services/suppliers';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
type StockStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';
type PublisherType = '平台发布';
type RowAction = 'shelf' | 'edit' | 'delete' | 'offShelf' | 'restore' | 'purge' | 'movement';
type BatchAction = 'publish' | 'batchShelf' | 'batchOffShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';
type FormTabKey = 'description' | 'base' | 'sales';
type SpecMode = 'single' | 'layered';
type LayeredSpecField = 'material' | 'length' | 'color' | 'size';
type BatchFilterField = 'specText' | LayeredSpecField;
type DecimalField =
  | 'cost'
  | 'guideCoefficient'
  | 'guide'
  | 'level1Coefficient'
  | 'level1'
  | 'level2Coefficient'
  | 'level2'
  | 'level3Coefficient'
  | 'level3';
type ConfirmType =
  'shelf' | 'delete' | 'restore' | 'purge' | 'batchShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';
type ProductFormMode = 'create' | 'edit';
type PriceDrawerMode = 'batchFill' | 'view';

interface TabConfig {
  value: StockStatus;
  label: string;
  count?: number;
}

interface FilterState {
  id: string;
  name: string;
  category: string;
  supplier: string;
}

interface PaginationState {
  current: number;
  pageSize: number;
}

interface StockItem {
  id: number;
  code: string;
  image: string;
  name: string;
  categoryId?: number;
  supplierId?: number;
  category: string;
  stock: number;
  supplier: string;
  publisherType: PublisherType;
  isExternalSupplier: boolean;
  guidePrice?: number;
  priceRange: string;
  status: StockStatus;
  offShelfReason?: string;
  markupPrices?: FinishedProductPrice[];
  guidePrices?: FinishedProductGuidePrice[];
  mainImageMediaId?: number;
  videoMediaId?: number;
  videoUrl?: string;
  detail: string;
  attributes: FinishedProductAttributeEntry[];
  variants: FinishedProductVariant[];
}

interface ProductForm {
  supplier: string;
  name: string;
  brand: string;
  model: string;
  style: string;
  shape: string;
  material: string;
  craftTexture: string;
  layers: string;
  functionText: string;
  waterproof: string;
  loadBearing: string;
  origin: string;
  installDesc: string;
  detail: string;
  totalStock: number;
  merchantCode: string;
  shelfNow: 'now' | 'later';
  [key: string]: string | number;
}

interface SpecRow extends TableRowData {
  id: number;
  mode: SpecMode;
  specText: string;
  specImage: boolean;
  material: string;
  materialImage: boolean;
  length: string;
  lengthImage: boolean;
  color: string;
  colorImage: boolean;
  size: string;
  sizeImage: boolean;
  costCoefficient: string;
  cost: string;
  guideCoefficient: string;
  guide: string;
  level1Coefficient: string;
  level1: string;
  level2Coefficient: string;
  level2: string;
  level3Coefficient: string;
  level3: string;
  quantity: number;
  merchantCode: string;
  markupPrices: Record<number, { coefficient: string; price: string }>;
}

interface PriceRow extends TableRowData {
  id: number;
  mode: SpecMode;
  specText: string;
  material: string;
  length: string;
  color: string;
  size: string;
  merchantCode: string;
  stock: number;
  costCoefficient: string;
  cost: string;
  guideCoefficient: string;
  guide: string;
  level1Coefficient: string;
  level1: string;
  level2Coefficient: string;
  level2: string;
  level3Coefficient: string;
  level3: string;
}

interface BatchFillForm {
  cost: string;
  guideCoefficient: string;
  guide: string;
  level1Coefficient: string;
  level1: string;
  level2Coefficient: string;
  level2: string;
  level3Coefficient: string;
  level3: string;
  quantity: number | null;
  merchantCode: string;
}

interface SingleSpecItem {
  id: number;
  text: string;
  imageUploaded: boolean;
}

interface SpecValue {
  id: number;
  value: string;
  imageUploaded: boolean;
}

interface SpecGroup {
  field: LayeredSpecField;
  name: string;
  selected: boolean;
  withImage: boolean;
  values: SpecValue[];
}

interface CategoryCascaderOption {
  label: string;
  value: string;
  children?: CategoryCascaderOption[];
}

const tabs: TabConfig[] = [
  { value: 'warehouse', label: '仓库中' },
  { value: 'selling', label: '出售中' },
  { value: 'offShelf', label: '已下架' },
  { value: 'soldOut', label: '已售完' },
  { value: 'recycle', label: '回收站' },
];

const pageSizeOptions = [10, 20, 50];
const offShelfReasons = ['库存异常', '价格调整', '图片更新', '供应商申请'];
const layeredFieldLabels: Record<LayeredSpecField, string> = {
  material: '大理石台面材质',
  length: '桌面长度（mm）',
  color: '颜色分类',
  size: '尺寸',
};
const batchFilterLabels: Record<BatchFilterField, string> = {
  specText: '商品规格',
  ...layeredFieldLabels,
};

const activeTab = ref<StockStatus>('warehouse');
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const saving = ref(false);
const selectedKeys = ref<number[]>([]);
const formPageVisible = ref(false);
const formPageMode = ref<ProductFormMode>('create');
const formTab = ref<FormTabKey>('description');
const categoryDialogVisible = ref(false);
const specDialogVisible = ref(false);
const priceDrawerVisible = ref(false);
const movementDrawerVisible = ref(false);
const reasonDialogVisible = ref(false);
const confirmDialogVisible = ref(false);
const detailDialogVisible = ref(false);
const imagePreviewVisible = ref(false);
const priceDrawerMode = ref<PriceDrawerMode>('batchFill');
const detailProduct = ref<StockItem | null>(null);
const editingProduct = ref<StockItem | null>(null);
const movementTarget = ref<StockItem | null>(null);
const movementLoading = ref(false);
const movementRows = ref<InventoryMovementRecord[]>([]);
const imagePreviewSrc = ref('');
const imagePreviewTitle = ref('商品主图');
const selectedCategoryId = ref<number>();
const selectedCategoryPath = ref('');
const categoryPickerSelection = ref<number[]>([]);
const specMode = ref<SpecMode>('single');
const confirmedSpecMode = ref<SpecMode>('single');
const confirmedLayeredFields = ref<LayeredSpecField[]>([]);
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
const mainImageMedia = ref<AdminMediaValue>();
const videoMedia = ref<AdminMediaValue>();
const pendingUploadedMediaIds = new Set<number>();
const productCategories = ref<ProductCategoryRecord[]>([]);
const productAttributes = ref<ProductAttributeRecord[]>([]);
const productAttributeValues = ref<ProductAttributeValueRecord[]>([]);
const productSuppliers = ref<SupplierRecord[]>([]);
const markupConfigurations = ref<FinishedMarkupConfigurationRecord[]>([]);
const productPriceLevels = computed(() => {
  const savedPrices = editingProduct.value?.markupPrices ?? [];
  if (savedPrices.length) {
    return Array.from(
      new Map(
        savedPrices.map((price) => [
          price.storeLevelId,
          {
            id: price.storeLevelId,
            name:
              price.storeLevelName ||
              markupConfigurations.value.find((item) => item.storeLevelId === price.storeLevelId)?.name ||
              `门店级别${price.storeLevelId}`,
            priceCoefficient: Number(price.priceCoefficient),
          },
        ]),
      ).values(),
    );
  }
  return markupConfigurations.value.map((configuration) => ({
    id: configuration.storeLevelId,
    name: configuration.name,
    priceCoefficient: Number(configuration.priceCoefficient),
  }));
});
const guidePriceSettingCoefficient = ref<number>();
const dataItems = ref<StockItem[]>([]);

const categoryCascaderOptions = computed<CategoryCascaderOption[]>(() => {
  const enabled = productCategories.value.filter(
    (category) => category.scope === 'finished' && category.status !== 'disabled',
  );
  const childrenByParent = new Map<number | undefined, ProductCategoryRecord[]>();
  enabled.forEach((category) => {
    const siblings = childrenByParent.get(category.parentId) ?? [];
    siblings.push(category);
    childrenByParent.set(category.parentId, siblings);
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
  id: '',
  name: '',
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
  merchantCode: '',
});

const batchFillForm = reactive<BatchFillForm>(createEmptyBatchFillForm());

const attributeFields = computed(() =>
  productAttributes.value
    .filter(
      (attribute) =>
        (attribute.scope === 'shared' || attribute.scope === 'finished') && attribute.status !== 'disabled',
    )
    .map((attribute) => ({
      key: `attribute_${attribute.id}`,
      attributeId: attribute.id,
      label: attribute.name,
      type: attribute.valueType === 'select' ? ('select' as const) : ('input' as const),
      options: productAttributeValues.value
        .filter((value) => value.attributeId === attribute.id && value.status !== 'disabled')
        .map((value) => value.value),
    })),
);

const materialOptions = computed(() => {
  const materialAttributeIds = new Set(
    productAttributes.value
      .filter((attribute) => attribute.name.includes('材质') && attribute.status !== 'disabled')
      .map((attribute) => attribute.id),
  );
  return productAttributeValues.value
    .filter((value) => materialAttributeIds.has(value.attributeId) && value.status !== 'disabled')
    .map((value) => value.value);
});

const specGroups = reactive<SpecGroup[]>([
  {
    field: 'material',
    name: '大理石台面材质',
    selected: false,
    withImage: false,
    values: [{ id: Date.now() + 1, value: '', imageUploaded: false }],
  },
  {
    field: 'color',
    name: '颜色分类',
    selected: false,
    withImage: false,
    values: [{ id: Date.now() + 2, value: '', imageUploaded: false }],
  },
  {
    field: 'size',
    name: '尺寸',
    selected: false,
    withImage: false,
    values: [{ id: Date.now() + 3, value: '', imageUploaded: false }],
  },
  {
    field: 'length',
    name: '桌面长度（mm）',
    selected: false,
    withImage: false,
    values: [{ id: Date.now() + 4, value: '', imageUploaded: false }],
  },
]);

const reasonState = reactive<{ product: StockItem | null; isBatch: boolean }>({
  product: null,
  isBatch: false,
});

const reasonForm = reactive({
  reason: '',
  detail: '',
});

const confirmState = reactive<{ type: ConfirmType; product: StockItem | null; content: string }>({
  type: 'shelf',
  product: null,
  content: '',
});
const confirmAction = computed(() => {
  const actionMap: Record<ConfirmType, string> = {
    shelf: '上架',
    delete: '删除',
    restore: '恢复',
    purge: '彻底删除',
    batchShelf: '批量上架',
    batchRestore: '批量恢复',
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

const normalizePublisherType = (): PublisherType => '平台发布';

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
  const status = normalizeStatus(record.status);
  const publisherType = normalizePublisherType();
  return {
    id: record.id,
    code: record.sku,
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
    videoMediaId: record.videoMediaId,
    videoUrl: record.videoUrl,
    detail: record.detail || '',
    attributes: record.attributes ?? [],
    variants: record.variants ?? [],
    priceRange: formatPriceRange(record.guidePrice),
    status,
    offShelfReason: record.offShelfReason,
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
    videoMediaId: nextItem.videoMediaId!,
    detail: nextItem.detail,
    totalStock: nextItem.stock,
    guidePrice: nextItem.guidePrice,
    guidePrices: nextItem.guidePrices,
    markupPrices: nextItem.markupPrices,
    attributes: nextItem.attributes,
    variants: nextItem.variants,
    offShelfReason: nextItem.offShelfReason,
    status: nextItem.status,
  };
};

const createMovement = async (
  productId: number,
  movementType: 'initial' | 'adjustment' | 'status_change',
  beforeQuantity: number,
  afterQuantity: number,
  reason: string,
) => {
  await createInventoryMovement({
    inventoryType: 'finished_product',
    inventoryId: productId,
    movementType,
    quantity: afterQuantity - beforeQuantity,
    beforeQuantity,
    afterQuantity,
    reason,
    remark: '管理后台成品库存操作',
  });
};

const loadInventoryData = async () => {
  loading.value = true;
  try {
    const [categories, attributes, attributeValues, suppliers, products, markupResult, guideSetting] =
      await Promise.all([
        listProductCategories(),
        listProductAttributes(),
        listProductAttributeValues(),
        listSuppliers(),
        listFinishedProducts(),
        listFinishedMarkupConfigurationOptions(),
        getFinishedGuidePriceSetting(),
      ]);
    productCategories.value = categories;
    productAttributes.value = attributes;
    productAttributeValues.value = attributeValues;
    productSuppliers.value = suppliers;
    markupConfigurations.value = markupResult;
    guidePriceSettingCoefficient.value = guideSetting?.priceCoefficient;
    dataItems.value = products.map(toStockItem);
    selectedKeys.value = [];
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '成品库存加载失败');
  } finally {
    loading.value = false;
  }
};

const currentFilter = computed(() => filters[activeTab.value]);
const currentAppliedFilter = computed(() => appliedFilters[activeTab.value]);
const currentPagination = computed(() => paginations[activeTab.value]);
const selectedKeySet = computed(() => new Set(selectedKeys.value));
const formPageTitle = computed(() => (formPageMode.value === 'create' ? '发布商品' : '编辑商品'));
const totalStock = computed(() => specRows.value.reduce((sum, row) => sum + Number(row.quantity || 0), 0));
const formEditorCover = computed(() => mainImageMedia.value?.url || '');

const handleMenuReselect = (event: Event) => {
  const detail = (event as CustomEvent<{ path?: string }>).detail;
  if (detail?.path === '/finished-stock-management') {
    closeFormPage();
  }
};

onMounted(() => {
  window.addEventListener('admin-menu-reselect', handleMenuReselect);
  loadInventoryData();
});

onBeforeUnmount(() => {
  window.removeEventListener('admin-menu-reselect', handleMenuReselect);
});

const filteredData = computed(() => {
  const filter = currentAppliedFilter.value;
  return dataItems.value.filter((item) => {
    if (item.status !== activeTab.value) return false;
    if (filter.id && !String(item.id).includes(filter.id)) return false;
    if (filter.name && !item.name.includes(filter.name)) return false;
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
    { action: BatchAction; label: string; theme: string; icon: string; className?: string }[]
  > = {
    warehouse: [
      { action: 'publish', label: '发布商品', theme: 'primary', icon: 'add' },
      { action: 'batchShelf', label: '批量上架', theme: 'primary', icon: 'upload' },
    ],
    selling: [
      { action: 'publish', label: '发布商品', theme: 'primary', icon: 'add' },
      { action: 'batchOffShelf', label: '批量下架', theme: 'warning', icon: 'rollback', className: 'warning-button' },
    ],
    offShelf: [{ action: 'batchRestore', label: '批量放回到仓库', theme: 'primary', icon: 'rollback' }],
    soldOut: [],
    recycle: [
      { action: 'batchRestore', label: '批量放回到仓库', theme: 'primary', icon: 'rollback' },
      { action: 'batchPurge', label: '批量彻底删除', theme: 'danger', icon: 'delete', className: 'deep-danger-button' },
      { action: 'clearRecycle', label: '清空回收站', theme: 'danger', icon: 'clear' },
    ],
  };
  return map[activeTab.value];
});

const columns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  const base: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'image', title: '商品主图', width: 96 },
    { colKey: 'product', title: '商品名称/ID/编码', minWidth: 220 },
    { colKey: 'stock', title: '库存', width: 88, align: 'center' },
    { colKey: 'supplier', title: '供应商', width: 180 },
    { colKey: 'price', title: '库存/价格', width: 120, align: 'center' },
  ];
  if (activeTab.value !== 'soldOut') {
    base.unshift({ colKey: 'select', title: 'selectTitle', width: 52, align: 'center' });
  }
  if (activeTab.value === 'offShelf') {
    base.splice(5, 0, { colKey: 'offShelfReason', title: '下架原因', width: 140 });
  }
  if (activeTab.value !== 'soldOut') {
    base.push({ colKey: 'operation', title: '操作', width: 230, align: 'left', fixed: 'right' });
  }
  return base;
});

const specColumns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  const priceColumnsBase: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'cost', title: '成本价*', width: 110 },
    { colKey: 'guide', title: '指导价*', width: 170 },
    ...productPriceLevels.value.map((item) => ({
      colKey: `markup-${item.id}`,
      title: `${item.name}*`,
      width: 170,
    })),
    { colKey: 'quantity', title: '数量*', width: 96 },
  ];
  const tailColumns: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'merchantCode', title: '商家编码', width: 150 },
    { colKey: 'operation', title: '操作', width: 100, align: 'left', fixed: 'right' },
  ];

  if (confirmedSpecMode.value === 'single') {
    return [
      { colKey: 'specText', title: '商品规格', width: 180 },
      ...priceColumnsBase,
      { colKey: 'material', title: '大理石台面材质', width: 150 },
      ...tailColumns,
    ];
  }

  const layeredColumns = confirmedLayeredFields.value.map<PrimaryTableCol<TableRowData>>((field) => ({
    colKey: field,
    title: layeredFieldLabels[field],
    width: field === 'material' ? 150 : field === 'size' ? 140 : 120,
  }));

  return [...layeredColumns, ...priceColumnsBase, ...tailColumns];
});

const priceColumns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  const dimensionColumns: PrimaryTableCol<TableRowData>[] =
    confirmedSpecMode.value === 'single'
      ? [{ colKey: 'specText', title: '商品规格', width: 132 }]
      : confirmedLayeredFields.value.map<PrimaryTableCol<TableRowData>>((field) => ({
          colKey: field,
          title: layeredFieldLabels[field],
          width: field === 'material' ? 126 : field === 'size' ? 108 : 92,
        }));
  const editableColumns: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'merchantCode', title: '商家编码', width: 132 },
    { colKey: 'stock', title: '库存', width: 82 },
    { colKey: 'cost', title: '成本价*', width: 96 },
    { colKey: 'guide', title: '指导价*', width: 96 },
    { colKey: 'level1', title: '1级合伙人价格*', width: 124 },
    { colKey: 'level2', title: '2级合伙人价格*', width: 124 },
    { colKey: 'level3', title: '3级合伙人价格*', width: 124 },
  ];
  return [...dimensionColumns, ...editableColumns];
});

const movementColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'createdAt', title: '时间', width: 150 },
  { colKey: 'movementType', title: '类型', width: 100 },
  { colKey: 'quantity', title: '变动', width: 90, align: 'center' },
  { colKey: 'stockChange', title: '库存变化', width: 130, align: 'center' },
  { colKey: 'reason', title: '原因', minWidth: 140, ellipsis: true },
];

const getSpecGroupKey = (row: SpecRow, fields: LayeredSpecField[]) =>
  fields.map((field) => row[field] || '').join('\u0001');

const specRowspanAndColspan = ({
  rowIndex,
  col,
}: {
  rowIndex: number;
  col: PrimaryTableCol<TableRowData>;
}): RowspanColspan => {
  if (confirmedSpecMode.value !== 'layered') return {};
  const field = col.colKey as LayeredSpecField;
  const fieldIndex = confirmedLayeredFields.value.indexOf(field);
  if (fieldIndex === -1) return {};

  const groupingFields = confirmedLayeredFields.value.slice(0, fieldIndex + 1);
  const currentKey = getSpecGroupKey(specRows.value[rowIndex], groupingFields);
  const previousRow = specRows.value[rowIndex - 1];
  if (previousRow && getSpecGroupKey(previousRow, groupingFields) === currentKey) {
    return { rowspan: 0 };
  }

  let rowspan = 1;
  for (let index = rowIndex + 1; index < specRows.value.length; index += 1) {
    if (getSpecGroupKey(specRows.value[index], groupingFields) !== currentKey) break;
    rowspan += 1;
  }
  return { rowspan };
};

const batchFilterFields = computed<BatchFilterField[]>(() =>
  confirmedSpecMode.value === 'single' ? ['specText'] : confirmedLayeredFields.value,
);

const batchFilterOptions = computed(() =>
  batchFilterFields.value.map((field) => ({
    field,
    label: batchFilterLabels[field],
    values: Array.from(new Set(specRows.value.map((row) => String(row[field] || '')).filter(Boolean))),
  })),
);

const isBatchFilterValueSelected = (field: BatchFilterField, value: string) => batchFillFilters[field].includes(value);

const batchFillMatchedRows = computed(() =>
  specRows.value.filter((row) =>
    batchFilterFields.value.every((field) => {
      const selectedValues = batchFillFilters[field];
      return selectedValues.length === 0 || selectedValues.includes(String(row[field] || ''));
    }),
  ),
);

const tabLabel = (tab: TabConfig) => {
  const count = countByStatus.value[tab.value];
  return count ? `${tab.label} ${count}` : tab.label;
};

const withMovementAction = (actions: { action: RowAction; label: string; theme: string }[]) => [
  ...actions,
  { action: 'movement' as const, label: '流水', theme: 'primary' },
];

const rowActions = (): { action: RowAction; label: string; theme: string }[] => {
  if (activeTab.value === 'warehouse') {
    return withMovementAction([
      { action: 'shelf', label: '上架', theme: 'primary' },
      { action: 'edit', label: '编辑', theme: 'primary' },
      { action: 'delete', label: '删除', theme: 'danger' },
    ]);
  }
  if (activeTab.value === 'selling') {
    return withMovementAction([
      { action: 'offShelf', label: '下架', theme: 'warning' },
      { action: 'edit', label: '编辑', theme: 'primary' },
      { action: 'delete', label: '删除', theme: 'danger' },
    ]);
  }
  if (activeTab.value === 'offShelf') {
    return withMovementAction([
      { action: 'restore', label: '放回到仓库', theme: 'primary' },
      { action: 'edit', label: '编辑', theme: 'primary' },
      { action: 'delete', label: '删除', theme: 'danger' },
    ]);
  }
  if (activeTab.value === 'soldOut') {
    return [];
  }
  return withMovementAction([
    { action: 'restore', label: '放回到仓库', theme: 'primary' },
    { action: 'purge', label: '彻底删除', theme: 'danger' },
  ]);
};

const handleTabChange = () => {
  selectedKeys.value = [];
};

const handleSearch = () => {
  Object.assign(currentAppliedFilter.value, currentFilter.value);
  currentPagination.value.current = 1;
  adminFeedback.success('已按筛选条件刷新列表');
};

const handleReset = () => {
  Object.assign(filters[activeTab.value], defaultFilter());
  handleSearch();
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
    selectedKeys.value = Array.from(new Set([...selectedKeys.value, ...pageData.value.map((item) => item.id)]));
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
    openConfirm('batchRestore', null, '是否批量放回到仓库所选成品现货？');
    return;
  }
  if (action === 'batchPurge') {
    openConfirm('batchPurge', null, '是否批量彻底删除所选成品现货？');
    return;
  }
  openConfirm('clearRecycle', null, '是否清空回收站？');
};

const handleRowAction = (action: RowAction, row: StockItem) => {
  const fullName = `${row.name}（${row.code}）`;
  if (action === 'movement') {
    openMovementDrawer(row);
    return;
  }
  if (action === 'edit') {
    openFormPage('edit', row);
    return;
  }
  if (action === 'shelf') {
    openConfirm('shelf', row, `是否上架商品“${fullName}”？`);
    return;
  }
  if (action === 'offShelf') {
    openReasonDialog('offShelf', row, false);
    return;
  }
  if (action === 'restore') {
    openConfirm('restore', row, `是否放回到仓库“${fullName}”？`);
    return;
  }
  if (action === 'delete') {
    openConfirm('delete', row, `是否删除商品“${fullName}”？`);
    return;
  }
  openConfirm('purge', row, `是否彻底删除商品“${fullName}”？`);
};

const movementTypeLabel = (type: MovementType) =>
  ({
    initial: '初始入库',
    adjustment: '库存调整',
    status_change: '状态变更',
    inbound: '入库',
    outbound: '出库',
  })[type] ?? type;

const formatMovementNumber = (value?: number) => Number(value ?? 0).toFixed(2);

const formatMovementQuantity = (value?: number) => {
  const quantity = Number(value ?? 0);
  if (quantity > 0) return `+${quantity.toFixed(2)}`;
  return quantity.toFixed(2);
};

const movementQuantityClass = (value?: number) => {
  const quantity = Number(value ?? 0);
  if (quantity > 0) return 'movement-positive';
  if (quantity < 0) return 'movement-negative';
  return 'movement-neutral';
};

const formatMovementTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ');
  return date.toLocaleString('zh-CN', { hour12: false });
};

const openMovementDrawer = async (row: StockItem) => {
  movementTarget.value = row;
  movementDrawerVisible.value = true;
  movementLoading.value = true;
  try {
    movementRows.value = await listInventoryMovements(row.id);
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '库存流水加载失败');
  } finally {
    movementLoading.value = false;
  }
};

const closeMovementDrawer = () => {
  movementDrawerVisible.value = false;
  movementTarget.value = null;
  movementRows.value = [];
};

const openCategoryDialog = () => {
  if (!formPageVisible.value) {
    selectedCategoryId.value = undefined;
    selectedCategoryPath.value = '';
  }
  categoryPickerSelection.value = categoryPathIds(selectedCategoryId.value);
  categoryDialogVisible.value = true;
};

const closeCategoryDialog = () => {
  categoryDialogVisible.value = false;
};

const selectCategory = (columnIndex: number, categoryId: number) => {
  categoryPickerSelection.value = [...categoryPickerSelection.value.slice(0, columnIndex), categoryId];
};

const confirmCategory = () => {
  const categoryId = categoryPickerSelection.value.at(-1);
  if (categoryId == null) {
    adminFeedback.warning('请选择成品现货分类');
    return;
  }
  if (hasCategoryChildren(categoryId)) {
    adminFeedback.warning('请继续选择下级分类');
    return;
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
      const coefficient = existing ? Number(existing.priceCoefficient) : Number(configuration.priceCoefficient);
      return [
        configuration.id,
        {
          coefficient: coefficient.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''),
          price: existing ? String(existing.price) : '',
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
  quantity: 0,
  merchantCode: '',
  markupPrices: createMarkupEditors(),
  ...partial,
});

const createEditSpecRows = (row: StockItem): SpecRow[] => {
  if (row.variants.length) {
    return row.variants.map((variant, index) => {
      const markupPrices = row.markupPrices?.filter((price) => price.variantKey === variant.variantKey) ?? [];
      const guidePrice = row.guidePrices?.find((price) => price.variantKey === variant.variantKey);
      return createBaseSpecRow({
        id: row.id * 100 + index + 1,
        mode: variant.displayMode,
        specText: variant.displayMode === 'single' ? variant.variantLabel : '',
        material: variant.material || '',
        length: variant.lengthValue || '',
        color: variant.color || '',
        size: variant.sizeValue || '',
        costCoefficient: '1',
        cost: String(guidePrice?.costPrice ?? markupPrices[0]?.costPrice ?? ''),
        guideCoefficient: guidePrice == null ? '' : String(Number(guidePrice.priceCoefficient)),
        guide: guidePrice == null ? '' : String(guidePrice.price),
        quantity: variant.stock,
        merchantCode: variant.variantKey,
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
    router.replace({ path: '/finished-stock-management', query: { form: mode } });
  }
  formTab.value = 'description';
  submitAttempted.value = false;
  Object.assign(productForm, createEmptyProductForm());
  specRows.value = [];
  priceRows.value = [];
  confirmedSpecMode.value = 'single';
  confirmedLayeredFields.value = [];
  confirmedImageField.value = null;
  mainImageMedia.value = undefined;
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
    confirmedLayeredFields.value = (['material', 'color', 'size', 'length'] as LayeredSpecField[]).filter((field) =>
      row.variants.some((variant) =>
        Boolean(
          field === 'material'
            ? variant.material
            : field === 'color'
              ? variant.color
              : field === 'size'
                ? variant.sizeValue
                : variant.lengthValue,
        ),
      ),
    );
    confirmedImageField.value = null;
    priceRows.value = specRows.value.map(specToPriceRow);
    mainImageMedia.value = row.mainImageMediaId
      ? { name: `${row.name}-主图`, mediaId: row.mainImageMediaId, url: row.image }
      : undefined;
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
  if (route.path === '/finished-stock-management' && Object.keys(route.query).length) {
    router.replace({ path: '/finished-stock-management' });
  }
};

const uploadProductMedia = async (file: File, expectedType: 'image' | 'video'): Promise<AdminMediaValue> => {
  const uploaded = await uploadFinishedProductMedia(file);
  if (uploaded.mediaType !== expectedType) {
    await releaseTemporaryFinishedProductMedia(uploaded.id);
    throw new Error(expectedType === 'image' ? '请选择图片文件' : '请选择视频文件');
  }
  pendingUploadedMediaIds.add(uploaded.id);
  return { name: file.name, mediaId: uploaded.id, url: uploaded.url };
};

const releasePendingProductMedia = (media: AdminMediaValue) => {
  const mediaId = media.mediaId;
  if (!mediaId || !pendingUploadedMediaIds.has(mediaId)) return;
  pendingUploadedMediaIds.delete(mediaId);
  void releaseTemporaryFinishedProductMedia(mediaId);
};

const normalizeDecimalInput = (value: unknown) => {
  const text = String(value ?? '').replace(/[^\d.]/g, '');
  const [integerPart, ...decimalParts] = text.split('.');
  if (!text.includes('.')) return integerPart;
  return `${integerPart || '0'}.${decimalParts.join('').slice(0, 2)}`;
};

const limitDecimalInput = (row: SpecRow | PriceRow | BatchFillForm, field: DecimalField, value: unknown) => {
  row[field] = normalizeDecimalInput(value);
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
  limitDecimalInput(row, 'cost', value);
  syncAllSpecPricesByCost(row);
};

const handleSpecCoefficientChange = (
  row: SpecRow,
  coefficientField: DecimalField,
  priceField: DecimalField,
  value: unknown,
) => {
  limitDecimalInput(row, coefficientField, value);
  syncSpecPriceByCoefficient(row, coefficientField, priceField);
};

const handleSpecPriceChange = (
  row: SpecRow,
  priceField: DecimalField,
  coefficientField: DecimalField,
  value: unknown,
) => {
  limitDecimalInput(row, priceField, value);
  syncSpecCoefficientByPrice(row, priceField, coefficientField);
};

const handleMarkupCoefficientChange = (row: SpecRow, configurationId: number, value: unknown) => {
  const editor = row.markupPrices[configurationId];
  if (!editor) return;
  editor.coefficient = normalizeDecimalInput(value);
  const cost = decimalNumber(row.cost);
  const coefficient = decimalNumber(editor.coefficient);
  if (cost !== null && coefficient !== null && coefficient >= 0) editor.price = (cost * coefficient).toFixed(2);
};

const handleMarkupPriceChange = (row: SpecRow, configurationId: number, value: unknown) => {
  const editor = row.markupPrices[configurationId];
  if (!editor) return;
  editor.price = normalizeDecimalInput(value);
  const cost = decimalNumber(row.cost);
  const price = decimalNumber(editor.price);
  if (cost !== null && cost > 0 && price !== null && price >= 0) editor.coefficient = (price / cost).toFixed(4);
};

const syncBatchPriceByCoefficient = (coefficientField: DecimalField, priceField: DecimalField) => {
  const cost = decimalNumber(batchFillForm.cost);
  const coefficient = decimalNumber(batchFillForm[coefficientField]);
  if (cost === null || coefficient === null) return;
  batchFillForm[priceField] = (cost * coefficient).toFixed(2);
};

const syncBatchCoefficientByPrice = (priceField: DecimalField, coefficientField: DecimalField) => {
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

const handleBatchCostChange = (value: unknown) => {
  limitDecimalInput(batchFillForm, 'cost', value);
  syncAllBatchPricesByCost();
};

const handleBatchCoefficientChange = (coefficientField: DecimalField, priceField: DecimalField, value: unknown) => {
  limitDecimalInput(batchFillForm, coefficientField, value);
  syncBatchPriceByCoefficient(coefficientField, priceField);
};

const handleBatchPriceChange = (priceField: DecimalField, coefficientField: DecimalField, value: unknown) => {
  limitDecimalInput(batchFillForm, priceField, value);
  syncBatchCoefficientByPrice(priceField, coefficientField);
};

const openSpecDialog = (preserveCurrent = false) => {
  if (preserveCurrent && specRows.value.length) {
    hydrateSpecDialogFromRows();
  } else {
    resetSpecDialog();
  }
  specDialogVisible.value = true;
};

const closeSpecDialog = () => {
  specDialogVisible.value = false;
};

const handleSpecModeChange = (value: unknown) => {
  if (value === 'single' || value === 'layered') {
    specMode.value = value;
  }
  clearSpecDraft(false);
};

const clearSpecDraft = (resetMode = true) => {
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

const selectedSpecGroups = computed(() => specGroups.filter((group) => group.selected));

const selectedImageGroup = computed(() => selectedSpecGroups.value.find((group) => group.withImage));

const addSingleSpec = () => {
  singleSpecs.value.push(createSingleSpecItem());
};

const removeSingleSpec = (index: number) => {
  singleSpecs.value.splice(index, 1);
};

const addSpecValue = (name: string) => {
  const group = specGroups.find((item) => item.name === name);
  group?.values.push(createSpecValue());
};

const removeSpecValue = (name: string, index: number) => {
  const group = specGroups.find((item) => item.name === name);
  if (!group) return;
  if (group.values.length <= 1) {
    adminFeedback.warning('至少需要输入一个属性值');
    return;
  }
  group?.values.splice(index, 1);
};

const toggleSpecGroup = (group: SpecGroup) => {
  if (!group.selected && selectedSpecGroups.value.length >= 3) {
    adminFeedback.warning('最多只能选择3个销售属性');
    return;
  }
  group.selected = !group.selected;
  group.withImage = false;
  group.values = [createSpecValue()];
};

const resetSpecDialog = () => {
  clearSpecDraft(true);
};

const hydrateSpecDialogFromRows = () => {
  specMode.value = confirmedSpecMode.value;
  if (confirmedSpecMode.value === 'single') {
    singleSpecs.value = specRows.value.map((row) => createSingleSpecItem(row.specText, row.specImage));
    if (!singleSpecs.value.length) singleSpecs.value = [createSingleSpecItem()];
    confirmedImageField.value = null;
    return;
  }
  let hasHydratedImageGroup = false;
  specGroups.forEach((group) => {
    const imageKey = `${group.field}Image` as 'materialImage' | 'lengthImage' | 'colorImage' | 'sizeImage';
    group.selected = specRows.value.some((row) => Boolean(row[group.field]));
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
    if (!group.values.length) group.values = [createSpecValue()];
  });
  confirmedLayeredFields.value = specGroups.filter((group) => group.selected).map((group) => group.field);
  confirmedImageField.value = specGroups.find((group) => group.selected && group.withImage)?.field || null;
};

const confirmCreateSpec = () => {
  const rows =
    specMode.value === 'single'
      ? singleSpecs.value
          .map((item) => ({ ...item, text: item.text.trim() }))
          .filter((item) => item.text)
          .map((item) =>
            createBaseSpecRow({
              mode: 'single',
              specText: item.text,
              specImage: item.imageUploaded,
              material: '',
              quantity: 0,
              merchantCode: '',
            }),
          )
      : buildLayeredSpecRows();
  if (!rows.length) {
    adminFeedback.warning('请至少配置一条商品规格');
    return;
  }
  confirmedSpecMode.value = specMode.value;
  confirmedLayeredFields.value =
    specMode.value === 'layered' ? selectedSpecGroups.value.map((group) => group.field) : [];
  confirmedImageField.value = specMode.value === 'layered' ? selectedImageGroup.value?.field || null : null;
  specRows.value = rows;
  priceRows.value = rows.map(specToPriceRow);
  closeSpecDialog();
  adminFeedback.success('规格表格已生成');
};

const normalizeLayeredValue = (field: LayeredSpecField, value: string) =>
  field === 'length' && value && !value.endsWith('mm') ? `${value}mm` : value;

const getSpecGroupByField = (field: LayeredSpecField) => specGroups.find((group) => group.field === field);

const buildLayeredSpecRows = () => {
  const normalizedGroups = selectedSpecGroups.value.map((group) => ({
    ...group,
    values: group.values
      .map((item) => ({ ...item, value: normalizeLayeredValue(group.field, item.value.trim()) }))
      .filter((item) => item.value),
  }));
  if (normalizedGroups.some((group) => group.values.length === 0)) return [];

  const combinations = normalizedGroups.reduce<Partial<Record<LayeredSpecField, SpecValue>>[]>(
    (acc, group) =>
      acc.flatMap((combination) =>
        group.values.map((value) => ({
          ...combination,
          [group.field]: value,
        })),
      ),
    [{}],
  );

  return combinations.map((combination) =>
    createBaseSpecRow({
      mode: 'layered',
      material: combination.material?.value || '',
      materialImage: Boolean(getSpecGroupByField('material')?.withImage && combination.material?.imageUploaded),
      length: combination.length?.value || '',
      lengthImage: Boolean(getSpecGroupByField('length')?.withImage && combination.length?.imageUploaded),
      color: combination.color?.value || '',
      colorImage: Boolean(getSpecGroupByField('color')?.withImage && combination.color?.imageUploaded),
      size: combination.size?.value || '',
      sizeImage: Boolean(getSpecGroupByField('size')?.withImage && combination.size?.imageUploaded),
      quantity: 0,
      merchantCode: '',
    }),
  );
};

const specToPriceRow = (row: SpecRow): PriceRow => ({
  id: row.id,
  mode: row.mode,
  specText: row.specText,
  material: row.material,
  length: row.length,
  color: row.color,
  size: row.size,
  merchantCode: row.merchantCode,
  stock: row.quantity,
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

const openPriceDrawer = (mode: PriceDrawerMode, row?: StockItem) => {
  priceDrawerMode.value = mode;
  if (mode === 'view' && row) {
    priceRows.value = createEditSpecRows(row).map(specToPriceRow);
  } else {
    priceRows.value = specRows.value.map(specToPriceRow);
    resetBatchFillState();
  }
  priceDrawerVisible.value = true;
};

const closePriceDrawer = () => {
  priceDrawerVisible.value = false;
};

const resetBatchFillState = () => {
  batchFilterFields.value.forEach((field) => {
    batchFillFilters[field] = [];
  });
  Object.assign(batchFillForm, createEmptyBatchFillForm());
};

const toggleBatchFilterValue = (field: BatchFilterField, value: string) => {
  const values = batchFillFilters[field];
  batchFillFilters[field] = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
};

const clearBatchFilterField = (field: BatchFilterField) => {
  batchFillFilters[field] = [];
};

const savePriceDrawer = () => {
  if (priceDrawerMode.value === 'batchFill') {
    const matchedIds = new Set(batchFillMatchedRows.value.map((row) => row.id));
    if (!matchedIds.size) {
      adminFeedback.warning('当前条件下没有可批量填写的规格');
      return;
    }
    specRows.value = specRows.value.map((row) => {
      return matchedIds.has(row.id)
        ? {
            ...row,
            cost: batchFillForm.cost || row.cost,
            guideCoefficient: batchFillForm.guideCoefficient || row.guideCoefficient,
            guide: batchFillForm.guide || row.guide,
            level1Coefficient: batchFillForm.level1Coefficient || row.level1Coefficient,
            level1: batchFillForm.level1 || row.level1,
            level2Coefficient: batchFillForm.level2Coefficient || row.level2Coefficient,
            level2: batchFillForm.level2 || row.level2,
            level3Coefficient: batchFillForm.level3Coefficient || row.level3Coefficient,
            level3: batchFillForm.level3 || row.level3,
            quantity: batchFillForm.quantity ?? row.quantity,
            merchantCode: batchFillForm.merchantCode || row.merchantCode,
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
  const pricesComplete = specRows.value.every(
    (row) =>
      Boolean(row.cost.trim()) &&
      Boolean(row.guideCoefficient.trim()) &&
      Boolean(row.guide.trim()) &&
      Boolean(row.merchantCode.trim()) &&
      productPriceLevels.value.every((configuration) => {
        const editor = row.markupPrices[configuration.id];
        return Boolean(editor?.coefficient.trim()) && Boolean(editor?.price.trim());
      }),
  );
  const checks: { valid: boolean; tab: FormTabKey; message: string }[] = [
    { valid: Boolean(mainImageMedia.value?.mediaId), tab: 'description', message: '请上传商品主图' },
    { valid: Boolean(videoMedia.value?.mediaId), tab: 'description', message: '请上传商品视频' },
    { valid: Boolean(productForm.detail.trim()), tab: 'description', message: '请输入宝贝详情' },
    { valid: Boolean(productForm.name.trim()), tab: 'base', message: '请输入商品名称' },
    { valid: Boolean(productForm.supplier), tab: 'base', message: '请选择供应商' },
    { valid: selectedCategoryId.value != null, tab: 'base', message: '请选择商品分类' },
    { valid: specRows.value.length > 0, tab: 'sales', message: '请创建销售规格' },
    {
      valid: editingProduct.value != null || guidePriceSettingCoefficient.value != null,
      tab: 'sales',
      message: '请先配置成品指导价默认价格系数',
    },
    { valid: pricesComplete, tab: 'sales', message: '请完善每条规格的成本价、指导价和商家编码' },
    { valid: Boolean(productForm.merchantCode.trim()), tab: 'sales', message: '请输入商家编码' },
    { valid: Boolean(productForm.shelfNow), tab: 'sales', message: '请选择上架方式' },
  ];
  const failed = checks.find((item) => !item.valid);
  if (failed) {
    formTab.value = failed.tab;
    adminFeedback.warning(failed.message);
    return false;
  }
  return true;
};

const buildProductPayloadFromForm = (): FinishedProductPayload => {
  const stock = totalStock.value || Number(productForm.totalStock || 0);
  const guidePrice = Number(specRows.value[0]?.guide || 0);
  const status = productForm.shelfNow === 'now' ? 'selling' : 'warehouse';
  return {
    categoryId: selectedCategoryId.value,
    supplierId: supplierIdByName(productForm.supplier),
    name: productForm.name.trim(),
    sku: productForm.merchantCode.trim(),
    mainImageMediaId: mainImageMedia.value!.mediaId!,
    videoMediaId: videoMedia.value!.mediaId!,
    detail: productForm.detail.trim(),
    totalStock: stock,
    guidePrice: guidePrice > 0 ? guidePrice : undefined,
    attributes: attributeFields.value
      .map((field) => ({
        attributeId: field.attributeId,
        attributeName: field.label,
        value: String(productForm[field.key] ?? '').trim(),
      }))
      .filter((attribute) => attribute.value),
    variants: specRows.value.map((row) => ({
      variantKey: row.merchantCode.trim(),
      variantLabel:
        row.specText || [row.material, row.length, row.color, row.size].filter(Boolean).join(' / ') || row.merchantCode,
      displayMode: row.mode,
      material: row.material || undefined,
      lengthValue: row.length || undefined,
      color: row.color || undefined,
      sizeValue: row.size || undefined,
      stock: Number(row.quantity || 0),
    })),
    guidePrices: specRows.value.map((row) => ({
      priceCoefficient: Number(Number(row.guideCoefficient).toFixed(4)),
      costPrice: Number(row.cost),
      price: Number(row.guide),
      variantKey: row.merchantCode.trim(),
      variantLabel:
        row.specText || [row.material, row.length, row.color, row.size].filter(Boolean).join(' / ') || row.merchantCode,
    })),
    markupPrices: specRows.value.flatMap((row) =>
      productPriceLevels.value.map((configuration) => {
        const editor = row.markupPrices[configuration.id];
        return {
          storeLevelId: configuration.id,
          priceCoefficient: Number(Number(editor.coefficient).toFixed(4)),
          costPrice: Number(row.cost),
          price: Number(editor.price),
          variantKey: row.merchantCode.trim(),
          variantLabel:
            row.specText ||
            [row.material, row.length, row.color, row.size].filter(Boolean).join(' / ') ||
            row.merchantCode,
        };
      }),
    ),
    offShelfReason: editingProduct.value?.offShelfReason,
    status,
  };
};

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
  if (!validateProductForm()) return;
  const isCreate = formPageMode.value !== 'edit' || !editingProduct.value;
  saving.value = true;
  try {
    const payload = buildProductPayloadFromForm();
    if (formPageMode.value === 'edit' && editingProduct.value) {
      const beforeStock = editingProduct.value.stock;
      const updated = await updateFinishedProduct(editingProduct.value.id, payload);
      upsertStockItem(updated);
      if (beforeStock !== (payload.totalStock ?? 0)) {
        await createMovement(updated.id, 'adjustment', beforeStock, payload.totalStock ?? 0, '编辑成品库存数量');
      }
    } else {
      const created = await createFinishedProduct(payload);
      upsertStockItem(created);
      await createMovement(created.id, 'initial', 0, payload.totalStock ?? 0, '新建成品库存');
    }
    pendingUploadedMediaIds.clear();
    formPageVisible.value = false;
    if (isCreate) {
      adminFeedback.created(payload.name);
    } else {
      adminFeedback.success(productForm.shelfNow === 'now' ? '商品信息已提交并上架' : '商品信息已提交，暂存仓库中');
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
      await Promise.all(selectedKeys.value.map((id) => updateProductStatus(id, 'offShelf', reasonForm.reason)));
      selectedKeys.value = [];
      adminFeedback.success('已批量下架');
    } else if (reasonState.product) {
      await updateProductStatus(reasonState.product.id, 'offShelf', reasonForm.reason);
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

const closeDetailDialog = () => {
  detailDialogVisible.value = false;
  detailProduct.value = null;
};

const openImagePreview = (row: StockItem) => {
  imagePreviewSrc.value = row.image;
  imagePreviewTitle.value = `${row.name} · 商品主图`;
  imagePreviewVisible.value = true;
};

const closeImagePreview = () => {
  imagePreviewVisible.value = false;
  imagePreviewSrc.value = '';
};

const updateProductStatus = async (id: number, status: StockStatus, reason?: string) => {
  const item = dataItems.value.find((product) => product.id === id);
  if (!item) return;
  const beforeStock = item.stock;
  const afterStock = status === 'soldOut' ? 0 : item.stock;
  const updated = await updateFinishedProduct(
    id,
    toProductPayload(item, {
      status,
      stock: afterStock,
      offShelfReason: status === 'offShelf' ? reason || item.offShelfReason : undefined,
    }),
  );
  upsertStockItem(updated, status === 'offShelf' ? reason || item.offShelfReason || '运营调整' : undefined);
  await createMovement(id, 'status_change', beforeStock, afterStock, reason || `状态变更为 ${status}`);
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
      await Promise.all(selectedKeys.value.map((id) => updateProductStatus(id, 'selling')));
      selectedKeys.value = [];
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

<style scoped>
.admin-layout {
  min-height: 100vh;
  background: var(--td-bg-color-page);
}

.top-nav {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-container);
  border-bottom: 1px solid var(--td-component-border);
}

.brand,
.top-actions,
.user-entry,
.page-header,
.filter-row,
.table-toolbar,
.toolbar-buttons,
.form-title-row,
.selected-category,
.spec-toolbar,
.drawer-head {
  display: flex;
  align-items: center;
}

.brand {
  width: 224px;
  height: 100%;
  flex-shrink: 0;
  gap: 12px;
}

.brand-logo {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: var(--td-brand-color);
  border-radius: 4px;
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

.admin-shell {
  min-height: calc(100vh - 64px);
  display: flex;
  align-items: stretch;
  background: var(--td-bg-color-page);
}

.side-nav {
  width: 248px;
  flex-shrink: 0;
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-s) 0;
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-component-border);
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

.breadcrumb-link {
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
}

.breadcrumb-link:hover {
  color: var(--td-brand-color);
}

.filter-card,
.table-card,
.form-shell {
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
}

.filter-card {
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  margin-bottom: var(--td-comp-margin-l);
}

.status-tabs {
  margin-bottom: var(--td-comp-margin-l);
}

.filter-row {
  justify-content: space-between;
  gap: 16px;
}

.filter-fields {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(5, minmax(170px, 1fr));
  gap: 12px 16px;
}

.filter-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  align-self: flex-start;
}

.table-card {
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
}

.table-empty {
  width: 100%;
  padding: 28px 0;
  color: var(--td-text-color-placeholder);
  text-align: center;
}

:deep(.table-card .t-table__empty) {
  height: auto;
  padding: 0;
}

.table-toolbar {
  justify-content: space-between;
  min-height: 34px;
  margin-bottom: 14px;
}

.toolbar-buttons {
  gap: 8px;
}

.selection-info {
  color: #6b7280;
  font-size: 13px;
}

.deep-danger-button {
  background: #8a1f11;
  border-color: #8a1f11;
}

.product-image {
  width: 64px;
  height: 64px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.product-image img,
.detail-panel img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.preview-trigger {
  padding: 0;
  cursor: zoom-in;
  background: transparent;
  border: 0;
}

.preview-trigger:hover img {
  transform: scale(1.04);
}

.preview-trigger img {
  transition: transform 0.2s ease;
}

.image-preview-dialog {
  display: flex;
  min-height: 620px;
  align-items: center;
  justify-content: center;
  background: var(--td-bg-color-secondarycontainer);
}

.image-preview-dialog img {
  display: block;
  width: min(900px, 100%);
  height: min(760px, calc(100vh - 220px));
  object-fit: contain;
}

.product-meta,
.tenant-cell,
.price-cell {
  display: grid;
  gap: 4px;
}

.product-name {
  color: #111827;
  font-weight: 600;
}

.product-code,
.store-text {
  color: #6b7280;
  font-size: 12px;
}

.tenant-tags {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.publisher-tag {
  width: fit-content;
  max-width: 100%;
}

.platform-publish {
  color: #0f7b3b;
  background: #effaf3;
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 10px;
}

.form-shell {
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl) 0;
}

.form-title-row {
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.form-title-row h1 {
  margin: 0 0 8px;
  font-size: 20px;
}

.selected-category {
  gap: 12px;
  color: #4b5563;
  font-size: 13px;
}

.form-section {
  width: 100%;
  max-width: none;
  padding: 20px 0 28px;
}

.form-grid {
  display: grid;
  gap: 16px 20px;
}

.form-grid.two {
  grid-template-columns: repeat(2, minmax(240px, 1fr));
}

.form-grid.three {
  grid-template-columns: repeat(3, minmax(210px, 1fr));
}

.upload-grid {
  display: grid;
  grid-template-columns: repeat(2, 180px);
  gap: 16px;
  margin-bottom: 22px;
}

.upload-box {
  position: relative;
  display: grid;
  height: 132px;
  color: #4b5563;
  cursor: pointer;
  background: #f9fafb;
  border: 1px dashed #b8c2d4;
  border-radius: 8px;
  place-items: center;
}

.upload-box.uploaded {
  color: #1664ff;
  background: #eef5ff;
  border-color: #1664ff;
}

.upload-box.error {
  color: #d54941;
  background: #fff5f5;
  border-color: #d54941;
}

.upload-box strong {
  color: #111827;
}

.upload-box .t-icon {
  color: #1664ff;
  font-size: 24px;
}

.upload-box.error .t-icon {
  color: #d54941;
}

.required-star {
  position: absolute;
  top: 8px;
  left: 10px;
  color: #d54941;
  font-weight: 700;
}

.rich-editor {
  max-width: 920px;
}

.section-title {
  margin: 20px 0 14px;
  color: #111827;
  font-size: 15px;
  font-weight: 700;
}

.sales-head {
  margin-bottom: 6px;
}

.spec-table-block {
  margin-top: 18px;
}

:deep(.spec-table-block .t-table__th),
:deep(.spec-table-block .t-table__td) {
  border-right: 1px solid var(--td-component-border);
  border-bottom: 1px solid var(--td-component-border);
}

:deep(.spec-table-block .t-table__th:first-child),
:deep(.spec-table-block .t-table__td:first-child) {
  border-left: 1px solid var(--td-component-border);
}

:deep(.spec-table-block .t-table__header tr:first-child .t-table__th) {
  border-top: 1px solid var(--td-component-border);
}

.spec-toolbar {
  justify-content: space-between;
  margin-bottom: 12px;
  font-weight: 700;
}

.spec-table-actions {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  margin-top: 12px;
}

.spec-name-cell {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.spec-thumb {
  width: 40px;
  height: 40px;
  display: inline-flex;
  flex: 0 0 40px;
  align-items: center;
  justify-content: center;
  color: #1664ff;
  cursor: pointer;
  background: #eef5ff;
  border: 1px dashed #8bb4ff;
  border-radius: 6px;
}

.spec-thumb.mini {
  width: 28px;
  height: 28px;
  flex-basis: 28px;
}

.price-pair {
  display: grid;
  grid-template-columns: 54px minmax(72px, 1fr);
  gap: 6px;
}

.price-pair.wide {
  grid-template-columns: 88px minmax(120px, 1fr);
}

.quantity-editor {
  display: flex;
  align-items: center;
  gap: 6px;
}

.quantity-editor :deep(.t-input-number),
.stock-input {
  width: 72px;
}

.decimal-input {
  width: 100%;
}

.form-submit-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 10px;
  padding: 14px 0;
  background: var(--td-bg-color-container);
  border-top: 1px solid var(--td-component-border);
}

.category-picker {
  display: flex;
  gap: 12px;
  min-height: 280px;
  padding-bottom: 4px;
  overflow-x: auto;
}

.category-column {
  flex: 0 0 260px;
  padding: 8px;
  background: var(--td-bg-color-secondarycontainer);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.category-column-title {
  padding: 6px 10px 10px;
  color: var(--td-text-color-secondary);
  font-size: 12px;
  font-weight: 600;
}

.category-option-list {
  height: 252px;
  overflow-y: auto;
}

.category-option-list :deep(.t-empty) {
  margin-top: 72px;
}

.category-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 38px;
  padding: 0 10px;
  color: var(--td-text-color-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: var(--td-radius-default);
}

.category-option.active {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  font-weight: 700;
}

.category-picker-path {
  margin-top: 12px;
  color: var(--td-text-color-secondary);
}

.spec-dialog {
  display: grid;
  gap: 18px;
}

.single-spec-editor,
.layered-spec-editor,
.spec-group {
  display: grid;
  gap: 10px;
}

.spec-section-title {
  color: #111827;
  font-weight: 700;
}

.single-spec-list {
  display: grid;
  gap: 10px;
}

.single-spec-row,
.layered-value-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.spec-upload-box {
  width: 72px;
  height: 56px;
  display: grid;
  place-items: center;
  color: #1664ff;
  cursor: pointer;
  background: #eef5ff;
  border: 1px dashed #8bb4ff;
  border-radius: 6px;
  font-size: 12px;
}

.spec-upload-box.small {
  width: 40px;
  height: 32px;
}

.spec-add-button {
  justify-self: end;
}

.inline-editor,
.selected-tags {
  display: flex;
  align-items: center;
  gap: 8px;
}

.selected-tags {
  flex-wrap: wrap;
}

.spec-attr-tag {
  height: 28px;
  padding: 0 12px;
  color: #4b5563;
  cursor: pointer;
  background: #f9fafb;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
}

.spec-attr-tag.active {
  color: #1664ff;
  background: #eef5ff;
  border-color: #8bb4ff;
  font-weight: 600;
}

.spec-attr-tag.disabled {
  color: #9ca3af;
  cursor: not-allowed;
  background: #f3f4f6;
  border-color: #e5e7eb;
}

.layered-empty {
  padding: 20px;
  color: #9ca3af;
  text-align: center;
  background: #f9fafb;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
}

.spec-group {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.spec-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.spec-group-title {
  color: #111827;
  font-weight: 700;
}

.dialog-reset-row {
  display: flex;
  justify-content: flex-start;
}

.spec-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid #e5e7eb;
}

.drawer-head {
  justify-content: space-between;
  margin-bottom: 16px;
}

:deep(.t-drawer) {
  max-width: calc(100vw - 32px);
}

.drawer-head div {
  display: grid;
  gap: 4px;
}

.drawer-head span {
  color: #6b7280;
  font-size: 13px;
}

.movement-drawer {
  display: grid;
  gap: 16px;
}

.movement-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px;
  background: #fff;
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
}

.movement-head div {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.movement-head strong {
  color: #111827;
  font-weight: 700;
}

.movement-head span {
  color: #6b7280;
  font-size: 13px;
}

.movement-positive {
  color: var(--td-success-color);
  font-weight: 700;
}

.movement-negative {
  color: var(--td-error-color);
  font-weight: 700;
}

.movement-neutral {
  color: var(--td-text-color-secondary);
}

.batch-fill-panel {
  display: grid;
  gap: 16px;
}

.batch-section {
  padding: 14px;
  background: #fff;
  border: 1px solid var(--td-component-border);
  border-radius: 6px;
}

.batch-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.batch-section-head strong {
  color: #111827;
  font-size: 14px;
}

.batch-section-head span,
.batch-match-tip {
  color: #6b7280;
  font-size: 13px;
}

.batch-filter-list {
  display: grid;
  gap: 12px;
}

.batch-filter-row {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 12px;
  align-items: flex-start;
}

.batch-filter-label {
  padding-top: 5px;
  color: #374151;
  font-weight: 600;
}

.batch-filter-values {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.batch-chip {
  height: 28px;
  padding: 0 12px;
  color: #4b5563;
  cursor: pointer;
  background: #f9fafb;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
}

.batch-chip.active {
  color: #1664ff;
  background: #eef5ff;
  border-color: #8bb4ff;
  font-weight: 600;
}

.batch-match-tip {
  margin-top: 12px;
}

.batch-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(260px, 1fr));
  gap: 12px 20px;
}

.detail-panel {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 20px;
}

.detail-panel img {
  height: 220px;
  border-radius: 8px;
}

.detail-info h2 {
  margin: 0 0 12px;
}

.detail-info p {
  margin: 8px 0;
  color: #4b5563;
}

@media (max-width: 1180px) {
  .filter-fields,
  .form-grid.three {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }
}

@media (max-width: 860px) {
  .filter-row,
  .form-title-row {
    display: block;
  }

  .filter-fields,
  .form-grid.two,
  .form-grid.three,
  .category-picker,
  .detail-panel {
    grid-template-columns: 1fr;
  }

  .filter-actions {
    margin-top: 12px;
  }
}
</style>
