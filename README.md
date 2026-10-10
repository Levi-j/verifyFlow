# verifyFlow

[![CI](https://github.com/Levi-j/verifyFlow/actions/workflows/ci.yml/badge.svg)](https://github.com/Levi-j/verifyFlow/actions/workflows/ci.yml)

**API test automation for [OrderFlow](https://github.com/Levi-j/orderFlow-backend), built with TypeScript and Playwright.**

verifyFlow tests a running Spring Boot order-management service through its public HTTP API. It checks more than status codes: an order that returns `201 Created` should also have the right total, deduct the right amount of stock, and leave consistent records behind. Rejected requests should not partially change anything, and competing requests should not create duplicate orders or oversell inventory.

The framework combines functional, negative, contract, authorization, and concurrency testing. A small Chromium suite also exercises OrderFlow's existing Swagger UI. Tests run against an isolated Docker environment, both locally and in GitHub Actions.

## What it tests

| Area                                  | Examples of what's verified                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Authentication and access control** | Registration, login, JWT handling, customer/admin permissions, and order ownership                               |
| **Products and inventory**            | Validation, SKU uniqueness, catalog visibility, stock adjustments, and movement history                          |
| **Order placement and totals**        | Order creation, product snapshots, totals calculated independently in integer cents, and atomic failure behavior |
| **Idempotency and lifecycle**         | Safe request replay, duplicate-key conflicts, confirmation, cancellation, and stock restoration                  |
| **Concurrency**                       | Limited-stock orders, simultaneous reuse of an idempotency key, and competing order transitions                  |
| **Contracts and diagnostics**         | Zod response validation, HTTP errors, OpenAPI requirements, and request-ID correlation                           |
| **Browser smoke checks**              | Swagger UI loads and can execute a public product request through **Try it out**                                 |

For the risk-based coverage map and detailed design decisions, see [Test strategy](docs/test-strategy.md).

## Quick start

### Prerequisites

- **Node.js 24**
- **Docker Desktop** with Linux containers, or Docker Engine with Compose
- **Git** and a local checkout of [OrderFlow](https://github.com/Levi-j/orderFlow-backend)

Keep the two repositories side by side by default:

```text
dev/
├── orderFlow-backend/
└── verifyFlow/
```

To set up fresh checkouts from their parent directory:

```powershell
git clone https://github.com/Levi-j/orderFlow-backend.git
git clone https://github.com/Levi-j/verifyFlow.git
cd verifyFlow
npm.cmd ci
Copy-Item .env.example .env
```

Edit `.env` and supply **test-only** values for the database credentials, JWT signing secret, and administrator account. Generate a different random value for each secret, such as:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The JWT secret must be at least 32 bytes. The administrator password must be at least 15 Unicode code points and no more than 72 UTF-8 bytes. Environment variables take precedence over `.env`, which is Git-ignored. If OrderFlow lives elsewhere, set `ORDERFLOW_SOURCE_DIR` accordingly.

Start the isolated backend and run the regression suite:

```powershell
npm.cmd run sut:up
npm.cmd test
```

The first startup builds the OrderFlow Docker image and may take a few minutes. Subsequent starts reuse cached layers where possible. `sut:up` does not deliberately clear an existing test database.

> Commands use `npm.cmd` and `npx.cmd` for Windows PowerShell. On macOS and Linux, use `npm` and `npx`, and replace `Copy-Item` with `cp`.

### Test commands

| Command                        | Purpose                                                           |
| ------------------------------ | ----------------------------------------------------------------- |
| `npm.cmd test`                 | Full API regression and framework checks                          |
| `npm.cmd run test:smoke`       | Critical API smoke tests                                          |
| `npm.cmd run test:framework`   | Framework checks; no backend required                             |
| `npm.cmd run test:concurrency` | Four concurrency scenarios, run separately                        |
| `npm.cmd run test:browser`     | Two Chromium Swagger UI checks                                    |
| `npm.cmd run report`           | Open the latest Playwright HTML report                            |
| `npm.cmd run sut:logs`         | View OrderFlow container logs                                     |
| `npm.cmd run sut:reset`        | Recreate the isolated environment with a fresh database           |
| `npm.cmd run sut:down`         | Stop the isolated containers and discard their temporary database |

The regular regression contains **49 framework tests, 308 API tests, and one readiness check** (358 reported passes in the verified baseline). The smoke command reports eight passes including readiness. Concurrency and browser tests are **not** part of `npm.cmd test`.

For browser tests, install Chromium once before running them:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:browser
```

## Concurrency testing

The four race-condition tests check whether the service leaves correct results when requests compete for the same resources:

- **Limited stock:** Ten customers attempt to buy five available units. Five orders succeed, while five receive insufficient-stock conflicts; inventory never goes below zero.
- **Shared idempotency key:** Five identical requests compete to create one order. Only one order and one stock deduction may be recorded.
- **Confirm versus cancel:** Two incompatible transitions race on a pending order. Exactly one succeeds, and the final state must match it.
- **Double cancellation:** A customer and an administrator cancel the same order concurrently. Stock is restored exactly once, with one cancellation movement.

These tests inspect saved orders, final stock quantities, and inventory movement history—not only the HTTP responses. Each run creates its own data, uses one Playwright worker for the scenarios, and disables retries. The requests _within_ a scenario are concurrent.

To repeat every scenario ten times:

```powershell
npx.cmd playwright test --project=concurrency --repeat-each=10
```

Concurrent HTTP calls cannot guarantee a particular database interleaving. Repeated successful tests provide useful evidence, but they do not prove that all possible races have been eliminated.

## How the framework is organized

```text
src/
├── api/          # Shared HTTP client and endpoint-specific clients
├── contracts/    # Zod response schemas and types
├── data/         # Unique test data and request builders
├── fixtures/     # Customers, administrator access, products, and orders
├── support/      # Assertions, inventory snapshots, money, and diagnostics
└── config/       # Environment validation and target restrictions

tests/
├── framework/    # Offline checks for the test infrastructure
├── api/          # Functional, security, contract, and workflow tests
├── concurrency/  # Four race-condition scenarios
└── browser/      # Chromium Swagger UI smoke tests

docs/
├── test-strategy.md
└── bug-reports/
```

Domain clients return raw Playwright responses so tests can inspect failures as carefully as successful requests. Zod checks response contracts at runtime, and a shared `toBeProblem` matcher verifies error status, application code, and request-ID consistency.

Tests create their own customers, products, and idempotency keys. They don't rely on fixed database IDs, a particular test order, or an empty catalog. Inventory and order assertions use resources owned by the test, making parallel execution more predictable.

## Test environment and safety

The [Docker Compose configuration](compose.sut.yaml) runs OrderFlow and PostgreSQL in a separate project named `verifyflow-sut`. Its API is available at **`http://127.0.0.1:18080`**, leaving a normal OrderFlow development instance on port 8080 alone. PostgreSQL uses temporary storage and does not publish a host port.

Because tests create and change data, verifyFlow accepts only `http://127.0.0.1:18080` and `http://localhost:18080` by default. Other targets require the explicit `VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET=true` override. Use that override only for an environment where the data may safely be modified.

See [`.env.example`](.env.example) for all configuration variables. GitHub Actions uses a pinned [OrderFlow revision](https://github.com/Levi-j/orderFlow-backend/tree/c0d77be16050cfa86e091b06f0c2873258477727) to keep the system under test consistent; local results can differ if your checkout uses another revision.

## Continuous integration

The [GitHub Actions workflow](.github/workflows/ci.yml) separates ordinary checks from more specialized testing.

| Trigger                        | Checks                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Push to `main` or pull request | Formatting, linting, type checking, framework tests, API smoke tests, and full regression        |
| Daily schedule or manual run   | All of the above, plus three repetitions of the concurrency suite and Chromium Swagger UI checks |

Each workflow run starts a fresh isolated backend and creates disposable test credentials. Reports and test results are kept for seven days on failure, along with application and database logs. Containers are cleaned up even when tests fail.

Concurrency and browser tests use one worker and zero retries. The normal CI tests permit one retry, but a test that only passes on retry still fails the job. API traces are disabled to avoid recording sensitive headers or request bodies; browser screenshots and traces are retained on failure for the public Swagger UI tests.

To run the same quality checks locally:

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:framework
```

## Investigating a failed test

Open the Playwright report:

```powershell
npm.cmd run report
```

Failed API tests include an `api-exchanges.json` attachment with request metadata such as method, path, status, duration, and request ID—without credentials or raw bodies. Concurrency tests add `race-evidence.json` for response and final-state evidence. Browser failures can include a screenshot and trace of the public Swagger UI.

To correlate a failed request with the backend's logs, search for its request ID:

```powershell
npm.cmd run sut:logs | Select-String 'vf-REQUEST-ID'
```

When diagnosing a GitHub Actions failure, download the job's report and `sut-logs` artifacts. Review browser traces before sharing them, as traces can contain page and network data.

## Documented backend findings

Testing uncovered two reproducible issues in the pinned OrderFlow backend:

- [Fractional inventory adjustments](docs/bug-reports/fractional-inventory-adjustment.md): an adjustment of `1.5` is accepted and applied as `1`.
- [Fractional order quantities](docs/bug-reports/fractional-order-quantity.md): an order for `1.5` units creates an order for one unit.

Both reports include reproduction steps, observed state changes, and correlated request IDs. The suspected deserialization cause is distinguished from verified behavior. These are open backend findings; verifyFlow documents them rather than altering OrderFlow or accepting the behavior as correct.

## Scope

verifyFlow is primarily an API testing project. Its two browser tests cover Swagger UI, not a customer-facing application. It does not claim exhaustive security testing, load-testing coverage, cross-browser compatibility, or proof that every concurrency interleaving is safe. See the [test strategy](docs/test-strategy.md) for the full scope and limitations.
