export const MAX_NOTE_LENGTH = 500;
export const INT32_MAX = 2_147_483_647;

export type AdjustmentReason = 'RESTOCK' | 'ADJUSTMENT';

export interface InventoryAdjustment {
  quantityChange: number;
  reason: AdjustmentReason;
  note?: string;
}

export function restock(quantity: number, note?: string): InventoryAdjustment {
  return { quantityChange: quantity, reason: 'RESTOCK', note };
}

export function adjustBy(quantityChange: number, note?: string): InventoryAdjustment {
  return { quantityChange, reason: 'ADJUSTMENT', note };
}
