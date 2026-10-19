<template>
  <component :is="embedded ? 'div' : Card" :bordered="false">
    <t-descriptions :title="title" :column="column" :bordered="bordered">
      <t-descriptions-item v-for="item in items" :key="item.label" :label="item.label" :span="item.span ?? 1">
        <slot :name="item.key ?? item.label" :item="item">{{ item.value ?? '-' }}</slot>
      </t-descriptions-item>
    </t-descriptions>
    <template v-if="$slots.default"><t-divider /><slot /></template>
  </component>
</template>
<script setup lang="ts">
import { Card } from 'tdesign-vue-next';
withDefaults(
  defineProps<{
    embedded?: boolean;
    bordered?: boolean;
    title: string;
    column?: number;
    items: { label: string; key?: string; value?: string | number; span?: number }[];
  }>(),
  { column: 3, embedded: false, bordered: false },
);
</script>
