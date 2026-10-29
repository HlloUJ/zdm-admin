<template>
  <t-space direction="vertical" size="small" align="start">
    <t-tag
      :theme="
        entry.warehouseEntryType === 'offShelf'
          ? 'warning'
          : entry.warehouseEntryType === 'firstEntry'
            ? 'primary'
            : 'default'
      "
      variant="light"
    >
      {{ warehouseEntryLabel(entry.warehouseEntryType) }}
    </t-tag>
    <template v-if="entry.warehouseEntryType === 'offShelf'">
      <span v-if="entry.warehouseEntryReason">{{ entry.warehouseEntryReason }}</span>
      <t-tooltip :content="entry.warehouseEntryDetail || '未填写详细说明'" placement="bottom-left">
        <span data-entry-detail>{{ entry.warehouseEntryDetail || '未填写详细说明' }}</span>
      </t-tooltip>
    </template>
    <template v-else-if="!['firstEntry', 'recycleRestore'].includes(entry.warehouseEntryType || '')">
      <span v-if="entry.warehouseEntryReason">{{ entry.warehouseEntryReason }}</span>
      <span v-if="entry.warehouseEntryDetail">{{ entry.warehouseEntryDetail }}</span>
    </template>
    <slot />
  </t-space>
</template>
<script setup lang="ts">
import { warehouseEntryLabel, type WarehouseEntryInformation } from '@/services/warehouseEntry';
defineProps<{ entry: WarehouseEntryInformation }>();
</script>
