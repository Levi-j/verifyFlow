# Fractional inventory adjustments are accepted and truncated

- **Status:** Open — reproduced October 10, 2026
- **Severity:** Medium
- **Priority:** P2
- **Affected endpoint:** `POST /api/v1/admin/inventory/{productId}/adjustments`

## Summary

OrderFlow accepts a fractional inventory adjustment but applies only its integer portion. Submitting `quantityChange: 1.5` returns HTTP 200, increases stock by one unit, and records a movement of `+1`. The API reports success even though it has changed the requested adjustment.

This endpoint requires administrator access, which limits exposure, but the mismatch can lead to incorrect stock levels and misleading inventory records.

## Environment

- **OrderFlow revision:** `c0d77be16050cfa86e091b06f0c2873258477727`
- **Stack:** Java 21, Spring Boot 4.1, PostgreSQL 18
- **Test environment:** Isolated `verifyflow-sut` Docker Compose stack
- **API address:** `http://127.0.0.1:18080`

## Steps to reproduce

1. Authenticate as an administrator and create an active product with a unique SKU and a valid price using `POST /api/v1/admin/products`. Save its ID.
2. Restock the product by five units using `POST /api/v1/admin/inventory/{productId}/adjustments` with `{"quantityChange":5,"reason":"RESTOCK"}`.
3. Confirm that `GET /api/v1/admin/inventory/{productId}` returns a stock quantity of 5, and record the existing movements.
4. Submit the following adjustment, replacing the placeholders:

   ```http
   POST /api/v1/admin/inventory/<PRODUCT_ID>/adjustments HTTP/1.1
   Host: 127.0.0.1:18080
   Authorization: Bearer <ADMIN_TOKEN>
   Content-Type: application/json
   X-Request-Id: vf-repro-inventory-<UNIQUE_SUFFIX>

   {"quantityChange":1.5,"reason":"ADJUSTMENT"}
   ```

5. Retrieve the stock quantity and movement history again.

## Expected result

The API rejects the fractional quantity with HTTP 400. Stock remains at 5, and no movement is added. Inventory adjustments are defined in whole units; the request should not be silently converted to a different value.

## Actual result

The API returns **HTTP 200** with `quantityOnHand: 6`. It adds one `ADJUSTMENT` movement with `quantityChange: 1`, `orderId: null`, and the administrator as the performer. The original restock movement is unchanged. No application error code is returned because the request succeeds.

## Reproduction evidence

The `1.5` case reproduced on **three separate products (3/3)** on October 10, 2026.

| Product ID | Submitted quantity |  HTTP | Stock | New movement            | Request ID                                        |
| ---------- | -----------------: | ----: | ----- | ----------------------- | ------------------------------------------------- |
| `3459`     |              `1.5` | `200` | 5 → 6 | `3953`, `ADJUSTMENT +1` | `vf-m10-inv-47d465cf-f8d3-45bf-97e2-1580ec0c58da` |
| `3460`     |              `1.5` | `200` | 5 → 6 | `3955`, `ADJUSTMENT +1` | `vf-m10-inv-75555907-f154-4aff-947a-c039cf85198e` |
| `3461`     |              `1.5` | `200` | 5 → 6 | `3957`, `ADJUSTMENT +1` | `vf-m10-inv-8b325265-f883-4434-8bec-28379cf031fa` |
| `3462`     |             `-0.9` | `400` | 5 → 5 | None                    | `vf-m10-inv-c0537835-c25c-4fd2-b60d-ee6c5ce112cb` |

For each successful adjustment, application logs contained an `inventory.adjusted` event recording `quantityChange: 1` and an `http.request` event with status 200, correlated by request ID.

The additional `-0.9` request returned `VALIDATION_FAILED` with the message `quantityChange must not be zero`. No stock or movement changes occurred. This is consistent with truncation toward zero before validation.

The original investigation also recorded `vf-truncation-1` through `vf-truncation-3`. Those IDs are historical; the table above contains the fresh reproduction evidence. The test database and application logs are disposable, so the recorded resource and request IDs may not remain available.

## Suspected cause and recommendation

The pinned [InventoryAdjustmentRequest](https://github.com/Levi-j/orderFlow-backend/blob/c0d77be16050cfa86e091b06f0c2873258477727/src/main/java/io/github/levij/orderflow/inventory/dto/InventoryAdjustmentRequest.java) declares `quantityChange` as `Integer`. Its [validator](https://github.com/Levi-j/orderFlow-backend/blob/c0d77be16050cfa86e091b06f0c2873258477727/src/main/java/io/github/levij/orderflow/inventory/dto/InventoryAdjustmentValidator.java) checks for zero and invalid restock values after deserialization.

The results suggest JSON floating-point values are being coerced to integers before validation. The effective Jackson coercion settings have **not** been verified, so this remains a suspected cause rather than a confirmed root cause.

Reject fractional quantities during JSON binding and add backend regression tests asserting HTTP 400 with no changes to stock or movement history. This report documents the defect; verifyFlow does not modify OrderFlow or treat the behavior as an accepted API contract.
