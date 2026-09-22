<template>
  <section v-if="visible && mode !== 'view'" class="slab-publish-page" :aria-label="title">
    <div ref="anchorSlot" :style="{ height: `${anchorHeight}px` }">
      <AdminSectionCard class="form-anchor-card" :style="anchorStyle">
        <nav ref="anchorNav" aria-label="商品信息分区导航">
          <t-space size="large">
            <t-link
              v-for="section in sections"
              :key="section.key"
              :href="`#slab-product-${section.key}`"
              :theme="activeSection === section.key ? 'primary' : 'default'"
              :aria-current="activeSection === section.key ? 'location' : undefined"
              @click.prevent="scrollToSection(section.key)"
              >{{ section.label }}</t-link
            >
          </t-space>
        </nav>
      </AdminSectionCard>
    </div>
    <header class="page-header">
      <t-breadcrumb aria-label="页面导航">
        <t-breadcrumb-item
          ><t-link theme="default" :disabled="loading" @click="emit('close')">大板管理</t-link></t-breadcrumb-item
        >
        <t-breadcrumb-item>{{ title }}</t-breadcrumb-item>
      </t-breadcrumb>
    </header>
    <section class="form-shell">
      <AdminSectionCard class="form-heading-card" aria-label="发布商品信息">
        <div class="form-title-row">
          <h1>{{ title }}</h1>
          <t-button theme="default" variant="base" :disabled="loading" @click="emit('close')">
            <template #icon><t-icon name="rollback" /></template>
            返回列表
          </t-button>
        </div>
      </AdminSectionCard>
      <AdminSectionCard
        v-for="section in sections"
        :id="`slab-product-${section.key}`"
        :key="section.key"
        class="form-section"
        :aria-label="section.label"
      >
        <h2 class="form-section-title">{{ section.label }}</h2>
        <slot :name="section.key" />
      </AdminSectionCard>
      <AdminSectionCard class="form-submit-bar">
        <t-button theme="primary" :loading="loading" @click="emit('confirm')">
          <template #icon><t-icon name="check" /></template>
          提交商品信息
        </t-button>
        <t-button theme="default" variant="base" :disabled="loading" @click="emit('close')">取消</t-button>
      </AdminSectionCard>
    </section>
  </section>
  <t-dialog
    v-else-if="mode === 'view'"
    v-model:visible="visible"
    :header="title"
    width="940px"
    placement="center"
    :confirm-btn="mode === 'view' ? null : '提交商品信息'"
    cancel-btn="取消"
    @confirm="emit('confirm')"
    @cancel="emit('close')"
    @close="emit('close')"
  >
    <t-tabs v-model="activeSection" class="product-tabs">
      <t-tab-panel
        v-for="section in sections"
        :key="section.key"
        :value="section.key"
        :label="section.key === 'images' ? '图片' : section.label"
      >
        <slot :name="section.key" />
      </t-tab-panel>
    </t-tabs>
  </t-dialog>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { AdminSectionCard } from '@/components/foundation';
const props = defineProps<{ mode: 'create' | 'edit' | 'view'; title: string; loading: boolean }>();
const visible = defineModel<boolean>('visible', { required: true });
const activeSection = defineModel<string>('activeSection', { required: true });
const emit = defineEmits<{ confirm: []; close: [] }>();
const sections = [
  { key: 'images', label: '图文描述' },
  { key: 'base', label: '基础信息' },
  { key: 'sales', label: '销售信息' },
];
const anchorNav = ref<HTMLElement>();
const anchorSlot = ref<HTMLElement>();
const anchorHeight = ref(72);
const anchorStyle = ref({ left: '0px', width: '0px', top: '64px' });
let listScrollTop = 0;
const updateAnchorPosition = () => {
  if (!anchorSlot.value) return;
  const rect = anchorSlot.value.getBoundingClientRect();
  const top = Math.max(0, document.querySelector('.top-nav')?.getBoundingClientRect().bottom ?? 0);
  anchorStyle.value = { left: `${rect.left}px`, width: `${rect.width}px`, top: `${top}px` };
  anchorHeight.value = anchorNav.value?.parentElement?.getBoundingClientRect().height ?? 72;
};
watch(
  anchorSlot,
  (slot, _previous, onCleanup) => {
    if (!slot) return;
    let frame = 0;
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateAnchorPosition);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(slot);
    if (anchorNav.value?.parentElement) observer.observe(anchorNav.value.parentElement);
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    updateAnchorPosition();
    onCleanup(() => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    });
  },
  { flush: 'post' },
);
watch(visible, async (open) => {
  if (props.mode === 'view') return;
  if (open) listScrollTop = window.scrollY;
  await nextTick();
  window.scrollTo({ top: open ? 0 : listScrollTop, behavior: 'instant' });
});
const scrollToSection = async (key: string) => {
  activeSection.value = key;
  if (props.mode === 'view') return;
  await nextTick();
  const section = document.getElementById(`slab-product-${key}`);
  if (!section) return;
  updateAnchorPosition();
  const offset = Number.parseFloat(anchorStyle.value.top) + anchorHeight.value + 16;
  window.scrollTo({
    top: Math.max(0, window.scrollY + section.getBoundingClientRect().top - offset),
    behavior: 'smooth',
  });
};
defineExpose({ scrollToSection });
</script>

<style scoped>
.slab-publish-page {
  margin-bottom: calc(-1 * var(--td-comp-paddingTB-xl));
}
.form-shell {
  display: grid;
  gap: var(--zdm-admin-section-gap);
}
.form-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.form-title-row h1 {
  margin: 0;
  font-size: 20px;
}
.form-anchor-card {
  position: fixed;
  z-index: 10;
  box-sizing: border-box;
  box-shadow:
    0 6px 18px rgb(0 0 0 / 24%),
    0 2px 4px rgb(0 0 0 / 16%);
}
.form-heading-card,
.form-section {
  box-shadow: none;
}
.form-section {
  min-width: 0;
}
.form-section-title {
  margin: 0 0 var(--td-comp-margin-xxl);
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  text-align: left;
}
.form-submit-bar {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  justify-content: center;
  gap: var(--td-comp-margin-l);
  box-shadow:
    0 -6px 18px rgb(0 0 0 / 24%),
    0 -2px 4px rgb(0 0 0 / 16%);
}
.product-tabs {
  min-height: 460px;
}
</style>
