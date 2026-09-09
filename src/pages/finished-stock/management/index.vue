<template>
  <div class="admin-layout">
    <AdminTopNav />

    <div class="admin-shell">
      <AdminSideMenu />

      <main class="page">
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

            <t-form :data="currentFilter" label-width="44px" colon>
              <div class="filter-row">
                <div class="filter-fields">
                  <t-form-item label="商品">
                    <t-input
                      v-model="currentFilter.keyword"
                      clearable
                      placeholder="商品名称 / ID / 编码"
                      @enter="handleSearch"
                    />
                  </t-form-item>
                  <t-form-item label="商品分类" label-width="72px">
                    <t-cascader
                      v-model="currentFilter.category"
                      :options="categoryCascaderOptions"
                      clearable
                      :check-strictly="false"
                      placeholder="请选择"
                      trigger="hover"
                    />
                  </t-form-item>
                  <t-form-item label="供应商" label-width="60px">
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
                  <span>{{ row.supplier }}</span>
                  <!-- TODO(warehouse-management): 仓库模块补全后改为展示商品关联的真实仓库，当前临时显示平台仓。 -->
                  <span class="store-text">平台仓</span>
                </div>
              </template>
              <template #createdAt="{ row }">{{ formatDateTime(row.createdAt) }}</template>
              <template #stock="{ row }">
                <span>{{ activeTab === 'soldOut' ? 0 : row.stock }}</span>
              </template>
              <template #operation="{ row }">
                <div class="table-actions">
                  <t-link theme="primary" hover="color" @click="openPriceDrawer('view', row)">价格</t-link>
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
            <AdminSectionCard class="form-heading-card" aria-label="发布商品信息">
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
            </AdminSectionCard>
            <AdminSectionCard id="finished-product-description" class="form-section" aria-label="图文描述">
              <h2 class="form-section-title">图文描述</h2>
              <t-form :data="productForm" label-width="116px" colon>
                <t-form-item label="商品主图" required-mark help="最多上传5张图片，第一张作为商品封面">
                  <div class="upload-grid">
                    <AdminMediaUpload
                      v-for="index in mainImageUploadIndexes"
                      :key="index"
                      v-model="mainImageSlots[index]"
                      :title="`商品主图${index + 1}`"
                      :show-title="false"
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

            <AdminSectionCard id="finished-product-base" class="form-section" aria-label="基础信息">
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
                    v-if="!specRows.length"
                    :theme="submitAttempted ? 'danger' : 'primary'"
                    variant="outline"
                    @click="openSpecDialog"
                  >
                    <template #icon><t-icon name="add" /></template>
                    创建规格
                  </t-button>
                  <div v-if="specRows.length" class="spec-table-block">
                    <t-table row-key="id" :data="specRows" :columns="specColumns" hover table-layout="fixed">
                      <template #specText="{ row }">
                        <div class="spec-name-cell">
                          <span>{{ row.specText || '-' }}</span>
                        </div>
                      </template>
                      <template v-for="field in salesAttributeFields" :key="field.key" #[field.key]="{ row }">
                        <t-select
                          v-if="field.type === 'select'"
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
                          @change="handleSpecCostChange(row, $event)"
                        />
                      </template>
                      <template
                        v-for="configuration in productPriceLevels"
                        #[`markup-${configuration.id}`]="{ row }"
                        :key="configuration.id"
                      >
                        <div class="partner-price-cell">
                          <div class="price-pair with-source">
                            <SpecPriceInput
                              v-model="row.markupPrices[configuration.id].coefficient"
                              placeholder="系数"
                              label="系数"
                              :submitted="submitAttempted"
                              @change="handleMarkupCoefficientChange(row, configuration.id, $event)"
                              @commit="markSpecPriceManual(row, configuration.id)"
                            />
                            <SpecPriceInput
                              v-model="row.markupPrices[configuration.id].price"
                              placeholder="价格"
                              label="价格"
                              :submitted="submitAttempted"
                              @change="handleMarkupPriceChange(row, configuration.id, $event)"
                              @commit="markSpecPriceManual(row, configuration.id)"
                            />
                            <PriceSourceToggle
                              :source="row.markupPrices[configuration.id].priceSource"
                              :available="
                                Boolean(configuration.configurationId) && configuration.priceCoefficient != null
                              "
                              @toggle="toggleSpecPriceSource(row, configuration.id)"
                            />
                          </div>
                        </div>
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
                </t-form-item>
                <t-form-item label="总库存">
                  <t-input-number :model-value="totalStock" theme="normal" :min="0" disabled />
                </t-form-item>
                <t-form-item label="商家编码" required-mark>
                  <t-input
                    v-model="productForm.merchantCode"
                    :status="requiredFieldStatus(productForm.merchantCode)"
                    clearable
                    placeholder="请输入"
                    :maxlength="60"
                  />
                </t-form-item>
                <t-form-item label="上架" required-mark :status="requiredFieldStatus(productForm.shelfNow)">
                  <t-radio-group v-model="productForm.shelfNow">
                    <t-radio value="now">立刻上架</t-radio>
                    <t-radio value="later">暂不上架</t-radio>
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
              :class="['spec-attr-tag', group.selected && 'active']"
              @click="toggleSpecGroup(group)"
            >
              {{ group.name }}
            </button>
          </div>
          <div v-if="!specGroups.length" class="layered-empty">当前分类暂无已发布且参与 SKU 组合的销售属性</div>
          <div v-else-if="!selectedSpecGroups.length" class="layered-empty">请选择销售属性标签</div>
          <div v-for="group in selectedSpecGroups" :key="group.name" class="spec-group">
            <div class="spec-group-head">
              <div class="spec-group-title">
                <span v-if="salesAttributeByKey(group.field)?.required" style="color: var(--td-error-color)">* </span
                >{{ group.name }}
              </div>
            </div>
            <div v-for="(value, index) in group.values" :key="value.id" class="layered-value-row">
              <t-select
                v-if="salesAttributeByKey(group.field)?.type === 'select'"
                v-model="value.value"
                clearable
                placeholder="请选择属性值"
              >
                <t-option
                  v-for="item in salesAttributeByKey(group.field)?.options"
                  :key="item"
                  :label="item"
                  :value="item"
                />
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
    </AdminDialog>

    <t-drawer
      v-model:visible="priceDrawerVisible"
      :header="priceDrawerMode === 'view' ? '价格编辑器' : '批量填写'"
      placement="right"
      size="1180px"
      lazy
      destroy-on-close
      :footer="priceDrawerMode === 'view' && !['soldOut', 'recycle'].includes(priceEditorTarget?.status ?? '')"
      confirm-btn="保存"
      cancel-btn="取消"
      @confirm="productPriceEditorRef?.confirmSave()"
      @cancel="closePriceDrawer"
      @close="closePriceDrawer"
    >
      <div v-if="priceDrawerMode === 'batchFill'" class="drawer-head">
        <div>
          <strong>批量填写</strong>
          <span>按规格属性值圈定范围，再填写要覆盖的字段</span>
        </div>
        <t-button theme="primary" @click="savePriceDrawer">
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
                <SpecPriceInput
                  v-model="batchFillForm.cost"
                  placeholder="价格"
                  label="价格"
                  optional
                  :submitted="batchFillSubmitted"
                  @change="handleBatchCostChange"
                />
              </t-form-item>
              <t-form-item label="指导价">
                <div class="price-pair wide">
                  <SpecPriceInput
                    v-model="batchFillForm.guideCoefficient"
                    placeholder="系数"
                    label="系数"
                    optional
                    :submitted="batchFillSubmitted"
                    @change="handleBatchCoefficientChange('guideCoefficient', 'guide', $event)"
                  />
                  <SpecPriceInput
                    v-model="batchFillForm.guide"
                    placeholder="价格"
                    label="价格"
                    optional
                    :submitted="batchFillSubmitted"
                    @change="handleBatchPriceChange('guide', 'guideCoefficient', $event)"
                  />
                </div>
              </t-form-item>
              <t-form-item
                v-for="configuration in productPriceLevels"
                :key="configuration.id"
                :label="configuration.name"
              >
                <div class="price-pair wide">
                  <SpecPriceInput
                    v-model="batchMarkupPrices[configuration.id].coefficient"
                    placeholder="系数"
                    label="系数"
                    optional
                    :submitted="batchFillSubmitted"
                    @change="handleBatchMarkupChange(configuration.id, 'coefficient', $event)"
                  />
                  <SpecPriceInput
                    v-model="batchMarkupPrices[configuration.id].price"
                    placeholder="价格"
                    label="价格"
                    optional
                    :submitted="batchFillSubmitted"
                    @change="handleBatchMarkupChange(configuration.id, 'price', $event)"
                  />
                </div>
              </t-form-item>
              <t-form-item label="数量">
                <t-input-number v-model="batchFillForm.quantity" theme="normal" :min="0" />
              </t-form-item>
              <t-form-item v-for="field in salesAttributeFields" :key="field.key" :label="field.label">
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
              <t-form-item label="商家编码">
                <t-input v-model="batchFillForm.merchantCode" placeholder="请输入" />
              </t-form-item>
            </div>
          </section>
        </div>
      </template>

      <ProductPriceEditor
        v-else-if="priceEditorTarget"
        ref="productPriceEditorRef"
        :key="priceEditorTarget.id"
        :product-id="priceEditorTarget.id"
        :product="toProductPayload(priceEditorTarget)"
        :levels="productPriceLevels"
        @saved="handlePriceEditorSaved"
      />
      <template #footer>
        <div class="price-editor-footer">
          <t-button theme="primary" @click="productPriceEditorRef?.confirmSave()">保存</t-button>
          <t-button theme="default" @click="closePriceDrawer">取消</t-button>
        </div>
      </template>
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
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';
import AdminSideMenu from '@/components/AdminSideMenu.vue';
import AdminTopNav from '@/components/AdminTopNav.vue';
import ProductRichEditor from '@/components/ProductRichEditor.vue';
import PriceSourceToggle from './components/PriceSourceToggle.vue';
import SpecPriceInput from './components/SpecPriceInput.vue';
import ProductPriceEditor from './components/ProductPriceEditor.vue';
import { isValidSpecPriceNumber } from './priceValidation';
import {
  adminFeedback,
  AdminConfirmDialog,
  AdminDialog,
  AdminMediaUpload,
  AdminPagination,
  AdminSectionCard,
  type AdminMediaValue,
} from '@/components/foundation';
import {
  getFinishedGuidePriceSetting,
  listFinishedMarkupConfigurationOptions,
  type FinishedMarkupConfigurationRecord,
} from '@/services/finishedMarkupConfigurations';
import {
  createFinishedProduct,
  listFinishedProductPriceLevelOptions,
  type FinishedProductPriceLevelOption,
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
import { listProductCategories, type ProductCategoryRecord } from '@/services/productCategories';
import {
  listFinishedProductTemplateAttributes,
  type FinishedProductTemplateAttribute,
} from '@/services/finishedProducts';
import { listProductAttributes, type ProductAttributeRecord } from '@/services/productAttributes';
import { listProductAttributeValues, type ProductAttributeValueRecord } from '@/services/productAttributeValues';
import { listSuppliers, type SupplierRecord } from '@/services/suppliers';
import { sortByCreatedAtDesc } from '@/services/recordSorting';
import { computed, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
type StockStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';
type PublisherType = '平台发布';
type RowAction = 'shelf' | 'edit' | 'delete' | 'offShelf' | 'restore' | 'purge';
type BatchAction = 'publish' | 'batchShelf' | 'batchOffShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';
type FormSectionKey = 'description' | 'base' | 'sales';
type SpecMode = 'single' | 'layered';
type LayeredSpecField = 'material' | 'length' | 'color' | 'size' | `attribute_${number}`;
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
  keyword: string;
  category: string;
  supplier: string;
}

interface PaginationState {
  current: number;
  pageSize: number;
}

interface StockItem {
  id: number;
  createdByName: string;
  createdAt?: string;
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
  mainImageMediaIds?: number[];
  mainImageUrls?: string[];
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
  markupPrices: Record<
    number,
    { coefficient: string; price: string; priceSource?: 'auto' | 'manual'; sourceConfigurationId?: number }
  >;
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

const activeTab = ref<StockStatus>('warehouse');
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const saving = ref(false);
const selectedKeys = ref<number[]>([]);
const formPageVisible = ref(false);
const formPageMode = ref<ProductFormMode>('create');
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
const formSections: { key: FormSectionKey; label: string }[] = [
  { key: 'description', label: '图文描述' },
  { key: 'base', label: '基础信息' },
  { key: 'sales', label: '销售信息' },
];

const scrollToFormSection = (key: FormSectionKey) => {
  const section = document.getElementById(`finished-product-${key}`);
  if (!section) return;
  activeFormSection.value = key;
  const offset = formAnchorHeight.value + 16;
  window.scrollTo({
    top: Math.max(0, window.scrollY + section.getBoundingClientRect().top - offset),
    behavior: 'smooth',
  });
};

const categoryDialogVisible = ref(false);
const categorySwitchWarningVisible = ref(false);
const productMediaUploading = ref(0);
const specDialogVisible = ref(false);
const productPriceEditorRef = ref<InstanceType<typeof ProductPriceEditor>>();
const priceDrawerVisible = ref(false);
const reasonDialogVisible = ref(false);
const confirmDialogVisible = ref(false);
const detailDialogVisible = ref(false);
const imagePreviewVisible = ref(false);
const priceDrawerMode = ref<PriceDrawerMode>('batchFill');
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
const requiredFieldStatus = (value: unknown) =>
  submitAttempted.value && !String(value ?? '').trim() ? 'error' : undefined;
const mainImageSlots = ref<(AdminMediaValue | undefined)[]>(Array.from({ length: 5 }));
const mainImages = computed(() => mainImageSlots.value.filter((item): item is AdminMediaValue => Boolean(item)));
const mainImageUploadIndexes = computed(() => {
  const indexes = mainImageSlots.value.flatMap((image, index) => (image ? [index] : []));
  const emptyIndex = mainImageSlots.value.findIndex((image) => !image);
  if (emptyIndex !== -1) indexes.push(emptyIndex);
  return indexes;
});
const mainImageMedia = computed(() => mainImages.value[0]);
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

const productAttributeValues = ref<ProductAttributeValueRecord[]>([]);
const productSuppliers = ref<SupplierRecord[]>([]);
const markupConfigurations = ref<FinishedMarkupConfigurationRecord[]>([]);
const enabledPriceLevels = ref<FinishedProductPriceLevelOption[]>([]);
const productPriceLevels = computed(() => {
  const saved = editingProduct.value?.markupPrices ?? [];
  const levels = [...enabledPriceLevels.value]
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
  for (const price of saved) {
    if (!levels.some((level) => level.id === price.storeLevelId))
      levels.push({
        id: price.storeLevelId,
        configurationId: undefined,
        name: price.storeLevelName || `门店级别${price.storeLevelId}`,
        priceCoefficient: Number(price.priceCoefficient),
      });
  }
  return levels;
});
let priceConfigurationRefresh: Promise<void> | undefined;
const refreshPriceConfigurations = () => {
  if (!priceConfigurationRefresh)
    priceConfigurationRefresh = Promise.all([
      listFinishedMarkupConfigurationOptions(),
      getFinishedGuidePriceSetting(),
      listFinishedProductPriceLevelOptions(),
    ])
      .then(([configurations, guide, levels]) => {
        enabledPriceLevels.value = levels;
        markupConfigurations.value = configurations;
        guidePriceSettingCoefficient.value = guide?.priceCoefficient;
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
              if (cost !== null && editor.coefficient) editor.price = (cost * Number(editor.coefficient)).toFixed(2);
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
  merchantCode: '',
});

const batchFillForm = reactive<BatchFillForm>(createEmptyBatchFillForm());
const batchFillSubmitted = ref(false);
const batchSalesAttributes = ref<Record<string, string>>({});
const batchMarkupPrices = ref<Record<number, { coefficient: string; price: string }>>({});

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
const layeredFieldLabels = computed<Record<string, string>>(() =>
  Object.fromEntries(salesAttributeFields.value.map((field) => [field.key, field.label])),
);
const skuAttributeFields = computed(() =>
  salesAttributeFields.value.filter((field) =>
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
      ...fields.map((field) =>
        existing.has(field.key)
          ? { ...existing.get(field.key)!, name: field.label }
          : {
              field: field.key,
              name: field.label,
              selected: field.required,
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

const toStockItem = (record: FinishedProductRecord): StockItem => {
  const status = normalizeStatus(record.status);
  const publisherType = normalizePublisherType();
  return {
    id: record.id,
    code: record.sku,
    createdByName: record.createdByName?.trim() || '-',
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
    mainImageMediaIds: nextItem.mainImageMediaIds,
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

const loadInventoryData = async () => {
  loading.value = true;
  try {
    const [categories, attributes, attributeValues, suppliers, products, markupResult, guideSetting, bindings] =
      await Promise.all([
        listProductCategories(),
        listProductAttributes(),
        listProductAttributeValues(),
        listSuppliers(),
        listFinishedProducts(),
        listFinishedMarkupConfigurationOptions(),
        getFinishedGuidePriceSetting(),
        listFinishedProductTemplateAttributes(),
      ]);
    productCategories.value = categories;
    productAttributes.value = attributes;
    categoryAttributeBindings.value = bindings;
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
const detailMediaUploading = ref(false);

const handleMenuReselect = (event: Event) => {
  const detail = (event as CustomEvent<{ path?: string }>).detail;
  if (detail?.path === '/finished-stock-management') {
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
  return sortByCreatedAtDesc(dataItems.value).filter((item) => {
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
    { colKey: 'createdByName', title: '创建人', width: 120, align: 'center' },
    { colKey: 'createdAt', title: '创建时间', width: 180, align: 'center' },
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

const requiredColumnTitle = (label: string) => () =>
  h('span', [label, h('span', { class: 'spec-required-star', style: { color: 'var(--td-error-color)' } }, '*')]);

const specColumns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  const priceColumnsBase: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'cost', title: requiredColumnTitle('成本价'), width: 96 },
    { colKey: 'guide', title: requiredColumnTitle('指导价'), width: 164 },
    ...productPriceLevels.value.map((item) => ({
      colKey: `markup-${item.id}`,
      title: requiredColumnTitle(item.name),
      width: 196,
    })),
    { colKey: 'quantity', title: requiredColumnTitle('数量'), width: 96 },
  ];
  const tailColumns: PrimaryTableCol<TableRowData>[] = [
    { colKey: 'merchantCode', title: '商家编码', width: 130 },
    { colKey: 'operation', title: '操作', width: 80, align: 'left', fixed: 'right' },
  ];

  const salesColumns = salesAttributeFields.value.map<PrimaryTableCol<TableRowData>>((field) => ({
    colKey: field.key,
    title: field.required ? requiredColumnTitle(field.label) : field.label,
    width: 136,
  }));
  return [
    ...(confirmedSpecMode.value === 'single' ? [{ colKey: 'specText', title: '商品规格', width: 120 }] : []),
    ...priceColumnsBase,
    ...salesColumns,
    ...tailColumns,
  ];
});

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

const rowActions = (): { action: RowAction; label: string; theme: string }[] => {
  if (activeTab.value === 'warehouse') {
    return [
      { action: 'shelf', label: '上架', theme: 'primary' },
      { action: 'edit', label: '编辑', theme: 'primary' },
      { action: 'delete', label: '删除', theme: 'danger' },
    ];
  }
  if (activeTab.value === 'selling') {
    return [
      { action: 'offShelf', label: '下架', theme: 'warning' },
      { action: 'edit', label: '编辑', theme: 'primary' },
      { action: 'delete', label: '删除', theme: 'danger' },
    ];
  }
  if (activeTab.value === 'offShelf') {
    return [
      { action: 'restore', label: '放回到仓库', theme: 'primary' },
      { action: 'edit', label: '编辑', theme: 'primary' },
      { action: 'delete', label: '删除', theme: 'danger' },
    ];
  }
  if (activeTab.value === 'soldOut') {
    return [];
  }
  return [
    { action: 'restore', label: '放回到仓库', theme: 'primary' },
    { action: 'purge', label: '彻底删除', theme: 'danger' },
  ];
};

const handleTabChange = () => {
  selectedKeys.value = [];
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
    specGroups.some((group) => group.selected || group.values.some((item) => item.value.trim()))
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
    for (const key of Object.keys(productForm)) {
      if (key.startsWith('attribute_')) delete productForm[key];
    }
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
        ...variant.salesAttributes,
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
  activeFormSection.value = 'description';
  submitAttempted.value = false;
  Object.assign(productForm, createEmptyProductForm());
  specRows.value = [];
  priceRows.value = [];
  confirmedSpecMode.value = 'single';
  confirmedLayeredFields.value = [];
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
    confirmedLayeredFields.value = salesAttributeFields.value
      .map((field) => field.key)
      .filter((field) => row.variants.some((variant) => variant.salesAttributes?.[field]));
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
  if (route.path === '/finished-stock-management' && Object.keys(route.query).length) {
    router.replace({ path: '/finished-stock-management' });
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
  try {
    await refreshPriceConfigurations();
  } catch {
    adminFeedback.error('价格配置加载失败，请重试');
    return;
  }
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
    group.selected = salesAttributeByKey(group.field)?.required ?? false;
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
  if (salesAttributeByKey(group.field)?.required) return;
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
  const fields = specMode.value === 'single' ? ['specText'] : selectedSpecGroups.value.map((group) => group.field);
  const sameStructure =
    confirmedSpecMode.value === specMode.value &&
    (specMode.value === 'single' ||
      [...confirmedLayeredFields.value].sort().join('|') === [...fields].sort().join('|'));
  if (sameStructure) {
    const keyOf = (row: SpecRow) => JSON.stringify(fields.map((field) => String(row[field] ?? '').trim()));
    const existing = new Map<string, SpecRow[]>();
    for (const row of specRows.value) {
      const key = keyOf(row);
      existing.set(key, [...(existing.get(key) ?? []), row]);
    }
    rows.forEach((row, index) => {
      const previous = existing.get(keyOf(row))?.shift();
      if (previous)
        rows[index] = {
          ...previous,
          specImage: row.specImage,
          materialImage: row.materialImage,
          lengthImage: row.lengthImage,
          colorImage: row.colorImage,
          sizeImage: row.sizeImage,
        };
    });
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
  if (!normalizedGroups.length) return [];
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
      ...Object.fromEntries(Object.entries(combination).map(([key, item]) => [key, item?.value ?? ''])),
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
  ...Object.fromEntries(salesAttributeFields.value.map((field) => [field.key, row[field.key]])),
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

const priceEditorTarget = ref<StockItem | null>(null);
const handlePriceEditorSaved = (record: FinishedProductRecord, closeAfterSave = true) => {
  upsertStockItem(record);
  if (closeAfterSave) closePriceDrawer();
};
const openPriceDrawer = async (mode: PriceDrawerMode, row?: StockItem) => {
  if (mode === 'view' && row) {
    try {
      const [, products] = await Promise.all([refreshPriceConfigurations(), listFinishedProducts()]);
      const latest = products.find((product) => product.id === row.id);
      if (!latest) {
        adminFeedback.error('商品不存在，请刷新列表');
        return;
      }
      upsertStockItem(latest);
      priceEditorTarget.value = toStockItem(latest);
    } catch {
      adminFeedback.error('价格配置加载失败，请重试');
      return;
    }
  } else {
    resetBatchFillState();
  }
  priceDrawerMode.value = mode;
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
  if (priceDrawerMode.value === 'batchFill') {
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
              salesAttributeFields.value
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
      isValidSpecPriceNumber(row.cost) &&
      isValidSpecPriceNumber(row.guideCoefficient) &&
      isValidSpecPriceNumber(row.guide) &&
      Boolean(row.merchantCode.trim()) &&
      productPriceLevels.value.every((configuration) => {
        const editor = row.markupPrices[configuration.id];
        return isValidSpecPriceNumber(editor?.coefficient) && isValidSpecPriceNumber(editor?.price);
      }),
  );
  const checks: { valid: boolean; tab: FormSectionKey; message: string }[] = [
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
      valid: specRows.value.every((row) =>
        salesAttributeFields.value.every((field) => !field.required || String(row[field.key] ?? '').trim()),
      ),
      tab: 'sales',
      message: `请填写每条规格的${salesAttributeFields.value.find((field) => field.required && specRows.value.some((row) => !String(row[field.key] ?? '').trim()))?.label ?? '必填销售属性'}`,
    },
    {
      valid: editingProduct.value != null || guidePriceSettingCoefficient.value != null,
      tab: 'sales',
      message: '请先配置成品指导价默认系数',
    },
    { valid: pricesComplete, tab: 'sales', message: '请完善每条规格的成本价、指导价和商家编码' },
    { valid: Boolean(productForm.merchantCode.trim()), tab: 'sales', message: '请输入商家编码' },
    { valid: Boolean(productForm.shelfNow), tab: 'sales', message: '请选择上架方式' },
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
  salesAttributeFields.value
    .map((field) => String(row[field.key] ?? '').trim())
    .filter(Boolean)
    .join(' / ') ||
  row.merchantCode;

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
    mainImageMediaIds: mainImages.value.map((image) => image.mediaId!),
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
      variantLabel: specVariantLabel(row),
      displayMode: row.mode,
      salesAttributes: Object.fromEntries(
        salesAttributeFields.value.map((field) => [field.key, String(row[field.key] ?? '').trim()]),
      ),
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
      variantLabel: specVariantLabel(row),
    })),
    markupPrices: specRows.value.flatMap((row) =>
      productPriceLevels.value.map((configuration) => {
        const editor = row.markupPrices[configuration.id];
        return {
          storeLevelId: configuration.id,
          priceSource: editor.priceSource,
          sourceConfigurationId: editor.sourceConfigurationId,
          priceCoefficient: Number(Number(editor.coefficient).toFixed(4)),
          costPrice: Number(row.cost),
          price: Number(editor.price),
          variantKey: row.merchantCode.trim(),
          variantLabel: specVariantLabel(row),
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

const openProductMediaPreview = (media: AdminMediaValue | undefined, type: 'image' | 'video') => {
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

const updateProductStatus = async (id: number, status: StockStatus, reason?: string) => {
  const item = dataItems.value.find((product) => product.id === id);
  if (!item) return;
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
.table-card {
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
  gap: var(--td-comp-margin-m);
}

.filter-fields {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(290px, 1.6fr) repeat(2, minmax(170px, 1fr));
  gap: var(--td-comp-margin-m);
}

.filter-actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--td-comp-margin-s);
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

.image-preview-dialog img,
.image-preview-dialog video {
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

.product-code,
.store-text {
  color: #6b7280;
  font-size: 12px;
}

.table-actions {
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 10px;
}

.form-shell {
  display: grid;
  gap: var(--zdm-admin-section-gap);
}

.form-title-row {
  align-items: flex-start;
  justify-content: space-between;
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

.form-anchor-card {
  box-shadow:
    0 6px 18px rgb(0 0 0 / 24%),
    0 2px 4px rgb(0 0 0 / 16%);
  position: fixed;
  z-index: 10;
  box-sizing: border-box;
}

.form-heading-card,
.form-section {
  box-shadow: none;
}

.form-section {
  min-width: 0;
}

.required-content-error {
  border-color: var(--td-error-color);
}

.form-section-title {
  margin: 0 0 var(--td-comp-margin-xxl);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  text-align: left;
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

.supplier-form {
  margin-top: var(--td-comp-margin-xxl);
}

.product-attributes {
  display: grid;
  grid-template-columns: 116px minmax(0, 1fr);
  margin-top: var(--td-comp-margin-xxl);
}

.product-attributes-title {
  margin: 0;
  padding-right: var(--td-comp-paddingLR-xl);
  text-align: right;
  font: var(--td-font-body-medium);
  font-weight: 400;
  color: var(--td-text-color-primary);
}

.product-attributes-required {
  color: var(--td-error-color);
}

.product-attribute-label {
  font-size: 12px;
  color: var(--td-text-color-secondary);
}

.product-attributes-panel {
  min-width: 0;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-secondarycontainer);
  border-radius: var(--td-radius-medium);
}

.product-attributes-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--td-comp-margin-xl) var(--td-comp-margin-xxl);
}

.upload-grid {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(auto-fit, 180px);
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

.spec-table-block {
  width: 100%;
  min-width: 0;
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

.spec-table-actions {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  margin-top: var(--td-comp-margin-xxl);
}

.spec-name-cell {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.spec-name-cell > span {
  flex: 1;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
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
  align-items: start;
  grid-template-columns: 54px minmax(72px, 1fr);
  gap: 6px;
}

.price-pair.with-source {
  grid-template-columns: 54px minmax(72px, 1fr) 24px;
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
  box-shadow:
    0 -6px 18px rgb(0 0 0 / 24%),
    0 -2px 4px rgb(0 0 0 / 16%);
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: center;
  gap: 10px;
  z-index: 1;
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

.price-editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-comp-margin-s);
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
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px 28px;
}

.batch-field-grid > :deep(.t-form__item) {
  min-width: 0;
  margin-bottom: 0;
}

.batch-field-grid :deep(.t-form__label) {
  font-size: var(--td-font-size-body-small);
}

.batch-field-grid .price-pair.wide {
  width: 100%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.batch-field-grid :deep(.t-input-number) {
  max-width: 100%;
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
  .product-attributes-grid,
  .filter-fields,
  .form-grid.three {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
  }
}

@media (max-width: 860px) {
  .product-attributes {
    grid-template-columns: 1fr;
    gap: var(--td-comp-margin-m);
  }

  .product-attributes-grid {
    grid-template-columns: minmax(0, 1fr);
  }

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
