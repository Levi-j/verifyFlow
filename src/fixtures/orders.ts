import { OrdersApi } from '../api/orders-api';
import { orderSchema, type Order } from '../contracts/order';
import { parseResponse } from '../contracts/parse-response';
import { newOrder, uniqueIdempotencyKey, type OrderLine } from '../data/orders';
import { requireStatus, type Customer } from './identities';

export async function placeOrderAs(customer: Customer, lines: OrderLine[]): Promise<Order> {
  const response = await new OrdersApi(customer.api).place(
    newOrder(...lines),
    uniqueIdempotencyKey(),
  );
  await requireStatus(response, 201, 'Order placement');
  return parseResponse(response, orderSchema);
}
