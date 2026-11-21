<script setup lang="ts">
import { buttonTheme } from '@/components/foundation/actions/buttonFunctions';
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { PageInfo } from 'tdesign-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { AdminPagination, AdminDialog, adminFeedback, getSafeErrorMessage } from '@/components/foundation';
import { ApiError } from '@/services/http';
import {
  centerContext,
  centerCategories,
  centerProducts,
  centerSelection,
  addCenterSelection,
  removeCenterSelection,
  joinCenterSelection,
  centerDetail,
  categoryTree,
  centerPrice,
} from '@/services/storeSelectionCenter';
import type {
  ProductType,
  CenterContext,
  CategoryNode,
  CenterProduct,
  CenterDetail,
  CenterResult,
} from '@/services/storeSelectionCenter';
import ApprovedCategoryPanel from './components/SelectionCategoryPanel.vue';
import FilterGlyph from './components/FilterGlyph.vue';
import SelectionDetail from './components/SelectionDetail.vue';
import './selection-center.css';
const route = useRoute(),
  router = useRouter();
const view = computed(() => (route.query.view === 'basket' ? 'basket' : 'browse'));
const context = ref<CenterContext | null>(null);
const selectedTypes = ref<string[]>(['finished', 'accessory']);
const selectedStates = ref<string[]>(['unadded']);
const effectiveTypes = computed(() => (selectedTypes.value.length ? selectedTypes.value : ['finished', 'accessory']));
const basketTab = ref<ProductType>('finished');
const counts = ref<Record<ProductType, number>>({ finished: 0, accessory: 0 });
const count = computed(() => counts.value.finished + counts.value.accessory);
const groups = computed(() =>
  (['finished', 'accessory'] as ProductType[]).map((type) => ({
    type,
    label: type === 'finished' ? '成品现货' : '配件',
    count: counts.value[type],
  })),
);
const query = ref(''),
  applied = ref('');
const categoryOpen = ref(false),
  selectedCategory = ref<CategoryNode | null>(null);
const categoryTrees = ref<Record<ProductType, CategoryNode[]>>({ finished: [], accessory: [] });
const products = ref<CenterProduct[]>([]),
  basketItems = ref<CenterProduct[]>([]);
const browseTotal = ref(0),
  basketTotal = ref(0);
const browsePage = ref(1),
  browsePageSize = ref(20),
  basketPage = ref(1),
  basketPageSize = ref(5);
const pagedProducts = computed(() => products.value),
  pagedBasketItems = computed(() => basketItems.value);
const activeBasketItems = computed(() => basketItems.value);
const detail = ref<CenterDetail | null>(null);
const loading = ref(false),
  error = ref(''),
  submitting = ref(false),
  adding = ref<string[]>([]);
const pendingRequest = ref<string | null>(null),
  result = ref<CenterResult | null>(null),
  resultVisible = ref(false);
const resultColumns = [
  { colKey: 'typeLabel', title: '商品类型' },
  { colKey: 'name', title: '商品名称' },
  { colKey: 'reason', title: '失败原因' },
];
const failures = computed(() =>
  (result.value?.failures ?? []).map((f) => ({
    ...f,
    key: `${f.type}:${f.productId}`,
    typeLabel: f.type === 'finished' ? '成品现货' : '配件',
  })),
);
const keyOf = (p: CenterProduct) => `${p.type}:${p.id}`;
const canMaintain = (p: CenterProduct) => Boolean(context.value?.maintain[p.type]);
const permissionLabel = (p: CenterProduct) => (p.type === 'finished' ? '无成品现货维护权限' : '无配件维护权限');
function fail(e: unknown) {
  error.value = getSafeErrorMessage(e, '加载失败，请重试');
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
    clearData();
  }
  adminFeedback.error(error.value);
}
function mutationFailed(e: unknown) {
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) fail(e);
  else adminFeedback.error(getSafeErrorMessage(e, '操作失败，请重试'));
}
function clearData() {
  ++browseSequence;
  ++basketSequence;
  result.value = null;
  resultVisible.value = false;
  pendingRequest.value = null;
  browseTotal.value = 0;
  basketTotal.value = 0;
  categoryOpen.value = false;
  products.value = [];
  basketItems.value = [];
  detail.value = null;
  counts.value = { finished: 0, accessory: 0 };
  categoryTrees.value = { finished: [], accessory: [] };
  context.value = null;
}
let browseSequence = 0,
  basketSequence = 0;
async function loadBrowse() {
  if (!context.value) return;
  const seq = ++browseSequence;
  loading.value = true;
  error.value = '';
  try {
    const data = await centerProducts(context.value.key, {
      keyword: applied.value.trim(),
      types: selectedTypes.value,
      states: selectedStates.value,
      categoryType: selectedCategory.value?.type,
      categoryId: selectedCategory.value?.id,
      page: browsePage.value,
      pageSize: browsePageSize.value,
    });
    if (seq !== browseSequence) return;
    products.value = data.records;
    browseTotal.value = data.total;
    const max = Math.max(1, Math.ceil(data.total / browsePageSize.value));
    if (browsePage.value > max) {
      browsePage.value = max;
      await loadBrowse();
    }
  } catch (e) {
    if (seq === browseSequence) {
      products.value = [];
      browseTotal.value = 0;
      fail(e);
    }
  } finally {
    if (seq === browseSequence) loading.value = false;
  }
}
async function loadBasket(preserveOnError = false) {
  if (!context.value) return;
  const seq = ++basketSequence;
  error.value = '';
  try {
    const data = await centerSelection(context.value.key, basketTab.value, basketPage.value, basketPageSize.value);
    if (seq !== basketSequence) return;
    basketItems.value = data.page.records;
    basketTotal.value = data.page.total;
    counts.value = data.counts;
    const max = Math.max(1, Math.ceil(data.page.total / basketPageSize.value));
    if (basketPage.value > max) {
      basketPage.value = max;
      await loadBasket(preserveOnError);
    }
  } catch (e) {
    if (seq === basketSequence) {
      if (!preserveOnError) {
        basketItems.value = [];
        basketTotal.value = 0;
      }
      if (preserveOnError) mutationFailed(e);
      else fail(e);
    }
  }
}
function toggleType(value: string) {
  selectedTypes.value = selectedTypes.value.includes(value)
    ? selectedTypes.value.filter((v) => v !== value)
    : [...selectedTypes.value, value];
}
function toggleState(value: string) {
  selectedStates.value = selectedStates.value.includes(value)
    ? selectedStates.value.filter((v) => v !== value)
    : [...selectedStates.value, value];
}
function clearSelectedCategory() {
  selectedCategory.value = null;
  categoryOpen.value = false;
}
function queryCategory(node: CategoryNode) {
  selectedCategory.value = node;
  applied.value = query.value;
  categoryOpen.value = false;
}
function search() {
  applied.value = query.value.trim();
  browsePage.value = 1;
  void loadBrowse();
}
async function changeView(value: string) {
  await router.replace({ path: route.path, query: { view: value } });
  window.scrollTo(0, 0);
}
function changeBrowsePage(info: PageInfo) {
  browsePage.value = info.pageSize === browsePageSize.value ? info.current : 1;
  browsePageSize.value = info.pageSize;
  void loadBrowse();
  window.scrollTo(0, 0);
}
function changeBasketPage(info: PageInfo) {
  basketPage.value = info.pageSize === basketPageSize.value ? info.current : 1;
  basketPageSize.value = info.pageSize;
  void loadBasket();
}
async function openDetail(p: CenterProduct) {
  if (!context.value) return;
  try {
    const owner = context.value.key;
    const response = await centerDetail(owner, p.type, p.id);
    if (context.value?.key === owner) detail.value = response;
  } catch (e) {
    fail(e);
  }
}
async function add(p: CenterProduct) {
  if (!context.value || !p.canAdd || p.inSelection || adding.value.includes(keyOf(p))) return;
  adding.value.push(keyOf(p));
  const owner = context.value.key;
  try {
    await addCenterSelection(owner, p.type, p.id);
    if (context.value?.key !== owner) return;
    const markSelected = (item: CenterProduct) => {
      if (keyOf(item) === keyOf(p)) item.inSelection = true;
    };
    products.value.forEach(markSelected);
    if (detail.value) markSelected(detail.value.product);
    counts.value[p.type] += 1;
    await loadBasket(true);
  } catch (e) {
    mutationFailed(e);
  } finally {
    adding.value = adding.value.filter((k) => k !== keyOf(p));
  }
}
async function remove(id: number | null) {
  if (!context.value || id == null) return;
  const owner = context.value.key;
  const removed = basketItems.value.find((item) => item.selectionId === id);
  try {
    await removeCenterSelection(owner, id);
    if (context.value?.key !== owner) return;
    if (removed) {
      basketItems.value = basketItems.value.filter((item) => item.selectionId !== id);
      basketTotal.value = Math.max(0, basketTotal.value - 1);
      counts.value[removed.type] = Math.max(0, counts.value[removed.type] - 1);
      for (const item of products.value) if (keyOf(item) === keyOf(removed)) item.inSelection = false;
      if (detail.value && keyOf(detail.value.product) === keyOf(removed)) detail.value.product.inSelection = false;
    }
    await loadBasket(true);
  } catch (e) {
    mutationFailed(e);
  }
}
const pendingKey = () => `zdm-selection-join:${context.value?.key}`;
async function submit() {
  if (!context.value || submitting.value || (!count.value && !pendingRequest.value)) return;
  submitting.value = true;
  const owner = context.value.key;
  pendingRequest.value ||= crypto.randomUUID();
  localStorage.setItem(pendingKey(), pendingRequest.value);
  try {
    const data = await joinCenterSelection(context.value.key, pendingRequest.value);
    if (context.value?.key !== owner) return;
    result.value = data;
    if (data.status === 'completed') {
      localStorage.removeItem(pendingKey());
      pendingRequest.value = null;
      resultVisible.value = data.failureCount > 0;
      if (!data.failureCount) adminFeedback.success(`成功加入门店${data.successCount}件商品`);
      localStorage.setItem(
        'zdm-selection-store-updated',
        JSON.stringify({ context: context.value.key, time: Date.now() }),
      );
    } else adminFeedback.warning('本次加入仍在处理中，请重试以查询并继续本次处理');
    await loadBasket(true);
  } catch (e) {
    mutationFailed(e);
  } finally {
    submitting.value = false;
  }
}
watch([selectedTypes, selectedStates, selectedCategory], () => {
  browsePage.value = 1;
  void loadBrowse();
});
watch(basketTab, () => {
  basketPage.value = 1;
  void loadBasket();
});
watch(view, () => {
  detail.value = null;
  categoryOpen.value = false;
  void loadBasket();
  if (view.value === 'browse') void loadBrowse();
});
const chromeRef = ref<HTMLElement | null>(null),
  compactChrome = ref(false),
  expandedChromeHeight = ref(180),
  chromeThreshold = ref(140);
let chromeObserver: ResizeObserver | undefined;
function measureChrome() {
  if (compactChrome.value || !chromeRef.value) return;
  expandedChromeHeight.value = Math.ceil(chromeRef.value.getBoundingClientRect().height);
  chromeThreshold.value = Math.ceil(
    (chromeRef.value.querySelector('.platform-header')?.getBoundingClientRect().height || 0) +
      (chromeRef.value.querySelector('.market-discovery')?.getBoundingClientRect().height || 0),
  );
}
function updateCompactChrome() {
  compactChrome.value = view.value === 'browse' && window.scrollY > chromeThreshold.value;
  updateCategoryPanelHeight();
}
watch(view, async () => {
  compactChrome.value = false;
  await nextTick();
  measureChrome();
  updateCompactChrome();
});
const categoryPanelMaxHeight = ref(560),
  categoryPanelMaxWidth = ref(1200);
function getCategoryPopupOffset() {
  const trigger = chromeRef.value?.querySelector('.category-trigger-group'),
    search = chromeRef.value?.querySelector('.market-search');
  if (!trigger || !search) return [0, 12];
  const a = trigger.getBoundingClientRect(),
    b = search.getBoundingClientRect();
  return [b.left - a.left, b.bottom - a.bottom + 12];
}
function updateCategoryPanelHeight() {
  if (!categoryOpen.value) return;
  const box = chromeRef.value?.querySelector('.market-search')?.getBoundingClientRect();
  if (!box) return;
  categoryPanelMaxWidth.value = Math.min(1200, innerWidth - box.left - 16);
  categoryPanelMaxHeight.value = Math.min(560, Math.max(0, innerHeight - box.bottom - 28));
}
watch(categoryOpen, async (open) => {
  if (open) {
    await nextTick();
    updateCategoryPanelHeight();
  }
});
function resize() {
  measureChrome();
  updateCategoryPanelHeight();
}
function identityKey() {
  try {
    const user = JSON.parse(localStorage.getItem('zdm-admin-user') || 'null');
    return JSON.stringify(user ? [user.id, user.tenantId, user.storeId, user.identityId] : null);
  } catch {
    return '';
  }
}
const initialIdentity = identityKey();
async function onFocus() {
  if (initialIdentity !== identityKey()) {
    clearData();
    error.value = '当前身份或门店已变更，请重新打开选品中心';
    return;
  }
  if (!context.value) return;
  const owner = context.value.key;
  try {
    const latest = await centerContext();
    if (owner !== latest.key) {
      clearData();
      error.value = '当前身份或门店已变更，请重新打开选品中心';
      return;
    }
    context.value = latest;
    await Promise.all([loadBrowse(), loadBasket()]);
  } catch (e) {
    fail(e);
  }
}
function onStorage(event: StorageEvent) {
  if (event.key === 'zdm-admin-user' || event.key === 'zdm-admin-token' || event.key === null) void onFocus();
}
async function initialize() {
  if (initialIdentity !== identityKey()) {
    clearData();
    loading.value = false;
    error.value = '当前身份或门店已变更，请重新打开选品中心';
    return;
  }
  loading.value = true;
  try {
    const current = await centerContext();
    if (initialIdentity !== identityKey()) {
      await onFocus();
      return;
    }
    context.value = current;
    const rows = await centerCategories(current.key);
    if (context.value?.key !== current.key || initialIdentity !== identityKey()) {
      await onFocus();
      return;
    }
    categoryTrees.value = { finished: categoryTree(rows, 'finished'), accessory: categoryTree(rows, 'accessory') };
    pendingRequest.value = localStorage.getItem(pendingKey());
    await Promise.all([loadBrowse(), loadBasket()]);
  } catch (e) {
    fail(e);
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  void initialize();
  measureChrome();
  window.addEventListener('focus', onFocus);
  window.addEventListener('storage', onStorage);
  window.addEventListener('scroll', updateCompactChrome, { passive: true });
  window.addEventListener('resize', resize);
  chromeObserver = new ResizeObserver(measureChrome);
  if (chromeRef.value) chromeObserver.observe(chromeRef.value);
});
onBeforeUnmount(() => {
  ++browseSequence;
  ++basketSequence;
  window.removeEventListener('focus', onFocus);
  window.removeEventListener('storage', onStorage);
  window.removeEventListener('scroll', updateCompactChrome);
  window.removeEventListener('resize', resize);
  chromeObserver?.disconnect();
});
</script>

<template>
  <div id="selection-center-app" class="selection-center-shell selection-center">
    <div class="chrome-reserve" :style="compactChrome ? { height: expandedChromeHeight + 'px' } : undefined">
      <div ref="chromeRef" :class="['sticky-chrome', { 'is-compact': compactChrome }]">
        <div v-if="compactChrome" class="compact-brand">
          <span class="brand-symbol" aria-label="装点猫">装</span><span class="center-name">选品中心</span>
        </div>
        <header class="platform-header">
          <div class="platform-width header-content">
            <div class="identity"><span class="brand-symbol">装</span><span class="center-name">选品中心</span></div>
            <div class="header-tools">
              <span class="store"><t-icon name="shop" />{{ context?.storeName || '—' }}</span
              ><t-divider layout="vertical" /><t-button
                data-button-control="page-navigation"
                :variant="view === 'browse' ? 'base' : 'text'"
                :theme="view === 'browse' ? 'primary' : 'default'"
                @click="changeView('browse')"
                >商品浏览</t-button
              ><t-badge :count="count" :offset="[5, 0]"
                ><t-button
                  data-button-control="page-navigation"
                  :variant="view === 'basket' ? 'base' : 'outline'"
                  @click="changeView('basket')"
                  ><template #icon><t-icon name="view-list" /></template>选品清单</t-button
                ></t-badge
              >
            </div>
          </div>
        </header>
        <section v-if="view === 'browse'" class="market-discovery platform-width">
          <div class="market-search search-shell" role="search" aria-label="商品名称搜索">
            <t-popup
              v-model:visible="categoryOpen"
              trigger="hover"
              placement="bottom-left"
              :delay="[100, 150]"
              :show-arrow="false"
              :popper-options="{
                modifiers: [
                  {
                    name: 'offset',
                    options: { offset: getCategoryPopupOffset },
                  },
                  {
                    name: 'preventOverflow',
                    options: { padding: 16, altAxis: true },
                  },
                  { name: 'flip', enabled: false },
                ],
              }"
              :overlay-inner-style="{ padding: '0', margin: '0' }"
            >
              <div class="category-trigger-group" :class="{ 'has-category': Boolean(selectedCategory) }">
                <t-button
                  data-button-control="category-trigger"
                  class="category-trigger"
                  theme="default"
                  variant="text"
                  aria-label="商品分类"
                  ><template #icon><t-icon name="view-list" /></template
                  ><span class="category-trigger-text"
                    ><span>{{ selectedCategory ? selectedCategory.label : '商品分类' }}</span
                    ><t-icon :name="categoryOpen ? 'chevron-up' : 'chevron-down'" /></span></t-button
                ><t-button
                  v-if="selectedCategory"
                  data-button-control="category-clear"
                  class="clear-category"
                  theme="default"
                  variant="text"
                  size="small"
                  shape="square"
                  aria-label="清除分类"
                  @click.stop="clearSelectedCategory"
                  ><t-icon name="close"
                /></t-button>
              </div>
              <template #content
                ><ApprovedCategoryPanel
                  :types="effectiveTypes"
                  :max-height="categoryPanelMaxHeight"
                  :max-width="categoryPanelMaxWidth"
                  :trees="categoryTrees"
                  :selected-category="selectedCategory"
                  :visible="categoryOpen"
                  @choose="queryCategory"
              /></template> </t-popup
            ><t-divider layout="vertical" />
            <t-input
              v-model="query"
              :size="compactChrome ? 'medium' : 'large'"
              borderless
              clearable
              placeholder="请输入商品名称"
              @clear="
                query = '';
                search();
              "
              @enter="search"
            />
            <t-button
              :size="compactChrome ? 'medium' : 'large'"
              shape="round"
              :theme="buttonTheme('search')"
              @click="search"
              >搜索</t-button
            >
          </div>
        </section>
        <div v-if="view === 'browse'" class="quick-filter-row" aria-label="商品筛选">
          <div class="quick-filter-group" aria-label="商品类型">
            <span
              v-for="item in [
                { value: 'finished', label: '成品现货' },
                { value: 'accessory', label: '配件' },
              ]"
              :key="item.value"
              class="filter-icon-option"
              ><t-tooltip
                :disabled="!compactChrome"
                :content="item.label"
                :show-arrow="false"
                placement="bottom"
                :delay="[250, 0]"
                ><t-button
                  data-button-control="catalog-filter"
                  variant="text"
                  :shape="compactChrome ? 'square' : 'rectangle'"
                  :theme="selectedTypes.includes(item.value) ? 'primary' : 'default'"
                  :aria-label="item.label"
                  :aria-pressed="selectedTypes.includes(item.value)"
                  @click="toggleType(item.value)"
                  ><template v-if="compactChrome" #icon><FilterGlyph :name="item.value" /></template
                  ><template v-if="!compactChrome"
                    ><t-typography-text
                      v-if="!selectedTypes.includes(item.value)"
                      theme="secondary"
                      class="filter-secondary-label"
                      >{{ item.label }}</t-typography-text
                    ><span v-else>{{ item.label }}</span></template
                  ></t-button
                ></t-tooltip
              ></span
            >
          </div>
          <t-divider layout="vertical" />
          <div class="quick-filter-group" aria-label="添加状态">
            <span
              v-for="item in [
                { value: 'unadded', label: '未加入门店' },
                { value: 'added', label: '已加入门店' },
              ]"
              :key="item.value"
              class="filter-icon-option"
              ><t-tooltip
                :disabled="!compactChrome"
                :content="item.label"
                :show-arrow="false"
                placement="bottom"
                :delay="[250, 0]"
                ><t-button
                  variant="text"
                  :shape="compactChrome ? 'square' : 'rectangle'"
                  :theme="selectedStates.includes(item.value) ? 'primary' : 'default'"
                  :aria-label="item.label"
                  :aria-pressed="selectedStates.includes(item.value)"
                  data-button-control="catalog-filter"
                  @click="toggleState(item.value)"
                  ><template v-if="compactChrome" #icon><FilterGlyph :name="item.value" /></template
                  ><template v-if="!compactChrome"
                    ><t-typography-text
                      v-if="!selectedStates.includes(item.value)"
                      theme="secondary"
                      class="filter-secondary-label"
                      >{{ item.label }}</t-typography-text
                    ><span v-else>{{ item.label }}</span></template
                  ></t-button
                ></t-tooltip
              ></span
            >
          </div>
        </div>
      </div>
    </div>
    <main class="platform-width platform-body">
      <t-alert v-if="error" theme="error"
        >{{ error }}
        <t-button :theme="buttonTheme('search')" variant="text" @click="context ? onFocus() : initialize()"
          >重试</t-button
        ></t-alert
      >
      <t-loading :loading="loading" fullscreen size="small" />
      <template v-if="view === 'browse'">
        <div class="product-grid">
          <t-card
            v-for="p in pagedProducts"
            :key="keyOf(p)"
            class="product-card"
            :hover-shadow="false"
            tabindex="0"
            role="button"
            :aria-label="`查看${p.name}详情`"
            :bordered="false"
            :body-style="{ padding: '0' }"
            @keydown.enter.self="openDetail(p)"
            @keydown.space.prevent.self="openDetail(p)"
            @click="openDetail(p)"
          >
            <div class="product-image">
              <img :src="p.imageUrl || undefined" :alt="p.name" />
              <div class="image-tags">
                <t-tag v-if="!canMaintain(p)" theme="default" variant="light">{{ permissionLabel(p) }}</t-tag>
                <t-tag v-if="p.inSelection && !p.addedToStore" theme="success" variant="light"
                  ><template #icon><t-icon name="check-circle" /></template>已加入选品清单</t-tag
                >
                <t-tag v-if="p.addedToStore" theme="primary" variant="light"
                  ><template #icon><t-icon name="shop" /></template>已加入门店</t-tag
                ><t-tag v-if="p.soldOut" theme="warning" variant="light">已售完</t-tag>
              </div>
            </div>
            <div class="product-info">
              <div class="product-name">{{ p.name }}</div>
              <div class="price"><span>¥</span> {{ centerPrice(p) }}</div>
              <div class="card-actions">
                <t-button
                  variant="base"
                  :disabled="!p.canAdd || p.inSelection || adding.includes(keyOf(p))"
                  :theme="buttonTheme('select-product')"
                  @click.stop="add(p)"
                  >加入清单</t-button
                >
              </div>
            </div>
          </t-card>
        </div>
        <t-empty v-if="!browseTotal && !loading && !error" description="暂无符合条件的商品" />
        <div class="selection-pagination admin-layout">
          <AdminPagination
            :total="browseTotal"
            :current="browsePage"
            :page-size="browsePageSize"
            :page-size-options="[10, 20, 40]"
            @change="changeBrowsePage"
          />
        </div>
      </template>
      <template v-else>
        <div v-if="count" class="selection-layout">
          <section class="selection-panel" :class="{ 'has-empty-type': !activeBasketItems.length }">
            <div class="selection-tabs">
              <t-radio-group v-model="basketTab" variant="primary-filled"
                ><t-radio-button v-for="g in groups" :key="g.type" :value="g.type"
                  >{{ g.label }}（{{ g.count }}）</t-radio-button
                ></t-radio-group
              >
            </div>
            <div v-if="activeBasketItems.length" class="basket-columns">
              <span>商品信息</span><span>价格</span><span>操作</span>
            </div>
            <div class="selection-scroll" :class="{ 'is-empty': !activeBasketItems.length }">
              <div
                v-for="p in pagedBasketItems"
                :key="keyOf(p)"
                class="basket-row"
                role="button"
                tabindex="0"
                :aria-label="`查看${p.name}详情`"
                @click="openDetail(p)"
                @keydown.enter.self="openDetail(p)"
                @keydown.space.prevent.self="openDetail(p)"
              >
                <div class="basket-product">
                  <img :src="p.imageUrl || undefined" :alt="p.name" />
                  <div>
                    <div class="product-name">{{ p.name }}</div>
                    <t-tag v-if="p.addedToStore" theme="primary" variant="light">已加入门店</t-tag>
                    <t-tag v-if="p.soldOut" theme="warning" variant="light">已售完</t-tag>
                    <t-tag v-if="!canMaintain(p)" theme="default" variant="light">{{ permissionLabel(p) }}</t-tag>
                    <div v-for="reason in p.reasons" :key="reason" class="secondary">{{ reason }}</div>
                  </div>
                </div>
                <div class="basket-price">¥ {{ centerPrice(p) }}</div>
                <t-link hover="color" :theme="buttonTheme('remove')" @click.stop="remove(p.selectionId)">移除</t-link>
              </div>

              <t-empty v-if="!activeBasketItems.length" description="尚未选择该类型商品" />
            </div>
            <div v-if="activeBasketItems.length" class="selection-pagination admin-layout">
              <AdminPagination
                :total="basketTotal"
                :current="basketPage"
                :page-size="basketPageSize"
                :page-size-options="[5, 10, 20]"
                @change="changeBasketPage"
              />
            </div>
          </section>
          <aside class="basket-summary">
            <t-card title="本次选品" :bordered="false">
              <div v-for="g in groups" :key="g.type" class="summary-line">
                <span>{{ g.label }}</span
                ><span>{{ g.count }} 件</span>
              </div>
              <t-divider />
              <div class="summary-total">
                <span>待加入商品</span><strong>{{ count }} <small>件</small></strong>
              </div>
              <p class="secondary summary-description">加入门店后，商品将分别进入成品现货管理、配件管理的仓库。</p>
              <t-button
                block
                :loading="submitting"
                :disabled="(!count && !pendingRequest) || submitting"
                :theme="buttonTheme('select-product')"
                @click="submit"
                >{{ pendingRequest ? '重试本次加入' : '加入门店' }}</t-button
              >
              <p class="summary-note">仅添加商品信息，不产生采购订单</p></t-card
            >
          </aside>
        </div>
        <section v-else class="basket-empty">
          <t-empty description="选品清单还是空的"
            ><template #image><t-icon name="shop" /></template
          ></t-empty>
          <div class="secondary">去发现适合门店的商品，加入选品清单后，在这里统一确认，并添加到仓库中。</div>
          <t-button :theme="buttonTheme('back')" @click="changeView('browse')">继续选品</t-button>
        </section>
      </template>
    </main>
    <SelectionDetail :detail="detail" @close="detail = null" @add="add" />
    <AdminDialog
      v-model:visible="resultVisible"
      header="加入门店结果"
      width="min(760px, 90vw)"
      confirm-function="close"
      :confirmation="{ kind: 'close', text: '我知道了' }"
      :cancel-btn="null"
      ><t-alert theme="warning"
        >本次加入 {{ result?.total }} 件商品，成功 {{ result?.successCount }} 件，失败
        {{ result?.failureCount }} 件</t-alert
      ><t-table class="failure-details" :data="failures" :columns="resultColumns" row-key="key" table-layout="auto"
    /></AdminDialog>
  </div>
</template>
