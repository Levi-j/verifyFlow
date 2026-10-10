import { adjustmentsPath, InventoryApi } from '../../../src/api/inventory-api';
import type { ErrorCode } from '../../../src/contracts/problem';
import { INT32_MAX, MAX_NOTE_LENGTH, restock } from '../../../src/data/inventory';
import { expect, test } from '../../../src/fixtures/test';
import { allMovements, inventoryState } from '../../../src/support/inventory-state';

const UNKNOWN_PRODUCT_ID = Number.MAX_SAFE_INTEGER;

interface RejectedAdjustment {
  description: string;
  body: Record<string, unknown>;
  code: ErrorCode;
  fields?: string[];
}

const rejectedAdjustments: RejectedAdjustment[] = [
  {
    description: 'a zero ADJUSTMENT',
    body: { quantityChange: 0, reason: 'ADJUSTMENT' },
    code: 'VALIDATION_FAILED',
    fields: ['quantityChange'],
  },
  {
    description: 'a zero RESTOCK',
    body: { quantityChange: 0, reason: 'RESTOCK' },
    code: 'VALIDATION_FAILED',
    fields: ['quantityChange'],
  },
  {
    description: 'a negative RESTOCK',
    body: { quantityChange: -1, reason: 'RESTOCK' },
    code: 'VALIDATION_FAILED',
    fields: ['quantityChange'],
  },
  {
    description: 'a missing quantity change',
    body: { reason: 'RESTOCK' },
    code: 'VALIDATION_FAILED',
    fields: ['quantityChange'],
  },
  {
    description: 'a null quantity change',
    body: { quantityChange: null, reason: 'RESTOCK' },
    code: 'VALIDATION_FAILED',
    fields: ['quantityChange'],
  },
  {
    description: 'a missing reason',
    body: { quantityChange: 1 },
    code: 'VALIDATION_FAILED',
    fields: ['reason'],
  },
  {
    description: 'a null reason',
    body: { quantityChange: 1, reason: null },
    code: 'VALIDATION_FAILED',
    fields: ['reason'],
  },
  {
    description: `a note longer than ${MAX_NOTE_LENGTH} characters`,
    body: { quantityChange: 1, reason: 'RESTOCK', note: 'n'.repeat(MAX_NOTE_LENGTH + 1) },
    code: 'VALIDATION_FAILED',
    fields: ['note'],
  },
  {
    description: 'an empty body',
    body: {},
    code: 'VALIDATION_FAILED',
    fields: ['quantityChange', 'reason'],
  },
  {
    description: 'a quantity change given as text',
    body: { quantityChange: 'ten', reason: 'RESTOCK' },
    code: 'MALFORMED_REQUEST',
  },
  {
    description: 'a quantity change given as a boolean',
    body: { quantityChange: true, reason: 'RESTOCK' },
    code: 'MALFORMED_REQUEST',
  },
  {
    description: 'a quantity change beyond the 32-bit integer range',
    body: { quantityChange: INT32_MAX + 1, reason: 'RESTOCK' },
    code: 'MALFORMED_REQUEST',
  },
  {
    description: 'an unsupported reason',
    body: { quantityChange: 1, reason: 'REFUND' },
    code: 'MALFORMED_REQUEST',
  },
  {
    description: 'a reason reserved for orders',
    body: { quantityChange: 1, reason: 'ORDER_PLACED' },
    code: 'MALFORMED_REQUEST',
  },
  {
    description: 'a reason in lowercase',
    body: { quantityChange: 1, reason: 'restock' },
    code: 'MALFORMED_REQUEST',
  },
];

test.describe('Inventory adjustment validation', () => {
  for (const { description, body, code, fields = [] } of rejectedAdjustments) {
    test(`rejects ${description} without changing stock or history`, async ({
      admin,
      createProduct,
    }) => {
      const product = await createProduct({ stock: 5 });
      const inventory = new InventoryApi(admin);
      const before = await inventoryState(inventory, product.id);

      const response = await admin.post(adjustmentsPath(product.id), { body });

      await expect(response).toBeProblem(400, code, { fields });
      expect(await inventoryState(inventory, product.id)).toEqual(before);
    });
  }

  const acceptedNotes = [
    { description: 'no note', note: undefined, stored: null },
    { description: 'an empty note', note: '', stored: '' },
    {
      description: `a note of exactly ${MAX_NOTE_LENGTH} characters`,
      note: 'n'.repeat(MAX_NOTE_LENGTH),
      stored: 'n'.repeat(MAX_NOTE_LENGTH),
    },
  ];

  for (const { description, note, stored } of acceptedNotes) {
    test(`accepts an adjustment with ${description}`, async ({ admin, createProduct }) => {
      const product = await createProduct();
      const inventory = new InventoryApi(admin);

      const response = await inventory.adjust(product.id, restock(1, note));

      expect(response.status()).toBe(200);
      const [movement] = await allMovements(inventory, product.id);
      expect(movement?.note).toBe(stored);
    });
  }

  test('returns 404 for a valid adjustment to an unknown product', async ({ admin }) => {
    const response = await new InventoryApi(admin).adjust(UNKNOWN_PRODUCT_ID, restock(1));

    await expect(response).toBeProblem(404, 'RESOURCE_NOT_FOUND');
  });

  test('validates the request before looking up the product', async ({ admin }) => {
    const response = await admin.post(adjustmentsPath(UNKNOWN_PRODUCT_ID), {
      body: { quantityChange: 0, reason: 'RESTOCK' },
    });

    await expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields: ['quantityChange'] });
  });
});
