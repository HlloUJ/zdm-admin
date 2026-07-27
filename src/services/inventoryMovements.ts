import { request } from './http';

export type InventoryType = 'finished_product' | 'slab';
export type MovementType = 'initial' | 'adjustment' | 'status_change' | 'inbound' | 'outbound';

export interface InventoryMovementRecord {
  id: number;
  inventoryType: InventoryType;
  inventoryId: number;
  movementType: MovementType;
  quantity?: number;
  beforeQuantity?: number;
  afterQuantity?: number;
  reason?: string;
  operatorId?: number;
  remark?: string;
  createdAt?: string;
}

export interface InventoryMovementPayload {
  inventoryType: InventoryType;
  inventoryId: number;
  movementType: MovementType;
  quantity?: number;
  beforeQuantity?: number;
  afterQuantity?: number;
  reason?: string;
  operatorId?: number;
  remark?: string;
}

export function listInventoryMovements() {
  return request<InventoryMovementRecord[]>('/admin/inventory-movements');
}

export function createInventoryMovement(payload: InventoryMovementPayload) {
  return request<InventoryMovementRecord>('/admin/inventory-movements', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
