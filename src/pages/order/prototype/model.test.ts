import { describe, it, expect } from 'vitest';
import {
  createState,
  blankOrder,
  addProduct,
  saveDraft,
  confirmOrder,
  pricing,
  recordPayment,
  shipPlan,
  planShipment,
  receivePlan,
  cancelLines,
  correctShipment,
  voidPayment,
  allocate,
  copyOrder,
  warnings,
  scopeKey,
  clone,
  uid,
  now,
  type Context,
  type Order,
  type Plan,
  type Payment,
} from './model';
import { hasMenuPermission, hasPermission } from '@/services/adminPermissions';
import { getFunctionCatalogPermissionValues, filterFunctionCatalogByAudience } from '@/services/functionCatalog';
import type { LoginUser } from '@/services/auth';
const c: Context = { tenantId: 1, storeId: 2, identityId: 3, accountId: 7, name: '原型导购' };
function fixture() {
  const s = createState(c);
  s.orders = [];
  return s;
}
function order(s: ReturnType<typeof fixture>, sku = 'CT-001', qty = 1) {
  const o = blankOrder(c);
  o.customerName = '测试客户';
  o.phone = '13800000002';
  o.customerId = s.customers.find((x) => x.phone === o.phone && x.ownerId === c.accountId)?.id ?? '';
  addProduct(
    o,
    s.products.find((p) => p.sku === sku)!,
  );
  o.lines[0]!.quantity = qty;
  o.lines[0]!.billingQuantity = qty;
  saveDraft(s, o, c);
  return s.orders[0]!;
}
function pay(o: Order, amount: number, kind: Payment['kind'] = 'receipt') {
  recordPayment(
    o,
    {
      id: uid(),
      kind,
      amount,
      nature: '全款',
      method: '微信',
      at: now(),
      reason: kind === 'refund' ? '线下退款' : '',
      remark: '',
      voided: false,
    },
    c,
  );
}
function plan(o: Order, quantity = 1, source: Plan['source'] = 'local', route: Plan['route'] = 'customer') {
  const p: Plan = {
    id: uid(),
    sku: o.lines[0]!.sku,
    quantity,
    source,
    route,
    mode: 'pickup',
    recipient: '',
    phone: '',
    address: '',
    shipped: 0,
    received: 0,
    at: now(),
    voided: false,
  };
  planShipment(o, p, c);
  return p;
}
describe('store order prototype business boundaries', () => {
  it('keeps drafts inventory-free and rejects sold-out finished goods on confirmation', () => {
    const s = fixture(),
      o = order(s, 'CT-003');
    expect(o.lines[0]!.reserved).toBe(0);
    expect(() => confirmOrder(s, o, c)).toThrow('库存不足');
    expect(o.status).toBe('pending');
  });
  it('allows replenishable accessories to wait for stock without inventing stock', () => {
    const s = fixture(),
      o = order(s, 'AC-001', 3);
    confirmOrder(s, o, c);
    expect(o.status).toBe('confirmed');
    expect(o.lines[0]!.reserved).toBe(0);
    expect(warnings(o)).toContain('缺货待补');
  });
  it('does not ship an accessory before inventory is allocated', () => {
    const s = fixture(),
      o = order(s, 'AC-001');
    confirmOrder(s, o, c);
    const p = plan(o, 1, 'supply');
    expect(() => shipPlan(s, o, p, 1, now(), c)).toThrow('已分配库存');
  });
  it('keeps one SKU line and resets discounts when adding quantities', () => {
    const s = fixture(),
      o = order(s);
    o.discount = 90;
    o.lines[0]!.discount = 80;
    addProduct(o, s.products[0]!);
    expect(o.lines).toHaveLength(1);
    expect(o.lines[0]!.quantity).toBe(2);
    expect(o.discount).toBe(100);
    expect(o.lines[0]!.discount).toBe(100);
  });
  it('does not change order snapshots when the catalog price changes', () => {
    const s = fixture(),
      o = order(s);
    s.products[0]!.price = 1;
    expect(o.lines[0]!.price).toBe(9800);
  });
  it('rejects down-shelved items at confirmation without mutating the order', () => {
    const s = fixture(),
      o = order(s);
    s.products[0]!.available = false;
    expect(() => confirmOrder(s, o, c)).toThrow('下架');
    expect(o.status).toBe('pending');
  });
  it('uses item or whole-order discounts exclusively, then reduction and rounding', () => {
    const s = fixture(),
      o = order(s);
    o.lines[0]!.price = 100;
    o.freight = 20;
    o.discount = 50;
    o.lines[0]!.discount = 90;
    o.discountMode = 'items';
    o.reduction = 5;
    o.rounding = 1;
    expect(pricing(o).total).toBe(104);
    o.discountMode = 'order';
    expect(pricing(o).total).toBe(64);
    o.freightDiscount = true;
    expect(pricing(o).total).toBe(54);
  });
  it('accepts money in pending but does not advance the order', () => {
    const s = fixture(),
      o = order(s);
    pay(o, 100);
    expect(o.status).toBe('pending');
    expect(o.lines[0]!.reserved).toBe(0);
  });
  it('limits net receipts and allows re-collection after a refund', () => {
    const s = fixture(),
      o = order(s);
    pay(o, 9800);
    expect(() => pay(o, 1)).toThrow('净收款');
    pay(o, 200, 'refund');
    pay(o, 200);
    expect(pricing(o).net).toBe(9800);
    expect(() => pay(o, 9801, 'refund')).toThrow('累计退款');
  });
  it('requires confirmation before planning or shipping', () => {
    const s = fixture(),
      o = order(s);
    expect(() => plan(o)).toThrow('确认订单后');
  });
  it('allows shipment without payment, then automatically completes on collection', () => {
    const s = fixture(),
      o = order(s);
    confirmOrder(s, o, c);
    const p = plan(o);
    shipPlan(s, o, p, 1, now(), c);
    expect(o.status).toBe('shipped');
    pay(o, 9800);
    expect(o.status).toBe('completed');
  });
  it('keeps a paid partial shipment in shipped state', () => {
    const s = fixture(),
      o = order(s, 'CH-001', 3);
    confirmOrder(s, o, c);
    pay(o, pricing(o).total);
    shipPlan(s, o, plan(o, 3), 1, now(), c);
    expect(o.status).toBe('shipped');
    expect(o.lines[0]!.shipped).toBe(1);
  });
  it('counts arrival at the store separately from customer delivery', () => {
    const s = fixture(),
      o = order(s);
    confirmOrder(s, o, c);
    const p = plan(o, 1, 'supply', 'store');
    receivePlan(s, o, p, 1, c);
    expect(o.status).toBe('confirmed');
    expect(o.lines[0]!.shipped).toBe(0);
    shipPlan(s, o, p, 1, now(), c);
    expect(o.status).toBe('shipped');
  });
  it('does not allow the same quantity to be arranged twice', () => {
    const s = fixture(),
      o = order(s);
    confirmOrder(s, o, c);
    plan(o);
    expect(() => plan(o)).toThrow('尚未安排');
  });
  it('retains completed state and shows a payment warning after a refund', () => {
    const s = fixture(),
      o = order(s);
    confirmOrder(s, o, c);
    shipPlan(s, o, plan(o), 1, now(), c);
    pay(o, 9800);
    pay(o, 100, 'refund');
    expect(o.status).toBe('completed');
    expect(warnings(o)).toContain('收款异常');
    pay(o, 100);
    expect(warnings(o)).not.toContain('收款异常');
  });
  it('restores mis-deducted stock to the original order, without reverting completion', () => {
    const s = fixture(),
      o = order(s);
    confirmOrder(s, o, c);
    shipPlan(s, o, plan(o), 1, now(), c);
    pay(o, 9800);
    const stock = s.products[0]!.stock;
    correctShipment(s, o, o.shipments[0]!.id, 0, c, '误登记');
    expect(s.products[0]!.stock).toBe(stock + 1);
    expect(o.lines[0]!.reserved).toBe(1);
    expect(o.status).toBe('completed');
    expect(warnings(o)).toContain('发货异常');
  });
  it('keeps original records when voiding a payment', () => {
    const s = fixture(),
      o = order(s);
    pay(o, 100);
    voidPayment(o, o.payments[0]!.id, c, '误记');
    expect(o.payments).toHaveLength(1);
    expect(o.payments[0]!.voided).toBe(true);
    expect(pricing(o).net).toBe(0);
    expect(o.logs[0]!.before).toContain('100');
  });
  it('fully cancels an unshipped order, retains original amount and blocks receipts', () => {
    const s = fixture(),
      o = order(s);
    confirmOrder(s, o, c);
    pay(o, 100);
    cancelLines(s, o, { 'CT-001': 1 }, { 'CT-001': 0 }, 100, 0, 0, '客户取消', c);
    expect(o.status).toBe('cancelled');
    expect(o.originalAmount).toBe(9800);
    expect(pricing(o).due).toBe(0);
    expect(pricing(o).refund).toBe(100);
    expect(() => pay(o, 1)).toThrow('不能新增收款');
  });
  it('reduces only cancelled quantities of existing plans and releases reservations', () => {
    const s = fixture(),
      o = order(s, 'CH-001', 5);
    confirmOrder(s, o, c);
    const p = plan(o, 5);
    cancelLines(s, o, { 'CH-001': 2 }, { 'CH-001': 3 }, 100, 0, 0, '减少数量', c);
    expect(p.id).toBe(o.plans[0]!.id);
    expect(o.plans[0]!.quantity).toBe(3);
    expect(o.lines[0]!.reserved).toBe(3);
    expect(o.status).toBe('confirmed');
    expect(pricing(o).total).toBe(2580);
  });
  it('finishes a partially shipped order after cancelling its rest and settling', () => {
    const s = fixture(),
      o = order(s, 'CH-001', 3);
    confirmOrder(s, o, c);
    shipPlan(s, o, plan(o, 3), 1, now(), c);
    pay(o, 2580);
    cancelLines(s, o, { 'CH-001': 2 }, { 'CH-001': 1 }, 100, 0, 0, '不再购买', c);
    expect(o.status).toBe('completed');
    expect(pricing(o).refund).toBe(1720);
  });
  it('allocates only new free stock by confirmation time without stealing reservations', () => {
    const s = fixture(),
      a = order(s, 'AC-001', 2);
    confirmOrder(s, a, c);
    a.confirmedAt = '2026-01-01';
    const b = order(s, 'AC-001', 2);
    confirmOrder(s, b, c);
    b.confirmedAt = '2026-01-02';
    s.products.find((p) => p.sku === 'AC-001')!.stock = 3;
    allocate(s);
    expect(a.lines[0]!.reserved).toBe(2);
    expect(b.lines[0]!.reserved).toBe(1);
    a.confirmedAt = '2026-01-03';
    allocate(s);
    expect(a.lines[0]!.reserved).toBe(2);
  });
  it('copies current prices, skipping off-shelf products and all execution records', () => {
    const s = fixture(),
      o = order(s);
    pay(o, 100);
    s.products[0]!.price = 1000;
    const copy = copyOrder(s, o, c);
    expect(copy.id).not.toBe(o.id);
    expect(copy.status).toBe('pending');
    expect(copy.lines[0]!.price).toBe(1000);
    expect(copy.payments).toEqual([]);
    expect(copy.plans).toEqual([]);
    expect(copy.lines[0]!.reserved).toBe(0);
    s.products[0]!.available = false;
    expect(copyOrder(s, o, c).lines).toEqual([]);
  });
  it('isolates local prototype partitions by identity and organization', () => {
    expect(scopeKey(c)).not.toBe(scopeKey({ ...c, storeId: 3 }));
    expect(scopeKey(c)).not.toBe(scopeKey({ ...c, accountId: 8 }));
    expect(scopeKey(c)).not.toBe(scopeKey({ ...c, identityId: 4 }));
  });
  it('does not overwrite a customer profile while saving an order snapshot', () => {
    const s = fixture(),
      o = order(s);
    const customer = clone(s.customers.find((x) => x.id === o.customerId)!);
    const edited = clone(o);
    edited.customerName = '订单联系人更正';
    saveDraft(s, edited, c);
    expect(s.customers.find((x) => x.id === o.customerId)).toEqual(customer);
  });
  it('requires a reason before making a new same-phone customer', () => {
    const s = fixture(),
      o = order(s);
    const next = blankOrder(c);
    next.customerName = '同号不同客户';
    next.phone = o.phone;
    addProduct(next, s.products[0]!);
    expect(() => saveDraft(s, next, c)).toThrow('同号另建');
    saveDraft(s, next, c, '号码已更换持有人');
    expect(next.customerId).not.toBe(o.customerId);
  });
});
describe('prototype audience and catalog', () => {
  const user = (audience: string, permissions = ['all']): LoginUser => ({
    id: 7,
    name: '测试',
    phone: '',
    roles: [],
    permissions,
    clientCode: audience === 'supply-chain' ? 'supply-chain' : 'admin',
    tenantId: audience === 'admin' ? undefined : 1,
    storeId: audience === 'admin' || audience === 'supply-chain' ? undefined : 2,
    storeType: audience === 'supplier' ? 'slabSupplier' : 'cityPartner',
  });
  it.each(['admin', 'supplier', 'supply-chain'] as const)(
    'never exposes store order menu to %s, even with all',
    (audience) => {
      expect(hasMenuPermission(user(audience), 'store.order-management.sales')).toBe(false);
      expect(
        getFunctionCatalogPermissionValues(filterFunctionCatalogByAudience(audience)).some((p) =>
          p.startsWith('store.order-management'),
        ),
      ).toBe(false);
    },
  );
  it('retains explicit role permission checks inside store', () => {
    expect(hasMenuPermission(user('store', []), 'store.order-management.sales')).toBe(false);
    const u = user('store', ['store.order-management.sales.pending.view']);
    expect(hasMenuPermission(u, 'store.order-management.sales')).toBe(true);
    expect(hasPermission(u, 'store.order-management.sales.pending.confirm')).toBe(false);
    expect(hasPermission(u, 'store.order-management.sales.completed.view')).toBe(false);
  });
  it('registers exact five status views, without query and reset operations', () => {
    const values = getFunctionCatalogPermissionValues(filterFunctionCatalogByAudience('store')).filter((p) =>
      p.startsWith('store.order-management.sales'),
    );
    expect(values.filter((p) => p.endsWith('.view'))).toHaveLength(5);
    expect(values.some((p) => p.endsWith('.query') || p.endsWith('.reset'))).toBe(false);
  });
});
