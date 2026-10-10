<template>
  <AdminSectionCard>
    <t-space direction="vertical" size="large">
      <h1>编辑商品</h1>
      <t-form ref="formRef" :data="form" :rules="rules" label-width="120px" colon>
        <t-form-item label="平台分类">{{ product.categoryName || '—' }}</t-form-item>
        <t-form-item label="门店分类" name="categoryId">
          <t-cascader
            v-model="form.categoryId"
            :options="categoryOptions"
            clearable
            placeholder="请选择"
            @change="changeCategory"
          />
        </t-form-item>
        <t-form-item label="价格系数">{{ coefficient ?? '—' }}</t-form-item>
      </t-form>
    </t-space>
  </AdminSectionCard>
  <StoreProductDetail :product="product">
    <template #sale="{ row }">
      <t-space align="start" size="small">
        <SpecPriceInput
          v-if="drafts[row.skuId]"
          :model-value="drafts[row.skuId].price"
          label="商品售价"
          placeholder="价格"
          :submitted="submitted"
          :optional="row.stock === 0"
          @change="editDraftPrice(drafts[row.skuId], $event)"
        />
        <PriceSourceToggle
          v-if="drafts[row.skuId]"
          :source="drafts[row.skuId].mode"
          :available="canFollow(row.skuId)"
          :readonly="drafts[row.skuId].mode === 'manual' && !canFollow(row.skuId)"
          @toggle="toggleSource(row.skuId)"
        />
      </t-space>
    </template>
  </StoreProductDetail>
  <AdminSectionCard>
    <t-space>
      <t-button theme="primary" :loading="saving" @click="save">保存</t-button>
      <t-button theme="default" :disabled="saving" @click="emit('cancel')">返回列表</t-button>
    </t-space>
  </AdminSectionCard>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { FormInstanceFunctions } from 'tdesign-vue-next';
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
import { calculateSalePrice, changeDraftCategory, createSalePriceDraft, editDraftPrice } from './salePriceDraft';
const props = defineProps<{ product: StoreFinishedProduct }>();
const emit = defineEmits<{ saved: [product: StoreFinishedProduct]; cancel: [] }>();
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
  if ((await formRef.value?.validate()) !== true) return;
  if (
    props.product.skus.some(
      (item) =>
        (item.stock > 0 || drafts[item.skuId].price !== '') && !isValidSpecPriceNumber(drafts[item.skuId].price),
    )
  )
    return;
  saving.value = true;
  try {
    const product = await saveStoreFinishedEdit(props.product.id, {
      storeCategoryId: form.categoryId!,
      skus: props.product.skus.map((item) => ({
        skuId: item.skuId,
        salePrice: drafts[item.skuId].price === '' ? null : Number(drafts[item.skuId].price),
        priceMode: drafts[item.skuId].mode,
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
