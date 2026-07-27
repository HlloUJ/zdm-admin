<template>
  <t-dialog
    v-model:visible="innerVisible"
    class="admin-dialog"
    v-bind="$attrs"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
    @close="emit('close')"
    @opened="emit('opened')"
    @closed="emit('closed')"
  >
    <slot />
  </t-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  confirm: [];
  cancel: [];
  close: [];
  opened: [];
  closed: [];
}>();

const innerVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
});
</script>
