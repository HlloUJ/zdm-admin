<template>
  <div class="list-common-table">
    <t-form :data="formData" :label-width="80" colon @reset="onReset" @submit="onSubmit">
      <t-row>
        <t-col :span="10">
          <t-row :gutter="[24, 24]">
            <t-col :span="4">
              <t-form-item :label="t('components.commonTable.contractName')" name="name">
                <t-input
                  v-model="formData.name"
                  class="form-item-content"
                  type="search"
                  :placeholder="t('components.commonTable.contractNamePlaceholder')"
                  :style="{ minWidth: '134px' }"
                />
              </t-form-item>
            </t-col>
            <t-col :span="4">
              <t-form-item :label="t('components.commonTable.contractStatus')" name="status">
                <t-select
                  v-model="formData.status"
                  class="form-item-content"
                  :options="CONTRACT_STATUS_OPTIONS"
                  :placeholder="t('components.commonTable.contractStatusPlaceholder')"
                  clearable
                />
              </t-form-item>
            </t-col>
            <t-col :span="4">
              <t-form-item :label="t('components.commonTable.contractNum')" name="no">
                <t-input
                  v-model="formData.no"
                  class="form-item-content"
                  :placeholder="t('components.commonTable.contractNumPlaceholder')"
                  :style="{ minWidth: '134px' }"
                />
              </t-form-item>
            </t-col>
            <t-col :span="4">
              <t-form-item :label="t('components.commonTable.contractType')" name="type">
                <t-select
                  v-model="formData.type"
                  style="display: inline-block"
                  class="form-item-content"
                  :options="CONTRACT_TYPE_OPTIONS"
                  :placeholder="t('components.commonTable.contractTypePlaceholder')"
                  clearable
                />
              </t-form-item>
            </t-col>
          </t-row>
        </t-col>

        <t-col :span="2" class="operation-container">
          <t-button theme="primary" type="submit" :style="{ marginLeft: 'var(--td-comp-margin-s)' }">
            {{ t('components.commonTable.query') }}
          </t-button>
          <t-button type="reset" variant="base" theme="default"> {{ t('components.commonTable.reset') }} </t-button>
        </t-col>
      </t-row>
    </t-form>

    <div class="table-container">
      <t-table
        row-key="id"
        :data="[]"
        :columns="[{ colKey: 'name', title: '合同名称' }]"
        :pagination="{ current: 1, pageSize: 10, total: 0 }"
      />
    </div>
  </div>
  <t-form class="native-inline-reference" :data="formData" layout="inline" label-align="left" colon>
    <t-form-item label="姓名" label-width="calc(3em + var(--td-comp-paddingLR-xl))"><t-input style="width:200px" /></t-form-item>
    <t-form-item label="联系电话" label-width="calc(5em + var(--td-comp-paddingLR-xl))"><t-input style="width:200px" /></t-form-item>
    <t-form-item label="归属人" label-width="calc(4em + var(--td-comp-paddingLR-xl))"><t-select style="width:200px" :options="[]" /></t-form-item>
  </t-form>
  <t-tabs class="native-tabs" default-value="daily"><t-tab-panel value="daily" label="日常客户" /><t-tab-panel value="archived" label="归档客户" /></t-tabs>
  <t-space class="native-buttons" size="small"><t-button>新增</t-button><t-button disabled>批量归档</t-button></t-space>
<t-space class="native-section-gap" direction="vertical" size="large"><span>字段</span><span>提示</span></t-space>
  <t-empty class="native-empty" description="暂无客户" />
  <t-dialog :visible="mode === 'dialog'" header="官方组件参照" placement="center" :prevent-scroll-through="false" confirm-btn="提交">
    <t-form :data="formData" label-width="100px" colon>
      <t-form-item label="姓名" required-mark><t-input placeholder="请输入" /></t-form-item>
      <t-form-item label="姓名" required-mark status="error" tips="请输入姓名"><t-input placeholder="请输入" /></t-form-item>
      <t-form-item label="备注"><t-textarea /></t-form-item>
      <t-form-item label="跟进时间"><t-date-picker enable-time-picker /></t-form-item>
      <t-form-item label="归属人"><t-select :options="[]" /></t-form-item>
      <t-form-item label="附件"><t-upload theme="file-input" :max="1" /></t-form-item>
      <t-alert theme="info" message="调整归属后，客户将自动恢复为日常客户。" />
    </t-form>
  </t-dialog>
  <t-descriptions class="native-descriptions" bordered title="客户资料"><t-descriptions-item label="姓名">客户</t-descriptions-item></t-descriptions>
  <t-list class="native-list"><t-list-item>跟进记录</t-list-item></t-list>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import type { SelectProps } from 'tdesign-vue-next';
const mode = new URLSearchParams(location.search).get('mode');
const formData = ref({ name: '', status: '', no: '', type: '' });
const CONTRACT_STATUS_OPTIONS: SelectProps['options'] = [];
const CONTRACT_TYPE_OPTIONS: SelectProps['options'] = [];
const t = (key: string) =>
  ({
    'components.commonTable.contractName': '合同名称',
    'components.commonTable.contractStatus': '合同状态',
    'components.commonTable.contractNum': '合同编号',
    'components.commonTable.contractType': '合同类型',
    'components.commonTable.query': '查询',
    'components.commonTable.reset': '重置',
  })[key] ?? key;
function onSubmit() {}
function onReset() {}
</script>
<style scoped>
.list-common-table {
  background-color: var(--td-bg-color-container);
  padding: var(--td-comp-paddingTB-xxl) var(--td-comp-paddingLR-xxl);
  border-radius: var(--td-radius-medium);
}
.operation-container {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}
.form-item-content {
  width: 100%;
}
.table-container {
  margin-top: var(--td-comp-margin-xxl);
}
</style>
