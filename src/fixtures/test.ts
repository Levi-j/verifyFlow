import { expect as baseExpect, test as base, type TestInfo } from '@playwright/test';
import { ApiClient } from '../api/api-client';
import { AuthApi } from '../api/auth-api';
import { loadAdminCredentials, loadTestConfig } from '../config/env';
import { ApiExchangeLog } from '../support/api-diagnostics';
import { problemMatchers } from '../support/problem-matcher';
import type { Order } from '../contracts/order';
import type { Product } from '../contracts/product';
import type { OrderLine } from '../data/orders';
import { AdminSession, registerCustomer, type Customer } from './identities';
import { placeOrderAs } from './orders';
import { createProductAsAdmin, type ProductSetup } from './products';

interface TestFixtures {
  anonymous: ApiClient;
  admin: ApiClient;
  createCustomer: () => Promise<Customer>;
  customer: Customer;
  createProduct: (setup?: ProductSetup) => Promise<Product>;
  placeOrder: (customer: Customer, lines: OrderLine[]) => Promise<Order>;
}

interface WorkerFixtures {
  adminSession: AdminSession;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  adminSession: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext({ baseURL: loadTestConfig().baseUrl });
      const auth = new AuthApi(new ApiClient(request, new ApiExchangeLog()));
      await use(new AdminSession(auth, loadAdminCredentials()));
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  anonymous: async ({ request }, use, testInfo) => {
    const exchangeLog = new ApiExchangeLog();
    await use(new ApiClient(request, exchangeLog));
    await attachExchangesOnFailure(exchangeLog, testInfo);
  },

  admin: async ({ anonymous, adminSession }, use) => {
    await use(anonymous.withToken(await adminSession.token()));
  },

  createCustomer: async ({ anonymous }, use) => {
    await use(() => registerCustomer(anonymous));
  },

  customer: async ({ createCustomer }, use) => {
    await use(await createCustomer());
  },

  createProduct: async ({ admin }, use) => {
    await use((setup) => createProductAsAdmin(admin, setup));
  },

  // The customer is passed in rather than taken from a fixture, so ownership tests can place
  // orders for several customers. Playwright requires the empty dependency list here.
  // eslint-disable-next-line no-empty-pattern
  placeOrder: async ({}, use) => {
    await use(placeOrderAs);
  },
});

export const expect = baseExpect.extend(problemMatchers);

async function attachExchangesOnFailure(log: ApiExchangeLog, testInfo: TestInfo): Promise<void> {
  const exchanges = log.entries();
  if (testInfo.status === testInfo.expectedStatus || exchanges.length === 0) {
    return;
  }
  await testInfo.attach('api-exchanges.json', {
    body: JSON.stringify(exchanges, null, 2),
    contentType: 'application/json',
  });
}
