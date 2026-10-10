# Fractional order quantities create orders with truncated values

- **Status:** Open — reproduced October 10, 2026
- **Severity:** Medium
- **Priority:** P2
- **Affected endpoint:** `POST /api/v1/orders`

## Summary

OrderFlow accepts a fractional item quantity and creates an order using only its integer portion. A request for `1.5` units returns HTTP 201, but the saved order contains one unit, with the total and inventory deduction calculated for that one unit.

The resulting order is internally consistent, but it does not match what the customer submitted. This can mask client-side input mistakes and lead to unexpected fulfillment quantities.

## Environment

- **OrderFlow revision:** `c0d77be16050cfa86e091b06f0c2873258477727`
- **Stack:** Java 21, Spring Boot 4.1, PostgreSQL 18
- **Test environment:** Isolated `verifyflow-sut` Docker Compose stack
- **API address:** `http://127.0.0.1:18080`

## Steps to reproduce

1. As an administrator, create an active product with a unique SKU and a price of `4.25` using `POST /api/v1/admin/products`. Save its ID.
2. Restock the product with `{"quantityChange":10,"reason":"RESTOCK"}`. Confirm that stock is 10 and record the movement history.
3. Register a new customer via `/api/v1/auth/register` and log in via `/api/v1/auth/login`.
4. Submit the order using the **customer's** bearer token and a fresh idempotency key. Replace the placeholders, including the numeric product ID:

   ```http
   POST /api/v1/orders HTTP/1.1
   Host: 127.0.0.1:18080
   Authorization: Bearer <CUSTOMER_TOKEN>
   Content-Type: application/json
   Idempotency-Key: vf-repro-order-<UNIQUE_SUFFIX>
   X-Request-Id: vf-repro-order-<UNIQUE_SUFFIX>

   {"items":[{"productId":<PRODUCT_ID>,"quantity":1.5}]}
   ```

5. Inspect the response and the customer's `GET /api/v1/orders` listing. As the administrator, retrieve the product's stock and movement history.

## Expected result

The API rejects the fractional quantity with HTTP 400. No order is created, stock stays at 10, and no `ORDER_PLACED` movement is recorded. Item quantities are whole units and should not be silently altered.

## Actual result

The API returns **HTTP 201** and creates a `PENDING` order containing:

- `quantity: 1`
- `unitPrice: 4.25`
- `lineTotal: 4.25`
- Order total: `4.25`

Stock falls from 10 to 9. One `ORDER_PLACED` movement deducts a single unit, references the new order, and identifies the customer as the performer. The customer can retrieve the order normally. No application error code is returned because creation succeeds.

## Reproduction evidence

The `1.5` case reproduced with **three independent customer/product/key combinations (3/3)** on October 10, 2026. Two further values were checked to characterize the behavior.

| Product ID | Submitted quantity |  HTTP | Order ID / saved quantity | Stock   | Request ID                                          |
| ---------- | -----------------: | ----: | ------------------------- | ------- | --------------------------------------------------- |
| `3463`     |              `1.5` | `201` | `1112` / `1`              | 10 → 9  | `vf-m10-order-09905c2a-0474-4aa6-8d84-98d3844e887a` |
| `3464`     |              `1.5` | `201` | `1113` / `1`              | 10 → 9  | `vf-m10-order-46843df7-a926-42bc-8b8f-51e7166594a2` |
| `3465`     |              `1.5` | `201` | `1114` / `1`              | 10 → 9  | `vf-m10-order-3b431e86-faf2-4aff-af6c-b9be3c68c130` |
| `3466`     |              `2.9` | `201` | `1115` / `2`              | 10 → 8  | `vf-m10-order-c4d3869e-e265-4c84-80c5-3b418b22a8e6` |
| `3467`     |              `0.5` | `400` | No order                  | 10 → 10 | `vf-m10-order-be5b7bca-5090-4628-bbd7-eafeafc25395` |

The first three orders produced placement movements `3960`, `3962`, and `3964`, each recording `-1`. The `2.9` request created movement `3966` with `-2` and an order total of `8.50`.

The `0.5` request returned `VALIDATION_FAILED` for `items[0].quantity` with the message `must be greater than or equal to 1`. It created no order and did not change inventory.

Application logs linked the four successful `order.placed` events to their request IDs, with corresponding `http.request` status 201 entries. The returned order data and inventory reads establish the saved quantities; the logs establish the request correlation.

The earlier M7 investigation recorded `vf-order-truncation-1` through `vf-order-truncation-3`. Those references are historical. The table above contains fresh observations, and the disposable test database and logs may not be retained.

## Suspected cause and recommendation

The pinned [OrderItemRequest](https://github.com/Levi-j/orderFlow-backend/blob/c0d77be16050cfa86e091b06f0c2873258477727/src/main/java/io/github/levij/orderflow/order/dto/OrderItemRequest.java) declares `quantity` as `Integer` with `@Min(1)` and `@Max(1000)` constraints.

The behavior suggests JSON fractional values are coerced to integers before validation. The effective Jackson coercion settings have **not** been inspected, so the precise mechanism remains unconfirmed.

Reject fractional item quantities during JSON binding and add backend regression cases for values such as `1.5`, `2.9`, and `0.5`, asserting HTTP 400 without creating orders or changing inventory. The behavior may share a cause with the [inventory adjustment defect](fractional-inventory-adjustment.md).

verifyFlow documents the finding without changing OrderFlow or incorporating the incorrect behavior into its expected-success tests.
