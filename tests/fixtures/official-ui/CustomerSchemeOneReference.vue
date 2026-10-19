<template>
  <t-layout>
    <t-header
      ><t-head-menu value="customer"
        ><template #logo
          ><t-space><t-avatar shape="round" size="small">装</t-avatar><span>装点猫</span></t-space></template
        ><t-menu-item value="customer">客户管理</t-menu-item></t-head-menu
      ></t-header
    >
    <t-layout>
      <t-aside
        ><t-menu value="customer"
          ><t-menu-item value="finished">成品现货管理</t-menu-item><t-menu-item value="customer">客户管理</t-menu-item
          ><t-menu-item value="price">价格配置</t-menu-item><t-menu-item value="supplier">供应商管理</t-menu-item
          ><t-menu-item value="permission">权限管理</t-menu-item></t-menu
        ></t-aside
      >
      <t-content
        ><t-card :bordered="false"
          ><t-tabs value="daily"
            ><t-tab-panel value="daily" label="日常客户" /><t-tab-panel value="archived" label="归档客户" /></t-tabs
          ><t-table
            row-key="name"
            :data="[{ name: '赵女士', phone: '+86 159****8941', owner: '赵云' }]"
            :columns="[
              { colKey: 'name', title: '客户姓名' },
              { colKey: 'phone', title: '联系电话' },
              { colKey: 'owner', title: '归属人' },
            ]" /></t-card
      ></t-content>
    </t-layout>
  </t-layout>
  <t-drawer :visible="true" header="客户详情" placement="right" size="1100px" :confirm-btn="null" cancel-btn="关闭">
    <t-descriptions title="客户资料" :column="3" bordered>
      <t-descriptions-item v-for="item in profile" :key="item.label" :label="item.label" :span="item.span || 1">{{
        item.value
      }}</t-descriptions-item>
    </t-descriptions>
    <t-divider />
    <t-typography-title level="h5">跟进记录</t-typography-title>

    <t-timeline mode="alternate" label-align="left">
      <t-timeline-item v-for="record in records" :key="record.id">
        <template #label>
          <div><t-typography-text :content="record.day" /></div>
          <div><t-typography-text :content="record.clock.slice(0, 5)" /></div>
        </template>
        <t-space direction="vertical" size="small" :style="{ width: '100%' }">
          <t-row justify="space-between" align="center">
            <t-space align="center">
              <t-avatar size="small">赵</t-avatar>
              <t-typography-text strong :content="record.author" />
            </t-space>
            <t-space
              ><t-link hover="color" theme="primary">编辑</t-link
              ><t-link hover="color" theme="danger">删除</t-link></t-space
            >
          </t-row>
          <t-typography-text :content="record.content" />
          <t-space v-if="record.attachment" break-line
            ><t-link hover="color" theme="primary">{{ record.attachment }}</t-link></t-space
          >
          <t-typography-text v-if="record.next">
            <span>{{ '下次跟进：' + record.next }}</span
            >{{ '\u3000' }}<span>{{ record.task }}</span>
          </t-typography-text>
        </t-space>
      </t-timeline-item>
    </t-timeline>
  </t-drawer>
</template>
<script setup lang="ts">
const profile = [
  { label: '客户姓名', value: '赵女士' },
  { label: '客户国籍', value: '中国' },
  { label: '号码归属地', value: '中国' },
  { label: '联系电话', value: '+86 159****8941' },
  { label: '微信号', value: 'zhao_8941' },
  { label: '归属人', value: '赵云' },
  { label: '客户需求', value: '想选一套浅色系餐桌，偏好简洁款式。', span: 3 },
  { label: '客户备注', value: '—', span: 3 },
  { label: '建档人', value: '赵云' },
  { label: '建档时间', value: '2026-10-19 09:13:38', span: 2 },
];
const records = [
  {
    id: 3,
    day: '2026-10-19',
    clock: '15:20:00',
    author: '赵云',
    content: '已确认餐桌尺寸为180×90厘米，客户偏好浅灰色岩板。',
    next: '2026-10-21 14:00',
    task: '提交选材方案',
    attachment: '',
  },
  {
    id: 2,
    day: '2026-10-19',
    clock: '10:30:00',
    author: '赵云',
    content: '已发送两款餐桌参考图，客户倾向简洁细腿款式。',
    next: '',
    task: '',
    attachment: '餐桌参考图.jpg',
  },
  {
    id: 1,
    day: '2026-10-18',
    clock: '07:54:40',
    author: '赵云',
    content: '客户第一次进店，初步了解客户需求。',
    next: '2026-10-20 08:00',
    task: '进一步确认尺寸与预算',
    attachment: '',
  },
];
</script>
