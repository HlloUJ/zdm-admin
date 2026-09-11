<template>
  <div class="attribute-changes">
    <div v-for="row in rows" :key="row.key" class="attribute-change">
      <div class="attribute-side attribute-side--before">
        <div class="attribute-side-heading">
          <span class="attribute-name">{{ row.name }}</span
          ><span class="attribute-side-label">修改前</span>
        </div>
        <div class="attribute-value">{{ row.before }}</div>
      </div>
      <t-icon name="arrow-right" class="attribute-arrow" aria-hidden="true" />
      <div class="attribute-side attribute-side--after">
        <div class="attribute-side-label">修改后</div>
        <div class="attribute-value">{{ row.after }}</div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ before: unknown; after: unknown }>();
type Attribute = { attributeId?: number; attributeName?: string; value?: unknown };
function values(value: unknown) {
  const counts = new Map<string, number>();
  return (Array.isArray(value) ? (value as Attribute[]) : []).map((item) => {
    const identity = item.attributeId != null ? `id:${item.attributeId}` : `name:${item.attributeName || ''}`;
    const occurrence = counts.get(identity) || 0;
    counts.set(identity, occurrence + 1);
    return { ...item, key: `${identity}:${occurrence}` };
  });
}
function text(value: unknown): string {
  if (value == null || value === '') return '—';
  return Array.isArray(value) ? value.map(text).join('、') : String(value);
}
const rows = computed(() => {
  const before = values(props.before);
  const after = values(props.after);
  const previous = new Map(before.map((item) => [item.key, item]));
  const next = new Map(after.map((item) => [item.key, item]));
  return [...new Set([...before, ...after].map((item) => item.key))].map((key) => {
    const old = previous.get(key);
    const current = next.get(key);
    return {
      key,
      name: current?.attributeName || old?.attributeName || '历史属性',
      before: old ? text(old.value) : '未设置',
      after: current ? text(current.value) : '已移除',
      changed: !old || !current || JSON.stringify(old.value) !== JSON.stringify(current.value),
    };
  });
});
</script>
<style scoped>
.attribute-changes {
  display: grid;
  gap: var(--td-comp-margin-m);
}
.attribute-change {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr);
  gap: var(--td-comp-margin-s);
  align-items: center;
}
.attribute-side-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--td-comp-margin-s);
}
.attribute-name {
  color: var(--td-text-color-primary);
  font: var(--td-font-body-small);
  overflow-wrap: anywhere;
}
.attribute-side {
  min-width: 0;
  min-height: 64px;
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-m);
  border-radius: var(--td-radius-default);
  color: var(--td-text-color-primary);
}
.attribute-side--before {
  background: var(--td-bg-color-secondarycontainer);
}
.attribute-side--after {
  background: var(--td-brand-color-light);
}
.attribute-side-label {
  margin-bottom: var(--td-comp-margin-xs);
  color: var(--td-text-color-secondary);
  font: var(--td-font-body-small);
}
.attribute-arrow {
  place-self: center;
  color: var(--td-brand-color);
  font-size: var(--td-font-size-title-medium);
}
.attribute-value {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
