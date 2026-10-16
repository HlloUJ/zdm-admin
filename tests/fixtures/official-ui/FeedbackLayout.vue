<template>
  <div style="width: min(100%, 700px); padding: 32px">
    <t-form ref="form" :data="data" :rules="rules" label-width="100px" colon>
      <t-form-item label="名称" name="name" help="保留现有业务说明">
        <t-input v-model="data.name" placeholder="请输入名称" />
      </t-form-item>
      <t-form-item label="内容" help="填写具体业务内容" v-bind="fieldFeedback(invalid, '请输入具体内容')">
        <t-textarea v-model="data.content" />
      </t-form-item>
      <t-form-item label="封面图">
        <AdminMediaUpload title="封面图" :upload="upload" :error-message="invalid ? '请上传封面图' : ''" />
      </t-form-item>
      <t-form-item label="表格价格">
        <div
          data-testid="price-row"
          style="display: grid; grid-template-columns: 1fr 140px; align-items: center; padding: 8px"
        >
          <span data-testid="price-label">价格</span>
          <SpecPriceInput v-model="data.price" label="价格" placeholder="请输入价格" :submitted="invalid" />
        </div>
      </t-form-item>
      <t-form-item label="编码" help="填写业务编码">
        <t-input v-model="data.code" v-bind="fieldFeedback(invalid, '请输入编码')" />
      </t-form-item>
      <t-form-item label="说明" help="填写业务说明">
        <t-textarea v-model="data.note" v-bind="fieldFeedback(invalid, '请输入说明')" />
      </t-form-item>
      <t-form-item label="下一字段"><t-input /></t-form-item>
    </t-form>
    <t-button @click="validate">校验</t-button>
    <t-button @click="clear">清除反馈</t-button>
  </div>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { FormInstanceFunctions } from 'tdesign-vue-next';
import AdminMediaUpload from '@/components/foundation/AdminMediaUpload.vue';
import SpecPriceInput from '@/pages/finished-stock/management/components/SpecPriceInput.vue';
import { fieldFeedback } from '@/utils/formValidation';
const form = ref<FormInstanceFunctions>();
const invalid = ref(false);
const data = reactive({ name: '', content: '', price: '', code: '', note: '' });
const rules = { name: [{ required: true, message: '请输入名称', type: 'error' as const }] };
const upload = async () => ({ name: '封面图', url: '/unused.png' });
async function validate() {
  invalid.value = true;
  await form.value?.validate();
}
function clear() {
  invalid.value = false;
  form.value?.clearValidate();
}
</script>
