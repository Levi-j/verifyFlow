# verifyFlow

verifyFlow is a TypeScript and Playwright test suite for the [OrderFlow REST API](https://github.com/Levi-j/orderFlow-backend), a Spring Boot order-management backend. It tests the service through its public HTTP endpoints, without accessing application internals or the database.

Coverage includes authentication, access control, products, inventory, and the order lifecycle, alongside request validation, error handling, request IDs, and the OpenAPI contract. Dedicated concurrency tests check how the API behaves when requests compete for the same stock or order. Framework tests validate shared utilities and configuration without starting OrderFlow.

## Getting started

### Requirements

- Node.js 24
- Docker Desktop with Linux containers, or Docker Engine with Docker Compose
- A local checkout of [OrderFlow](https://github.com/Levi-j/orderFlow-backend)

By default, the repositories sit alongside each other:

```text
dev/
├── orderFlow-backend/
└── verifyFlow/
```

If your OrderFlow checkout is elsewhere, set `ORDERFLOW_SOURCE_DIR` in your configuration.

### Installation

From the verifyFlow directory, install the dependencies and create a local environment file:

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

Set the required values in `.env`, using test-only credentials. Generate separate random values for `POSTGRES_PASSWORD`, `ORDERFLOW_JWT_SECRET`, and `ORDERFLOW_ADMIN_PASSWORD`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The JWT secret must be at least 32 bytes. The administrator password must be at least 15 Unicode code points and no more than 72 UTF-8 bytes. The `.env` file is ignored by Git. It is optional when configuration is supplied through environment variables, which take precedence over `.env` values.

These commands use `npm.cmd` for Windows PowerShell. On other systems, use `npm` instead.

### Running tests

```powershell
npm.cmd run sut:up
npm.cmd test
```

Other commands:

| Command                        | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `npm.cmd run test:smoke`       | Run the API smoke tests                              |
| `npm.cmd run test:framework`   | Run framework tests without Docker or OrderFlow      |
| `npm.cmd run test:concurrency` | Run the four race-condition tests separately         |
| `npm.cmd run sut:reset`        | Recreate the test environment with an empty database |
| `npm.cmd run sut:logs`         | View OrderFlow's application logs                    |
| `npm.cmd run sut:down`         | Stop the containers and discard the test database    |
| `npm.cmd run report`           | Open the Playwright HTML report                      |

The first start builds the OrderFlow Docker image. Later starts can reuse cached layers. Running `sut:up` against an existing environment does **not** reset its database; use `sut:reset` when you need a clean start.

## Test coverage

Tests focus on behavior visible to an API consumer:

- **Registration and login:** successful and unsuccessful requests, email normalization, duplicate accounts, password and email boundaries, token responses, and sensitive-field exclusion.
- **User identity:** authenticated `/users/me` responses, customer isolation, and administrator identity.
- **Products:** administrator creation and updates, SKU normalization and duplicates, field and price limits, active and inactive product visibility, pagination, and sorting.
- **Inventory:** stock retrieval, restocks and adjustments, input validation, insufficient-stock handling, and paginated movement history. Tests confirm that rejected adjustments leave both stock and movement records unchanged, and that recorded changes reconcile with the current quantity. Boundary tests cover the 32-bit stock limit.
- **Order placement:** single- and multi-item orders, response contracts, product snapshots, and independently calculated prices and totals. Tests verify stock deductions and `ORDER_PLACED` movements, and check that failed orders do not leave partial inventory changes.
- **Idempotency:** required keys, successful replays without duplicate orders or stock deductions, and rejection of keys reused with different requests. Coverage also includes case sensitivity, customer-specific keys, reordered items, and replay after a product is deactivated.
- **Order lifecycle:** customer and administrator cancellation, administrator confirmation, and invalid status transitions. Tests check that cancellation restores stock and records `ORDER_CANCELLED` movements, confirmation does not deduct stock again, and rejected transitions leave the order, stock, and movement history unchanged. Order details retain the original product name and price after product updates.
- **Order access and ownership:** customers can list and retrieve their own orders, with pagination. Attempts to view or cancel another customer's order return `404` without changing it. Administrators can retrieve orders, browse the order list, and filter by status.
- **Authorization:** access to user, order, product, inventory, and administrator endpoints as anonymous, `CUSTOMER`, and `ADMIN` callers. Tests distinguish `401` from `403` and require a valid success response to establish permitted access.
- **Registration privileges:** attempts to supply administrator roles or authority fields cannot elevate a newly registered account.
- **Bearer authentication:** missing, malformed, and unsupported credentials, authentication challenges, and invalid credentials sent to public routes.
- **Request IDs:** accepted and replaced `X-Request-Id` values, server-generated IDs, and matching IDs in error responses.
- **HTTP errors:** malformed JSON, invalid input, unsupported methods and content types, content negotiation, invalid path parameters, and unknown routes.
- **API documentation:** health and OpenAPI availability, documented operations, bearer security requirements, and the required `Idempotency-Key` header for order creation.

Playwright separates the suite into four projects: `framework` checks shared test utilities, `sut-ready` checks that OrderFlow is healthy, and `api` runs the regular HTTP tests. The `concurrency` project runs independently after the same readiness check. The default `npm.cmd test` command excludes concurrency tests.

Browser tests and tests using constructed unsigned, altered-claim, or differently signed JWTs are deferred.

### Concurrency tests

The regular API tests check individual requests and state changes. The concurrency tests look at what happens when several requests target the same resources at once:

- **Limited stock:** Ten customers each try to buy one unit of a product with five units available. Exactly five orders should succeed; the others should receive insufficient-stock conflicts. Inventory must never fall below zero.
- **Shared idempotency key:** Five identical order requests use the same customer and key. Only one order and stock deduction should be recorded. The other requests may replay the original result or receive an in-use conflict.
- **Confirm versus cancel:** An administrator sends both actions for the same pending order. Only one transition may succeed, and the final order status and inventory must match the winning action.
- **Double cancellation:** A customer and an administrator try to cancel the same order. Stock must be restored once, with a single cancellation movement attributed to the successful caller.

Each scenario creates its own test data before sending the competing requests. Once all requests finish, the tests check their responses, the saved orders, stock levels, and full inventory movement history. Scenarios run separately with one Playwright worker, while the requests within each scenario run concurrently. Retries are disabled so failures aren't masked.

```powershell
npm.cmd run test:concurrency
npx.cmd playwright test --project=concurrency --repeat-each=10
```

Start the test environment first with `npm.cmd run sut:up`. The repeat command runs each scenario ten times with fresh data. Run concurrency tests separately from other suites using the same environment to avoid unrelated resource contention.

These checks can reveal inconsistent behavior under contention, but they don't guarantee that every possible request interleaving has been exercised.

## Test environment and safety

[`compose.sut.yaml`](compose.sut.yaml) builds OrderFlow from the local checkout and runs it with PostgreSQL under a separate Docker Compose project, `verifyflow-sut`.

The API listens on `http://127.0.0.1:18080`, leaving a normal OrderFlow development instance on port `8080` untouched. PostgreSQL uses temporary in-memory storage and has no published host port. OrderFlow creates the test administrator from environment configuration.

Because the tests create and modify data, verifyFlow allows only these API targets by default:

- `http://127.0.0.1:18080`
- `http://localhost:18080`

Other targets, including `localhost:8080`, require `VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET=true`. Only enable the override for an environment whose data can safely be changed.

### Configuration reference

| Variable                                            | Purpose                                                 |
| --------------------------------------------------- | ------------------------------------------------------- |
| `ORDERFLOW_BASE_URL`                                | API target; defaults to `http://127.0.0.1:18080`        |
| `VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET`              | Explicitly allow another target; defaults to `false`    |
| `VERIFYFLOW_HEALTH_TIMEOUT_MS`                      | Readiness timeout in milliseconds; defaults to `120000` |
| `ORDERFLOW_SOURCE_DIR`                              | Path to the OrderFlow source checkout                   |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Test database settings                                  |
| `ORDERFLOW_JWT_SECRET`                              | JWT signing secret for the test backend                 |
| `ORDERFLOW_ADMIN_EMAIL`, `ORDERFLOW_ADMIN_PASSWORD` | Bootstrapped test administrator credentials             |

See [`.env.example`](.env.example) for the configuration template.

## Continuous integration

[GitHub Actions](.github/workflows/ci.yml) runs on pull requests, pushes to `main`, a daily schedule, and manual dispatch. The workflow has two jobs:

1. **Quality:** Installs dependencies and runs formatting, linting, type checks, and framework tests. This job does not need Docker or a running OrderFlow instance.
2. **API tests:** After quality checks pass, checks out OrderFlow at a pinned commit, starts a fresh Docker Compose environment, and runs the smoke tests followed by the full regression suite.

Scheduled and manually triggered workflows also run each concurrency scenario three times after the regular regression. Pushes and pull requests skip this extra run. Concurrency reports are written to `playwright-report/concurrency/` and `test-results/concurrency/`, keeping them separate from the regular API results.

The pinned OrderFlow revision keeps the backend under test consistent between runs. Each run also generates its own database password, JWT secret, and administrator password. No local `.env` file or stored repository secrets are required.

The regular CI tests use two workers and allow one retry, but a test that only passes on retry still fails the job. Concurrency tests use one worker and no retries. API tracing stays disabled to avoid collecting sensitive request data.

When a job fails, GitHub Actions retains the Playwright report and test results for seven days. The API job also collects OrderFlow and PostgreSQL logs and container status. Its test containers are removed at the end of the job, including after a failure.

To run the same checks locally:

```powershell
npm.cmd ci
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:framework
npm.cmd run sut:up
npm.cmd run test:smoke
npm.cmd test
```

## Framework design

Reusable code lives under `src/`, while the tests are grouped under `tests/api/`, `tests/framework/`, and `tests/concurrency/`:

| Location         | Responsibility                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/api/`       | Shared HTTP client and typed APIs for authentication, products, inventory, customer orders, and administrator orders |
| `src/contracts/` | Zod schemas for API responses, pagination, errors, and OpenAPI data                                                  |
| `src/data/`      | Unique test data, inventory adjustments, order payloads, and idempotency keys                                        |
| `src/fixtures/`  | Customer and administrator identities, products with optional stock, and order setup                                 |
| `src/support/`   | Error assertions, safe diagnostics, inventory snapshots, and money calculations                                      |
| `src/config/`    | Environment parsing and target restrictions                                                                          |

API methods return the raw Playwright `APIResponse`, so tests can check expected failures as well as successes. A reusable `toBeProblem` matcher checks error status, response contract, application error code, and request-ID consistency.

Tests create their own accounts and products with unique identifiers, without relying on execution order or an empty database. Administrator authentication is reused per worker and refreshed before the token expires.

Catalog tests check pagination metadata and sort order within individual responses rather than expecting global results to stay unchanged while other tests add products. Visibility checks scan a bounded range of recently updated products and fail if they cannot establish whether the test product is listed.

Inventory tests operate only on products they create. This lets them compare the stock level and movement history before and after each adjustment without interference from other workers.

Order tests derive expected totals from the product prices and quantities chosen during setup, then compare them with the server response in integer cents. They also check stock and movement history to confirm that order creation has the expected effects and idempotent replays make no additional changes.

Customer order-list tests use a fresh account, making their results predictable even when other tests are running. Administrator lists are shared across workers, so those tests search a bounded set of results instead of assuming a fixed total or position.

## Investigating failures

Open the latest HTML report with:

```powershell
npm.cmd run report
```

Failed API tests include an `api-exchanges.json` attachment containing only selected metadata: HTTP method, path, status, request ID, duration, and recognized application error code. Request and response bodies, query strings, authorization headers, and credentials are not collected in these attachments. API tracing is disabled because traces may contain sensitive request data.

Concurrency failures include a `race-evidence.json` attachment with relevant response details, order and user IDs, stock quantities, and inventory movements. It excludes credentials and raw response bodies. After downloading a scheduled or manual CI artifact, you can open its report with `npx.cmd playwright show-report playwright-report/concurrency`.

The API client assigns a request ID to ordinary requests. You can use an ID from a failed test to find the corresponding server-side events:

```powershell
npm.cmd run sut:logs | Select-String 'vf-fa74bcca-5'
```

Replace the example ID with the one from the failed test. For GitHub Actions failures, look up the ID in `sut-logs/orderflow.log` from the workflow artifact. Transport failures use shortened error messages to avoid exposing request headers.

## Development checks

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
```

Playwright projects and reporters are configured in [`playwright.config.ts`](playwright.config.ts).
