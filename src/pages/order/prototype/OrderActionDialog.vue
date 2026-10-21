<template>
  <AdminFormDialog
    ref="dialog"
    v-model:visible="visible"
    :header="label"
    :data="form"
    :width="action === 'cancel' ? 'min(1100px, 94vw)' : '480px'"
    :form-layout="action === 'cancel' ? 'custom' : 'single-column'"
    :confirm-function="
      action === 'cancel' || action === 'void-payment' || action === 'revoke-plan' ? 'archive' : 'save'
    "
    :confirmation="operationConfirmation(label)"
    @confirm="submit"
  >
    <t-alert theme="info" message="前端原型：本操作只更新当前浏览器的模拟记录，不写入真实业务。" />
    <template v-if="action === 'confirm'"
      ><p>确认后锁定商品、规格、数量、单价及优惠，并占用模拟统一库存。成品现货库存不足时无法确认。</p>
      <p>{{ order.id }} · {{ order.customerName }} · {{ money(pricing(order).total) }}</p></template
    >
    <template v-if="paymentAction">
      <t-form-item label="金额" required v-bind="fb.field('amount', form.amount)"
        ><t-input-number v-model="form.amount" placeholder="请输入金额" :min="0.01" :decimal-places="2" suffix="元"
      /></t-form-item>
      <t-form-item v-if="paymentKind === 'receipt'" label="款项性质" required v-bind="fb.field('nature', form.nature)"
        ><t-select v-model="form.nature" :options="options('nature')" placeholder="请选择款项性质"
      /></t-form-item>
      <t-form-item label="方式" required v-bind="fb.field('method', form.method)"
        ><t-select v-model="form.method" :options="options('method')" placeholder="请选择方式"
      /></t-form-item>
      <t-form-item label="实际时间" required v-bind="fb.field('at', form.at)"
        ><t-date-picker v-model="form.at" enable-time-picker format="YYYY-MM-DD HH:mm:ss" placeholder="请选择日期时间"
      /></t-form-item>
      <t-form-item v-if="paymentKind === 'refund'" label="退款原因" required v-bind="fb.field('reason', form.reason)"
        ><t-textarea
          v-model="form.reason"
          :maxlength="100"
          :autosize="{ minRows: 3, maxRows: 5 }"
          :show-limit-number="true"
          placeholder="请输入退款原因"
      /></t-form-item>
      <t-form-item label="备注"
        ><t-textarea
          v-model="form.remark"
          :maxlength="100"
          :autosize="{ minRows: 3, maxRows: 5 }"
          :show-limit-number="true"
          placeholder="请输入备注"
      /></t-form-item>
      <t-form-item label="收退款凭证"
        ><AdminMediaUpload v-model="form.proof" title="上传凭证" :upload="uploadProof"
      /></t-form-item>
    </template>
    <template v-if="action === 'plan' || action === 'supply'">
      <t-form-item label="商品" required v-bind="fb.field('sku', form.sku)"
        ><t-select
          v-model="form.sku"
          :options="
            order.lines
              .filter((l) => remaining(l) > 0)
              .map((l) => ({ label: `${l.name} · 待发 ${remaining(l)}`, value: l.sku }))
          "
          placeholder="请选择商品"
      /></t-form-item>
      <t-form-item label="安排数量" required v-bind="fb.field('quantity', form.quantity)"
        ><t-input-number v-model="form.quantity" placeholder="请输入安排数量" :min="1" :decimal-places="0"
      /></t-form-item>
      <t-form-item v-if="action === 'supply'" label="交付路径"
        ><t-radio-group v-model="form.route"
          ><t-radio value="customer">直接发给客户</t-radio><t-radio value="store">先发到门店</t-radio></t-radio-group
        ></t-form-item
      >
      <t-form-item label="交付方式"
        ><t-radio-group v-model="form.mode"
          ><t-radio value="delivery">配送</t-radio><t-radio value="pickup">自提</t-radio></t-radio-group
        ></t-form-item
      >
      <template v-if="form.mode === 'delivery'"
        ><t-form-item label="收货人" required v-bind="fb.field('recipient', form.recipient)"
          ><t-input v-model="form.recipient" placeholder="请输入收货人" /></t-form-item
        ><t-form-item label="联系电话" required v-bind="fb.field('phone', form.phone)"
          ><t-input v-model="form.phone" placeholder="请输入联系电话" /></t-form-item
        ><t-form-item label="收货地址" required v-bind="fb.field('address', form.address)"
          ><t-input v-model="form.address" placeholder="请输入收货地址" /></t-form-item
      ></template>
      <p v-if="action === 'supply'">此处只演示门店下单内容；货源、供应商及供货进度由后续供应链模块接入。</p>
    </template>
    <template v-if="action === 'ship' || action === 'receive' || action === 'correct-shipment'">
      <t-form-item
        :label="action === 'correct-shipment' ? '更正后数量' : '本次数量'"
        required
        v-bind="fb.field('quantity', form.quantity)"
        ><t-input-number
          v-model="form.quantity"
          :placeholder="controlPlaceholder(action === 'correct-shipment' ? '更正后数量' : '本次数量', 'input')"
          :min="action === 'correct-shipment' ? 0 : 1"
          :decimal-places="0"
      /></t-form-item>
      <t-form-item label="实际时间" required v-bind="fb.field('at', form.at)"
        ><t-date-picker v-model="form.at" enable-time-picker format="YYYY-MM-DD HH:mm:ss" placeholder="请选择日期时间"
      /></t-form-item>
      <p v-if="action === 'receive'">到店收货只更新中转进度，不计入客户已发数量。</p>
    </template>
    <template v-if="action === 'cancel'">
      <AdminListPage
        :table-props="{
          rowKey: 'sku',
          data: order.lines.filter((l) => l.quantity > l.cancelled),
          columns: cancelColumns,
          pagination: undefined,
          bordered: true,
        }"
      >
        <template #remaining="{ row }">{{ remaining(row) }}</template>
        <template #quantity="{ row }"
          ><t-input-number
            v-model="form.cancelQuantities[row.sku]"
            placeholder="请输入取消件数"
            :min="0"
            :max="remaining(row)"
            :decimal-places="0"
            :aria-label="`${row.name}取消件数`"
        /></template>
        <template #billing="{ row }"
          ><t-input-number
            v-model="form.billings[row.sku]"
            placeholder="请输入剩余计价数量"
            :min="0"
            :decimal-places="3"
            :aria-label="`${row.name}剩余计价数量`"
        /></template>
        <template #discount="{ row }"
          ><t-input-number
            v-model="form.lineDiscounts[row.sku]"
            placeholder="请输入剩余商品折扣"
            :disabled="form.discountMode !== 'items'"
            :min="0"
            :max="100"
            suffix="%"
            :aria-label="`${row.name}结算折扣`"
        /></template>
      </AdminListPage>
      <p>请核实取消后的剩余计价数量；已发部分不能取消。原确认金额与本次结算分别保留。</p>
      <t-form-item label="折扣方式"
        ><t-radio-group v-model="form.discountMode"
          ><t-radio value="order">整单折扣</t-radio><t-radio value="items">商品折扣</t-radio></t-radio-group
        ></t-form-item
      >
      <t-form-item label="剩余整单折扣"
        ><t-input-number
          v-model="form.discount"
          placeholder="请输入剩余整单折扣"
          :disabled="form.discountMode !== 'order'"
          :min="0"
          :max="100"
          suffix="%"
      /></t-form-item>
      <t-form-item label="减免金额"
        ><t-input-number
          v-model="form.reduction"
          placeholder="请输入减免金额"
          :min="0"
          :decimal-places="2" /></t-form-item
      ><t-form-item label="抹零金额"
        ><t-input-number v-model="form.rounding" placeholder="请输入抹零金额" :min="0" :decimal-places="2"
      /></t-form-item>
    </template>
    <template v-if="action === 'terms'">
      <t-form-item label="运费"
        ><t-input-number v-model="form.freight" placeholder="请输入运费" :min="0" :decimal-places="2" suffix="元"
      /></t-form-item>
      <t-form-item label="预计发完日期"
        ><t-date-picker v-model="form.due" clearable placeholder="请选择日期"
      /></t-form-item>
      <t-form-item label="订单负责人"
        ><t-select
          v-model="form.ownerId"
          :options="[
            { label: state.context.name, value: state.context.accountId },
            { label: '示例导购', value: state.context.accountId + 1000 },
          ]"
          placeholder="请选择订单负责人"
      /></t-form-item>
    </template>
    <t-form-item v-if="needsReason" label="操作原因" required v-bind="fb.field('reason', form.reason)"
      ><t-textarea
        v-model="form.reason"
        :maxlength="100"
        :autosize="{ minRows: 3, maxRows: 5 }"
        :show-limit-number="true"
        placeholder="请输入操作原因"
    /></t-form-item>
    <t-form-item v-bind="fb.field('operation', error)" label="操作校验"
      ><span>{{ error || '以本次填写内容执行，操作前后数据会保留在订单日志中。' }}</span></t-form-item
    >
  </AdminFormDialog>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { AdminListPage, AdminFormDialog, AdminMediaUpload, type AdminMediaValue } from '@/components/foundation';
import { operationConfirmation } from '@/components/foundation/actions/confirmation';
import { controlPlaceholder } from '@/utils/controlPlaceholder';
import { useFormFeedback } from '@/utils/formValidation';
import { rejectFormSubmission } from '@/utils/submitValidation';
import { clone, money, pricing, remaining, type State, type Order } from './model';
export interface ActionForm {
  amount: number;
  nature: string;
  method: string;
  at: string;
  reason: string;
  remark: string;
  proof?: AdminMediaValue;
  sku: string;
  quantity: number;
  route: 'customer' | 'store';
  mode: 'delivery' | 'pickup';
  recipient: string;
  phone: string;
  address: string;
  freight: number;
  due: string;
  ownerId: number;
  discountMode: 'order' | 'items';
  discount: number;
  reduction: number;
  rounding: number;
  cancelQuantities: Record<string, number>;
  billings: Record<string, number>;
  lineDiscounts: Record<string, number>;
}
const props = defineProps<{
  action: string;
  label: string;
  order: Order;
  state: State;
  recordId?: string;
  execute: (form: ActionForm) => void;
}>();
const visible = defineModel<boolean>('visible', { required: true });
const form = ref<ActionForm>(initial());
const dialog = ref<InstanceType<typeof AdminFormDialog>>();
const fb = useFormFeedback(visible),
  error = ref('');
function initial(): ActionForm {
  return {
    amount: 0,
    nature: '',
    method: '',
    at: new Date().toLocaleString('sv-SE'),
    reason: '',
    remark: '',
    sku: '',
    quantity: 1,
    route: 'customer',
    mode: 'delivery',
    recipient: props.order.customerName,
    phone: props.order.phone,
    address: '',
    freight: props.order.freight,
    due: props.order.due,
    ownerId: props.order.ownerId,
    discountMode: props.order.discountMode,
    discount: props.order.discount,
    reduction: props.order.reduction,
    rounding: props.order.rounding,
    cancelQuantities: Object.fromEntries(props.order.lines.map((l) => [l.sku, 0])),
    billings: Object.fromEntries(props.order.lines.map((l) => [l.sku, l.billingQuantity])),
    lineDiscounts: Object.fromEntries(props.order.lines.map((l) => [l.sku, l.discount])),
  };
}
const paymentAction = computed(() => ['receipt', 'refund', 'correct-payment'].includes(props.action));
const paymentKind = computed(() =>
  props.action === 'correct-payment'
    ? props.order.payments.find((p) => p.id === props.recordId)?.kind
    : props.action === 'receipt'
      ? 'receipt'
      : 'refund',
);
const needsReason = computed(() =>
  ['cancel', 'terms', 'void-payment', 'revoke-plan', 'correct-shipment'].includes(props.action),
);
const options = (group: string) =>
  props.state.settings.filter((s) => s.group === group && s.enabled).map((s) => ({ label: s.name, value: s.name }));
watch(visible, (v) => {
  if (!v) return;
  form.value = initial();
  error.value = '';
  if (props.action === 'correct-payment') {
    const p = props.order.payments.find((p) => p.id === props.recordId);
    if (p) Object.assign(form.value, clone(p));
  }
  if (props.action === 'correct-shipment') {
    form.value.quantity = props.order.shipments.find((s) => s.id === props.recordId)?.quantity ?? 0;
  }
});
const cancelColumns = [
  { colKey: 'name', title: '商品', width: 180 },
  { colKey: 'remaining', title: '未发件数', width: 95 },
  { colKey: 'quantity', title: '取消件数', width: 145 },
  { colKey: 'billing', title: '剩余计价数量', width: 160 },
  { colKey: 'discount', title: '剩余商品折扣', width: 145 },
];
function uploadProof(file: File): Promise<AdminMediaValue> {
  return new Promise((resolve, reject) => {
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error('原型凭证请使用不超过2MB的图片'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, url: String(reader.result) });
    reader.onerror = () => reject(new Error('无法读取图片'));
    reader.readAsDataURL(file);
  });
}
async function submit() {
  fb.clear();
  error.value = '';
  try {
    props.execute(clone(form.value));
    visible.value = false;
    return;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
    fb.reject('operation', error.value, error.value);
  }
  await rejectFormSubmission(dialog.value);
}
</script>
