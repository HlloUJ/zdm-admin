<template>
  <t-form :data="{}" label-width="calc(7em + var(--td-comp-paddingLR-xl))" colon>
    <t-form-item label="附件">
      <t-upload
        :files="files"
        theme="file"
        multiple
        :max="3"
        :size-limit="{ size: 5 * 1024 * 1024, unit: 'B' }"
        :trigger-button-props="{ theme: 'primary', variant: 'outline' }"
        tips="最多3个附件，单个不超过5MiB"
      />
    </t-form-item>
  </t-form>
</template>
<script setup lang="ts">
import type { UploadFile } from 'tdesign-vue-next';
const files: UploadFile[] = [
  { name: 'first.txt', url: '#first', status: 'success' },
  { name: 'second.txt', url: '#second', status: 'success' },
];
</script>
