<template>
  <AdminFormDialog
    ref="dialog"
    v-model:visible="visible"
    :header="editing ? '编辑订单' : '新增订单'"
    :data="draft"
    width="min(1280px, 96vw)"
    form-layout="custom"
    confirm-function="save"
    :confirmation="formConfirmation(editing ? 'edit' : 'create')"
    @confirm="save"
  >
    <t-alert
      theme="info"
      message="前端原型：商品、客户及保存结果仅用于本机演示，不创建真实订单。保存后为待确认，不占库存。"
    />
    <h3 class="form-section-title">客户信息</h3>
    <t-row :gutter="[32, 24]">
      <t-col :span="6"
        ><t-form-item label="联系电话" required v-bind="feedback.field('phone', draft.phone)"
          ><t-input v-model="draft.phone" placeholder="请输入联系电话"
            ><template #suffix
              ><t-link v-if="!editing" :theme="buttonTheme('view')" hover="color" @click="lookup"
                >检索客户</t-link
              ></template
            ></t-input
          ></t-form-item
        ></t-col
      >
      <t-col :span="6"
        ><t-form-item label="客户姓名" required v-bind="feedback.field('customerName', draft.customerName)"
          ><t-input v-model="draft.customerName" placeholder="请输入客户姓名" /></t-form-item
      ></t-col>
      <t-col v-if="!editing && matches.length" :span="12"
        ><t-form-item label="客户档案"
          ><t-select
            :value="draft.customerId"
            :options="matches.map((c) => ({ label: `${c.name} · ${c.phone}`, value: c.id }))"
            placeholder="请选择客户档案"
            @change="selectCustomer(String($event))" /></t-form-item
      ></t-col>
      <t-col v-if="!editing && matches.length" :span="12"
        ><t-form-item label="同号另建"
          ><t-checkbox v-model="another" @change="draft.customerId = ''"
            >确认不是已有客户，另建独立档案</t-checkbox
          ></t-form-item
        ></t-col
      >
      <t-col v-if="another" :span="12"
        ><t-form-item label="另建原因" required v-bind="feedback.field('reason', reason)"
          ><t-input v-model="reason" placeholder="请输入另建原因" /></t-form-item
      ></t-col>
    </t-row>
    <h3 class="form-section-title">购买商品</h3>
    <t-space break-line
      ><t-select
        v-model="sku"
        :options="
          state.products
            .filter((p) => p.available)
            .map((p) => ({ label: `${p.name} · ${p.sku} · 可售 ${freeStock(state, p.sku)}`, value: p.sku }))
        "
        placeholder="请选择商品"
        filterable
      /><t-button :theme="buttonTheme('select-product')" @click="add">添加商品</t-button></t-space
    >
    <t-form-item label="商品明细" required v-bind="feedback.field('lines', draft.lines)">
      <span>{{ draft.lines.length }}项商品</span></t-form-item
    >
    <AdminListPage
      :table-props="{ rowKey: 'sku', data: draft.lines, columns: columns, pagination: undefined, bordered: true }"
    >
      <template #name="{ row }"
        ><div>{{ row.name }}</div>
        <t-tag variant="light">{{ row.sku }}</t-tag>
        <div>{{ row.specification }} / {{ row.material }}</div></template
      >
      <template #quantity="{ row }"
        ><t-input-number
          placeholder="请输入购买件数"
          :value="row.quantity"
          :min="1"
          :decimal-places="0"
          :aria-label="`${row.name}购买件数`"
          @change="changeLine(row, 'quantity', Number($event))"
      /></template>
      <template #billingQuantity="{ row }"
        ><t-input-number
          placeholder="请输入计价数量"
          :value="row.billingQuantity"
          :min="0.001"
          :decimal-places="3"
          :suffix="row.unit"
          :aria-label="`${row.name}计价数量`"
          @change="changeLine(row, 'billingQuantity', Number($event))"
      /></template>
      <template #price="{ row }"
        ><t-input-number
          placeholder="请输入单价"
          :value="row.price"
          :min="0"
          :decimal-places="2"
          :aria-label="`${row.name}单价`"
          @change="changeLine(row, 'price', Number($event))"
      /></template>
      <template #discount="{ row }"
        ><t-input-number
          v-model="row.discount"
          placeholder="请输入商品折扣"
          :disabled="draft.discountMode !== 'items'"
          :min="0"
          :max="100"
          suffix="%"
          :aria-label="`${row.name}折扣`"
      /></template>
      <template #amount="{ row }">{{
        money(row.billingQuantity * row.price * (draft.discountMode === 'items' ? row.discount / 100 : 1))
      }}</template>
      <template #operation="{ row }"
        ><t-link hover="color" :theme="buttonTheme('remove')" @click="remove(row.sku)">移除</t-link></template
      >
    </AdminListPage>
    <h3 class="form-section-title">优惠与交付约定</h3>
    <t-row :gutter="[32, 24]">
      <t-col :span="6"
        ><t-form-item label="折扣方式"
          ><t-radio-group v-model="draft.discountMode"
            ><t-radio-button value="order">整单折扣</t-radio-button
            ><t-radio-button value="items">商品折扣</t-radio-button></t-radio-group
          ></t-form-item
        ></t-col
      >
      <t-col :span="6"
        ><t-form-item label="整单折扣"
          ><t-input-number
            v-model="draft.discount"
            placeholder="请输入整单折扣"
            :disabled="draft.discountMode !== 'order'"
            :min="0"
            :max="100"
            suffix="%" /></t-form-item
      ></t-col>
      <t-col :span="6"
        ><t-form-item label="减免金额"
          ><t-input-number
            v-model="draft.reduction"
            placeholder="请输入减免金额"
            :min="0"
            :decimal-places="2"
            suffix="元" /></t-form-item
      ></t-col>
      <t-col :span="6"
        ><t-form-item label="抹零金额"
          ><t-input-number
            v-model="draft.rounding"
            placeholder="请输入抹零金额"
            :min="0"
            :decimal-places="2"
            suffix="元" /></t-form-item
      ></t-col>
      <t-col :span="6"
        ><t-form-item label="运费"
          ><t-input-number
            v-model="draft.freight"
            placeholder="请输入运费"
            :min="0"
            :decimal-places="2"
            suffix="元" /></t-form-item
      ></t-col>
      <t-col :span="6"
        ><t-form-item label="运费折扣"
          ><t-checkbox v-model="draft.freightDiscount" :disabled="draft.discountMode !== 'order'"
            >运费参与整单折扣</t-checkbox
          ></t-form-item
        ></t-col
      >
      <t-col :span="12"
        ><t-form-item label="预计发完日期"
          ><t-date-picker v-model="draft.due" clearable placeholder="请选择日期" /></t-form-item
      ></t-col>
    </t-row>
    <t-form-item label="金额校验" v-bind="feedback.field('amount', amount.total)"
      ><t-tag :theme="amount.total < 0 ? 'danger' : 'primary'" variant="light">{{
        money(amount.total)
      }}</t-tag></t-form-item
    >
    <AdminDetailPage embedded title="金额计算过程" :items="amountItems" />
  </AdminFormDialog>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { AdminListPage, AdminFormDialog, AdminDetailPage, adminFeedback } from '@/components/foundation';
import { formConfirmation } from '@/components/foundation/actions/confirmation';
import { buttonTheme } from '@/components/foundation/actions/buttonFunctions';
import { rejectFormSubmission } from '@/utils/submitValidation';
import { useFormFeedback } from '@/utils/formValidation';
import { addProduct, clone, freeStock, money, pricing, type State, type Order, type Line } from './model';
const props = defineProps<{ order: Order; state: State; editing: boolean }>();
const emit = defineEmits<{ save: [order: Order, reason: string] }>();
const visible = defineModel<boolean>('visible', { required: true });
const draft = ref(clone(props.order));
const dialog = ref<InstanceType<typeof AdminFormDialog>>();
const feedback = useFormFeedback(visible);
const reason = ref(''),
  another = ref(false),
  sku = ref('');
const matches = computed(() =>
  props.state.customers.filter((c) => c.ownerId === props.state.context.accountId && c.phone === draft.value.phone),
);
watch(visible, (v) => {
  if (v) {
    draft.value = clone(props.order);
    reason.value = '';
    another.value = false;
    sku.value = '';
  }
});
function lookup() {
  if (matches.value.length === 1) selectCustomer(matches.value[0]!.id);
  else if (!matches.value.length) {
    draft.value.customerId = '';
    adminFeedback.info('未找到客户，请填写姓名；保存订单时建立独立档案');
  }
}
function selectCustomer(id: string) {
  const c = matches.value.find((c) => c.id === id);
  if (c) {
    draft.value.customerId = c.id;
    draft.value.customerName = c.name;
    another.value = false;
  }
}
function add() {
  const p = props.state.products.find((p) => p.sku === sku.value);
  if (p) addProduct(draft.value, p);
}
function remove(id: string) {
  draft.value.lines = draft.value.lines.filter((l) => l.sku !== id);
  clearDiscount();
}
function clearDiscount() {
  draft.value.discount = 100;
  draft.value.reduction = 0;
  draft.value.rounding = 0;
}
function changeLine(line: Line, key: 'quantity' | 'billingQuantity' | 'price', value: number) {
  line[key] = value;
  if (key === 'quantity' && line.unit === '件') line.billingQuantity = value;
  line.discount = 100;
  clearDiscount();
}
const amount = computed(() => pricing(draft.value));
const amountItems = computed(() => [
  { label: '商品原金额', value: money(amount.value.goods) },
  { label: '运费', value: money(draft.value.freight) },
  { label: '折扣优惠', value: money(amount.value.discount) },
  { label: '减免', value: money(draft.value.reduction) },
  { label: '抹零', value: money(draft.value.rounding) },
  { label: '成交金额', value: money(amount.value.total) },
]);
const columns = [
  { colKey: 'name', title: '商品 / SKU', width: 260 },
  { colKey: 'quantity', title: '购买件数', width: 145 },
  { colKey: 'billingQuantity', title: '计价数量', width: 155 },
  { colKey: 'price', title: '单价（元）', width: 155 },
  { colKey: 'discount', title: '商品折扣', width: 140 },
  { colKey: 'amount', title: '金额', width: 120 },
  { colKey: 'operation', title: '操作', width: 75 },
];
async function save() {
  feedback.clear();
  let valid = true;
  for (const [key, value, message] of [
    ['phone', draft.value.phone, '请输入联系电话'],
    ['customerName', draft.value.customerName, '请输入客户姓名'],
    ['lines', draft.value.lines, '请选择购买商品'],
  ] as const) {
    if (!value || (Array.isArray(value) && !value.length)) {
      feedback.reject(key, value, message);
      valid = false;
    }
  }
  if (another.value && !reason.value.trim()) {
    feedback.reject('reason', reason.value, '请输入另建原因');
    valid = false;
  }
  if (amount.value.total < 0) {
    feedback.reject('amount', amount.value.total, '成交金额不能为负数');
    valid = false;
  }
  if (!valid) {
    await rejectFormSubmission(dialog.value);
    return;
  }
  emit('save', clone(draft.value), reason.value);
}
</script>
