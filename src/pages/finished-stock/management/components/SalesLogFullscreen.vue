<template>
  <div ref="anchor" :style="fullscreen ? { minHeight: `${originalHeight}px` } : undefined">
    <Teleport to="body" :disabled="!fullscreen">
      <div ref="panel" class="sales-fullscreen-panel" :class="{ 'is-fullscreen': fullscreen }">
        <div v-if="fullscreen || !titleTarget" ref="toolbar" class="sales-fullscreen-toolbar">
          <span v-if="fullscreen">销售规格</span>
        </div>
        <div ref="content" class="sales-fullscreen-content"><slot /></div>
      </div>
    </Teleport>
    <Teleport :to="(fullscreen ? toolbar : titleTarget) || toolbar || 'body'" :disabled="!toolbar && !titleTarget">
      <t-button
        class="sales-fullscreen-button"
        shape="square"
        variant="text"
        theme="primary"
        :title="fullscreen ? '还原' : '全屏显示'"
        :aria-label="fullscreen ? '还原' : '全屏显示'"
        @click="toggle"
      >
        <t-icon :name="fullscreen ? 'fullscreen-exit-1' : 'fullscreen-1'" />
      </t-button>
    </Teleport>
  </div>
</template>
<script setup lang="ts">
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue';
const emit = defineEmits<{ resize: [] }>();
const fullscreen = ref(false);
const originalHeight = ref(0);
const anchor = ref<HTMLElement>();
const toolbar = ref<HTMLElement>();
const titleTarget = ref<HTMLElement>();
const panel = ref<HTMLElement>();
const content = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;
let previousScroll = 0;
async function toggle() {
  if (!fullscreen.value) {
    originalHeight.value = anchor.value?.getBoundingClientRect().height || 0;
    previousFocus = document.activeElement as HTMLElement;
    previousScroll = content.value?.scrollTop || 0;
  }
  fullscreen.value = !fullscreen.value;
  await nextTick();
  if (fullscreen.value) panel.value?.querySelector('button')?.focus();
  else {
    if (content.value) content.value.scrollTop = previousScroll;
    previousFocus?.focus({ preventScroll: true });
  }
  emit('resize');
}
function onKeydown(event: KeyboardEvent) {
  if (fullscreen.value && event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    void toggle();
  }
}
onMounted(() => {
  titleTarget.value =
    anchor.value?.closest('section')?.querySelector<HTMLElement>('.creation-section-title, .change-section-title') ||
    undefined;
  window.addEventListener('keydown', onKeydown, true);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true));
</script>
<style scoped>
.sales-fullscreen-panel.is-fullscreen .sales-fullscreen-content :deep(> h4) {
  display: none;
}
.sales-fullscreen-button {
  margin-left: auto;
  flex-shrink: 0;
}
.sales-fullscreen-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: var(--td-comp-margin-s);
}
.sales-fullscreen-toolbar > span {
  margin-right: auto;
  font: var(--td-font-title-medium);
  color: var(--td-text-color-primary);
}
.sales-fullscreen-panel.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 6000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  background: var(--td-bg-color-container);
}
.is-fullscreen .sales-fullscreen-toolbar {
  flex-shrink: 0;
  background: var(--td-bg-color-container);
}
.is-fullscreen .sales-fullscreen-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  isolation: isolate;
}
</style>
