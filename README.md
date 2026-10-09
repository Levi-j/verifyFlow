# verifyFlow

verifyFlow is a black-box API test automation framework for [OrderFlow](https://github.com/Levi-j/orderFlow-backend), a Spring Boot order management backend. It tests OrderFlow the way an external client uses it: over HTTP, through the public API only.

The project is under active development. This README describes what is currently implemented.

## Tech Stack

- TypeScript
- Node.js 24
- Playwright Test (API testing with `APIRequestContext`)
- Zod (configuration and response validation)
- ESLint and Prettier
- Docker Compose (disposable OrderFlow test environment)

## How the Test Environment Works

verifyFlow builds OrderFlow from source and runs it in its own Docker Compose project, `verifyflow-sut`, defined in [`compose.sut.yaml`](compose.sut.yaml):

- OrderFlow is published on `http://127.0.0.1:18080`, so it can run alongside a development instance on port 8080.
- PostgreSQL stores its data in memory (`tmpfs`) and does not publish a port. Stopping the environment discards all data, and every start begins with a fresh database.
- An administrator account is bootstrapped from configuration when OrderFlow starts.

Before the API tests run, a Playwright setup project (`sut-ready`) polls `GET /actuator/health` until OrderFlow reports `UP` or a timeout is reached.

## Prerequisites

- Node.js 24
- Docker Desktop (Linux containers) or Docker Engine with Docker Compose
- A local checkout of [orderFlow-backend](https://github.com/Levi-j/orderFlow-backend), by default next to this repository

```text
dev/
├── orderFlow-backend/
└── verifyFlow/
```

## Setup

Install dependencies:

```powershell
npm ci
```

Create a local configuration file:

```powershell
Copy-Item .env.example .env
```

Fill in `POSTGRES_PASSWORD`, `ORDERFLOW_JWT_SECRET`, and `ORDERFLOW_ADMIN_PASSWORD` with test-only values. One way to generate a random value:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`ORDERFLOW_JWT_SECRET` must be at least 32 bytes, and `ORDERFLOW_ADMIN_PASSWORD` must be at least 15 characters. The `.env` file is ignored by Git.

The `.env` file is optional. Any setting can be supplied as an environment variable instead, and environment variables take precedence over values in `.env`.

## Running the Tests

```powershell
npm run sut:up          # build and start OrderFlow with a fresh database
npm test                # run the framework and API tests
npm run test:smoke      # run only the API smoke tests
npm run test:framework  # run framework self-tests (no OrderFlow needed)
npm run sut:down        # stop the environment and discard its data
```

The tests are organized into Playwright projects:

| Project     | Contents                                                              | Needs OrderFlow |
| ----------- | --------------------------------------------------------------------- | --------------- |
| `framework` | Self-tests for verifyFlow's own code, such as the target safety guard | No              |
| `sut-ready` | Waits until OrderFlow reports `UP`; runs automatically before `api`   | Yes             |
| `api`       | Black-box tests of the OrderFlow API                                  | Yes             |

The first `sut:up` builds the OrderFlow image and takes a few minutes; later starts reuse the Docker build cache. The environment can stay running across test runs. `npm run sut:reset` restarts it with an empty database.

## Configuration

| Variable                                            | Purpose                                                                | Default                  |
| --------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| `ORDERFLOW_BASE_URL`                                | API under test                                                         | `http://127.0.0.1:18080` |
| `VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET`              | Allow an `ORDERFLOW_BASE_URL` other than the isolated test environment | `false`                  |
| `VERIFYFLOW_HEALTH_TIMEOUT_MS`                      | Maximum wait for OrderFlow to report `UP`                              | `120000`                 |
| `ORDERFLOW_SOURCE_DIR`                              | OrderFlow checkout used to build the test environment                  | —                        |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Test database settings                                                 | —                        |
| `ORDERFLOW_JWT_SECRET`                              | JWT signing secret for the test environment                            | —                        |
| `ORDERFLOW_ADMIN_EMAIL`, `ORDERFLOW_ADMIN_PASSWORD` | Bootstrapped test administrator                                        | —                        |

### Target safety

The tests create and modify data, so by default verifyFlow only runs against its isolated test environment:

- `http://127.0.0.1:18080`
- `http://localhost:18080`

Every other target is refused, including other local ports such as a development instance on `http://localhost:8080` that may hold data worth keeping. To run against a different environment deliberately, set `VERIFYFLOW_ALLOW_NON_ISOLATED_TARGET=true`. Only do this for an environment whose data can be safely modified.

## Debugging

```powershell
npm run sut:logs    # OrderFlow logs (ECS JSON)
npm run report      # open the latest HTML test report
```

## Code Quality

```powershell
npm run format:check
npm run lint
npm run typecheck
```

## Project Structure

```text
verifyFlow/
├── src/
│   └── config/          # environment loading, validation, and target safety check
├── tests/
│   ├── sut-ready.setup.ts  # waits for OrderFlow to become healthy
│   ├── framework/          # self-tests for verifyFlow's own code
│   └── api/                # API test specs
├── compose.sut.yaml     # disposable OrderFlow + PostgreSQL environment
└── playwright.config.ts
```
