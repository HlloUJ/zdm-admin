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
                  <t-form-item label="租户">
                    <t-select v-model="currentFilter.tenant" clearable placeholder="请选择">
                      <t-option v-for="item in tenantOptions" :key="item" :label="item" :value="item" />
                    </t-select>
                  </t-form-item>
                  <t-form-item label="门店">
                    <t-select v-model="currentFilter.store" clearable placeholder="请选择">
                      <t-option v-for="item in storeOptions" :key="item" :label="item" :value="item" />
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
                  <img :src="row.image" :alt="row.name" />
                </button>
              </template>
              <template #product="{ row }">
                <div class="product-meta">
                  <div class="product-name">{{ row.name }}</div>
                  <div class="product-code">ID：{{ row.id }}</div>
                  <div class="product-code">编码：{{ row.code }}</div>
                </div>
              </template>
              <template #tenant="{ row }">
                <div class="tenant-cell">
                  <div>{{ row.tenant }}</div>
                  <span class="store-text">{{ row.store }}</span>
                  <div class="tenant-tags">
                    <t-tag :class="publisherTagClass(row.publisherType)" variant="light" class="tenant-tag">
                      {{ row.publisherType }}
                    </t-tag>
                    <t-tag v-if="row.publisherType === '平台发布'" variant="light" class="tenant-tag supplier-publish">
                      外部供应商
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
                    <button
                      :class="[
                        'upload-box',
                        uploadState.mainImage && 'uploaded',
                        submitAttempted && !uploadState.mainImage && 'error',
                      ]"
                      type="button"
                      @click="simulateUpload('mainImage')"
                    >
                      <span class="required-star">*</span>
                      <t-icon :name="uploadState.mainImage ? 'check-circle' : 'add'" />
                      <strong>商品主图</strong>
                      <span>{{
                        uploadState.mainImage ? '已上传图片' : submitAttempted ? '请上传图片' : '点击上传图片'
                      }}</span>
                    </button>
                    <button
                      :class="[
                        'upload-box',
                        uploadState.video && 'uploaded',
                        submitAttempted && !uploadState.video && 'error',
                      ]"
                      type="button"
                      @click="simulateUpload('video')"
                    >
                      <span class="required-star">*</span>
                      <t-icon :name="uploadState.video ? 'check-circle' : 'add'" />
                      <strong>商品视频</strong>
                      <span>{{
                        uploadState.video ? '已上传视频' : submitAttempted ? '请上传视频' : '点击上传视频'
                      }}</span>
                    </button>
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
                      <t-form-item label="商家编码">
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
                          <button class="spec-thumb" type="button" @click="simulateSpecImageUpload(row, 'spec')">
                            <t-icon :name="row.specImage ? 'image' : 'add'" />
                          </button>
                          <span>{{ row.specText || '-' }}</span>
                        </div>
                      </template>
                      <template #material="{ row }">
                        <t-select v-if="row.mode === 'single'" v-model="row.material" placeholder="请选择">
                          <t-option v-for="item in materialOptions" :key="item" :label="item" :value="item" />
                        </t-select>
                        <div v-else class="spec-name-cell">
                          <button
                            v-if="isConfirmedImageField('material')"
                            class="spec-thumb mini"
                            type="button"
                            @click="simulateSpecImageUpload(row, 'material')"
                          >
                            <t-icon :name="row.materialImage ? 'image' : 'add'" />
                          </button>
                          <span>{{ row.material || '-' }}</span>
                        </div>
                      </template>
                      <template #length="{ row }">
                        <div class="spec-name-cell">
                          <button
                            v-if="isConfirmedImageField('length')"
                            class="spec-thumb mini"
                            type="button"
                            @click="simulateSpecImageUpload(row, 'length')"
                          >
                            <t-icon :name="row.lengthImage ? 'image' : 'add'" />
                          </button>
                          <span>{{ row.length || '-' }}</span>
                        </div>
                      </template>
                      <template #color="{ row }">
                        <div class="spec-name-cell">
                          <button
                            v-if="isConfirmedImageField('color')"
                            class="spec-thumb mini"
                            type="button"
                            @click="simulateSpecImageUpload(row, 'color')"
                          >
                            <t-icon :name="row.colorImage ? 'image' : 'add'" />
                          </button>
                          <span>{{ row.color || '-' }}</span>
                        </div>
                      </template>
                      <template #size="{ row }">
                        <div class="spec-name-cell">
                          <button
                            v-if="isConfirmedImageField('size')"
                            class="spec-thumb mini"
                            type="button"
                            @click="simulateSpecImageUpload(row, 'size')"
                          >
                            <t-icon :name="row.sizeImage ? 'image' : 'add'" />
                          </button>
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
                      <template #guide="{ row }">
                        <div class="price-pair">
                          <t-input
                            v-model="row.guideCoefficient"
                            placeholder="系数"
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

    <t-dialog
      v-model:visible="categoryDialogVisible"
      header="选择商品分类"
      width="760px"
      placement="center"
      confirm-btn="确认，下一步"
      cancel-btn="取消"
      @confirm="confirmCategory"
      @cancel="closeCategoryDialog"
      @close="closeCategoryDialog"
    >
      <div class="category-picker">
        <div v-for="(column, columnIndex) in categoryColumns" :key="columnIndex" class="category-column">
          <button
            v-for="item in column"
            :key="item"
            type="button"
            :class="['category-option', categorySelection[columnIndex] === item && 'active']"
            @click="selectCategory(columnIndex, item)"
          >
            <span>{{ item }}</span>
            <t-icon v-if="columnIndex < 2" name="chevron-right" />
          </button>
        </div>
      </div>
    </t-dialog>

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
              <button class="spec-upload-box small" type="button" title="上传图片" @click="item.imageUploaded = true">
                <t-icon :name="item.imageUploaded ? 'image' : 'add'" />
              </button>
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
              <t-checkbox
                :model-value="group.withImage"
                :disabled="isSpecImageGroupDisabled(group)"
                @change="(checked: boolean) => toggleSpecImageGroup(group, checked)"
              >
                添加图片
              </t-checkbox>
            </div>
            <div v-for="(value, index) in group.values" :key="value.id" class="layered-value-row">
              <button
                v-if="group.withImage"
                class="spec-upload-box small"
                type="button"
                @click="value.imageUploaded = true"
              >
                <t-icon :name="value.imageUploaded ? 'image' : 'add'" />
              </button>
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
                    placeholder="系数"
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
                    placeholder="系数"
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
                    placeholder="系数"
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
                    placeholder="系数"
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
              placeholder="系数"
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
              placeholder="系数"
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
              placeholder="系数"
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
              placeholder="系数"
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
      :header="reasonState.type === 'reject' ? '驳回' : '下架'"
      width="520px"
      placement="center"
      confirm-btn="提交"
      cancel-btn="取消"
      @confirm="submitReason"
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

    <t-dialog
      v-model:visible="detailDialogVisible"
      header="商品详情"
      width="760px"
      placement="center"
      :footer="false"
      @close="closeDetailDialog"
    >
      <div v-if="detailProduct" class="detail-panel">
        <img :src="detailProduct.image" :alt="detailProduct.name" />
        <div class="detail-info">
          <h2>{{ detailProduct.name }}</h2>
          <p>ID：{{ detailProduct.id }} ｜ 编码：{{ detailProduct.code }}</p>
          <p>分类：{{ detailProduct.category }} ｜ 库存：{{ activeTab === 'soldOut' ? 0 : detailProduct.stock }}</p>
          <p>租户/门店：{{ detailProduct.tenant }} / {{ detailProduct.store }}</p>
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
import { adminFeedback, AdminConfirmDialog, AdminPagination } from '@/components/foundation';
import {
  createFinishedProduct,
  deleteFinishedProduct,
  listFinishedProducts,
  updateFinishedProduct,
  type FinishedProductPayload,
  type FinishedProductRecord,
} from '@/services/finishedProducts';
import {
  createInventoryMovement,
  listInventoryMovements,
  type InventoryMovementRecord,
  type MovementType,
} from '@/services/inventoryMovements';
import { listProductCategories, type ProductCategoryRecord } from '@/services/productCategories';
import { listSuppliers, type SupplierRecord } from '@/services/suppliers';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
type StockStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';
type PublisherType = '租户发布' | '平台发布';
type RowAction = 'shelf' | 'edit' | 'reject' | 'delete' | 'offShelf' | 'restore' | 'purge' | 'movement';
type BatchAction = 'publish' | 'batchShelf' | 'batchOffShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';
type FormTabKey = 'description' | 'base' | 'sales';
type UploadTarget = 'mainImage' | 'video' | 'attributeImage';
type SpecMode = 'single' | 'layered';
type LayeredSpecField = 'material' | 'length' | 'color' | 'size';
type SpecImageField = 'spec' | LayeredSpecField;
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
  'shelf' | 'delete' | 'restore' | 'purge' | 'reject' | 'batchShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';
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
  tenant: string;
  store: string;
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
  tenant: string;
  store: string;
  publisherType: PublisherType;
  isExternalSupplier: boolean;
  guidePrice?: number;
  priceRange: string;
  status: StockStatus;
  offShelfReason?: string;
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

const categoryCascaderOptions: CategoryCascaderOption[] = [
  {
    label: '家具',
    value: '家具',
    children: [
      {
        label: '餐桌',
        value: '家具 / 餐桌',
        children: [
          { label: '奢石餐桌', value: '家具 / 餐桌 / 奢石餐桌' },
          { label: '岩板餐桌', value: '家具 / 餐桌 / 岩板餐桌' },
          { label: '圆桌', value: '家具 / 餐桌 / 圆桌' },
        ],
      },
      {
        label: '茶几',
        value: '家具 / 茶几',
        children: [
          { label: '岩板茶几', value: '家具 / 茶几 / 岩板茶几' },
          { label: '圆几', value: '家具 / 茶几 / 圆几' },
          { label: '组合茶几', value: '家具 / 茶几 / 组合茶几' },
        ],
      },
      {
        label: '边柜',
        value: '家具 / 边柜',
        children: [
          { label: '玄关柜', value: '家具 / 边柜 / 玄关柜' },
          { label: '餐边柜', value: '家具 / 边柜 / 餐边柜' },
          { label: '电视柜', value: '家具 / 边柜 / 电视柜' },
        ],
      },
    ],
  },
  {
    label: '软装',
    value: '软装',
    children: [
      {
        label: '地毯',
        value: '软装 / 地毯',
        children: [
          { label: '标准款', value: '软装 / 地毯 / 标准款' },
          { label: '设计师款', value: '软装 / 地毯 / 设计师款' },
        ],
      },
      {
        label: '摆件',
        value: '软装 / 摆件',
        children: [
          { label: '石材摆件', value: '软装 / 摆件 / 石材摆件' },
          { label: '金属摆件', value: '软装 / 摆件 / 金属摆件' },
        ],
      },
    ],
  },
  {
    label: '整装套餐',
    value: '整装套餐',
    children: [
      {
        label: '客餐厅',
        value: '整装套餐 / 客餐厅',
        children: [
          { label: '轻奢套餐', value: '整装套餐 / 客餐厅 / 轻奢套餐' },
          { label: '现代套餐', value: '整装套餐 / 客餐厅 / 现代套餐' },
        ],
      },
      {
        label: '全屋',
        value: '整装套餐 / 全屋',
        children: [
          { label: '标准套餐', value: '整装套餐 / 全屋 / 标准套餐' },
          { label: '定制套餐', value: '整装套餐 / 全屋 / 定制套餐' },
        ],
      },
    ],
  },
];

const tenantOptions = ['杭州云栖装饰', '平台自营', '南山设计中心', '云石供应链', '外部精品供应商'];
const storeOptions = ['杭州旗舰店', '深圳体验店', '上海设计中心', '云浮仓', '平台仓'];
const fallbackSupplierOptions = ['云石供应链', '平台自营', '星河矿业', '南山石材', '外部精品供应商'];
const pageSizeOptions = [10, 20, 50];
const rejectReasons = ['图片不清晰', '资料不完整', '规格填写异常', '价格信息缺失'];
const offShelfReasons = ['库存异常', '价格调整', '图片更新', '供应商申请'];
const materialOptions = ['鱼肚白', '雪花白', '爵士白', '劳伦黑金', '潘多拉'];
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
const selectedCategoryPath = ref('家具 > 餐桌 > 奢石餐桌');
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
const uploadState = reactive({
  mainImage: false,
  video: false,
});
const productCategories = ref<ProductCategoryRecord[]>([]);
const productSuppliers = ref<SupplierRecord[]>([]);
const dataItems = ref<StockItem[]>([]);

const defaultFilter = (): FilterState => ({
  id: '',
  name: '',
  category: '',
  tenant: '',
  store: '',
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

const attributeFields: { key: string; label: string; type: 'input' | 'select'; options?: string[] }[] = [
  { key: 'brand', label: '品牌', type: 'select', options: ['装点猫', '华中石业', '国庆奢石家居', '卓越五金'] },
  { key: 'model', label: '型号', type: 'input' },
  { key: 'style', label: '风格', type: 'select', options: ['现代轻奢', '新中式', '极简', '法式'] },
  { key: 'shape', label: '款式', type: 'select', options: ['圆角矩形', '圆形', '椭圆形', '方形'] },
  { key: 'material', label: '桌面材质', type: 'select', options: ['大理石', '岩板', '奢石', '石英石'] },
  { key: 'craftTexture', label: '工艺/纹理', type: 'select', options: ['水刀拼花', '直纹', '山水纹', '细纹'] },
  { key: 'layers', label: '层数', type: 'select', options: ['单层', '双层'] },
  { key: 'functionText', label: '功能', type: 'input' },
  { key: 'waterproof', label: '防水防污', type: 'select', options: ['支持', '不支持'] },
  { key: 'loadBearing', label: '承重能力', type: 'input' },
  { key: 'origin', label: '产地', type: 'input' },
  { key: 'installDesc', label: '安装说明详情', type: 'input' },
];

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

const categorySelection = ref(['家具', '餐桌', '奢石餐桌']);
const categoryColumns = computed(() => [
  ['家具', '软装', '整装套餐'],
  categorySelection.value[0] === '家具' ? ['餐桌', '茶几', '边柜'] : ['地毯', '摆件', '灯具'],
  categorySelection.value[1] === '餐桌' ? ['奢石餐桌', '岩板餐桌', '圆桌'] : ['标准款', '设计师款', '定制款'],
]);

const reasonState = reactive<{ type: 'reject' | 'offShelf'; product: StockItem | null; isBatch: boolean }>({
  type: 'reject',
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
    reject: '驳回',
    batchShelf: '批量上架',
    batchRestore: '批量恢复',
    batchPurge: '批量彻底删除',
    clearRecycle: '清空回收站',
  };
  return actionMap[confirmState.type];
});

const createStoneImage = (seed: number) => {
  const palettes = [
    ['#f8fafc', '#c9d4df', '#52677f'],
    ['#fff7ed', '#d6a06f', '#56606d'],
    ['#ecfeff', '#9eb7b8', '#1f2937'],
    ['#f5f3ff', '#c4b5fd', '#57534e'],
    ['#fef2f2', '#fca5a5', '#57534e'],
  ];
  const [start, middle, end] = palettes[seed % palettes.length];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${start}"/>
          <stop offset="0.52" stop-color="${middle}"/>
          <stop offset="1" stop-color="${end}"/>
        </linearGradient>
      </defs>
      <rect width="180" height="180" rx="14" fill="url(#bg)"/>
      <path d="M-8 42 C34 18 58 62 96 40 C132 20 146 36 188 12" fill="none" stroke="#fff" stroke-opacity=".48" stroke-width="8"/>
      <path d="M-12 126 C28 94 72 144 112 108 C142 82 164 102 192 76" fill="none" stroke="#fff" stroke-opacity=".34" stroke-width="7"/>
      <path d="M18 184 C54 126 86 164 112 126 C134 94 158 112 176 86" fill="none" stroke="#172033" stroke-opacity=".16" stroke-width="5"/>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const supplierOptions = computed(() => {
  const remoteOptions = productSuppliers.value
    .filter((supplier) => supplier.status !== 'disabled')
    .map((supplier) => supplier.name);
  return remoteOptions.length ? remoteOptions : fallbackSupplierOptions;
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

const normalizePublisherType = (type?: string): PublisherType => (type === '租户发布' ? '租户发布' : '平台发布');

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

const categoryIdByPath = (path: string) => {
  const leafName = path
    .split(/[>/]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1);
  const matched = productCategories.value.find(
    (category) => category.scope === 'finished' && category.name === leafName && category.status !== 'disabled',
  );
  return matched?.id ?? productCategories.value.find((category) => category.scope === 'finished')?.id;
};

const supplierNameById = (supplierId?: number) =>
  productSuppliers.value.find((supplier) => supplier.id === supplierId)?.name ?? '平台自营';

const supplierIdByName = (name: string) =>
  productSuppliers.value.find((supplier) => supplier.name === name && supplier.status !== 'disabled')?.id ??
  productSuppliers.value.find((supplier) => supplier.type === 'finished' && supplier.status !== 'disabled')?.id;

const formatPriceRange = (guidePrice?: number) => {
  const value = Number(guidePrice ?? 0);
  return value > 0 ? `￥${value.toFixed(2)}` : '-';
};

const toStockItem = (record: FinishedProductRecord, index: number): StockItem => {
  const status = normalizeStatus(record.status);
  const publisherType = normalizePublisherType(record.publisherType);
  return {
    id: record.id,
    code: record.sku,
    image: record.coverImage || createStoneImage(Number(record.id || index)),
    name: record.name,
    categoryId: record.categoryId,
    supplierId: record.supplierId,
    category: categoryPathById(record.categoryId),
    stock: status === 'soldOut' ? 0 : (record.totalStock ?? 0),
    tenant: supplierNameById(record.supplierId),
    store: publisherType === '平台发布' ? '平台仓' : '门店仓',
    publisherType,
    isExternalSupplier: Boolean(record.supplierId),
    guidePrice: record.guidePrice,
    priceRange: formatPriceRange(record.guidePrice),
    status,
  };
};

const toProductPayload = (item: StockItem, patch: Partial<StockItem> = {}): FinishedProductPayload => {
  const nextItem = { ...item, ...patch };
  return {
    categoryId: nextItem.categoryId,
    supplierId: nextItem.supplierId,
    name: nextItem.name,
    sku: nextItem.code,
    coverImage: nextItem.image,
    publisherType: nextItem.publisherType,
    totalStock: nextItem.stock,
    guidePrice: nextItem.guidePrice,
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
    const [categories, suppliers, products] = await Promise.all([
      listProductCategories(),
      listSuppliers(),
      listFinishedProducts(),
    ]);
    productCategories.value = categories;
    productSuppliers.value = suppliers;
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
const formEditorCover = computed(
  () => editingProduct.value?.image || (uploadState.mainImage ? dataItems.value[0]?.image : ''),
);

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
    if ((activeTab.value === 'offShelf' || activeTab.value === 'recycle') && item.publisherType !== '平台发布') {
      return false;
    }
    if (filter.id && !String(item.id).includes(filter.id)) return false;
    if (filter.name && !item.name.includes(filter.name)) return false;
    if (filter.category && item.category !== filter.category) return false;
    if (filter.tenant && item.tenant !== filter.tenant) return false;
    if (filter.store && item.store !== filter.store) return false;
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
    { colKey: 'tenant', title: '租户/门店', width: 210 },
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
    { colKey: 'guide', title: '指导价*', width: 150 },
    { colKey: 'level1', title: '1级合伙人价格*', width: 160 },
    { colKey: 'level2', title: '2级合伙人价格*', width: 160 },
    { colKey: 'level3', title: '3级合伙人价格*', width: 160 },
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

const tabLabel = (tab: TabConfig) => `${tab.label}（${countByStatus.value[tab.value]}）`;

const publisherTagClass = (type: PublisherType) => {
  if (type === '租户发布') return 'tenant-publish';
  if (type === '平台发布') return 'platform-publish';
  return 'platform-publish';
};

const withMovementAction = (actions: { action: RowAction; label: string; theme: string }[]) => [
  ...actions,
  { action: 'movement' as const, label: '流水', theme: 'primary' },
];

const rowActions = (row: StockItem): { action: RowAction; label: string; theme: string }[] => {
  if (activeTab.value === 'warehouse') {
    const lastAction =
      row.publisherType === '租户发布'
        ? { action: 'reject' as const, label: '驳回', theme: 'warning' }
        : { action: 'delete' as const, label: '删除', theme: 'danger' };
    return withMovementAction([
      { action: 'shelf', label: '上架', theme: 'primary' },
      { action: 'edit', label: '编辑', theme: 'primary' },
      lastAction,
    ]);
  }
  if (activeTab.value === 'selling') {
    if (row.publisherType === '租户发布') {
      return withMovementAction([
        { action: 'reject', label: '驳回', theme: 'warning' },
        { action: 'edit', label: '编辑', theme: 'primary' },
      ]);
    }
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
  if (action === 'reject') {
    openReasonDialog('reject', row, false);
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
    const records = await listInventoryMovements();
    movementRows.value = records
      .filter((item) => item.inventoryType === 'finished_product' && item.inventoryId === row.id)
      .sort((first, second) => {
        const firstTime = new Date(first.createdAt ?? '').getTime();
        const secondTime = new Date(second.createdAt ?? '').getTime();
        return (Number.isNaN(secondTime) ? 0 : secondTime) - (Number.isNaN(firstTime) ? 0 : firstTime);
      });
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
  categoryDialogVisible.value = true;
};

const closeCategoryDialog = () => {
  categoryDialogVisible.value = false;
};

const selectCategory = (columnIndex: number, item: string) => {
  const next = [...categorySelection.value];
  next[columnIndex] = item;
  if (columnIndex === 0) {
    next[1] = item === '家具' ? '餐桌' : '地毯';
    next[2] = item === '家具' ? '奢石餐桌' : '标准款';
  }
  if (columnIndex === 1) {
    next[2] = item === '餐桌' ? '奢石餐桌' : '标准款';
  }
  categorySelection.value = next;
};

const confirmCategory = () => {
  selectedCategoryPath.value = categorySelection.value.join(' > ');
  closeCategoryDialog();
  openFormPage('create');
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
  guideCoefficient: '',
  guide: '',
  level1Coefficient: '',
  level1: '',
  level2Coefficient: '',
  level2: '',
  level3Coefficient: '',
  level3: '',
  quantity: 0,
  merchantCode: '',
  ...partial,
});

const createEditSpecRows = (row: StockItem): SpecRow[] => [
  createBaseSpecRow({
    id: row.id * 10 + 1,
    mode: 'layered',
    material: '鱼肚白',
    length: '1200mm',
    color: '白色系',
    size: '1500*800*750mm',
    costCoefficient: '1',
    cost: '1800',
    guideCoefficient: '1.2',
    guide: '2680',
    level1Coefficient: '1.1',
    level1: '2480',
    level2Coefficient: '1.05',
    level2: '2280',
    level3Coefficient: '1',
    level3: '2080',
    quantity: Math.max(0, Math.ceil(row.stock / 2)),
    merchantCode: `${row.code}-01`,
  }),
  createBaseSpecRow({
    id: row.id * 10 + 2,
    mode: 'layered',
    material: '雪花白',
    length: '1400mm',
    color: '浅灰系',
    size: '1600*850*750mm',
    costCoefficient: '1',
    cost: '2200',
    guideCoefficient: '1.2',
    guide: '3280',
    level1Coefficient: '1.1',
    level1: '3080',
    level2Coefficient: '1.05',
    level2: '2880',
    level3Coefficient: '1',
    level3: '2680',
    quantity: Math.max(0, row.stock - Math.ceil(row.stock / 2)),
    merchantCode: `${row.code}-02`,
  }),
];

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
  uploadState.mainImage = false;
  uploadState.video = false;
  if (row) {
    productForm.name = row.name;
    productForm.merchantCode = row.code;
    productForm.totalStock = row.stock;
    productForm.supplier = row.publisherType === '平台发布' ? '平台自营' : row.tenant;
    productForm.shelfNow = row.status === 'selling' ? 'now' : 'later';
    productForm.brand = '装点猫甄选';
    productForm.style = '现代轻奢';
    productForm.material = '大理石';
    productForm.detail = '天然奢石纹理，适配门店、设计师和 C 端客户选品场景。';
    selectedCategoryPath.value = row.category.replaceAll('/', ' > ');
    specRows.value = createEditSpecRows(row);
    confirmedSpecMode.value = 'layered';
    confirmedLayeredFields.value = ['material', 'color', 'size', 'length'];
    confirmedImageField.value = null;
    priceRows.value = specRows.value.map(specToPriceRow);
    uploadState.mainImage = true;
    uploadState.video = true;
  }
};

const closeFormPage = () => {
  formPageVisible.value = false;
  editingProduct.value = null;
  if (route.path === '/finished-stock-management' && Object.keys(route.query).length) {
    router.replace({ path: '/finished-stock-management' });
  }
};

const simulateUpload = (target: UploadTarget) => {
  const labelMap: Record<UploadTarget, string> = {
    mainImage: '商品主图',
    video: '商品视频',
    attributeImage: '属性图片',
  };
  if (target === 'mainImage' || target === 'video') {
    uploadState[target] = true;
  }
  adminFeedback.success(`${labelMap[target]}已选择占位资源`);
};

const simulateSpecImageUpload = (row: SpecRow, field: SpecImageField) => {
  const key = `${field}Image` as 'specImage' | 'materialImage' | 'lengthImage' | 'colorImage' | 'sizeImage';
  row[key] = true;
  adminFeedback.success('规格图片已选择占位资源');
};

const isConfirmedImageField = (field: LayeredSpecField) => confirmedImageField.value === field;

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

const isSpecImageGroupDisabled = (group: SpecGroup) =>
  Boolean(selectedImageGroup.value && selectedImageGroup.value !== group);

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

const toggleSpecImageGroup = (group: SpecGroup, checked: boolean) => {
  if (checked && isSpecImageGroupDisabled(group)) return;
  specGroups.forEach((item) => {
    item.withImage = item === group ? checked : false;
    if (item !== group) {
      item.values.forEach((value) => {
        value.imageUploaded = false;
      });
    }
  });
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
    priceRows.value = [
      {
        id: row.id,
        mode: 'layered',
        specText: row.name,
        material: '鱼肚白',
        length: '1200mm',
        color: '白色系',
        size: '1500*800*750mm',
        merchantCode: row.code,
        stock: row.stock,
        costCoefficient: '1',
        cost: '1800',
        guideCoefficient: '1.2',
        guide: '2680',
        level1Coefficient: '1.1',
        level1: '2480',
        level2Coefficient: '1.05',
        level2: '2280',
        level3Coefficient: '1',
        level3: '2080',
      },
    ];
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
  const checks: { valid: boolean; tab: FormTabKey; message: string }[] = [
    { valid: uploadState.mainImage, tab: 'description', message: '请上传商品主图' },
    { valid: uploadState.video, tab: 'description', message: '请上传商品视频' },
    { valid: Boolean(productForm.detail.trim()), tab: 'description', message: '请输入宝贝详情' },
    { valid: Boolean(productForm.name.trim()), tab: 'base', message: '请输入商品名称' },
    { valid: specRows.value.length > 0, tab: 'sales', message: '请创建销售规格' },
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
  const guidePrice = Number(specRows.value.find((row) => row.guide)?.guide || 0);
  const status = productForm.shelfNow === 'now' ? 'selling' : 'warehouse';
  return {
    categoryId: categoryIdByPath(selectedCategoryPath.value),
    supplierId: supplierIdByName(productForm.supplier),
    name: productForm.name.trim(),
    sku: productForm.merchantCode.trim() || `FP-${Date.now()}`,
    coverImage: editingProduct.value?.image || (uploadState.mainImage ? createStoneImage(Date.now()) : undefined),
    publisherType: '平台发布',
    totalStock: stock,
    guidePrice: guidePrice > 0 ? guidePrice : undefined,
    status,
  };
};

const upsertStockItem = (record: FinishedProductRecord, offShelfReason?: string) => {
  const nextItem = toStockItem(record, dataItems.value.length);
  nextItem.offShelfReason = offShelfReason;
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

const openReasonDialog = (type: 'reject' | 'offShelf', product: StockItem | null, isBatch: boolean) => {
  reasonState.type = type;
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
    if (reasonState.type === 'reject' && reasonState.product) {
      await updateProductStatus(reasonState.product.id, 'offShelf', reasonForm.reason || '平台驳回');
      adminFeedback.success('商品已驳回');
      return;
    }
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
    } else if (type === 'reject' && product) {
      await updateProductStatus(product.id, 'offShelf', reasonForm.reason || '平台驳回');
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

.tenant-tag {
  width: fit-content;
  max-width: 100%;
}

.tenant-publish {
  color: #1664ff;
  background: #eef5ff;
}

.platform-publish {
  color: #0f7b3b;
  background: #effaf3;
}

.supplier-publish {
  color: #b45309;
  background: #fff7ed;
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
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  min-height: 280px;
}

.category-column {
  padding: 8px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.category-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 38px;
  padding: 0 10px;
  color: #374151;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
}

.category-option.active {
  color: #1664ff;
  background: #eef5ff;
  font-weight: 700;
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
