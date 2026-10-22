import { generateOrderNumber } from './orderNumber';
/** Front-end prototype only. No business API calls or production inventory. */
export const statuses = [
  { value: 'pending', label: '待确认' },
  { value: 'confirmed', label: '已确认' },
  { value: 'shipped', label: '已发货' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
] as const;
export type Status = (typeof statuses)[number]['value'];
export interface Context {
  tenantId: number;
  storeId: number;
  identityId: number;
  accountId: number;
  name: string;
}
export interface Product {
  sku: string;
  name: string;
  imageUrl?: string;
  specification: string;
  material: string;
  unit: string;
  price: number;
  stock: number;
  replenishable: boolean;
  local: boolean;
  available: boolean;
}
export interface Line {
  sku: string;
  name: string;
  imageUrl?: string;
  specification: string;
  material: string;
  unit: string;
  quantity: number;
  billingQuantity: number;
  price: number;
  discount: number;
  shipped: number;
  cancelled: number;
  reserved: number;
}
export interface Customer {
  id: string;
  name: string;
  phone: string;
  ownerId: number;
  reason: string;
}
export interface Payment {
  id: string;
  kind: 'receipt' | 'refund';
  amount: number;
  nature: string;
  method: string;
  at: string;
  reason: string;
  remark: string;
  proof?: { name: string; url: string };
  voided: boolean;
}
export interface Plan {
  id: string;
  sku: string;
  quantity: number;
  shipped: number;
  received: number;
  source: 'local' | 'supply';
  route: 'customer' | 'store';
  mode: 'delivery' | 'pickup';
  recipient: string;
  phone: string;
  address: string;
  at: string;
  voided: boolean;
}
export interface Shipment {
  id: string;
  planId: string;
  sku: string;
  quantity: number;
  at: string;
  recipient: string;
  phone: string;
  address: string;
  voided: boolean;
}
export interface Log {
  id: string;
  at: string;
  actor: string;
  action: string;
  before: string;
  after: string;
}
export interface Order {
  id: string;
  tenantId: number;
  storeId: number;
  customerId: string;
  customerName: string;
  phone: string;
  ownerId: number;
  ownerName: string;
  creator: string;
  status: Status;
  createdAt: string;
  statusAt: string;
  confirmedAt: string;
  due: string;
  lines: Line[];
  discountMode: 'order' | 'items';
  discount: number;
  reduction: number;
  rounding: number;
  freight: number;
  freightDiscount: boolean;
  originalAmount: number | null;
  payments: Payment[];
  plans: Plan[];
  shipments: Shipment[];
  logs: Log[];
}
export interface Setting {
  id: string;
  group: 'nature' | 'method';
  name: string;
  enabled: boolean;
  createdBy?: number;
  createdByName?: string;
  createdAt?: string;
}
export interface State {
  version: 1;
  context: Context;
  products: Product[];
  customers: Customer[];
  orders: Order[];
  settings: Setting[];
}
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const now = () => new Date().toISOString();
export const money = (amount: number) => `¥${amount.toFixed(2)}`;
export const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function demand(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function scopeKey(c: Context) {
  return `zdm-order-prototype-v1:${c.tenantId}:${c.storeId}:${c.identityId}:${c.accountId}`;
}
export function pricing(o: Order) {
  const goods = round(o.lines.reduce((n, l) => n + (l.cancelled === l.quantity ? 0 : l.billingQuantity * l.price), 0));
  const itemDiscount =
    o.discountMode === 'items'
      ? round(
          o.lines.reduce(
            (n, l) => n + (l.cancelled === l.quantity ? 0 : (l.billingQuantity * l.price * (100 - l.discount)) / 100),
            0,
          ),
        )
      : 0;
  const discount =
    o.discountMode === 'order'
      ? round(((goods + (o.freightDiscount ? o.freight : 0)) * (100 - o.discount)) / 100)
      : itemDiscount;
  const total =
    o.status === 'cancelled'
      ? (o.originalAmount ?? round(goods + o.freight - discount - o.reduction - o.rounding))
      : round(goods + o.freight - discount - o.reduction - o.rounding);
  const net = round(
    o.payments.filter((p) => !p.voided).reduce((n, p) => n + (p.kind === 'receipt' ? p.amount : -p.amount), 0),
  );
  const due = o.status === 'cancelled' ? 0 : total;
  return {
    goods,
    discount,
    total,
    net,
    outstanding: Math.max(0, round(due - net)),
    refund: Math.max(0, round(net - due)),
    due,
  };
}
export const remaining = (l: Line) => Math.max(0, l.quantity - l.cancelled - l.shipped);
export function shipmentProgress(o: Order) {
  const shipped = o.lines.reduce((n, l) => n + l.shipped, 0),
    pending = o.lines.reduce((n, l) => n + remaining(l), 0);
  return { shipped, pending, label: pending === 0 ? '全部发货' : shipped > 0 ? '部分发货' : '未发货' };
}
export function warnings(o: Order) {
  const p = pricing(o),
    s = shipmentProgress(o),
    result: string[] = [];
  if (o.status !== 'pending' && o.status !== 'cancelled' && o.lines.some((l) => remaining(l) > l.reserved))
    result.push('缺货待补');
  if (o.due && new Date(`${o.due}T23:59:59+08:00`).getTime() < Date.now() && s.pending > 0 && o.status !== 'cancelled')
    result.push('延期');
  if (p.refund > 0) result.push('待退款');
  if (o.status === 'completed' && s.pending > 0) result.push('发货异常');
  if (o.status === 'completed' && p.outstanding > 0) result.push('收款异常');
  return result;
}
export function settle(o: Order) {
  if (o.status === 'pending' || o.status === 'cancelled' || o.status === 'completed') return;
  const s = shipmentProgress(o);
  if (s.shipped > 0 && o.status === 'confirmed') {
    o.status = 'shipped';
    o.statusAt = now();
  }
  if (s.pending === 0 && s.shipped > 0 && pricing(o).outstanding === 0) {
    o.status = 'completed';
    o.statusAt = now();
  }
}
export function audit(o: Order, c: Context, action: string, before: unknown, after: unknown) {
  o.logs.unshift({
    id: uid(),
    at: now(),
    actor: c.name,
    action,
    before: JSON.stringify(before),
    after: JSON.stringify(after),
  });
}
export function freeStock(state: State, sku: string) {
  return Math.max(
    0,
    (state.products.find((p) => p.sku === sku)?.stock ?? 0) -
      state.orders.reduce((n, o) => n + o.lines.filter((l) => l.sku === sku).reduce((a, l) => a + l.reserved, 0), 0),
  );
}
export function allocate(state: State) {
  const orders = state.orders
    .filter((o) => !['pending', 'cancelled'].includes(o.status))
    .sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt));
  for (const o of orders)
    for (const l of o.lines) l.reserved += Math.min(Math.max(0, remaining(l) - l.reserved), freeStock(state, l.sku));
}
export function blankOrder(c: Context, existing: Order[] = []): Order {
  const t = now();
  return {
    id: generateOrderNumber(existing.map((o) => o.id)),
    tenantId: c.tenantId,
    storeId: c.storeId,
    customerId: '',
    customerName: '',
    phone: '',
    ownerId: c.accountId,
    ownerName: c.name,
    creator: c.name,
    status: 'pending',
    createdAt: t,
    statusAt: t,
    confirmedAt: '',
    due: '',
    lines: [],
    discountMode: 'order',
    discount: 100,
    reduction: 0,
    rounding: 0,
    freight: 0,
    freightDiscount: false,
    originalAmount: null,
    payments: [],
    plans: [],
    shipments: [],
    logs: [],
  };
}
export function addProduct(o: Order, p: Product) {
  demand(o.status === 'pending', '确认后不允许修改商品');
  demand(p.available, '商品未上架');
  const l = o.lines.find((l) => l.sku === p.sku);
  if (l) {
    l.quantity++;
    l.billingQuantity++;
    l.discount = 100;
  } else
    o.lines.push({
      sku: p.sku,
      name: p.name,
      imageUrl: p.imageUrl,
      specification: p.specification,
      material: p.material,
      unit: p.unit,
      quantity: 1,
      billingQuantity: 1,
      price: p.price,
      discount: 100,
      shipped: 0,
      cancelled: 0,
      reserved: 0,
    });
  o.discount = 100;
  o.reduction = 0;
  o.rounding = 0;
}
export function saveDraft(state: State, o: Order, c: Context, newCustomerReason = '') {
  demand(o.status === 'pending', '只有待确认订单可以编辑');
  demand(o.customerName.trim(), '请输入客户姓名');
  demand(o.phone.trim(), '请输入联系电话');
  demand(o.lines.length, '请选择购买商品');
  demand(
    o.lines.every(
      (l) =>
        Number.isInteger(l.quantity) &&
        l.quantity > 0 &&
        l.billingQuantity > 0 &&
        l.price >= 0 &&
        l.discount >= 0 &&
        l.discount <= 100,
    ),
    '请检查商品数量、计价数量、单价和折扣',
  );
  demand(
    o.discount >= 0 &&
      o.discount <= 100 &&
      o.freight >= 0 &&
      o.reduction >= 0 &&
      o.rounding >= 0 &&
      pricing(o).total >= 0,
    '请检查折扣、运费、减免和抹零金额',
  );
  const old = state.orders.find((x) => x.id === o.id);
  if (old) demand(o.customerId === old.customerId, '订单客户不能更换');
  if (!o.customerId) {
    const matches = state.customers.filter((x) => x.phone === o.phone && x.ownerId === c.accountId);
    demand(matches.length === 0 || newCustomerReason.trim(), '同号另建客户必须填写原因');
    const customer = {
      id: uid(),
      name: o.customerName,
      phone: o.phone,
      ownerId: c.accountId,
      reason: newCustomerReason,
    };
    state.customers.push(customer);
    o.customerId = customer.id;
  }
  audit(o, c, old ? '编辑订单' : '创建订单', old ? pricing(old) : null, pricing(o));
  const index = state.orders.findIndex((x) => x.id === o.id);
  if (index < 0) state.orders.unshift(clone(o));
  else state.orders[index] = clone(o);
}
export function confirmOrder(state: State, o: Order, c: Context) {
  demand(o.status === 'pending', '订单已确认');
  for (const l of o.lines) {
    const p = state.products.find((p) => p.sku === l.sku);
    demand(p?.available, `${l.name}已下架，请移除或更换`);
    demand(p.replenishable || freeStock(state, l.sku) >= l.quantity, `${l.name}可售库存不足，不能确认`);
  }
  const before = o.status;
  o.status = 'confirmed';
  o.confirmedAt = now();
  o.statusAt = o.confirmedAt;
  o.originalAmount = pricing(o).total;
  allocate(state);
  audit(o, c, '确认订单', before, o.status);
}
export function copyOrder(state: State, source: Order, c: Context) {
  const o = blankOrder(c, state.orders);
  o.customerId = source.customerId;
  o.customerName = source.customerName;
  o.phone = source.phone;
  for (const line of source.lines) {
    const p = state.products.find((p) => p.sku === line.sku && p.available);
    if (!p) continue;
    addProduct(o, p);
    const target = o.lines.find((l) => l.sku === p.sku)!;
    target.quantity = Math.max(1, line.quantity - line.cancelled);
    target.billingQuantity = line.billingQuantity;
  }
  return o;
}
export function recordPayment(o: Order, p: Payment, c: Context, replaceId?: string) {
  demand(p.amount > 0 && p.method && p.at, '请填写金额、收退款渠道和实际时间');
  if (p.kind === 'receipt') {
    demand(o.status !== 'cancelled' || replaceId, '已取消订单不能新增收款');
    demand(p.nature, '请选择款项名称');
  } else demand(p.reason.trim(), '请输入退款原因');
  const before = clone(o.payments),
    next = clone(o.payments).filter((x) => x.id !== replaceId);
  next.push(p);
  const receipts = next.filter((x) => !x.voided && x.kind === 'receipt').reduce((n, x) => n + x.amount, 0),
    refunds = next.filter((x) => !x.voided && x.kind === 'refund').reduce((n, x) => n + x.amount, 0);
  demand(refunds <= receipts, '累计退款不能超过有效已收款');
  if (p.kind === 'receipt' && !replaceId) demand(receipts - refunds <= pricing(o).due, '净收款不能超过当前应收金额');
  o.payments = next;
  audit(o, c, replaceId ? '更正收退款' : p.kind === 'receipt' ? '登记收款' : '登记退款', before, next);
  settle(o);
}
export function voidPayment(o: Order, id: string, c: Context, reason: string) {
  demand(reason.trim(), '请输入作废原因');
  const p = o.payments.find((x) => x.id === id);
  demand(p && !p.voided, '记录不可作废');
  const before = clone(p);
  p.voided = true;
  audit(o, c, '作废收退款', { record: before }, { record: p, reason });
}
export function planShipment(o: Order, plan: Plan, c: Context) {
  demand(['confirmed', 'shipped'].includes(o.status), '确认订单后才能安排发货');
  const line = o.lines.find((l) => l.sku === plan.sku);
  demand(line, '请选择商品');
  const planned = o.plans
    .filter((p) => !p.voided && p.sku === line.sku)
    .reduce((n, p) => n + p.quantity - p.shipped, 0);
  demand(
    Number.isInteger(plan.quantity) && plan.quantity > 0 && plan.quantity <= remaining(line) - planned,
    '安排数量不能超过尚未安排的待发数量',
  );
  demand(
    plan.mode === 'pickup' || (plan.recipient.trim() && plan.phone.trim() && plan.address.trim()),
    '请填写收货人、电话和地址',
  );
  if (plan.source === 'local') demand(plan.quantity <= line.reserved - planned, '不能发货尚未分配到库存的数量');
  o.plans.push(plan);
  audit(o, c, plan.source === 'supply' ? '向供应链下单' : '安排本店发货', null, plan);
}
export function receivePlan(state: State, o: Order, p: Plan, qty: number, c: Context) {
  demand(!p.voided && p.source === 'supply' && p.route === 'store', '仅中转到店任务可以收货');
  demand(Number.isInteger(qty) && qty > 0 && qty <= p.quantity - p.received, '收货数量超出剩余数量');
  const l = o.lines.find((l) => l.sku === p.sku)!;
  const lacking = Math.max(0, qty - l.reserved);
  if (lacking) {
    state.products.find((x) => x.sku === p.sku)!.stock += lacking;
    allocate(state);
  }
  const before = p.received;
  p.received += qty;
  audit(o, c, '登记到店收货', before, p.received);
}
export function shipPlan(state: State, o: Order, p: Plan, qty: number, at: string, c: Context) {
  demand(!p.voided, '安排已撤销');
  const l = o.lines.find((l) => l.sku === p.sku)!;
  demand(
    Number.isInteger(qty) && qty > 0 && qty <= p.quantity - p.shipped && qty <= l.reserved,
    '发货数量不能超过安排余量及已分配库存',
  );
  demand(p.route !== 'store' || p.source !== 'supply' || qty <= p.received - p.shipped, '先登记实际到店收货');
  demand(at, '请选择实际发货时间');
  p.shipped += qty;
  l.shipped += qty;
  l.reserved -= qty;
  state.products.find((x) => x.sku === p.sku)!.stock -= qty;
  const shipment = {
    id: uid(),
    planId: p.id,
    sku: p.sku,
    quantity: qty,
    at,
    recipient: p.recipient,
    phone: p.phone,
    address: p.address,
    voided: false,
  };
  o.shipments.push(shipment);
  audit(o, c, '登记客户发货', null, shipment);
  settle(o);
}
export function correctShipment(state: State, o: Order, id: string, qty: number, c: Context, reason: string) {
  const shipment = o.shipments.find((s) => s.id === id);
  demand(shipment && !shipment.voided, '发货记录不可更正');
  demand(Number.isInteger(qty) && qty >= 0 && reason.trim(), '请输入正确数量和更正原因');
  const l = o.lines.find((l) => l.sku === shipment.sku)!,
    p = o.plans.find((p) => p.id === shipment.planId)!;
  const delta = qty - shipment.quantity;
  demand(
    delta <= 0 || (delta <= l.reserved && delta <= p.quantity - p.shipped),
    '更正后数量不能超过已分配库存及安排数量',
  );
  const before = clone(shipment);
  l.shipped += delta;
  l.reserved -= delta;
  p.shipped += delta;
  state.products.find((x) => x.sku === l.sku)!.stock -= delta;
  shipment.quantity = qty;
  shipment.voided = qty === 0;
  audit(o, c, '更正客户发货', before, { ...shipment, reason });
  settle(o);
}
export function cancelLines(
  state: State,
  o: Order,
  quantities: Record<string, number>,
  billings: Record<string, number>,
  discount: number,
  reduction: number,
  rounding: number,
  reason: string,
  c: Context,
  options?: { mode: Order['discountMode']; discounts: Record<string, number> },
) {
  demand(!['completed', 'cancelled'].includes(o.status), '订单不可取消');
  demand(reason.trim(), '请输入取消原因');
  demand(discount >= 0 && discount <= 100 && reduction >= 0 && rounding >= 0, '请检查结算优惠');
  const before = { lines: clone(o.lines), amount: pricing(o) };
  const copy = clone(o);
  copy.originalAmount ??= pricing(o).total;
  if (options) {
    copy.discountMode = options.mode;
    for (const l of copy.lines) {
      l.discount = options.discounts[l.sku] ?? l.discount;
      demand(l.discount >= 0 && l.discount <= 100, '请检查商品折扣');
    }
  }
  let changed = false;
  for (const l of copy.lines) {
    const qty = quantities[l.sku] ?? 0;
    demand(Number.isInteger(qty) && qty >= 0 && qty <= remaining(l), '取消数量不能超过未发数量');
    if (!qty) continue;
    changed = true;
    l.cancelled += qty;
    l.reserved = Math.min(l.reserved, remaining(l));
    l.billingQuantity = billings[l.sku] ?? l.billingQuantity;
    demand(l.billingQuantity >= 0, '请核对剩余计价数量');
    const plans = copy.plans.filter((p) => !p.voided && p.sku === l.sku);
    let excess = Math.max(0, plans.reduce((n, p) => n + p.quantity - p.shipped, 0) - remaining(l));
    for (const p of [...plans].reverse()) {
      const release = Math.min(excess, p.quantity - p.shipped);
      p.quantity -= release;
      excess -= release;
      if (p.quantity === 0) p.voided = true;
    }
  }
  demand(changed, '请选择取消商品及数量');
  copy.discount = discount;
  copy.reduction = reduction;
  copy.rounding = rounding;
  if (copy.lines.every((l) => l.quantity === l.cancelled)) {
    copy.status = 'cancelled';
    copy.statusAt = now();
  } else settle(copy);
  demand(pricing(copy).total >= 0, '取消后金额不能为负数');
  audit(copy, c, '取消商品并结算', before, {
    lines: copy.lines,
    amount: pricing(copy),
    reason,
    notice: '对应取消数量的未执行安排已撤销；通知为本地模拟事件',
  });
  Object.assign(o, copy);
  allocate(state);
}
export function updateTerms(
  o: Order,
  c: Context,
  freight: number,
  due: string,
  ownerId: number,
  ownerName: string,
  reason: string,
) {
  demand(!['completed', 'cancelled'].includes(o.status), '已完成或已取消订单不允许修改');
  demand(freight >= 0 && reason.trim(), '请输入非负运费和修改原因');
  const before = { freight: o.freight, due: o.due, owner: o.ownerName };
  o.freight = freight;
  o.due = due;
  o.ownerId = ownerId;
  o.ownerName = ownerName;
  audit(o, c, '调整运费、交期或负责人', before, { freight, due, owner: ownerName, reason, amount: pricing(o) });
  settle(o);
}
export function createState(c: Context): State {
  const state: State = {
    version: 1,
    context: clone(c),
    products: [
      {
        sku: 'CT-001',
        name: '云雾白大理石餐桌',
        specification: '1800 × 900 × 750 mm',
        material: '天然大理石',
        unit: '件',
        price: 9800,
        stock: 4,
        replenishable: false,
        local: true,
        available: true,
      },
      {
        sku: 'CT-002',
        name: '鱼肚白圆餐桌',
        specification: '直径 1300 × 750 mm',
        material: '天然大理石',
        unit: '件',
        price: 12800,
        stock: 2,
        replenishable: false,
        local: false,
        available: true,
      },
      {
        sku: 'CH-001',
        name: '实木餐椅',
        specification: '480 × 520 × 800 mm',
        material: '实木 / 皮革',
        unit: '件',
        price: 860,
        stock: 18,
        replenishable: false,
        local: true,
        available: true,
      },
      {
        sku: 'AC-001',
        name: '标准安装连接件',
        specification: '标准规格',
        material: '不锈钢',
        unit: '件',
        price: 60,
        stock: 0,
        replenishable: true,
        local: false,
        available: true,
      },
      {
        sku: 'CT-003',
        name: '黑金花茶几',
        specification: '1200 × 600 × 420 mm',
        material: '天然大理石',
        unit: '件',
        price: 5600,
        stock: 0,
        replenishable: false,
        local: false,
        available: true,
      },
    ],
    customers: [{ id: 'customer-1', name: '小李（示例）', phone: '13800000001', ownerId: c.accountId, reason: '' }],
    orders: [],
    settings: [],
  };
  for (const [i, entry] of statuses.entries()) {
    const status = entry.value;
    const o = blankOrder(c, state.orders);
    o.customerId = 'customer-1';
    o.customerName = ['小李（示例）', '王女士（示例）', '陈先生（示例）', '刘女士（示例）', '周先生（示例）'][i]!;
    o.phone = `1380000000${i + 1}`;
    addProduct(o, state.products[i === 2 ? 2 : 0]!);
    o.status = status;
    o.due = i === 2 ? '2026-01-01' : '';
    if (status !== 'pending') {
      o.confirmedAt = now();
      o.originalAmount = pricing(o).total;
    }
    if (status === 'shipped') {
      o.lines[0]!.quantity = 4;
      o.lines[0]!.billingQuantity = 4;
      o.lines[0]!.shipped = 2;
    }
    if (status === 'completed') {
      o.lines[0]!.shipped = 1;
      o.payments.push({
        id: uid(),
        kind: 'receipt',
        amount: pricing(o).total,
        nature: '全款',
        method: '银行转账',
        at: now(),
        reason: '',
        remark: '示例收款',
        voided: false,
      });
    }
    if (status === 'cancelled') o.lines[0]!.cancelled = 1;
    audit(o, c, '载入示例订单', null, status);
    state.orders.push(o);
  }
  allocate(state);
  return state;
}

/** Remove old setting fixtures and update only legacy demo numbers; preserve user-created data. */
export function removeDefaultSettings(state: State) {
  state.settings = state.settings.filter((s) => !/^(nature-[0-4]|method-[0-3])$/.test(s.id));
  for (const order of state.orders) {
    if (
      /^XS-DEMO-00[1-5]$/.test(order.id) ||
      (/^(xs\d{17}|XS\d{10}|XS\d{12}|XS\d{14})$/.test(order.id) &&
        order.logs.some((log) => log.action === '载入示例订单'))
    )
      order.id = generateOrderNumber(state.orders.map((existing) => existing.id));
  }
  return state;
}
