<template>
  <t-button theme="primary" @click="visible = true"
    ><template #icon><t-icon name="add" /></template>新增员工</t-button
  >
  <AdminDialog v-model:visible="visible" header="新增员工" :confirm-loading="saving" @confirm="submit">
    <t-form ref="form" :data="draft" :rules="rules" label-width="96px">
      <t-form-item label="姓名" name="name"><t-input v-model="draft.name" :maxlength="80" /></t-form-item>
      <t-form-item label="手机号码" name="phone"><t-input v-model="draft.phone" :maxlength="11" /></t-form-item>
      <t-form-item label="性别"
        ><t-radio-group
          v-model="draft.gender"
          :options="[
            { label: '男', value: 'male' },
            { label: '女', value: 'female' },
          ]"
      /></t-form-item>
    </t-form>
  </AdminDialog>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { FormInstanceFunctions, FormRule } from 'tdesign-vue-next';
import { AdminDialog, adminFeedback } from '@/components/foundation';
import { createEmployee } from '@/services/employees';
const props = defineProps<{ clientCode: 'admin' | 'supply-chain' }>();
const emit = defineEmits<{ created: [] }>();
const visible = ref(false);
const saving = ref(false);
const form = ref<FormInstanceFunctions>();
const draft = reactive({ name: '', phone: '', gender: 'male' as 'male' | 'female' });
const rules: Record<string, FormRule[]> = {
  name: [{ required: true, message: '请输入姓名', type: 'error' }],
  phone: [{ pattern: /^1\d{10}$/, message: '请输入11位手机号', type: 'error' }],
};
const submit = async () => {
  if (saving.value || (await form.value?.validate()) !== true) return;
  saving.value = true;
  try {
    await createEmployee({ ...draft, name: draft.name.trim(), clientCode: props.clientCode, status: 'disabled' });
    visible.value = false;
    draft.name = '';
    draft.phone = '';
    adminFeedback.success('已新增员工，请配置角色和数据权限后启用');
    emit('created');
  } catch (error) {
    adminFeedback.error(error instanceof Error ? error.message : '新增员工失败');
  } finally {
    saving.value = false;
  }
};
</script>
