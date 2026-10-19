<template>
  <t-form ref="form" :data="data" :rules="rules" label-width="80px">
    <t-form-item label="普通输入" name="normal"
      ><t-textarea v-model="data.normal" :maxlength="100" :autosize="{}"
    /></t-form-item>
    <t-form-item label="自动增高"><t-textarea v-model="data.auto" :maxlength="100" :autosize="{}" /></t-form-item>
    <t-form-item label="错误提示"
      ><t-textarea
        v-model="data.error"
        :maxlength="100"
        :autosize="{}"
        :status="invalid ? 'error' : 'default'"
        :tips="invalid ? '请输入内容' : '\u00a0'"
    /></t-form-item>
    <t-form-item label="历史内容"><t-textarea v-model="data.history" :maxlength="100" :autosize="{}" /></t-form-item>
    <t-form-item label="只读内容"><t-textarea :value="history" readonly /></t-form-item>
  </t-form>
  <t-button @click="validate">校验</t-button>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { FormInstanceFunctions } from 'tdesign-vue-next';
const form = ref<FormInstanceFunctions>();
const invalid = ref(false);
const history = '历史'.repeat(70);
const data = reactive({ normal: '', auto: '', error: '', history });
const rules = { normal: [{ required: true, message: '请输入普通内容', type: 'error' as const }] };
async function validate() {
  invalid.value = true;
  await form.value?.validate();
}
</script>
