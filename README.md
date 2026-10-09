# verifyFlow

verifyFlow is a TypeScript and Playwright test automation project for the [OrderFlow REST API](https://github.com/Levi-j/orderFlow-backend), a Java and Spring Boot order-management backend. It tests the service as an external client would, using HTTP requests rather than application internals or direct database access.

The current suite covers account registration, login, authenticated user details, and basic API availability. Tests include successful workflows, invalid input, boundary conditions, response contracts, and error handling.

## Technology

- TypeScript and Node.js 24
- Playwright Test and `APIRequestContext`
- Zod for configuration and response validation
- Docker Compose and PostgreSQL for the isolated test environment
- ESLint and Prettier

## Getting started

### Prerequisites

- Node.js 24
- Docker Desktop running Linux containers, or Docker Engine with Docker Compose
- A local checkout of [OrderFlow](https://github.com/Levi-j/orderFlow-backend)

By default, the repositories should be adjacent:

```text
dev/
├── orderFlow-backend/
└── verifyFlow/
```

If OrderFlow is elsewhere, set `ORDERFLOW_SOURCE_DIR` in your local configuration.

### Install and configure

From the verifyFlow directory, install dependencies and copy the example configuration:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env` and provide test-only values for the database password, JWT signing secret, and administrator password. You can generate a random value with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use separate generated values for `POSTGRES_PASSWORD`, `ORDERFLOW_JWT_SECRET`, and `ORDERFLOW_ADMIN_PASSWORD`. The JWT secret must be at least 32 bytes, and the administrator password must satisfy OrderFlow's password policy (at least 15 Unicode code points and no more than 72 UTF-8 bytes).

The `.env` file is ignored by Git. It is optional if you supply the required settings as environment variables; environment variables take precedence over values in `.env`.

### Run the tests

Start the isolated OrderFlow environment and run the suite:

```powershell
npm run sut:up
npm test
```

Other useful commands:

| Command                  | Purpose                                                   |
| ------------------------ | --------------------------------------------------------- |
| `npm run test:smoke`     | Run the API smoke tests                                   |
| `npm run test:framework` | Test verifyFlow's own helpers without OrderFlow or Docker |
| `npm run sut:reset`      | Recreate the test environment with an empty database      |
| `npm run sut:logs`       | View OrderFlow's application logs                         |
| `npm run sut:down`       | Remove the test containers and discard their database     |
| `npm run report`         | Open the Playwright HTML report                           |

The initial Docker image build may take a few minutes. Subsequent starts can reuse cached build layers. Running `sut:up` while the environment is already up does not clear its database; use `sut:reset` when you need a fresh one.

## Test environment

[`compose.sut.yaml`](compose.sut.yaml) builds OrderFlow from the local checkout and runs it with PostgreSQL in a separate Compose project named `verifyflow-sut`.

- The API is available at `http://127.0.0.1:18080`, leaving the usual OrderFlow development port (`8080`) untouched.
- PostgreSQL uses temporary in-memory storage and has no published host port.
- OrderFlow bootstraps a test administrator from the supplied configuration.
- The `sut-ready` Playwright setup project checks `/actuator/health` and waits for the service to report `UP` before API tests begin.

The tests create and modify data. To avoid accidentally targeting a development or production database, verifyFlow accepts only `http://127.0.0.1:18080` and `http://localhost:18080` by default. All other targets, including `localhost:8080`, require `VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET=true`. Use that override only with an environment whose data is safe to change.

### Configuration

| Variable                                            | Purpose                                     | Default                    |
| --------------------------------------------------- | ------------------------------------------- | -------------------------- |
| `ORDERFLOW_BASE_URL`                                | API endpoint under test                     | `http://127.0.0.1:18080`   |
| `VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET`              | Explicitly permit another API target        | `false`                    |
| `VERIFYFLOW_HEALTH_TIMEOUT_MS`                      | Maximum wait for API readiness              | `120000`                   |
| `ORDERFLOW_SOURCE_DIR`                              | Path to the local OrderFlow source checkout | Set in local configuration |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Test database configuration                 | Set in local configuration |
| `ORDERFLOW_JWT_SECRET`                              | Test JWT signing secret                     | Required                   |
| `ORDERFLOW_ADMIN_EMAIL`, `ORDERFLOW_ADMIN_PASSWORD` | Test administrator credentials              | Required for admin tests   |

## Framework design

The framework keeps HTTP transport, response validation, test setup, and assertions separate:

| Component        | Responsibility                                                                          |
| ---------------- | --------------------------------------------------------------------------------------- |
| `src/api/`       | A small client built on `APIRequestContext`, plus typed authentication endpoint methods |
| `src/contracts/` | Zod schemas for successful responses and API errors                                     |
| `src/data/`      | Valid, unique test inputs                                                               |
| `src/fixtures/`  | Anonymous, administrator, and newly registered customer sessions                        |
| `src/support/`   | Reusable error assertions and safe request diagnostics                                  |
| `src/config/`    | Environment loading, validation, and target protection                                  |

API methods return Playwright's raw `APIResponse`, leaving each test to assert the expected result. This is useful for negative tests, where a `400`, `401`, or `409` response may be the correct outcome.

For example, a duplicate-registration test can use the same API method as a successful-registration test:

```ts
test('rejects an email that is already registered', async ({ anonymous, customer }) => {
  const response = await new AuthApi(anonymous).register({
    email: customer.email,
    password: validPassword(),
  });

  await expect(response).toBeProblem(409, 'EMAIL_ALREADY_REGISTERED');
});
```

Tests that need customer accounts create unique data, so they can run independently and in parallel without relying on an empty database or a particular execution order. Administrator authentication is reused within each worker and refreshed before token expiry.

## Current coverage

| Area                | Tests cover                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Registration        | Successful account creation, `CUSTOMER` role, email normalization, duplicate addresses, malformed input, and response data safety |
| Password validation | Minimum of 15 Unicode code points, maximum of 72 UTF-8 bytes, and multibyte character boundaries                                  |
| Login               | Valid and invalid credentials, case-insensitive emails, bearer token response, and overlength password handling                   |
| Current user        | Registration-to-login workflow, `/users/me`, customer identity isolation, and administrator identity                              |
| Platform            | API health, public OpenAPI documentation, and restricted health detail exposure                                                   |

Tests run in three Playwright projects:

- `framework` checks configuration, client behavior, assertions, data generation, and diagnostic safety without starting OrderFlow.
- `sut-ready` waits for the API to become healthy.
- `api` runs the black-box HTTP tests and depends on `sut-ready`.

Product, inventory, and order automation, broader security checks, concurrency tests, browser tests, and CI workflows are not part of the current implementation.

## Investigating failures

Playwright produces an HTML report with test results and assertion details:

```powershell
npm run report
```

When an API test fails, the report includes an `api-exchanges.json` attachment with a short record of the requests made during that test. It contains the HTTP method, path, status, request ID, duration, and recognized application error code. Request bodies, response bodies, query strings, authorization headers, and credentials are not included.

The API client normally supplies an `X-Request-Id` header. OrderFlow includes the same ID in its structured logs, making it possible to connect a failing assertion to a server-side request:

```powershell
npm run sut:logs | Select-String 'vf-fa74bcca-5'
```

Replace the sample ID with one from a failed test. API traces are disabled because they can contain authentication headers and sensitive request data.

## Development checks

```powershell
npm run format:check
npm run lint
npm run typecheck
```

The source is organized by responsibility: reusable test code under `src/`, API specifications under `tests/api/`, and independent framework checks under `tests/framework/`. Playwright configuration lives in [`playwright.config.ts`](playwright.config.ts).
