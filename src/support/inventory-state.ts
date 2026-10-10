import type { APIResponse } from '@playwright/test';
import type { InventoryApi } from '../api/inventory-api';
import {
  inventorySchema,
  movementPageSchema,
  type InventoryMovement,
} from '../contracts/inventory';
import { parseResponse } from '../contracts/parse-response';
import { describeResponse } from './api-diagnostics';

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export interface InventoryState {
  quantityOnHand: number;
  movements: InventoryMovement[];
}

export async function inventoryState(
  inventory: InventoryApi,
  productId: number,
): Promise<InventoryState> {
  const stock = await inventory.getStock(productId);
  await requireOk(stock, `Reading stock for product ${productId}`);
  const { quantityOnHand } = await parseResponse(stock, inventorySchema);
  return { quantityOnHand, movements: await allMovements(inventory, productId) };
}

export async function allMovements(
  inventory: InventoryApi,
  productId: number,
): Promise<InventoryMovement[]> {
  const movements: InventoryMovement[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await inventory.listMovements(productId, { page, size: PAGE_SIZE });
    await requireOk(response, `Listing movements for product ${productId}`);
    const { content, totalPages } = await parseResponse(response, movementPageSchema);
    movements.push(...content);
    if (page + 1 >= totalPages) {
      return movements;
    }
  }
  throw new Error(`Product ${productId} has more than ${MAX_PAGES * PAGE_SIZE} movements.`);
}

async function requireOk(response: APIResponse, step: string): Promise<void> {
  if (response.status() !== 200) {
    throw new Error(`${step} returned ${await describeResponse(response)}; expected HTTP 200.`);
  }
}
