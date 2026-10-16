<template>
  <div ref="formAnchorSlot" :style="{ height: `${formAnchorHeight}px` }">
    <AdminSectionCard class="form-anchor-card" :style="formAnchorStyle">
      <nav ref="formAnchorNav" class="form-anchor-nav" aria-label="商品信息分区导航">
        <t-space size="large">
          <t-link
            v-for="section in formSections"
            :key="section.key"
            data-button-control="section-navigation"
            :href="`#store-finished-product-${section.key}`"
            :theme="activeFormSection === section.key ? 'primary' : 'default'"
            :aria-current="activeFormSection === section.key ? 'location' : undefined"
            @click.prevent="scrollToFormSection(section.key)"
            >{{ section.label }}</t-link
          >
        </t-space>
      </nav>
    </AdminSectionCard>
  </div>
  <section ref="productFormRoot" class="form-shell">
    <AdminSectionCard class="form-heading-card" aria-label="编辑商品信息">
      <div class="form-title-row">
        <div>
          <h1>编辑商品</h1>
          <div class="selected-category">平台分类：{{ product.categoryName || '—' }}</div>
        </div>
        <t-button :theme="buttonTheme('back')" variant="base" :disabled="saving" @click="emit('cancel')"
          ><template #icon><t-icon name="rollback" /></template>返回列表</t-button
        >
      </div>
    </AdminSectionCard>
    <div ref="readonlyFields" class="readonly-product-fields">
      <StoreProductDetail :product="product" editor-layout>
        <template #basic-extra>
          <t-form ref="formRef" class="supplier-form" :data="form" :rules="rules" label-width="100px" colon>
            <t-form-item label="门店分类" name="categoryId"
              ><t-cascader
                v-model="form.categoryId"
                :options="categoryOptions"
                trigger="hover"
                clearable
                placeholder="请选择门店分类"
                @change="changeCategory"
            /></t-form-item>
          </t-form>
        </template>
        <template #sales="{ rows, columns, span }">
          <AdminSectionCard id="store-finished-product-sales" class="form-section" aria-label="销售信息">
            <h2 class="form-section-title">销售信息</h2>
            <t-form :data="form" label-width="100px" colon>
              <t-form-item label="销售规格">
                <div class="spec-table-block">
                  <t-table
                    row-key="key"
                    :data="rows"
                    :columns="editorColumns(columns)"
                    :rowspan-and-colspan="span"
                    table-content-width="max-content"
                    bordered
                    hover
                    table-layout="auto"
                  >
                    <template #label="{ row }"
                      ><div class="spec-name-cell">
                        <span>{{ row.label || '—' }}</span>
                      </div></template
                    >
                    <template v-for="key in ['cost', 'guide']" :key="key" #[key]="{ row }">
                      <span>{{ readonlyPrice(row[key]) || '-' }}</span>
                    </template>
                    <template #stock="{ row }"
                      ><span>{{ row.stock ?? '-' }}</span></template
                    >
                    <template
                      v-for="column in columns.filter(
                        (item) => !['label', 'cost', 'guide', 'sale', 'stock'].includes(String(item.colKey)),
                      )"
                      :key="column.colKey"
                      #[String(column.colKey)]="{ row }"
                    >
                      <span class="readonly-spec-value">{{ row[String(column.colKey)] || '-' }}</span>
                    </template>
                    <template #sale="{ row }">
                      <div class="price-pair with-source">
                        <SpecPriceInput
                          v-if="drafts[row.skuId]"
                          v-model="drafts[row.skuId].coefficient"
                          class="store-sale-coefficient-input"
                          placeholder="请输入系数"
                          label="系数"
                          :submitted="submitted"
                          @change="editDraftCoefficient(drafts[row.skuId], $event, sku(row.skuId).costPrice)"
                        />
                        <SpecPriceInput
                          v-if="drafts[row.skuId]"
                          v-model="drafts[row.skuId].price"
                          class="decimal-input store-sale-price-input"
                          label="商品售价"
                          placeholder="请输入商品售价"
                          :submitted="submitted"
                          @change="editDraftPrice(drafts[row.skuId], $event, sku(row.skuId).costPrice)"
                        />
                        <PriceSourceToggle
                          v-if="drafts[row.skuId]"
                          :source="drafts[row.skuId].mode"
                          :available="canFollow(row.skuId)"
                          :readonly="drafts[row.skuId].mode === 'manual' && !canFollow(row.skuId)"
                          @toggle="toggleSource(row.skuId)"
                        />
                      </div>
                    </template>
                  </t-table>
                </div>
              </t-form-item>
              <t-form-item label="总库存"
                ><t-input-number :model-value="product.totalStock" theme="normal" :min="0" disabled
              /></t-form-item>
            </t-form>
          </AdminSectionCard>
        </template>
      </StoreProductDetail>
    </div>
    <AdminSectionCard class="form-submit-bar">
      <t-button :theme="buttonTheme('submit')" :loading="saving" @click="save"
        ><template #icon><t-icon name="check" /></template>{{ formConfirmationText('edit') }}</t-button
      >
      <t-button :theme="buttonTheme('cancel')" variant="base" :disabled="saving" @click="emit('cancel')">取消</t-button>
    </AdminSectionCard>
  </section>
</template>
<script setup lang="ts">
import { formConfirmationText } from '@/components/foundation/actions/confirmation';
import { buttonTheme } from '@/components/foundation/actions/buttonFunctions';
import { rejectFormSubmission } from '@/utils/submitValidation';
import { computed, onMounted, reactive, ref, watch, h } from 'vue';
import type { FormInstanceFunctions, PrimaryTableCol } from 'tdesign-vue-next';
import { AdminSectionCard, adminFeedback, getSafeErrorMessage } from '@/components/foundation';
import {
  listStoreFinishedEditCategories,
  saveStoreFinishedEdit,
  type StoreFinishedProduct,
  type StoreFinishedEditCategory,
} from '@/services/storeFinishedStock';
import StoreProductDetail from '../shared/StoreFinishedStockDetailAdapter.vue';
import SpecPriceInput from '../management/components/SpecPriceInput.vue';
import PriceSourceToggle from '../management/components/PriceSourceToggle.vue';
import { isValidSpecPriceNumber } from '../management/priceValidation';
import {
  calculateSalePrice,
  changeDraftCategory,
  createSalePriceDraft,
  editDraftPrice,
  editDraftCoefficient,
} from './salePriceDraft';
const props = defineProps<{ product: StoreFinishedProduct }>();
const emit = defineEmits<{ saved: [product: StoreFinishedProduct]; cancel: [] }>();
const formAnchorSlot = ref<HTMLElement>();
const formAnchorNav = ref<HTMLElement>();
const readonlyFields = ref<HTMLElement>();
const formAnchorHeight = ref(72);
const formAnchorStyle = ref({ left: '0px', width: '0px', top: '64px' });
const activeFormSection = ref('description');
const formSections = [
  { key: 'description', label: '图文描述' },
  { key: 'base', label: '基础信息' },
  { key: 'sales', label: '销售信息' },
];
function updateFormAnchorPosition() {
  const slot = formAnchorSlot.value;
  if (!slot) return;
  const rect = slot.getBoundingClientRect();
  const top = Math.max(0, document.querySelector('.top-nav')?.getBoundingClientRect().bottom ?? 0);
  formAnchorStyle.value = { left: `${rect.left}px`, width: `${rect.width}px`, top: `${top}px` };
  formAnchorHeight.value = formAnchorNav.value?.parentElement?.getBoundingClientRect().height ?? 72;
}
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
function scrollToFormSection(key: string) {
  const section =
    key === 'sales'
      ? document.getElementById('store-finished-product-sales')
      : readonlyFields.value?.querySelectorAll('.zdm-admin-section-card')[key === 'description' ? 0 : 1];
  if (!section) return;
  activeFormSection.value = key;
  updateFormAnchorPosition();
  const offset = Number.parseFloat(formAnchorStyle.value.top) + formAnchorHeight.value + 16;
  window.scrollTo({
    top: Math.max(0, window.scrollY + section.getBoundingClientRect().top - offset),
    behavior: 'smooth',
  });
}
function editorColumns(columns: PrimaryTableCol[]): PrimaryTableCol[] {
  return columns.map((column) => {
    if (column.colKey === 'label') return { ...column, minWidth: 100 };
    if (column.colKey === 'stock') return { ...column, title: '数量', minWidth: 80 };
    if (column.colKey === 'cost') return { ...column, minWidth: 80 };
    if (column.colKey === 'guide') return { ...column, minWidth: 148 };
    if (column.colKey === 'sale')
      return {
        ...column,
        minWidth: 176,
        title: () =>
          h('span', [
            '商品售价',
            h('span', { class: 'spec-required-star', style: { color: 'var(--td-error-color)' } }, '*'),
          ]),
      };
    return column;
  });
}
const readonlyPrice = (value: unknown) => (value == null || value === '—' ? '' : Number(value).toFixed(2));
const productFormRoot = ref<HTMLElement>();
const formRef = ref<FormInstanceFunctions>();
const form = reactive<{ categoryId?: number }>({ categoryId: props.product.storeCategoryId ?? undefined });
const rules = { categoryId: [{ required: true, message: '请选择门店分类', type: 'error' as const }] };
const categories = ref<StoreFinishedEditCategory[]>([]);
const drafts = reactive(Object.fromEntries(props.product.skus.map((sku) => [sku.skuId, createSalePriceDraft(sku)])));
const submitted = ref(false);
const saving = ref(false);
const ready = ref(false);
interface CategoryOption {
  label: string;
  value: number;
  disabled: boolean;
  children?: CategoryOption[];
}
const categoryOptions = computed(() => {
  const build = (parentId: number | null, parentEnabled: boolean, visited: Set<number>): CategoryOption[] =>
    categories.value
      .filter((item) => item.parentId === parentId && !visited.has(item.id))
      .map((item) => {
        const enabled = parentEnabled && item.status === 'enabled';
        const children = build(item.id, enabled, new Set([...visited, item.id]));
        return { label: item.name, value: item.id, disabled: !enabled, ...(children.length ? { children } : {}) };
      });
  return build(null, true, new Set());
});
const coefficient = computed(() => {
  const category = categories.value.find((item) => item.id === form.categoryId);
  if (!category || categories.value.some((item) => item.parentId === category.id)) return null;
  const seen = new Set<number>();
  for (
    let current: StoreFinishedEditCategory | undefined = category;
    current;
    current = categories.value.find((item) => item.id === current?.parentId)
  ) {
    if (current.status !== 'enabled' || seen.has(current.id)) return null;
    seen.add(current.id);
  }
  return category.coefficient;
});
const sku = (id: number) => props.product.skus.find((item) => item.skuId === id)!;
const canFollow = (id: number) => ready.value && coefficient.value != null && sku(id).costPrice != null;
function changeCategory() {
  props.product.skus.forEach((item) => changeDraftCategory(drafts[item.skuId], item, coefficient.value));
}
function toggleSource(id: number) {
  if (drafts[id].mode === 'auto') drafts[id].mode = 'manual';
  else if (canFollow(id)) {
    drafts[id].mode = 'auto';
    drafts[id].coefficient = String(coefficient.value);
    drafts[id].price = calculateSalePrice(sku(id).costPrice, coefficient.value);
  }
}
onMounted(async () => {
  try {
    categories.value = await listStoreFinishedEditCategories(props.product.id);
    ready.value = true;
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '门店分类加载失败'));
  }
});
async function save() {
  if (saving.value || !ready.value) return;
  submitted.value = true;
  if ((await formRef.value?.validate()) !== true) return rejectFormSubmission(productFormRoot.value);
  if (
    props.product.skus.some(
      (item) =>
        !isValidSpecPriceNumber(drafts[item.skuId].price) || !isValidSpecPriceNumber(drafts[item.skuId].coefficient),
    )
  )
    return rejectFormSubmission(productFormRoot.value);
  saving.value = true;
  try {
    const product = await saveStoreFinishedEdit(props.product.id, {
      storeCategoryId: form.categoryId!,
      skus: props.product.skus.map((item) => ({
        skuId: item.skuId,
        salePrice: drafts[item.skuId].price === '' ? null : Number(drafts[item.skuId].price),
        priceMode: drafts[item.skuId].mode,
        saleCoefficient: drafts[item.skuId].coefficient === '' ? null : Number(drafts[item.skuId].coefficient),
      })),
    });
    adminFeedback.actionSuccess({ action: '保存', target: '商品' });
    emit('saved', product);
  } catch (error) {
    adminFeedback.error(getSafeErrorMessage(error, '保存商品失败'));
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
@import url('../shared/index.css');

.form-shell {
  grid-template-columns: minmax(0, 1fr);
}
</style>
