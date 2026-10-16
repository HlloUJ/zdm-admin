<template>
  <component
    :is="kind === 'native' ? 't-dialog' : kind === 'foundation' ? AdminFormDialog : AdminDialog"
    v-bind="kind === 'foundation' ? { data } : {}"
    :visible="true"
    header="新增"
    width="560px"
    placement="center"
    :prevent-scroll-through="false"
    confirm-btn="提交"
    @confirm="validate"
  >
    <t-form v-if="kind !== 'foundation'" ref="formRef" :data="data" :rules="rules" label-width="100px" colon>
      <t-form-item label="所属属性" name="attribute">
        <t-select
          v-model="data.attribute"
          placeholder="请选择所属属性"
          :options="[{ label: '测试属性', value: 'test' }]"
        />
      </t-form-item>
      <t-form-item
        v-for="index in count"
        :key="index"
        :label="index === count ? '值名称' : `字段${index}`"
        :name="`name${index}`"
      >
        <t-input v-model="data[`name${index}`]" placeholder="请输入值名称" />
      </t-form-item>
    </t-form>
    <template v-else>
      <t-form-item label="所属属性" v-bind="fieldFeedback(submitted && !data.attribute, '请选择所属属性')">
        <t-select
          v-model="data.attribute"
          placeholder="请选择所属属性"
          :options="[{ label: '测试属性', value: 'test' }]"
        />
      </t-form-item>
      <t-form-item
        v-for="index in count"
        :key="index"
        :label="index === count ? '值名称' : `字段${index}`"
        v-bind="fieldFeedback(submitted && !data[`name${index}`], '请输入值名称')"
      >
        <t-input v-model="data[`name${index}`]" placeholder="请输入值名称" />
      </t-form-item>
    </template>
  </component>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { FormInstanceFunctions, FormRule } from 'tdesign-vue-next';
import AdminDialog from '@/components/foundation/AdminDialog.vue';
import AdminFormDialog from '@/components/foundation/official/AdminFormDialog.vue';
import { fieldFeedback } from '@/utils/formValidation';
const query = new URLSearchParams(location.search);
const kind = query.get('kind') ?? 'native';
const count = query.has('long') ? 30 : 1;
const formRef = ref<FormInstanceFunctions>();
const submitted = ref(false);
async function validate() {
  submitted.value = true;
  await formRef.value?.validate();
}
const data = reactive<Record<string, string>>({
  attribute: '',
  ...Object.fromEntries(Array.from({ length: count }, (_, index) => [`name${index + 1}`, ''])),
});
const rules: Record<string, FormRule[]> = {
  attribute: [{ required: true, message: '请选择所属属性', type: 'error' }],
  ...Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `name${index + 1}`,
      [{ required: true, message: '请输入值名称', type: 'error' }],
    ]),
  ),
};
</script>
