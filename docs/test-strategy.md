# Test strategy

## Scope

verifyFlow tests OrderFlow as an API consumer would: through its public HTTP endpoints. The suite checks that users can perform only permitted actions, responses follow the expected contracts, and orders and inventory remain consistent after successful, rejected, repeated, and concurrent requests.

OrderFlow's Java tests cover application internals. verifyFlow complements them by testing the running service, including authentication, routing, JSON handling, validation, and changes that can be observed through subsequent API calls. The tests do not access the database or invoke Java services directly. Backend source code is consulted when clarifying expected behavior or investigating a failure.

The system under test (SUT) is pinned to OrderFlow commit `c0d77be16050cfa86e091b06f0c2873258477727`. Browser testing is limited to the existing Swagger UI because OrderFlow has no customer-facing frontend. Load testing, performance benchmarks, exhaustive security testing, other browsers, and backend fixes are outside the project's scope.

## Risk-based coverage

The suite gives the most attention to failures that could expose another customer's data, change stock incorrectly, create duplicate orders, or leave a transaction partially applied. The following areas link to the tests that cover those risks.

- **Authentication and access control.** Registration, login, bearer tokens, role restrictions, and attempts to gain administrator privileges are covered by [authentication tests](../tests/api/auth/), the [authorization matrix](../tests/api/security/authorization-matrix.spec.ts), [bearer-token tests](../tests/api/security/bearer-tokens.spec.ts), and [registration privilege tests](../tests/api/security/registration-privileges.spec.ts). [Ownership tests](../tests/api/orders/ownership.spec.ts) ensure customers cannot retrieve or cancel another customer's orders.
- **Products and inventory.** Product tests cover [administrator operations](../tests/api/products/admin-products.spec.ts), [validation](../tests/api/products/product-validation.spec.ts), [public visibility](../tests/api/products/public-catalog.spec.ts), and [pagination and sorting](../tests/api/products/pagination-sorting.spec.ts). Inventory tests check [stock state](../tests/api/inventory/inventory.spec.ts), [adjustments](../tests/api/inventory/adjustments.spec.ts), [invalid inputs](../tests/api/inventory/inventory-validation.spec.ts), [movement history](../tests/api/inventory/movements.spec.ts), and [integer boundaries](../tests/api/inventory/integer-limits.spec.ts).
- **Order placement and idempotency.** [Placement tests](../tests/api/orders/placement.spec.ts) verify product snapshots, calculated totals, inventory deductions, and rollback when part of an order fails. [Validation tests](../tests/api/orders/order-validation.spec.ts) cover rejected requests. [Idempotency tests](../tests/api/orders/idempotency.spec.ts) check that replays do not create extra orders or deduct stock twice.
- **Order lifecycle.** [Lifecycle tests](../tests/api/orders/lifecycle.spec.ts) and [administrator order tests](../tests/api/orders/admin-orders.spec.ts) cover confirmation, cancellation, invalid transitions, and stock restoration. They also verify that historical order details are retained when products change.
- **Concurrent requests.** The [stock race](../tests/concurrency/stock-race.spec.ts), [idempotency race](../tests/concurrency/idempotency-race.spec.ts), and [lifecycle races](../tests/concurrency/lifecycle-race.spec.ts) check that competing operations leave orders, stock, and movement history in an allowed final state.
- **API behavior and documentation.** Tests cover [HTTP errors](../tests/api/platform/http-errors.spec.ts), [request-ID correlation](../tests/api/platform/request-id.spec.ts), the [OpenAPI contract](../tests/api/platform/api-docs.spec.ts), and [health](../tests/api/platform/health.spec.ts). [Swagger UI browser tests](../tests/browser/api-docs-ui.spec.ts) check operation discovery and the execution of a public product request.
- **Framework correctness.** [Framework tests](../tests/framework/) exercise configuration safeguards, administrator setup, test-data generation, diagnostics, error matching, and money calculations without requiring a running OrderFlow instance.

## Test suites and execution

| Suite           | Coverage                                                                                  | Command                        |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| Framework       | 49 tests; runs without OrderFlow, using local HTTP stubs where needed                     | `npm.cmd run test:framework`   |
| Readiness       | One bounded health check; runs as a dependency for API, concurrency, and browser projects | Automatic                      |
| API smoke       | 7 API tests plus readiness: 8 reported passes                                             | `npm.cmd run test:smoke`       |
| Full regression | 49 framework tests, 308 API tests, and readiness: 358 reported passes                     | `npm.cmd test`                 |
| Concurrency     | 4 race scenarios plus readiness: 5 reported passes                                        | `npm.cmd run test:concurrency` |
| Browser         | 2 Chromium tests plus readiness: 3 reported passes                                        | `npm.cmd run test:browser`     |

The named scripts keep the suites separate. In particular, `npm.cmd test` runs the framework and API projects, not concurrency or browser tests. Running `playwright test` without project selection would include every configured project.

[GitHub Actions](../.github/workflows/ci.yml) runs formatting, linting, type checking, framework tests, API smoke tests, and the full regression on pushes to `main` and pull requests. Scheduled and manually triggered runs also repeat the concurrency suite three times, install Chromium and its Linux dependencies, and run the browser tests. All suites use the same isolated SUT. Failure artifacts are collected and the containers are cleaned up even when a job fails.

For additional reliability checks, use `npx.cmd playwright test --project=concurrency --repeat-each=10` or `npx.cmd playwright test --project=browser --repeat-each=3`. With all tests passing, these report 41 and 7 passes respectively, including one readiness check per command. Each repetition creates fresh test data or a fresh browser context as appropriate.

## Framework design and assertions

The shared [ApiClient](../src/api/api-client.ts) handles authentication headers, request IDs, and selected diagnostic metadata. Small domain-specific clients define endpoint operations and return Playwright's raw responses. This lets tests inspect expected error responses without an API client treating every non-2xx status as an exception. Setup fixtures, by contrast, assert that the data needed for a test was created successfully.

[Zod schemas](../src/contracts/) validate responses at runtime. [Data builders](../src/data/) provide valid request defaults and unique identifiers, while [fixtures](../src/fixtures/test.ts) provide customers, administrator access, products, and order setup. The order fixture accepts a specific customer so tests can exercise ownership rules.

The [problem matcher](../src/support/problem-matcher.ts) checks status, problem response format, application error code, and agreement between response-header and response-body request IDs. [Inventory helpers](../src/support/inventory-state.ts) read current stock and paginated movement history, failing explicitly if a bounded read cannot complete.

HTTP statuses are only part of the result. Tests also check business effects:

- Order totals are calculated independently in [integer cents](../src/support/money.ts), avoiding floating-point comparisons.
- Rejected inventory adjustments leave stock and movement history unchanged.
- A failed multi-item order rolls back its deductions. A subsequent successful request with the same idempotency key also demonstrates that the failed attempt did not persist an order under that key.
- Idempotent replays create no additional order or deduction. After cancellation, replay returns the original as-placed response, while a separate GET returns the current order status.
- Cancellation restores stock once and records the correct actor. Attempts to access or cancel another customer's order return 404 without changing the order or inventory.

## Test environment and isolation

[Docker Compose](../compose.sut.yaml) runs OrderFlow under the separate `verifyflow-sut` project at `http://127.0.0.1:18080`. PostgreSQL uses temporary in-memory storage without a published host port. The normal OrderFlow development instance on port 8080 is unaffected.

`sut:up` builds or starts the test environment without intentionally clearing its database. `sut:down` removes the containers and temporary database; `sut:reset` explicitly recreates the environment. Routine tests use fresh data rather than resetting the database between runs.

Each test owns its customers, products, orders, and idempotency keys. No test depends on a fixed database ID, an empty catalog, or another test running first. Administrator authentication is reused per worker and refreshed before expiry. Browser tests start with a fresh, unauthenticated context and only access public information.

Ordinary tests use four workers locally and two in CI. Shared catalogs and administrator lists can change as tests create resources, so assertions avoid fixed global totals and positions. Searches are bounded and fail if they cannot establish a result. Inventory tests use their own products, allowing precise before-and-after comparisons. Separate suites should be run sequentially against the same local SUT.

## Concurrency and reliability

Four scenarios exercise limited-stock ordering, concurrent reuse of an idempotency key, confirmation versus cancellation, and customer versus administrator cancellation. Each test completes setup before launching competing HTTP calls, then waits for every outcome with `Promise.allSettled()`. Unexpected transport failures are not accepted as valid race outcomes. The tests associate results with the originating caller or operation and verify the final order, stock, and movement history.

Concurrency scenarios run one at a time with one Playwright worker, zero retries, and a 60-second timeout. Requests _within_ each scenario still run concurrently. Browser tests also use one worker and zero retries, with a 30-second timeout. Ordinary CI tests allow one retry, but `failOnFlakyTests` makes a retry-only success fail the job.

There are no arbitrary sleeps. Readiness uses bounded health polling; browser tests rely on Playwright's automatic waiting and web-first assertions. The Swagger UI catalog test waits for the real network response and its rendered result, rather than accepting a static example from the documentation.

When a test fails, the first step is to inspect its response metadata, request IDs, and final state, then correlate those details with application logs. Unexpected server errors, unrecognized conflicts, duplicate movements, and timeouts remain failures rather than being hidden by retries or looser assertions.

**Concurrent HTTP requests do not guarantee that operations overlap inside the backend, and repeated passing tests cannot prove the absence of every race condition.** In the original local repetitions, confirmation won the confirm/cancel race and customer cancellation won the double-cancel race. The tests allow the alternative outcomes, but those particular executions did not exercise them.

## Security and failure diagnostics

The [target guard](../src/config/env.ts) allows only the isolated localhost API origins by default. Testing another target, including port 8080, requires explicit opt-in. Local credentials are stored in the ignored `.env` file; CI generates and masks disposable secrets.

API tracing is disabled because traces could capture sensitive request details. On failure, API exchange attachments contain selected metadata only: method, path, status, request ID, duration, and recognized error code. Transport diagnostics exclude header-bearing call logs. Concurrency evidence adds relevant resource IDs, quantities, and movements without recording credentials or raw bodies. Request IDs can then be used to find corresponding events in OrderFlow's CI logs.

Browser tests capture screenshots on failure and retain traces on failure, with video disabled. They use public documentation and a public GET request; no credentials are entered. Browser artifacts may contain page and network data, so authenticated browser workflows would need another security review before adopting the same reporting policy.

CI keeps regression, concurrency, and browser outputs in separate locations under `playwright-report/` and `test-results/`. Failure artifacts, including SUT logs, are retained for seven days. Artifact reviews should include the attachments and trace contents, not just the visible HTML report.

## Known findings and limitations

Two reproducible OrderFlow defects are documented: [fractional inventory adjustments](bug-reports/fractional-inventory-adjustment.md) and [fractional order quantities](bug-reports/fractional-order-quantity.md). In both cases, some fractional values are accepted and silently converted to integers. The reports separate observed behavior from the suspected JSON deserialization cause. verifyFlow documents these findings without modifying OrderFlow or introducing intentionally failing tests into CI.

Coverage remains intentionally selective. The browser suite checks Swagger UI, not customer-facing workflows, cross-browser behavior, or accessibility compliance. OpenAPI tests inspect selected operations and security requirements rather than comparing the entire specification. Constructed unsigned, altered-claim, and differently signed JWT cases are deferred. Passing tests demonstrate the behavior of the pinned backend for the exercised cases, not every possible input, load, or concurrent execution.
