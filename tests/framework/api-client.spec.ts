import { request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { ApiClient } from '../../src/api/api-client';
import { ApiExchangeLog } from '../../src/support/api-diagnostics';
import { expect, test } from '../../src/fixtures/test';

const SECRET_TOKEN = 'secret-token-value';
const SECRET_PASSWORD = 'secret-password-value';
const SECRET_QUERY = 'secret-query-value';
const SECRET_DETAIL = 'secret-detail-value';

const echoSchema = z.object({
  authorization: z.string().nullable(),
  requestId: z.string().nullable(),
});

let stubServer: Server;
let context: APIRequestContext;

test.beforeAll(async () => {
  stubServer = createServer(respond);
  await new Promise<void>((resolve) => stubServer.listen(0, '127.0.0.1', resolve));
  context = await request.newContext({ baseURL: `http://127.0.0.1:${portOf(stubServer)}` });
});

test.afterAll(async () => {
  await context.dispose();
  await new Promise<void>((resolve, reject) =>
    stubServer.close((error) => (error ? reject(error) : resolve())),
  );
});

test.describe('ApiClient', () => {
  test('sends a unique, OrderFlow-compatible request ID with every request', async () => {
    const client = new ApiClient(context, new ApiExchangeLog());

    const first = await echoed(await client.get('/echo'));
    const second = await echoed(await client.get('/echo'));

    expect(first.requestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(second.requestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(first.requestId).not.toBe(second.requestId);
  });

  test('uses a supplied request ID, or none when explicitly omitted', async () => {
    const client = new ApiClient(context, new ApiExchangeLog());

    const supplied = await echoed(await client.get('/echo', { requestId: 'custom-id-1' }));
    const omitted = await echoed(await client.get('/echo', { requestId: null }));

    expect(supplied.requestId).toBe('custom-id-1');
    expect(omitted.requestId).toBeNull();
  });

  test('withToken returns an independent client and leaves the original anonymous', async () => {
    const anonymous = new ApiClient(context, new ApiExchangeLog());
    const authenticated = anonymous.withToken('token-a');

    const fromAuthenticated = await echoed(await authenticated.get('/echo'));
    const fromAnonymous = await echoed(await anonymous.get('/echo'));

    expect(fromAuthenticated.authorization).toBe('Bearer token-a');
    expect(fromAnonymous.authorization).toBeNull();
  });

  test('records only allowlisted metadata for each exchange', async () => {
    const log = new ApiExchangeLog();
    const client = new ApiClient(context, log).withToken(SECRET_TOKEN);

    await client.post('/problem', {
      body: { password: SECRET_PASSWORD },
      params: { token: SECRET_QUERY },
    });

    const exchanges = log.entries();
    expect(exchanges).toEqual([
      {
        method: 'POST',
        path: '/problem',
        status: 409,
        requestId: expect.stringMatching(/^vf-/),
        durationMs: expect.any(Number),
        problemCode: 'EMAIL_ALREADY_REGISTERED',
      },
    ]);
    const serialized = JSON.stringify(exchanges);
    for (const secret of [SECRET_TOKEN, SECRET_PASSWORD, SECRET_QUERY, SECRET_DETAIL]) {
      expect(serialized.includes(secret), 'diagnostics must not contain secrets').toBe(false);
    }
  });

  test('reports a dropped connection without revealing request headers', async () => {
    const client = new ApiClient(context, new ApiExchangeLog()).withToken(SECRET_TOKEN);

    const failure = await failureMessage(client.get('/disconnect'));

    expect(failure).toMatch(/^GET \/disconnect failed without an HTTP response: /);
    expect(failure.includes(SECRET_TOKEN), 'message must not contain the token').toBe(false);
  });
});

test.describe('toBeProblem matcher', () => {
  test('accepts a matching problem response', async () => {
    const client = new ApiClient(context, new ApiExchangeLog());

    await expect(await client.post('/problem')).toBeProblem(409, 'EMAIL_ALREADY_REGISTERED');
    await expect(await client.post('/validation')).toBeProblem(400, 'VALIDATION_FAILED', {
      fields: ['email', 'password'],
    });
  });

  const mismatches = [
    {
      description: 'a different error code',
      path: '/problem',
      status: 409,
      code: 'DUPLICATE_SKU',
      reason: /code was EMAIL_ALREADY_REGISTERED, expected DUPLICATE_SKU/,
    },
    {
      description: 'a different HTTP status',
      path: '/problem',
      status: 400,
      code: 'EMAIL_ALREADY_REGISTERED',
      reason: /HTTP status was 409, expected 400/,
    },
    {
      description: 'a request ID that differs from the response header',
      path: '/mismatched-request-id',
      status: 409,
      code: 'EMAIL_ALREADY_REGISTERED',
      reason: /requestId does not match the X-Request-Id response header/,
    },
    {
      description: 'a non-problem content type',
      path: '/echo',
      status: 200,
      code: 'VALIDATION_FAILED',
      reason: /Content-Type was not application\/problem\+json/,
    },
  ] as const;

  for (const { description, path, status, code, reason } of mismatches) {
    test(`rejects ${description} without revealing the response body`, async () => {
      const client = new ApiClient(context, new ApiExchangeLog());
      const response = await client.post(path);

      const failure = await failureMessage(expect(response).toBeProblem(status, code));

      expect(failure).toMatch(reason);
      expect(failure.includes(SECRET_DETAIL), 'message must not contain the body').toBe(false);
    });
  }

  test('rejects validation errors for different fields', async () => {
    const client = new ApiClient(context, new ApiExchangeLog());
    const response = await client.post('/validation');

    const failure = await failureMessage(
      expect(response).toBeProblem(400, 'VALIDATION_FAILED', { fields: ['email'] }),
    );

    expect(failure).toMatch(/fields were \[email, password\], expected \[email\]/);
  });
});

async function echoed(response: APIResponse) {
  return echoSchema.parse(await response.json());
}

async function failureMessage(assertion: Promise<unknown>): Promise<string> {
  try {
    await assertion;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected the assertion to fail, but it passed.');
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Stub server is not listening on a TCP port.');
  }
  return address.port;
}

function respond(incoming: IncomingMessage, outgoing: ServerResponse): void {
  const requestId = incoming.headers['x-request-id'] ?? null;
  const path = new URL(incoming.url ?? '/', 'http://stub').pathname;
  const problem = {
    title: 'Conflict',
    status: 409,
    detail: SECRET_DETAIL,
    instance: path,
    code: 'EMAIL_ALREADY_REGISTERED',
    requestId,
  };

  switch (path) {
    case '/disconnect':
      incoming.socket.destroy();
      return;
    case '/echo':
      return send(outgoing, 200, 'application/json', requestId, {
        authorization: incoming.headers.authorization ?? null,
        requestId,
      });
    case '/problem':
      return send(outgoing, 409, 'application/problem+json', requestId, problem);
    case '/mismatched-request-id':
      return send(outgoing, 409, 'application/problem+json', requestId, {
        ...problem,
        requestId: 'some-other-request-id',
      });
    case '/validation':
      return send(outgoing, 400, 'application/problem+json', requestId, {
        ...problem,
        title: 'Bad Request',
        status: 400,
        code: 'VALIDATION_FAILED',
        errors: [
          { field: 'password', message: 'must not be null' },
          { field: 'email', message: 'must not be blank' },
          { field: 'email', message: 'must be a well-formed email address' },
        ],
      });
    default:
      return send(outgoing, 404, 'text/plain', requestId, 'not found');
  }
}

function send(
  outgoing: ServerResponse,
  status: number,
  contentType: string,
  requestId: string | string[] | null,
  body: unknown,
): void {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (typeof requestId === 'string') {
    headers['X-Request-Id'] = requestId;
  }
  outgoing.writeHead(status, headers);
  outgoing.end(JSON.stringify(body));
}
